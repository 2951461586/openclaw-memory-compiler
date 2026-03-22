# Publishing and packaging

This document defines the publishable/packageable boundary for `memory-compiler`.

## Package boundary

Publish this directory as the package root:

```text
plugins/memory-compiler/
```

Include:
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

Do not publish workspace/runtime state:
- `memory/compiler/`
- `_trash/`
- host-local `openclaw.json`
- ad-hoc workspace reports outside this package root

## Publish-time checklist

Before calling the package publish-ready, make sure these are green:

```bash
npm test
npm run smoke:clean-install
npm run smoke:trusted-install
npm run smoke:install
npm run check:publish
```

## Operator promise

A publish-ready package should let an operator:
1. install the package into a clean workspace
2. enable it in `openclaw.json`
3. run `doctor`
4. run `migrate`
5. run `refresh`
6. run `verify`
7. validate clean-install and trusted-install smoke paths

The operator should not need migration history to complete those steps.
