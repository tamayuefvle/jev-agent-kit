import type { EvaluationInput, PreparedInput, Question } from './types.js';
import { error } from './types.js';
import type { Config } from '../config/config.js';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const id = (v: string): boolean => idPattern.test(v) && !forbidden.has(v);
const keys = (v: Record<string, unknown>, allowed: string[]): boolean => Object.keys(v).every(k => allowed.includes(k));
function validQuestion(q: unknown): q is Question {
  if (!record(q) || !text(q.instructions)) return false;
  if (q.type === 'noul') return keys(q, ['type', 'instructions', 'criteria']) && (q.criteria === undefined || (record(q.criteria) && keys(q.criteria, ['true', 'false']) && Object.keys(q.criteria).length === 2 && text(q.criteria.true) && text(q.criteria.false)));
  if (q.type === 'choice') return keys(q, ['type', 'instructions', 'criteria']) && record(q.criteria) && Object.keys(q.criteria).length >= 2 && Object.keys(q.criteria).length <= 255 && Object.entries(q.criteria).every(([k,v]) => id(k) && text(v));
  if (q.type === 'score') return keys(q, ['type', 'instructions', 'criteria']) && Array.isArray(q.criteria) && q.criteria.length >= 2 && q.criteria.length <= 10 && q.criteria.every(text);
  return false;
}
function validJson(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value) ? value.every(x => validJson(x, seen)) : Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null ? Object.entries(value).every(([,v]) => validJson(v, seen)) : false;
  seen.delete(value);
  return valid;
}
export function prepareInput(value: unknown, config: Config): { ok: true; data: PreparedInput } | { ok: false; error: ReturnType<typeof error> } {
  if (!record(value) || !keys(value, ['state', 'questions']) || !('state' in value) || !('questions' in value) || !(text(value.state) || ((record(value.state) || Array.isArray(value.state)) && validJson(value.state))) || !record(value.questions)) return { ok: false, error: error('INPUT_ERROR', '入力形式が無効です。') };
  const questions = value.questions;
  const questionIds = Object.keys(questions);
  if (questionIds.length < 1 || questionIds.length > 64 || !questionIds.every(qid => id(qid) && validQuestion(questions[qid]))) return { ok: false, error: error('INPUT_ERROR', '質問が無効です。') };
  if (!validJson(value)) return { ok: false, error: error('INPUT_ERROR', 'JSONとして表現できない値が含まれます。') };
  const input = value as EvaluationInput;
  try {
    const body = JSON.stringify({ state: input.state, model: config.provider.model, questions: input.questions });
    const stableInput = JSON.parse(body) as EvaluationInput;
    const requestBytes = Buffer.byteLength(body);
    if (requestBytes > config.runtime.maxInputBytes) return { ok: false, error: error('INPUT_ERROR', '入力がバイト上限を超えています。') };
    return { ok: true, data: { input: stableInput, body, requestBytes, questionCount: questionIds.length } };
  } catch { return { ok: false, error: error('INPUT_ERROR', '入力をJSON化できません。') }; }
}
