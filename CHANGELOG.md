# Changelog

## 0.2.4

- Reframe the package docs around clean-install and operator-first usage instead of migration-first wording.
- Add `docs/FAQ.md` and align `README.md`, `MIGRATION.md`, `docs/README.md`, and `docs/CONFIG.md` to a single install/enable/doctor/migrate/refresh/verify path.
- Add `smoke:clean-install` as an explicit package script, keep `smoke:install` as a compatibility alias, and add `smoke:trusted-install` for existing trusted workspaces.
- Extend publish-check to require FAQ/config/docs/publishing surfaces and both clean-install + trusted-install smoke metadata.
- Clarify repository/publish boundary in the main README and add `docs/PUBLISHING.md` so operators can package the plugin without workspace runtime junk.

## 0.2.3

- Add CLI smoke coverage (`test/cli-smoke.mjs`) and package scripts `doctor` / `smoke:install`.
- Promote install/readiness checks toward a more plug-and-play beta package shape.
- Extend publish-check to require author / keywords / install-smoke script.
- Expand README with common pitfalls / FAQ and clean up stale duplicated tail text.

## 0.2.2

- Add `memory-compiler doctor` for install-surface / layout / control-plane readiness checks.
- Upgrade README with copy-paste install / enable / restart / verify instructions closer to `memory-lancedb-pro` style.
- Extend plugin-only acceptance to cover the `doctor` command.
- Tighten the operator-facing story for plugin-preferred installs.

## 0.2.1

- Add plugin-preferred command dispatch for `review-apply`, `scheduler-plan`, `scheduler-run`, `scheduler-drain`, `pipeline-run`, `trigger-execute`, and `digest-compile`.
- Export plugin-owned cores for scheduler, review apply, pipeline run, trigger execute, and digest compile entrypoints while preserving CLI compatibility.
- Extend plugin-only acceptance to cover pipeline/trigger/digest command surfaces.
- Clarify migration/documentation boundary: command-layer ownership is plugin-first, while many downstream compilers remain transitional.

## 0.2.0

- Promote memory-compiler from migration shell toward a publishable plugin package.
- Add plugin-preferred scheduler and hook-dispatch CLI commands.
- Add plugin-owned digest GC wrapper.
- Add publish/readiness validation and plugin-only acceptance entrypoints.
- Add LICENSE, packaging metadata, and minimal release hygiene files.
