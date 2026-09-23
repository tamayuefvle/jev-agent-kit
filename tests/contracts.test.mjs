import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../dist/index.js';
import { defaultConfig } from '../dist/config/config.js';
import { readFileSync } from 'node:fs';
import { prepareInput } from '../dist/contracts/input.js';
import { validateResponse } from '../dist/contracts/response.js';

const config = validateConfig({ schemaVersion: 1, projectId: 'project-a' });
assert.equal(config.ok, true);
import { mixed, response } from './fixtures.mjs';
test('config defaults, unknown fields, version, and immutable output', () => {
  assert.equal(config.config.runtime.maxRetries, 0);
  assert.equal(config.config.provider.model, 'jev-latest');
  assert.equal(validateConfig({ schemaVersion: 2, projectId: 'a' }).ok, false);
  assert.equal(validateConfig({ schemaVersion: 1, projectId: 'a', extra: true }).ok, false);
  assert.equal(validateConfig({ schemaVersion: 1, projectId: 'a', runtime: { requestTimeoutMs: 5000, totalTimeoutMs: 1000 } }).ok, false);
  assert.equal(validateConfig({ schemaVersion: 1, projectId: 'a', telemetry: { path: '../escape' } }).ok, false);
  assert.equal(Object.isFrozen(config.config.runtime), true);
});
test('three question kinds and mixed request validate', () => {
  const prepared = prepareInput(mixed, config.config);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.data.questionCount, 3);
  assert.equal(prepareInput({ ...mixed, state: '   ' }, config.config).ok, false);
  assert.equal(prepareInput({ ...mixed, state: null }, config.config).ok, false);
  assert.equal(prepareInput({ ...mixed, extra: 1 }, config.config).ok, false);
  assert.equal(prepareInput({ ...mixed, questions: {} }, config.config).ok, false);
  assert.equal(prepareInput({ ...mixed, questions: { constructor: mixed.questions.yes } }, config.config).ok, false);
  assert.equal(prepareInput({ ...mixed, questions: { a: { type: 'choice', instructions: 'q', criteria: { a: 'a' } } } }, config.config).ok, false);
  assert.equal(prepareInput({ ...mixed, questions: { a: { type: 'score', instructions: 'q', criteria: ['low'] } } }, config.config).ok, false);
  assert.equal(prepareInput({ ...mixed, questions: { a: { type: 'noul', instructions: 'q', criteria: { true: 'yes' } } } }, config.config).ok, false);
  const circular = {}; circular.self = circular;
  assert.equal(prepareInput({ ...mixed, state: circular }, config.config).ok, false);
  assert.equal(prepareInput({ ...mixed, state: { number: Infinity } }, config.config).ok, false);
});
test('response contracts match ids, types, ranges, distributions, and score mean', () => {
  assert.ok(validateResponse(response, mixed));
  for (const changed of [
    { ...response, answers: { ...response.answers, extra: response.answers.yes } },
    { ...response, answers: { route: response.answers.route, impact: response.answers.impact } },
    { ...response, answers: { ...response.answers, yes: { type: 'noul', noul: NaN } } },
    { ...response, answers: { ...response.answers, route: { ...response.answers.route, type: 'score' } } },
    { ...response, answers: { ...response.answers, route: { ...response.answers.route, probabilities: { a: 0.4, b: 0.4 } } } },
    { ...response, answers: { ...response.answers, route: { ...response.answers.route, choice: 'b' } } },
    { ...response, answers: { ...response.answers, impact: { ...response.answers.impact, score: 0.5 } } },
    { ...response, usage: { input_tokens: -1, output_tokens: 2 } }
  ]) assert.equal(validateResponse(changed, mixed), null);
});
test('question and option boundaries are kit limits', () => {
  const questions64 = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`q${i}`, { type: 'noul', instructions: 'Question?' }]));
  assert.equal(prepareInput({ state: 'x', questions: questions64 }, config.config).ok, true);
  assert.equal(prepareInput({ state: 'x', questions: { ...questions64, q64: { type: 'noul', instructions: 'Question?' } } }, config.config).ok, false);
  const options255 = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`option${i}`, `Option ${i}`]));
  const choice = { state: 'x', questions: { pick: { type: 'choice', instructions: 'Choose', criteria: options255 } } };
  assert.equal(prepareInput(choice, config.config).ok, true);
  assert.equal(prepareInput({ ...choice, questions: { pick: { ...choice.questions.pick, criteria: { ...options255, overflow: 'no' } } } }, config.config).ok, false);
  const score = { state: 'x', questions: { rate: { type: 'score', instructions: 'Rate', criteria: Array.from({ length: 10 }, (_, i) => String(i)) } } };
  assert.equal(prepareInput(score, config.config).ok, true);
  score.questions.rate.criteria.push('overflow');
  assert.equal(prepareInput(score, config.config).ok, false);
});
test('serialized HTTP request is also byte limited', () => {
  const tiny = validateConfig({ schemaVersion: 1, projectId: 'a', runtime: { maxInputBytes: 1024 } });
  assert.equal(tiny.ok, true);
  assert.equal(prepareInput({ ...mixed, state: 'x'.repeat(1000) }, tiny.config).ok, false);
});
test('schema defaults match the generated init config', () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/jev-kit.config.schema.json', import.meta.url), 'utf8'));
  const generated = defaultConfig('sample-project');
  for (const section of ['provider', 'runtime', 'telemetry']) {
    for (const [key, definition] of Object.entries(schema.properties[section].properties)) assert.deepEqual(generated[section][key], definition.default);
  }
  const validated = validateConfig({ schemaVersion: 1, projectId: 'sample-project' });
  assert.equal(validated.ok, true);
  for (const section of ['provider', 'runtime', 'telemetry']) assert.deepEqual(validated.config[section], generated[section]);
});
test('config rejects non-JSON sections and Windows drive paths', () => {
  assert.equal(validateConfig({ schemaVersion: 1, projectId: 'a', provider: new Date() }).ok, false);
  assert.equal(validateConfig({ schemaVersion: 1, projectId: 'a', telemetry: { path: 'C:relative.log' } }).ok, false);
});
test('loadConfig rejects an existing symlink in a telemetry path', async () => {
  const { mkdtemp, writeFile, symlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { loadConfig } = await import('../dist/index.js');
  const root = await mkdtemp(join(tmpdir(), 'jev-config-path-'));
  const outside = await mkdtemp(join(tmpdir(), 'jev-config-outside-'));
  await symlink(outside, join(root, 'logs'), process.platform === 'win32' ? 'junction' : 'dir');
  const path = join(root, 'jev-kit.config.json');
  await writeFile(path, JSON.stringify({ schemaVersion: 1, projectId: 'a', telemetry: { enabled: true, path: 'logs/events.jsonl' } }));
  const result = await loadConfig(path);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CONFIG_ERROR');
});
