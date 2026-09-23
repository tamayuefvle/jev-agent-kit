import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isSafeLogPath, type ValidatedConfig } from '../config/config.js';
import type { EvaluationResult } from '../contracts/types.js';
import { version } from '../version.js';
const redact = (value: string | undefined, secret: string): string | undefined => value === undefined ? undefined : secret && value.includes(secret) ? '[REDACTED]' : value;
export async function writeTelemetry(config: ValidatedConfig, result: EvaluationResult, questionCount: number, secret: string): Promise<void> {
  if (!config.telemetry.enabled) return;
  if (!(await isSafeLogPath(config))) throw new Error('Unsafe log path');
  const path = resolve(config.baseDir, config.telemetry.path);
  await mkdir(dirname(path), { recursive: true });
  if (!(await isSafeLogPath(config))) throw new Error('Unsafe log path');
  const event = {
    timestamp: new Date().toISOString(), kitVersion: version, projectId: redact(config.projectId, secret),
    requestedModel: redact(config.provider.model, secret), resolvedModel: result.ok ? redact(result.data.resolvedModel, secret) : undefined,
    ok: result.ok, errorCode: result.ok ? undefined : result.error.code, questionCount,
    durationMs: result.meta.durationMs, attempts: result.meta.attempts, usage: result.ok ? result.data.usage : undefined
  };
  await appendFile(path, JSON.stringify(event) + '\n', { encoding: 'utf8', flag: 'a' });
}
