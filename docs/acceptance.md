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
| A12 | PASS | On 2026-09-24, the first invocation passed a whole `NAME=value` line as the credential and returned `AUTH_REJECTED` after one attempt. The corrected invocation sent one synthetic request containing Noul, Choice, and Score; it passed with requested model `jev-latest`, resolved model `jev-1.13.0`, and one attempt. No key value was recorded. |

Linux passed locally and in [GitHub Actions run 35865126454](https://github.com/tamayuefvle/jev-agent-kit/actions/runs/35865126454). Windows passed in the same run. The live smoke verifies API access and the response contract for one synthetic request; it does not establish decision quality.
