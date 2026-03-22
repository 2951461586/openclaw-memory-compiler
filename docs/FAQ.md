# FAQ

## Do I need migration history to use this plugin?
No. For normal installs, use `README.md` and `docs/CONFIG.md`.

## Do I need `memory-compiler-bridge` on a fresh install?
No. Clean installs should enable `memory-compiler` directly.

## Does `migrate` delete or move my trusted runtime data?
No. `migrate` is non-destructive.

## Should I delete `memory/compiler/` during cleanup?
No. `memory/compiler/` is the active runtime/data root.

## What should be green before I call the install healthy?
At minimum:
- `doctor`
- `migrate`
- `refresh`
- `verify`
- `npm test`
- `npm run smoke:clean-install`
- `npm run smoke:trusted-install`
- `npm run check:publish`

## Where should operators look for docs?
Use the plugin docs under `docs/` as the default docs surface.

## What are legacy-only surfaces on older nodes?
If present, these are migration residue, not primary dependencies:
- `scripts/memory-compiler/`
- `reports/openclaw-memory-compiler/`
- `plugins/memory-compiler-bridge/`
