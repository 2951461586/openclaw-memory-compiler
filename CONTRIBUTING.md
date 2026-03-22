# Contributing to memory-compiler

Thanks for contributing.

This repo is for the **plugin-first** `memory-compiler` package for OpenClaw. The project cares about three things more than almost anything else:

1. **source-first correctness** for precise questions
2. **operator-facing evidence** for runtime / control-plane behavior
3. **clean install + trusted install + publish surfaces** staying healthy

If a change makes one of those fuzzier, it probably needs to be tightened before merge.

## Before you start

Please read, in roughly this order:

- `README.md`
- `README.zh-CN.md` (if you prefer Chinese)
- `docs/CONFIG.md`
- `docs/ARCHITECTURE.md`
- `docs/OPERATOR-REVIEW-FLOW.md`
- `docs/PUBLISHING.md`
- `docs/RETIREMENT-PLAN.md` (if your change touches migration / legacy cleanup)

## Good issue shape

Before writing code, try to make the issue explicit about:

- what operator/runtime problem is being solved
- whether the change affects source-first behavior
- whether it changes install / migration / publish surfaces
- what evidence will count as done

Good evidence usually means one or more of:

- targeted tests
- `npm test`
- `npm run smoke:clean-install`
- `npm run smoke:trusted-install`
- `npm run check:publish`
- relevant `doctor` / `refresh` / `verify` output
- updated docs when operator behavior changes

## Setup

```bash
cd /path/to/your/openclaw/workspace/plugins/memory-compiler
npm install
```

## Typical validation flow

Run the smallest thing that proves your change, then broaden only if needed.

### Core test pass

```bash
npm test
```

### Install / publish surfaces

```bash
npm run smoke:clean-install
npm run smoke:trusted-install
npm run check:publish
```

### Operator path checks

```bash
node ./bin/memory-compiler.mjs doctor -
node ./bin/memory-compiler.mjs migrate -
node ./bin/memory-compiler.mjs refresh - <<'JSON'
{
  "pluginConfig": {
    "enabled": true,
    "controlPlaneMode": "plugin-preferred"
  }
}
JSON
node ./bin/memory-compiler.mjs verify - <<'JSON'
{
  "pluginConfig": {
    "enabled": true,
    "controlPlaneMode": "plugin-preferred"
  }
}
JSON
```

## Change boundaries

### Prefer

- plugin-owned docs as the authoritative default
- plugin-owned entrypoints over workspace-era operator defaults
- explicit source/evidence over hand-wavy behavior claims
- minimal diffs that still leave strong evidence behind

### Avoid

- making digest-only claims for precise scenes
- reintroducing `memory-compiler-bridge` into clean-install defaults
- moving operator defaults back toward legacy workspace surfaces
- landing docs-only changes that claim behavior not actually validated

## Pull requests

Please include:

- a short problem statement
- the main change in plain language
- risks / boundaries
- exact validation run
- any docs updated

If your change affects runtime source routing, control-plane trust, migration, or publish/install behavior, say that explicitly in the PR body.

## Documentation rule

If operator behavior changes, docs should move in the same PR.

At minimum, update whichever of these is touched by the change:

- `README.md`
- `README.zh-CN.md`
- `docs/CONFIG.md`
- `docs/ARCHITECTURE.md`
- `docs/OPERATOR-REVIEW-FLOW.md`
- `docs/PUBLISHING.md`
- `docs/RETIREMENT-PLAN.md`

## Discussions first for fuzzy scope

If the change is still fuzzy, or sequence matters more than implementation details, open a Discussion first:

- Discussions: <https://github.com/2951461586/openclaw-memory-compiler/discussions>
- Roadmap thread: <https://github.com/2951461586/openclaw-memory-compiler/discussions/1>

## Style

Keep it boring in the good way:

- direct names
- explicit evidence
- low ceremony
- no mystery operator flows

The goal is not cleverness. The goal is a plugin people can install, trust, and operate.
