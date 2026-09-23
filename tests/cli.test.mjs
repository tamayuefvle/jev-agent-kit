import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mixed } from './fixtures.mjs';
const cli = resolve('dist/cli/main.js');
const secret = 'very-private-api-key';
function run(cwd, args, input) { return spawnSync(process.execPath, [cli, ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: '' } }); }
test('CLI init, validate, doctor, dry-run and no overwrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev cli space '));
  const init = run(root, ['init']);
  assert.equal(init.status, 0);
  assert.equal(JSON.parse(init.stdout).command, 'init');
  const file = join(root, 'jev-kit.config.json');
  const original = await readFile(file, 'utf8');
  assert.equal(run(root, ['init']).status, 2);
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal(JSON.parse(run(root, ['config', 'validate']).stdout).data.valid, true);
  const doctor = run(root, ['doctor']);
  assert.equal(doctor.status, 3);
  assert.equal(JSON.parse(doctor.stdout).data.onlineChecked, false);
  await writeFile(join(root, 'input.json'), JSON.stringify(mixed));
  const dry = run(root, ['evaluate', '--input', 'input.json', '--dry-run']);
  assert.equal(dry.status, 0);
  const data = JSON.parse(dry.stdout).data;
  assert.equal(data.status, 'validated');
  assert.equal('answers' in data, false);
  assert.equal(run(root, ['evaluate', '--input', 'input.json']).status, 3);
  assert.equal(run(root, ['evaluate', '--input', '-','--dry-run'], JSON.stringify(mixed)).status, 0);
  assert.equal(run(root, ['evaluate']).status, 2);
  assert.equal(run(root, ['evaluate', '--input', 'input.json', '--unknown']).status, 2);
  assert.equal(run(root, ['--help']).stdout.includes('Usage:'), true);
  assert.equal(run(root, ['--version']).stdout.trim(), '0.1.0');
  for (const output of [init, doctor, dry]) {
    assert.equal(output.stdout.trim().split('\n').length, 1);
    assert.equal(output.stderr.includes(secret), false);
    assert.equal(output.stdout.includes(secret), false);
  }
});
test('CLI input byte limit applies during read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-cli-large-'));
  run(root, ['init']);
  const huge = JSON.stringify({ state: 'x'.repeat(300000), questions: mixed.questions });
  await writeFile(join(root, 'huge.json'), huge);
  const result = run(root, ['evaluate', '--input', 'huge.json', '--dry-run']);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).error.code, 'INPUT_ERROR');
  assert.equal(result.stdout.includes('xxx'), false);
});
test('CLI maps mocked provider status and contract errors to exit codes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-cli-http-'));
  run(root, ['init']);
  await writeFile(join(root, 'input.json'), JSON.stringify(mixed));
  const preload = join(root, 'mock.mjs');
  await writeFile(preload, `globalThis.fetch = async () => new Response('synthetic provider body', { status: Number(process.env.MOCK_STATUS) });`);
  for (const [status, expectedExit, code] of [[401,3,'AUTH_REJECTED'],[422,4,'PROVIDER_INPUT_REJECTED'],[503,4,'PROVIDER_HTTP_ERROR'],[200,5,'PROVIDER_CONTRACT_ERROR']]) {
    const result = spawnSync(process.execPath, ['--import', preload, cli, 'evaluate', '--input', 'input.json'], { cwd: root, encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: secret, MOCK_STATUS: String(status) } });
    assert.equal(result.status, expectedExit);
    assert.equal(JSON.parse(result.stdout).error.code, code);
    assert.equal(result.stdout.trim().split('\n').length, 1);
    assert.equal(result.stdout.includes('synthetic provider body'), false);
    assert.equal(result.stderr.includes(secret), false);
  }
  assert.equal(JSON.parse(run(root, ['init', '--unknown']).stdout).command, 'init');
});
