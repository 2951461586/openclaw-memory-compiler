# Migration and legacy notes

This document is for maintainers working on older installs or the historical transition from workspace-era `memory-compiler` to the plugin-first package.

If you are doing a **normal install**, start with:
- `README.md`
- `docs/CONFIG.md`

You should not need this file to install, enable, or operate the plugin.

## Historical goal

Move from the old workspace shape:
- `scripts/memory-compiler/`
- `reports/openclaw-memory-compiler/`
- `memory/compiler/`
- `SESSION-STATE.md`
- `memory/YYYY-MM-DD.md`
- `plugins/memory-compiler-bridge/`

into a plugin-first package under:
- `plugins/memory-compiler/`

without breaking trusted runtime data.

## Current default stance

For current installs, the operator default is:
- install and enable `plugins/memory-compiler/`
- run in `plugin-preferred` mode
- use plugin docs as the default docs/contracts surface
- keep `memory/compiler/` as the active runtime/data root
- treat bridge/scripts/legacy reports as migration residue on old nodes, not as required dependencies

## What has already been completed

### Phase 1 — plugin shell and command surface
Completed.

- plugin directory created
- plugin config schema added
- plugin path abstraction added
- plugin init/bootstrap added
- plugin CLI entrypoints added
- plugin-preferred control-plane path enabled
- runtime/control-plane execution fallback to workspace legacy scripts removed
- bridge plugin reduced to compatibility-only glue during migration

### Phase 2 — mainline ownership of high-value paths
Completed for the install/operator mainline.

Mainline ownership now lives in the plugin package for:
- runtime bridge entry
- session lifecycle entry
- control-plane refresh
- control-plane verify
- compiler status wrapper
- source backlink wrapper
- review queue/apply/triage command path
- scheduler plan/enqueue/run/drain command path
- digest compiler command path
- contract schemas
- adapter-driven import path (`adapter-pipeline-run` + real/batch durable import)

Cleanups completed:
- plugin script dispatch no longer falls back to workspace `scripts/memory-compiler`
- plugin-only acceptance no longer seeds workspace script stubs
- command tests no longer depend on workspace script stubs for pipeline/digest coverage

### Phase 3 — production node retirement of legacy operator surfaces
Completed on the active three-node rollout used for validation.

Validated end state:
- direct `memory-compiler` enablement on all target nodes
- no active `memory-compiler-bridge` dependency in node config
- legacy workspace surfaces retired from active nodes and archived out of the operator path
- control plane verified to `trusted-and-clear`

## Legacy surfaces on older installs

Older nodes may still contain one or more of these:
- `scripts/memory-compiler/`
- `reports/openclaw-memory-compiler/`
- `plugins/memory-compiler-bridge/`

Interpret them like this:
- `memory/compiler/` = active runtime/data root (**keep**)
- `scripts/memory-compiler/` = legacy operator surface (**retire after readiness check**)
- `reports/openclaw-memory-compiler/` = legacy docs/evidence surface (**retire after operator path has moved to plugin docs**)
- `plugins/memory-compiler-bridge/` = compatibility residue (**retire after direct plugin enablement is live**)

## Recommended retirement workflow for older nodes

1. verify direct `memory-compiler` enablement in `openclaw.json`
2. run:
   - `doctor`
   - `migrate`
   - `refresh`
   - `verify`
3. confirm the node reaches `trusted-and-clear`
4. archive old legacy surfaces out of the active workspace path
5. re-run `refresh` and `verify`
6. restart the gateway and re-verify

## What `migrate` does not do

`migrate` is intentionally non-destructive.

It does **not**:
- delete trusted runtime data
- force-move `memory/compiler/`
- rewrite every historical workspace script
- auto-retire old bridge-only setups without an operator decision

## Maintainer note

The remaining work after this migration is productization/polish work, not “make the plugin basically usable” work.

That includes:
- deeper normalization of script-layer internals into stable modules
- ongoing packaging/documentation polish
- keeping clean-install, publish-check, and operator-facing docs aligned
