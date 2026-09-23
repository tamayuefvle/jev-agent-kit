#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, defaultConfig } from '../config/config.js';
import { prepareInput } from '../contracts/input.js';
import { evaluate } from '../runtime/evaluate.js';
import { error, type KitError, type Meta } from '../contracts/types.js';
import { version } from '../version.js';

type Command = 'init' | 'config validate' | 'doctor' | 'evaluate';
type CliResult = { schemaVersion: 1; command: Command; ok: true; data: unknown; meta: Meta } | { schemaVersion: 1; command: Command; ok: false; error: KitError; data?: unknown; meta: Meta };
const usage = `jev-kit 0.1.0\nUsage:\n  jev-kit init [--config PATH]\n  jev-kit config validate [--config PATH]\n  jev-kit doctor [--config PATH]\n  jev-kit evaluate --input FILE|- [--config PATH] [--dry-run]\n  jev-kit --help | --version`;
const zero = { durationMs: 0, attempts: 0 };
const failure = (command: Command, problem: KitError): CliResult => ({ schemaVersion: 1, command, ok: false, error: problem, meta: zero });
const success = (command: Command, data: unknown): CliResult => ({ schemaVersion: 1, command, ok: true, data, meta: zero });
function exitCode(problem: KitError): number {
  switch (problem.code) {
    case 'USAGE_ERROR': case 'CONFIG_ERROR': case 'INPUT_ERROR': return 2;
    case 'AUTH_MISSING': case 'AUTH_REJECTED': return 3;
    case 'PROVIDER_INPUT_REJECTED': case 'PROVIDER_HTTP_ERROR': case 'PROVIDER_NETWORK_ERROR': case 'TIMEOUT': return 4;
    case 'PROVIDER_CONTRACT_ERROR': return 5;
    case 'LOCAL_IO_ERROR': case 'INTERNAL_ERROR': return 6;
    case 'CANCELLED': return 130;
    default: { const neverProblem: never = problem.code; return neverProblem; }
  }
}
function parse(args: string[]): { command: Command; config: string; input?: string; dryRun: boolean } | { command: Command; error: KitError } {
  let command: Command;
  if (args[0] === 'init') command = 'init';
  else if (args[0] === 'config' && args[1] === 'validate') command = 'config validate';
  else if (args[0] === 'doctor') command = 'doctor';
  else if (args[0] === 'evaluate') command = 'evaluate';
  else return { command: 'evaluate', error: error('USAGE_ERROR', '不明なコマンドです。') };
  const start = command === 'config validate' ? 2 : 1;
  let config = 'jev-kit.config.json';
  let input: string | undefined;
  let dryRun = false;
  const seen = new Set<string>();
  for (let i = start; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config' || arg === '--input') {
      if (seen.has(arg) || i + 1 >= args.length || args[i+1]?.startsWith('--')) return { command, error: error('USAGE_ERROR', '引数が無効です。') };
      seen.add(arg);
      const val = args[++i];
      if (!val) return { command, error: error('USAGE_ERROR', '引数が無効です。') };
      if (arg === '--config') config = val; else input = val;
    } else if (arg === '--dry-run' && command === 'evaluate' && !dryRun) dryRun = true;
    else return { command, error: error('USAGE_ERROR', '引数が無効です。') };
  }
  if (command === 'evaluate' && input === undefined) return { command, error: error('USAGE_ERROR', '--inputを指定してください。') };
  if (command !== 'evaluate' && (input !== undefined || dryRun)) return { command, error: error('USAGE_ERROR', '引数が無効です。') };
  return { command, config, input, dryRun };
}
async function readBounded(path: string, limit: number): Promise<unknown> {
  const stream = path === '-' ? process.stdin : createReadStream(resolve(path));
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > limit) throw new Error('TOO_LARGE');
      chunks.push(bytes);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { if (path !== '-') stream.destroy(); }
}
async function run(args: string[]): Promise<CliResult | string> {
  if (args.length === 1 && args[0] === '--help') return usage;
  if (args.length === 1 && args[0] === '--version') return version;
  const parsed = parse(args);
  if ('error' in parsed) return failure(parsed.command, parsed.error);
  const { command, config: configPath } = parsed;
  if (command === 'init') {
    try {
      const file = await open(resolve(configPath), 'wx');
      try { await file.writeFile(JSON.stringify(defaultConfig('sample-project'), null, 2) + '\n'); }
      finally { await file.close(); }
      return success(command, { path: resolve(configPath), created: true });
    } catch (cause) { return failure(command, error((cause as NodeJS.ErrnoException).code === 'EEXIST' ? 'CONFIG_ERROR' : 'LOCAL_IO_ERROR', '設定ファイルを新規作成できません。')); }
  }
  const loaded = await loadConfig(configPath);
  if (!loaded.ok) return failure(command, loaded.error);
  if (command === 'config validate') return success(command, { valid: true, projectId: loaded.config.projectId });
  if (command === 'doctor') {
    const keyPresent = !!process.env[loaded.config.provider.apiKeyEnv]?.trim();
    const data = { nodeVersion: process.versions.node, projectId: loaded.config.projectId, configValid: true, keyPresent, onlineChecked: false };
    return keyPresent ? success(command, data) : { schemaVersion: 1, command, ok: false, error: error('AUTH_MISSING', '指定された認証用環境変数が設定されていません。'), data, meta: zero };
  }
  let input: unknown;
  try { input = await readBounded(parsed.input ?? '', loaded.config.runtime.maxInputBytes); }
  catch (cause) {
    if ((cause as Error).message === 'TOO_LARGE' || cause instanceof SyntaxError) return failure(command, error('INPUT_ERROR', '入力JSONが無効または大きすぎます。'));
    return failure(command, error('LOCAL_IO_ERROR', '入力を読み込めません。'));
  }
  const prepared = prepareInput(input, loaded.config);
  if (!prepared.ok) return failure(command, prepared.error);
  if (parsed.dryRun) return success(command, { status: 'validated', questionCount: prepared.data.questionCount, requestBytes: prepared.data.requestBytes, requestedModel: loaded.config.provider.model });
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const result = await evaluate(input, loaded.config, { signal: controller.signal });
  return { schemaVersion: 1, command, ...result };
}
try {
  const result = await run(process.argv.slice(2));
  if (typeof result === 'string') process.stdout.write(result + '\n');
  else { process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = result.ok ? 0 : exitCode(result.error); }
} catch {
  const result = failure('evaluate', error('INTERNAL_ERROR', '内部エラーが発生しました。'));
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = 6;
}
