# Phase 1 design decisions

## ADR-001: Keep the package independent of host projects

The package exports `loadConfig`, `validateConfig`, and `evaluate`. The CLI owns arguments, streams, output envelopes, and exit codes. The runtime owns one HTTP lifecycle and returns typed results. Host projects decide what to do with answers. The kit does not read their repositories or execute actions. The tarball bundles Ajv and its runtime dependencies so the two-project install check works with an empty npm cache.

## ADR-002: Validate at the boundaries

Draft-07 and Ajv validate config while applying defaults. Unknown config keys are rejected. The three question and answer kinds use discriminated unions, and runtime checks parse unknown JavaScript and HTTP values before returning typed data. A validated config is frozen. Request preparation serializes once and uses that snapshot for both the HTTP body and answer matching.

## ADR-003: Bound and report HTTP work

The endpoint is fixed to HTTPS. One private evaluator factory owns transport, monotonic time, wall time for HTTP-date `Retry-After`, and sleep injection for offline tests. Each attempt has a request timeout, and the total deadline includes retry waits and body reading. The runtime returns failure codes; it never inserts an affirmative answer or calls a fallback model. Retry defaults to zero because resends may be billed.

## ADR-004: Keep telemetry operational

Telemetry is opt-in. It writes allowlisted metadata after an evaluation and reports write failures as warnings. It is not a decision ledger. Path checks reject lexical escape and existing symlinks, including a check immediately before writing. Filesystem races remain possible if another process can replace a checked path.
