# Phase 1 offline acceptance

Run `npm run check` on Node 24 to reproduce the offline checks. The automated suite uses synthetic data and no live API key.

| ID | Status | Evidence |
|---|---|---|
| A01 | PASS | `tests/contracts.test.mjs`, `tests/cli.test.mjs` |
| A02 | PASS | `tests/contracts.test.mjs` |
| A03 | PASS | `tests/contracts.test.mjs` |
| A04 | PASS | `tests/runtime.test.mjs`, `tests/cli.test.mjs` |
| A05 | PASS | `tests/runtime.test.mjs` |
| A06 | PASS | `tests/runtime.test.mjs` |
| A07 | PASS | `tests/cli.test.mjs` |
| A08 | PASS | `tests/runtime.test.mjs` |
| A09 | PASS | `tests/pack-check.mjs`; real tarball installs offline with an empty npm cache |
| A10 | PASS | `tests/pack-check.mjs`; separate project IDs and install directories |
| A11 | PASS | `tests/cli.test.mjs`, `tests/pack-check.mjs` |
| A12 | NOT_RUN | `npm run smoke:live` is separate and guarded. No purpose-supplied API key; no live request was made |

Linux is verified locally. The Windows CI job exists but remains unverified until it runs in GitHub Actions.
