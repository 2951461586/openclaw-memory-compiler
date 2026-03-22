# memory-compiler docs

Operator docs for the plugin-first `memory-compiler` package.

## Start here

If you are installing or enabling the plugin for normal use, start with:
1. `../README.md`
2. `CONFIG.md`

That should be enough to:
- install
- enable
- restart OpenClaw
- run `doctor`
- run `migrate`
- run `refresh`
- run `verify`
- run package smoke checks

You should **not** need migration history for a clean install.

## Operator path

### Clean install / enable
- `../README.md`
- `CONFIG.md`

### Day-2 understanding
- `ARCHITECTURE.md`
- `OPERATOR-REVIEW-FLOW.md`
- `PUBLISHING.md`

### Legacy retirement / old-node cleanup
- `RETIREMENT-PLAN.md`
- `../MIGRATION.md`

## Authority

Treat this directory as the **authoritative default docs/contracts surface** for `memory-compiler`.

Primary operator/docs entrypoints:
- `CONFIG.md`
- `ARCHITECTURE.md`
- `OPERATOR-REVIEW-FLOW.md`
- `RETIREMENT-PLAN.md`
- `MASTERPLAN.md`
- `IMPLEMENTATION-BACKLOG.md`

## Legacy docs stance

`reports/openclaw-memory-compiler/` is legacy evidence/history only.

Do not use it as the primary operator entrypoint for fresh installs.

## Practical rule

For normal installs:
- use plugin docs
- use plugin CLI
- treat migration notes as maintainer-only context
