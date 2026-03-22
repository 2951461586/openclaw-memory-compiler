# memory-compiler

**Language: English | [中文](./README.zh-CN.md)**

[![Release](https://img.shields.io/github/v/release/2951461586/openclaw-memory-compiler?sort=semver)](https://github.com/2951461586/openclaw-memory-compiler/releases)
[![License](https://img.shields.io/github/license/2951461586/openclaw-memory-compiler)](./LICENSE)
[![Open Issues](https://img.shields.io/github/issues/2951461586/openclaw-memory-compiler)](https://github.com/2951461586/openclaw-memory-compiler/issues)
[![Stars](https://img.shields.io/github/stars/2951461586/openclaw-memory-compiler?style=social)](https://github.com/2951461586/openclaw-memory-compiler)

Derived continuity and control-plane plugin for OpenClaw.

## Install / verify at a glance

```bash
cd /path/to/your/openclaw/workspace
mkdir -p plugins

git clone https://github.com/2951461586/openclaw-memory-compiler.git plugins/memory-compiler
cd plugins/memory-compiler
npm install

openclaw gateway restart
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
npm test
npm run smoke:clean-install
npm run smoke:trusted-install
npm run check:publish
```

If those commands are green, the install surface and publish surface are in good shape.

`memory-compiler` turns source-backed inputs (workspace files, LCM recall, durable memory exports, session state) into operator/runtime artifacts such as facts, threads, continuity records, digests, session packs, source backlinks, review queues, and control-plane reports.

## What this plugin is for

Use this plugin when you want OpenClaw to:
- compile derived continuity from source-backed inputs
- keep operator-facing review / control-plane artifacts in one place
- inject tighter runtime context before prompt build
- preserve source-first behavior for precise questions

What it is **not**:
- not a vector database
- not a replacement for LCM
- not a replacement for `memory-lancedb-pro`

## Requirements

- OpenClaw `>= 2026.3.13`
- Node.js compatible with your OpenClaw install
- A writable workspace (default: `~/.openclaw/workspace`)

## Quick start

### 1) Put the plugin in your workspace

```bash
cd /path/to/your/openclaw/workspace
mkdir -p plugins
git clone https://github.com/2951461586/openclaw-memory-compiler.git plugins/memory-compiler
cd plugins/memory-compiler
npm install
```

### 2) Enable it in `openclaw.json`

Minimal config:

```json
{
  "plugins": {
    "allow": ["memory-compiler"],
    "load": {
      "paths": ["/absolute/path/to/your/openclaw/workspace/plugins/memory-compiler"]
    },
    "entries": {
      "memory-compiler": {
        "enabled": true,
        "config": {
          "enabled": true,
          "workspaceDir": "/absolute/path/to/your/openclaw/workspace",
          "controlPlaneMode": "plugin-preferred"
        }
      }
    }
  }
}
```

Notes:
- prefer **absolute paths** for `plugins.load.paths`
- `controlPlaneMode: "plugin-preferred"` is the only supported mode
- clean installs should **not** add `memory-compiler-bridge`

### 3) Restart OpenClaw

```bash
openclaw gateway restart
```

### 4) Run the operator bootstrap checks

```bash
cd plugins/memory-compiler
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

### 5) Run the package smoke checks

```bash
npm test
npm run smoke:clean-install
npm run smoke:trusted-install
npm run check:publish
```

If all four are green, you have a usable install surface.

## Install into an existing trusted workspace

If the workspace already has trusted `memory/compiler` data, keep it in place.

Recommended order:
1. enable the plugin
2. keep default data paths first
3. run `doctor`
4. run `migrate`
5. run `refresh`
6. run `verify`
7. only then do any legacy retirement work

## Common commands

```bash
node ./bin/memory-compiler.mjs doctor -
node ./bin/memory-compiler.mjs status -
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
node ./bin/memory-compiler.mjs review-triage - <<'JSON'
{
  "limit": 5
}
JSON
node ./bin/memory-compiler.mjs scheduler-plan - <<'JSON'
{
  "eventType": "heartbeat",
  "force": true
}
JSON
```

## Config highlights

Core path settings:
- `workspaceDir`: workspace root
- `dataDir`: derived data root, default `memory/compiler`
- `reportsDir`: operator reports root, default `memory/compiler/reports`
- `runtimeDir`: runtime state root, default `memory/compiler`
- `docsDir`: docs/contracts root, default `plugin:docs`
- `sessionStatePath`: default `SESSION-STATE.md`
- `workingBufferPath`: default `memory/working-buffer.md`
- `dailyMemoryDir`: default `memory`

Core behavior/settings:
- `controlPlaneMode`: `plugin-preferred` only
- `enableRuntimeBridge`
- `enableSessionLifecycle`
- `enableControlPlane`
- `preferredSourcePrefixes`
- `includeReviewTriage`
- `maxReviewItems`

See `docs/CONFIG.md` for the full reference.

## Evidence / trust stance

Default trust order:
1. `file:` source refs
2. `sum:` LCM summaries with source-bearing context
3. `mem:` durable memory support
4. session/artifact-derived context only as support

Practical rule:
- exact claims should be source-backed
- digests are continuity aids, not final proof
- control-plane output is operator evidence, not truth by assertion

## Repository boundary

If you publish or package this plugin, the publishable boundary is this directory only:

```text
plugins/memory-compiler/
```

Treat these as package-owned:
- `bin/`
- `contracts/`
- `docs/`
- `scripts/`
- `src/`
- `test/`
- `index.ts`
- `openclaw.plugin.json`
- `README.md`
- `MIGRATION.md`
- `CHANGELOG.md`
- `LICENSE`
- `package.json`

Do **not** treat workspace runtime state as publishable package content:
- `memory/compiler/`
- `_trash/`
- ad-hoc reports outside the package root
- host-specific `openclaw.json`

## FAQ

### Do I need `memory-compiler-bridge` for a fresh install?
No. Clean installs should enable `memory-compiler` directly.

### Does `migrate` move or delete my data?
No. `migrate` inspects and prepares the plugin layout. It does not destructively move trusted runtime data.

### Should I delete `memory/compiler/` during cleanup?
No. `memory/compiler/` is the active runtime/data root.

### How do I know the install is healthy?
A healthy install should pass:
- `doctor`
- `migrate`
- `refresh`
- `verify`
- `npm test`
- `npm run smoke:clean-install`
- `npm run check:publish`

### Where do I look for day-2 operator docs?
Start with:
- `docs/README.md`
- `docs/CONFIG.md`
- `docs/ARCHITECTURE.md`
- `docs/OPERATOR-REVIEW-FLOW.md`

### Do I need migration history to use this plugin?
No. Normal installs should use this README plus `docs/CONFIG.md`. `MIGRATION.md` is maintainer history, not the primary operator path.

## Docs map

- `docs/README.md` — operator docs index
- `docs/CONFIG.md` — config reference and recommended defaults
- `docs/ARCHITECTURE.md` — layering and trust boundary
- `docs/OPERATOR-REVIEW-FLOW.md` — operator review workflow
- `docs/RETIREMENT-PLAN.md` — legacy retirement boundary
- `MIGRATION.md` — maintainer migration notes / historical context

## Current product boundary

This package is ready to install, enable, validate, and operate as a plugin-first OpenClaw package.

What remains evolutionary rather than blocking:
- continued cleanup of deeper script-layer internals
- further normalization of copied MJS modules into stable TS modules
- ongoing polish of acceptance/burn-in fixture surfaces

Those are implementation refinements, not blockers for clean install / enable / doctor / migrate / refresh / verify / smoke / publish-check flows.
resh / verify / smoke / publish-check flows.
