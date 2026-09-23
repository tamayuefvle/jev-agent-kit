import type { Answer, EvaluationInput, Usage } from './types.js';
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const probability = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const sameKeys = (v: Record<string, unknown>, expected: string[]): boolean => Object.keys(v).length === expected.length && Object.keys(v).every(k => expected.includes(k));
function distribution(v: unknown, expected: string[]): v is Record<string, number> {
  if (!record(v) || !sameKeys(v, expected)) return false;
  const values = Object.values(v);
  if (!values.every(probability)) return false;
  return Math.abs(values.reduce((a,b) => a + b, 0) - 1) <= 1e-3;
}
export function validateResponse(value: unknown, input: EvaluationInput): { model: string; answers: Record<string, Answer>; usage: Usage } | null {
  if (!record(value) || typeof value.model !== 'string' || !value.model.trim() || !record(value.answers) || !record(value.usage)) return null;
  if (!Number.isSafeInteger(value.usage.input_tokens) || (value.usage.input_tokens as number) < 0 || !Number.isSafeInteger(value.usage.output_tokens) || (value.usage.output_tokens as number) < 0) return null;
  const ids = Object.keys(input.questions);
  if (!sameKeys(value.answers, ids)) return null;
  const answers: Record<string, Answer> = Object.create(null);
  for (const qid of ids) {
    const question = input.questions[qid];
    const answer = value.answers[qid];
    if (!question || !record(answer) || question.type !== answer.type) return null;
    switch (question.type) {
      case 'noul':
        if (!probability(answer.noul)) return null;
        answers[qid] = { type: 'noul', noul: answer.noul };
        break;
      case 'choice': {
        const options = Object.keys(question.criteria);
        if (typeof answer.choice !== 'string' || !options.includes(answer.choice) || !distribution(answer.probabilities, options) || !probability(answer.confidence)) return null;
        const probabilities = answer.probabilities;
        const chosen = probabilities[answer.choice];
        if (chosen === undefined || chosen + 1e-12 < Math.max(...Object.values(probabilities))) return null;
        answers[qid] = { type: 'choice', choice: answer.choice, probabilities, confidence: answer.confidence };
        break;
      }
      case 'score': {
        const levels = question.criteria.map((_, i) => String(i));
        if (!distribution(answer.probabilities, levels) || !record(answer.legend) || !sameKeys(answer.legend, levels) || !Object.values(answer.legend).every(v => typeof v === 'string') || !probability(answer.confidence)) return null;
        if (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > levels.length - 1) return null;
        const probabilities = answer.probabilities;
        const mean = levels.reduce((sum, level, i) => sum + i * (probabilities[level] ?? 0), 0);
        if (Math.abs(answer.score - mean) > 1e-3) return null;
        answers[qid] = { type: 'score', score: answer.score, legend: answer.legend as Record<string,string>, probabilities, confidence: answer.confidence };
        break;
      }
      default: { const neverQuestion: never = question; return neverQuestion; }
    }
  }
  return { model: value.model, answers, usage: { input_tokens: value.usage.input_tokens as number, output_tokens: value.usage.output_tokens as number } };
}
