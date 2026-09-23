# Roadmap

Phase 1 implements generic question validation, HTTP evaluation, config, and CLI. The following role IDs describe possible future work; no role skill or command is shipped for them:

- `context-select`: choose context for a task.
- `work-route`: route work among agents or tools.
- `action-review`: assess a proposed action before execution.
- `evidence-check`: assess cited evidence.
- `context-retain`: choose what context to preserve.

The first Phase 2 candidates are `context-select` and `work-route`. They need explicit host inputs, role-specific question designs, thresholds, and an integration boundary owned by each host project. No automatic model switch, hook, or approval action is part of Phase 1.
