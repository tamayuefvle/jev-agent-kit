# jev-agent-kit

`jev-agent-kit` validates typed Jev questions, sends them to TypeSafe System One, and returns typed answers. Phase 1 provides a local CLI and a small Node API. A successful response means the HTTP exchange and answer contract passed validation. It does not approve an action or prove that the answer is correct.

This package is private at version 0.1.0. It supports Node.js 24 and ESM. It has no install script.

## Install and configure

From this repository, run:

```sh
npm ci
npm run build
npm pack
```

Install the resulting tarball in a Node 24 project with `npm install /path/to/jev-agent-kit-0.1.0.tgz`. Then create a config file in that project's current directory:

```sh
npx jev-kit init
npx jev-kit config validate
npx jev-kit doctor
```

`init` creates `jev-kit.config.json` only if the file does not exist. The default config uses the `jev-latest` alias. Pin `provider.model` to a specific version when exact model identity matters. Results retain both requested and resolved model names.

`doctor` checks Node, the config, and whether the configured environment variable contains a nonempty value. `onlineChecked: false` means it has not checked the key's validity, model availability, or access rights. Set the API key in the environment variable named by `provider.apiKeyEnv` before a live evaluation. The default name is `TYPESAFE_API_KEY`. The CLI never loads `.env` files.

## Evaluate an input

Use [examples/evaluation.json](examples/evaluation.json) as a synthetic example:

```sh
npx jev-kit evaluate --input examples/evaluation.json --dry-run
npx jev-kit evaluate --input examples/evaluation.json
```

The second command calls `https://api.typesafe.ai/v1/systemone` and may incur a charge. Run it only with a key supplied for that purpose. You can pass `--input -` to read one JSON value from stdin. `--input` is required; the CLI never waits on stdin by default. The config path defaults to `./jev-kit.config.json` without parent search. `--input` paths resolve from the current directory, while telemetry paths resolve from the config file's directory.

Dry-run validates the config and complete request without authentication or HTTP. It returns `status`, `questionCount`, `requestBytes`, and `requestedModel`. It does not return answers. The byte limit applies to the input stream and to the serialized HTTP body. Byte limits do not imply token limits.

The CLI writes one JSON document to stdout for each non-help command. Exit codes are 0 for success, 2 for arguments, config, or input; 3 for authentication; 4 for HTTP, network, timeout, or provider input rejection; 5 for invalid provider responses; 6 for local I/O or internal failure; and 130 for explicit cancellation.

## Use the Node API

```js
import { loadConfig, validateConfig, evaluate } from 'jev-agent-kit';

const loaded = await loadConfig('./jev-kit.config.json');
if (!loaded.ok) throw new Error(loaded.error.code);
const input = {
  state: 'Synthetic test item',
  questions: { check: { type: 'noul', instructions: 'Is this a test item?' } }
};
const result = await evaluate(input, loaded.config);
if (result.ok) console.log(result.data.answers);
else console.error(result.error.code);
```

`validateConfig(value)` applies defaults and resolves telemetry paths relative to the process's current directory. `loadConfig(path)` uses the config file's directory and checks existing path components for symlinks. The three public functions return discriminated results for expected errors. `evaluate` requires a config produced by the validator or loader. It does not read project files or execute returned actions.

## Limits and telemetry

A request contains 1 to 64 questions. Noul asks yes/no; Choice has 2 to 255 options; Score has 2 to 10 ordered levels. This kit accepts nonempty string instructions and descriptions. The provider supports some broader forms, which this version leaves out. The full input and response rules are in [docs/api-contract.md](docs/api-contract.md).

File telemetry is off by default. If enabled, one JSONL event records time, kit version, project ID, requested and resolved model, success or error code, question count, duration, attempts, and final response usage. It omits state, instructions, criteria, answers, key, input path, and raw HTTP bodies. A write failure adds `TELEMETRY_WRITE_FAILED` to `meta.warnings` without retrying the evaluation. The path must remain inside the config directory. Path checks reject existing symlinks, but ordinary Node path checks cannot eliminate a concurrent symlink replacement race. Keep the config and log directory under trusted ownership. Logs are operational metadata, not decision or approval records.

Retries are off by default. If enabled, the kit retries 429, 529, 502, 503, and 504 up to two times with backoff, jitter, and `Retry-After`. A retry may create an additional charge. Reported usage is from the final response only, not total billing across attempts. There is no automatic model switch or fallback answer.

## Verify locally

```sh
npm run check
```

This runs TypeScript checks, offline tests, build, and `npm pack` installation into two temporary projects. Tests use synthetic data and injected HTTP responses. They do not validate real API access or decision quality. The live smoke status for Phase 1 is `NOT_RUN` because no purpose-supplied key was available. See [docs/acceptance.md](docs/acceptance.md) for the offline evidence.
