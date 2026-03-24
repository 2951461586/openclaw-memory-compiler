# Retirement plan

## Scope

This file freezes the cleanup boundary for the plugin-first migration of `memory-compiler`.

It exists to prevent destructive cleanup against active runtime state while the package is still in pre-retirement mode.

## Current retirement status (2026-03-24)

On maintained nodes (`violet` / `laoda` / `lebang`), the workspace-root legacy surfaces have now been formally retired and removed:
- `scripts/memory-compiler/`
- `reports/openclaw-memory-compiler/`
- `plugins/memory-compiler-bridge/`

This does **not** change the hard keep rule for `memory/compiler/`, which remains the live runtime/data root.

Treat this file as the boundary record explaining **what was safe to remove** and **what must still never be cleaned as legacy junk**.

## Hard boundary: do not delete

### `memory/compiler/`
Status: **active runtime/data root**

Treat this as live state, not as cleanup junk.
It currently holds runtime/compiler data such as:
- facts / threads / continuity
- digests / manifests / indexes
- control-plane outputs and operator reports
- source backlinks
- review queue / scheduler state
- session packs / handoffs

Rules:
- do not delete
- do not archive as legacy
- do not move during early retirement work
- only change through explicit data migration plans

## Legacy retirement surfaces

### `scripts/memory-compiler/`
Status: **retired residue / compatibility evidence only**

Rules:
- no longer a supported execution surface
- plugin-owned modules now cover operator/runtime flows
- any remaining files here should be treated as archive/remove candidates once local out-of-band callers are gone

### `reports/openclaw-memory-compiler/`
Status: **supported legacy docs/contracts surface**

Rules:
- no longer the default docs surface
- plugin-owned docs live under `plugins/memory-compiler/docs/`
- retire only after fixtures/evidence/default references stop depending on the legacy path

### `plugins/memory-compiler-bridge/`
Status: **compatibility bridge**

Rules:
- keep only while node configs or compat installs still depend on it
- prefer direct `memory-compiler` plugin runtime ownership going forward
- retire only after node configs stop depending on bridge behavior

## Working categories

### keep
- `memory/compiler/`
- plugin-owned docs/contracts under `plugins/memory-compiler/`
- plugin runtime/control-plane package entrypoints

### shrink / convert
- `scripts/memory-compiler/`
- `plugins/memory-compiler-bridge/`

### demote from primary source
- `reports/openclaw-memory-compiler/`

## Readiness gates before destructive retirement

All of the following should be true before deleting legacy surfaces:

1. plugin-preferred operator/runtime flows no longer require workspace legacy scripts
2. plugin-owned docs/contracts are the effective default with no critical legacy hard refs
3. acceptance / burn-in / fixtures no longer depend on legacy docs/scripts paths by default
4. node configs no longer depend on `memory-compiler-bridge`
5. `doctor` reports retirement readiness instead of blocked/preflight-only

## Execution order

1. freeze boundary
2. remove bridge -> workspace-script hard dependency
3. move plugin mainline off legacy script execution
4. move docs/contracts authority fully to plugin-owned paths
5. demote legacy scripts to compat/archive
6. migrate acceptance/burn-in/examples to plugin-first
7. disable bridge in node configs
8. only then archive/delete legacy surfaces

## Operator reminder

If unsure, run:

```bash
node plugins/memory-compiler/bin/memory-compiler.mjs doctor -
```

Linux note:
- `openclaw-gateway` is often installed as a **systemd --user** service, so verify it with:

```bash
systemctl --user status openclaw-gateway.service
```

- Do **not** use plain `systemctl status openclaw-gateway.service` as retirement/runtime evidence on those hosts; that can falsely look `inactive` even while the user service is actually running.

Do not infer retirement readiness from the fact that plugin-preferred works on one machine.
