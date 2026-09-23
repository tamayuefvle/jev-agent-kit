import AjvModule from 'ajv';
const Ajv = AjvModule.default;
import { readFile, realpath, lstat } from 'node:fs/promises';
import { isAbsolute, resolve, dirname, relative, sep, parse } from 'node:path';
import type { KitError } from '../contracts/types.js';
import { error } from '../contracts/types.js';

export type Config = {
  schemaVersion: 1; projectId: string;
  provider: { model: string; apiKeyEnv: string };
  runtime: { requestTimeoutMs: number; totalTimeoutMs: number; maxRetries: number; maxInputBytes: number };
  telemetry: { enabled: boolean; path: string };
};
const validated = new WeakSet<object>();
export type ValidatedConfig = Readonly<{
  schemaVersion: 1; projectId: string;
  provider: Readonly<Config['provider']>;
  runtime: Readonly<Config['runtime']>;
  telemetry: Readonly<Config['telemetry']>;
  baseDir: string;
}>;
export type ConfigResult = { ok: true; config: ValidatedConfig } | { ok: false; error: KitError };
export const defaultConfig = (projectId: string): Config => ({ schemaVersion: 1, projectId, provider: { model: 'jev-latest', apiKeyEnv: 'TYPESAFE_API_KEY' }, runtime: { requestTimeoutMs: 10000, totalTimeoutMs: 30000, maxRetries: 0, maxInputBytes: 262144 }, telemetry: { enabled: false, path: '.jev-kit/events.jsonl' } });
const schemaUrl = new URL('../../schemas/jev-kit.config.schema.json', import.meta.url);

function isPlainJson(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  seen.add(value);
  const valid = Reflect.ownKeys(value).every(key => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor && isPlainJson(descriptor.value, seen);
  });
  seen.delete(value);
  return valid;
}
const validPath = (path: string): boolean => path.length > 0 && !isAbsolute(path) && !path.split(/[\\/]/).includes('..') && !path.split(/[\\/]/).includes('.') && !path.includes('\\') && !path.includes(':') && parse(path).root === '';
export function validateConfig(value: unknown): ConfigResult { return validateAt(value, process.cwd()); }
function validateAt(value: unknown, baseDir: string): ConfigResult {
  try {
    if (!isPlainJson(value)) return { ok: false, error: error('CONFIG_ERROR', '設定はJSON値で指定してください。') };
    const schema = JSON.parse(requireSchema()) as object;
    const ajv = new Ajv({ allErrors: true, useDefaults: true, coerceTypes: false, removeAdditional: false, strict: false });
    const candidate = structuredClone(value);
    if (!ajv.validate(schema, candidate)) return { ok: false, error: error('CONFIG_ERROR', '設定がスキーマに一致しません。') };
    const config = candidate as Config;
    if (config.runtime.requestTimeoutMs > config.runtime.totalTimeoutMs || !validPath(config.telemetry.path)) return { ok: false, error: error('CONFIG_ERROR', '設定の期限またはログパスが無効です。') };
    const result = Object.freeze({ ...config, provider: Object.freeze(config.provider), runtime: Object.freeze(config.runtime), telemetry: Object.freeze(config.telemetry), baseDir: resolve(baseDir) });
    validated.add(result);
    return { ok: true, config: result };
  } catch { return { ok: false, error: error('CONFIG_ERROR', '設定を検証できません。') }; }
}
import { readFileSync } from 'node:fs';
function requireSchema(): string { return readFileSync(schemaUrl, 'utf8'); }
export async function loadConfig(path: string): Promise<ConfigResult> {
  try {
    const abs = resolve(path);
    const raw = await readFile(abs, 'utf8');
    let parsed: unknown;
    try { parsed = JSON.parse(raw) as unknown; }
    catch { return { ok: false, error: error('CONFIG_ERROR', '設定JSONが無効です。') }; }
    const result = validateAt(parsed, dirname(abs));
    if (result.ok && !(await isSafeLogPath(result.config))) return { ok: false, error: error('CONFIG_ERROR', 'ログパスが設定ディレクトリの外を指します。') };
    return result;
  } catch { return { ok: false, error: error('LOCAL_IO_ERROR', '設定ファイルを読み込めません。') }; }
}
export function isValidatedConfig(value: unknown): value is ValidatedConfig { return typeof value === 'object' && value !== null && validated.has(value); }
export async function isSafeLogPath(config: ValidatedConfig): Promise<boolean> {
  const base = await realpath(config.baseDir);
  const target = resolve(base, config.telemetry.path);
  const segments = relative(base, target).split(sep);
  if (segments[0] === '..' || isAbsolute(relative(base, target))) return false;
  let current = base;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) return false;
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  }
  return true;
}
