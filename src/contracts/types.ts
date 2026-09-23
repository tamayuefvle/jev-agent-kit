export type Question =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };
export type EvaluationInput = { state: string | Record<string, unknown> | unknown[]; questions: Record<string, Question> };
export type Answer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number };
export type Usage = { input_tokens: number; output_tokens: number };
export type KitErrorCode = 'CONFIG_ERROR' | 'INPUT_ERROR' | 'AUTH_MISSING' | 'AUTH_REJECTED' | 'PROVIDER_INPUT_REJECTED' | 'PROVIDER_HTTP_ERROR' | 'PROVIDER_NETWORK_ERROR' | 'PROVIDER_CONTRACT_ERROR' | 'TIMEOUT' | 'CANCELLED' | 'LOCAL_IO_ERROR' | 'INTERNAL_ERROR' | 'USAGE_ERROR';
export type KitError = { code: KitErrorCode; message: string; retryable: boolean; status?: number };
export type Meta = { durationMs: number; attempts: number; warnings?: 'TELEMETRY_WRITE_FAILED'[] };
export type EvaluationResult =
  | { ok: true; data: { requestedModel: string; resolvedModel: string; answers: Record<string, Answer>; usage: Usage }; meta: Meta }
  | { ok: false; error: KitError; meta: Meta };
export type PreparedInput = { input: EvaluationInput; body: string; requestBytes: number; questionCount: number };
export const error = (code: KitErrorCode, message: string, status?: number): KitError => ({ code, message, retryable: code === 'PROVIDER_HTTP_ERROR' && status !== undefined && [429, 529, 502, 503, 504].includes(status), ...(status === undefined ? {} : { status }) });
