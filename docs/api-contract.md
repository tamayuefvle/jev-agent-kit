# API contract

Verified against the [TypeSafe API reference](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), and [Noul](https://docs.typesafe.ai/primitives/noul) on 2026-09-23. No difference from the Phase 1 design was found in the endpoint or the three answer shapes. The provider accepts broader structured instructions and criteria than this kit's first version.

The kit sends `POST https://api.typesafe.ai/v1/systemone` with Bearer authorization and a JSON body containing `state`, configured `model`, and `questions`. It does not accept a configurable host or follow redirects. The provider returns `model`, `answers`, and `usage`. The kit strips other provider metadata.

| Question | Input | Answer |
|---|---|---|
| Noul | `type: "noul"`, string `instructions`, optional `criteria.true` and `criteria.false` descriptions | `type: "noul"`, `noul` probability from 0 to 1 |
| Choice | `type: "choice"`, string `instructions`, map of 2 to 255 named descriptions | `type: "choice"`, `choice`, `probabilities`, `confidence` |
| Score | `type: "score"`, string `instructions`, array of 2 to 10 ordered descriptions | `type: "score"`, weighted `score`, `legend`, `probabilities`, `confidence` |

Noul has no separate confidence field. Score is indexed from 0 through the last level; it is not a normalized quality score. The kit requires probabilities to sum to 1 within `1e-3` and the Score value to match their weighted mean within `1e-3`. This tolerance is kit policy, not a published provider precision guarantee.

Question IDs and Choice option IDs use 1 to 64 characters, start with an ASCII letter or digit, and continue with ASCII letters, digits, underscores, or hyphens. `__proto__`, `prototype`, and `constructor` are forbidden. The kit limits requests to 1 to 64 questions and rejects unknown input control fields. `state` is a nonblank string, JSON object, or JSON array. Nested JSON values may include null, booleans, and finite numbers. The kit rejects non-JSON JavaScript values and cycles. The serialized request must fit `runtime.maxInputBytes`.

A successful response must contain the exact question ID set and matching types. Choice must select a maximum-probability option, and its probability keys must match the requested option set. Score legend and probability keys must match level indices. Usage counts must be nonnegative integers. Invalid 200 responses become `PROVIDER_CONTRACT_ERROR` without an answer. Additional provider metadata is ignored.

HTTP 401 and 403 map to `AUTH_REJECTED`, 422 to `PROVIDER_INPUT_REJECTED`, and other non-200 statuses to `PROVIDER_HTTP_ERROR`. Only 429, 529, 502, 503, and 504 are retryable when `maxRetries` allows them. Network failures, contract failures, input rejection, cancellation, and timeout are not retried. Successful response bodies are capped at 1 MiB while reading. Error bodies are ignored.
