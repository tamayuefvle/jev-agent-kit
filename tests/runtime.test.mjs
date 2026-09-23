import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from '../dist/index.js';
import { createEvaluator } from '../dist/runtime/evaluate.js';
import { mixed, response } from './fixtures.mjs';
const secret = 'test-key-secret';
process.env.JEV_TEST_KEY = secret;
function cfg(patch = {}) {
  const result = validateConfig({ schemaVersion: 1, projectId: 'a', provider: { apiKeyEnv: 'JEV_TEST_KEY' }, ...patch });
  assert.equal(result.ok, true);
  return result.config;
}
function body(value = response, init = {}) { return new Response(JSON.stringify(value), { status: 200, ...init }); }
test('successful mixed evaluation uses fixed endpoint and expected request', async () => {
  let calls = 0;
  const evaluate = createEvaluator({ fetch: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(init.redirect, 'error');
    assert.equal(JSON.parse(init.body).model, 'jev-latest');
    return body();
  } });
  const result = await evaluate(mixed, cfg());
  assert.equal(result.ok, true);
  assert.equal(result.data.answers.impact.score, 0.25);
  assert.equal(calls, 1);
});
test('missing key and bad input never send', async () => {
  let calls = 0;
  const evaluate = createEvaluator({ fetch: async () => { calls++; return body(); } });
  const missing = cfg({ provider: { apiKeyEnv: 'UNSET_JEV_TEST_KEY' } });
  assert.equal((await evaluate(mixed, missing)).error.code, 'AUTH_MISSING');
  assert.equal((await evaluate({ state: 'x', questions: {} }, cfg())).error.code, 'INPUT_ERROR');
  assert.equal(calls, 0);
});
test('contract errors and HTTP failures stay failures', async () => {
  for (const [reply, code] of [[body({ ...response, answers: {} }), 'PROVIDER_CONTRACT_ERROR'], [new Response('secret provider body', { status: 401 }), 'AUTH_REJECTED'], [new Response('', { status: 422 }), 'PROVIDER_INPUT_REJECTED']]) {
    const result = await createEvaluator({ fetch: async () => reply.clone() })(mixed, cfg());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.equal('answers' in result, false);
    assert.equal(JSON.stringify(result).includes('secret provider body'), false);
  }
});
test('retry statuses, Retry-After HTTP date, and total deadline', async () => {
  let clock = 0;
  let calls = 0;
  const waits = [];
  const evaluate = createEvaluator({ now: () => clock, wallNow: () => Date.UTC(2026, 0, 1), random: () => 0, sleep: async ms => { waits.push(ms); clock += ms; }, fetch: async () => { calls++; return calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': 'Thu, 01 Jan 2026 00:00:02 GMT' } }) : body(); } });
  const result = await evaluate(mixed, cfg({ runtime: { maxRetries: 1 } }));
  assert.equal(result.ok, true);
  assert.equal(result.meta.attempts, 2);
  assert.deepEqual(waits, [2000]);
  const deadline = await createEvaluator({ now: () => 0, random: () => 0, fetch: async () => new Response('', { status: 503, headers: { 'retry-after': '100' } }) })(mixed, cfg({ runtime: { maxRetries: 2 } }));
  assert.equal(deadline.error.code, 'TIMEOUT');
  assert.equal(deadline.meta.attempts, 1);
});
test('request timeout and explicit cancellation', async () => {
  const evaluate = createEvaluator({ timer: callback => { queueMicrotask(callback); return () => undefined; }, fetch: async (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  const timeout = await evaluate(mixed, cfg({ runtime: { requestTimeoutMs: 1000, totalTimeoutMs: 1000 } }));
  assert.equal(timeout.error.code, 'TIMEOUT');
  const controller = new AbortController();
  controller.abort();
  const cancelled = await evaluate(mixed, cfg(), { signal: controller.signal });
  assert.equal(cancelled.error.code, 'CANCELLED');
  assert.equal(cancelled.meta.attempts, 0);
});
test('telemetry allowlist, disabled mode, and write failure do not resend', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-logs-'));
  const previous = process.cwd();
  process.chdir(root);
  try {
    let calls = 0;
    const evaluate = createEvaluator({ fetch: async () => { calls++; return body(); } });
    const disabled = cfg();
    await evaluate(mixed, disabled);
    const enabled = cfg({ telemetry: { enabled: true, path: 'logs/events.jsonl' } });
    const result = await evaluate(mixed, enabled);
    assert.equal(result.ok, true);
    const log = await readFile(join(root, 'logs/events.jsonl'), 'utf8');
    assert.equal(log.trim().split('\n').length, 1);
    for (const sensitive of [secret, 'synthetic failure', 'Choose a team', '0.25']) assert.equal(log.includes(sensitive), false);
    await symlink(tmpdir(), join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const unsafe = cfg({ telemetry: { enabled: true, path: 'escape/events.jsonl' } });
    const warned = await evaluate(mixed, unsafe);
    assert.deepEqual(warned.meta.warnings, ['TELEMETRY_WRITE_FAILED']);
    assert.equal(calls, 3);
  } finally { process.chdir(previous); }
});
test('response byte limit and invalid UTF-8 produce contract failure', async () => {
  const oversized = new Response(new Uint8Array(1048577));
  const badUtf8 = new Response(new Uint8Array([0xff]));
  for (const reply of [oversized, badUtf8]) {
    const result = await createEvaluator({ fetch: async () => reply })(mixed, cfg());
    assert.equal(result.error.code, 'PROVIDER_CONTRACT_ERROR');
  }
});
test('retry maximum and cancellation during wait', async () => {
  let calls = 0;
  const controller = new AbortController();
  const retrying = createEvaluator({ fetch: async () => { calls++; return new Response('', { status: 503 }); }, random: () => 0, sleep: async () => undefined });
  const ended = await retrying(mixed, cfg({ runtime: { maxRetries: 2 } }));
  assert.equal(ended.error.code, 'PROVIDER_HTTP_ERROR');
  assert.equal(ended.meta.attempts, 3);
  assert.equal(calls, 3);
  let waitCalls = 0;
  const duringWait = createEvaluator({ fetch: async () => new Response('', { status: 429 }), sleep: async () => { waitCalls++; controller.abort(); throw new Error('aborted'); } });
  const cancelled = await duringWait(mixed, cfg({ runtime: { maxRetries: 1 } }), { signal: controller.signal });
  assert.equal(cancelled.error.code, 'CANCELLED');
  assert.equal(waitCalls, 1);
});
test('cancellation interrupts a pending response body read', async () => {
  const controller = new AbortController();
  const stalled = new ReadableStream({ cancel() {} });
  const evaluate = createEvaluator({ fetch: async () => new Response(stalled, { status: 200 }) });
  const running = evaluate(mixed, cfg(), { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  const result = await running;
  assert.equal(result.error.code, 'CANCELLED');
});
