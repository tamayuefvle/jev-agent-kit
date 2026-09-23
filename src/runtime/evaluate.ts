import { setTimeout as sleepTimer } from 'node:timers/promises';
import { isValidatedConfig, type ValidatedConfig } from '../config/config.js';
import { prepareInput } from '../contracts/input.js';
import { validateResponse } from '../contracts/response.js';
import { error, type EvaluationResult, type KitError, type PreparedInput } from '../contracts/types.js';
import { writeTelemetry } from './telemetry.js';

const endpoint = 'https://api.typesafe.ai/v1/systemone';
const maxResponseBytes = 1048576;
export type EvaluateOptions = { signal?: AbortSignal };
type Dependencies = { fetch: typeof fetch; now: () => number; wallNow: () => number; sleep: (ms: number, signal?: AbortSignal) => Promise<void>; random: () => number; timer: (callback: () => void, ms: number) => () => void };
const defaults: Dependencies = { fetch: globalThis.fetch, now: () => performance.now(), wallNow: () => Date.now(), sleep: (ms, signal) => sleepTimer(ms, undefined, { signal }).then(() => undefined), random: Math.random, timer: (callback, ms) => { const handle = setTimeout(callback, ms); return () => clearTimeout(handle); } };
const failed = (problem: KitError, start: number, now: () => number, attempts: number): EvaluationResult => ({ ok: false, error: problem, meta: { durationMs: Math.max(0, Math.round(now() - start)), attempts } });
const cancelled = () => error('CANCELLED', '評価がキャンセルされました。');
const timedOut = () => error('TIMEOUT', '評価の期限を超えました。');
function retryAfter(value: string | null, wallNow: number): number | null {
  if (value === null) return null;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Math.max(0, Number(value) * 1000);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.max(0, parsed - wallNow);
}
async function readLimited(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error('empty body');
  const reader = response.body.getReader();
  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxResponseBytes) throw new Error('response too large');
      chunks.push(next.value);
    }
  } finally { signal.removeEventListener('abort', onAbort); await reader.cancel().catch(() => undefined); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
}
export function createEvaluator(injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  return async function evaluate(input: unknown, config: ValidatedConfig, options: EvaluateOptions = {}): Promise<EvaluationResult> {
    const start = deps.now();
    const finish = async (result: EvaluationResult, questionCount: number, secret: string): Promise<EvaluationResult> => {
      try { await writeTelemetry(config, result, questionCount, secret); }
      catch { result.meta.warnings = ['TELEMETRY_WRITE_FAILED']; }
      return result;
    };
    if (!isValidatedConfig(config)) return failed(error('CONFIG_ERROR', '検証済み設定が必要です。'), start, deps.now, 0);
    const prepared = prepareInput(input, config);
    if (!prepared.ok) return finish(failed(prepared.error, start, deps.now, 0), 0, '');
    const key = process.env[config.provider.apiKeyEnv]?.trim() ?? '';
    if (!key) return finish(failed(error('AUTH_MISSING', '指定された認証用環境変数が設定されていません。'), start, deps.now, 0), prepared.data.questionCount, '');
    if (options.signal?.aborted) return finish(failed(cancelled(), start, deps.now, 0), prepared.data.questionCount, key);
    const result = await runRequest(prepared.data, config, key, options.signal, deps, start);
    return finish(result, prepared.data.questionCount, key);
  };
}
async function runRequest(prepared: PreparedInput, config: ValidatedConfig, key: string, external: AbortSignal | undefined, deps: Dependencies, start: number): Promise<EvaluationResult> {
  const deadline = deps.now() + config.runtime.totalTimeoutMs;
  let attempts = 0;
  for (;;) {
    if (external?.aborted) return failed(cancelled(), start, deps.now, attempts);
    const remaining = deadline - deps.now();
    if (remaining <= 0) return failed(timedOut(), start, deps.now, attempts);
    attempts++;
    const controller = new AbortController();
    const onAbort = () => controller.abort(external?.reason);
    external?.addEventListener('abort', onAbort, { once: true });
    const cancelTimer = deps.timer(() => controller.abort(new Error('deadline')), Math.min(remaining, config.runtime.requestTimeoutMs));
    let response: Response;
    try {
      response = await deps.fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: prepared.body, redirect: 'error', signal: controller.signal });
      if (response.status === 200) {
        let decoded: unknown;
        try { decoded = await readLimited(response, controller.signal); }
        catch (cause) {
          if (external?.aborted) return failed(cancelled(), start, deps.now, attempts);
          if (controller.signal.aborted) return failed(timedOut(), start, deps.now, attempts);
          return failed(error('PROVIDER_CONTRACT_ERROR', 'API応答を解釈できません。'), start, deps.now, attempts);
        }
        const valid = validateResponse(decoded, prepared.input);
        if (!valid) return failed(error('PROVIDER_CONTRACT_ERROR', 'API応答が契約に一致しません。'), start, deps.now, attempts);
        return { ok: true, data: { requestedModel: config.provider.model, resolvedModel: valid.model, answers: valid.answers, usage: valid.usage }, meta: { durationMs: Math.max(0, Math.round(deps.now() - start)), attempts } };
      }
      if (response.status === 401 || response.status === 403) return failed(error('AUTH_REJECTED', 'API認証が拒否されました。', response.status), start, deps.now, attempts);
      if (response.status === 422) return failed(error('PROVIDER_INPUT_REJECTED', 'APIが入力を拒否しました。', response.status), start, deps.now, attempts);
      const problem = error('PROVIDER_HTTP_ERROR', 'APIがエラーを返しました。', response.status);
      if (!problem.retryable || attempts > config.runtime.maxRetries) return failed(problem, start, deps.now, attempts);
      const after = retryAfter(response.headers.get('retry-after'), deps.wallNow());
      const backoff = Math.round(250 * 2 ** (attempts - 1) * (0.5 + deps.random()));
      const delay = Math.max(after ?? 0, backoff);
      if (delay >= deadline - deps.now()) return failed(timedOut(), start, deps.now, attempts);
      try { await deps.sleep(delay, external); }
      catch { return failed(external?.aborted ? cancelled() : timedOut(), start, deps.now, attempts); }
    } catch {
      if (external?.aborted) return failed(cancelled(), start, deps.now, attempts);
      if (controller.signal.aborted || deps.now() >= deadline) return failed(timedOut(), start, deps.now, attempts);
      return failed(error('PROVIDER_NETWORK_ERROR', 'APIとの通信に失敗しました。'), start, deps.now, attempts);
    } finally {
      cancelTimer();
      external?.removeEventListener('abort', onAbort);
    }
  }
}
export const evaluate = createEvaluator();
