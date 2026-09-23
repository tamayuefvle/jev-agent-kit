import { validateConfig, evaluate } from '../dist/index.js';

if (process.env.JEV_LIVE_SMOKE !== '1' || !process.env.TYPESAFE_API_KEY?.trim()) {
  process.stdout.write(JSON.stringify({ status: 'NOT_RUN', reason: 'Set JEV_LIVE_SMOKE=1 and a purpose-supplied TYPESAFE_API_KEY.' }) + '\n');
  process.exitCode = 2;
} else {
  const config = validateConfig({ schemaVersion: 1, projectId: 'live-smoke', runtime: { maxRetries: 0 } });
  if (!config.ok) throw new Error(config.error.code);
  const input = {
    state: 'This is a synthetic test item. No user or business data is included.',
    questions: {
      synthetic: { type: 'noul', instructions: 'Is the state describing synthetic test data?' },
      category: { type: 'choice', instructions: 'Choose the category', criteria: { test: 'Synthetic test content', other: 'Other content' } },
      clarity: { type: 'score', instructions: 'Rate how explicit the state is', criteria: ['Unclear', 'Somewhat clear', 'Explicit'] }
    }
  };
  const result = await evaluate(input, config.config);
  process.stdout.write(JSON.stringify(result.ok ? { status: 'PASS', requestedModel: result.data.requestedModel, resolvedModel: result.data.resolvedModel, attempts: result.meta.attempts } : { status: 'FAIL', code: result.error.code, attempts: result.meta.attempts }) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}
