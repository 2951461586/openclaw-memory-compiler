# Config reference

This is the operator-facing config reference for `memory-compiler`.

## Minimal recommended config

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

## Required toggle

- `enabled`: enable the plugin

## Path settings

- `workspaceDir`: workspace root; default `~/.openclaw/workspace`
- `dataDir`: derived data directory; default `memory/compiler`
- `reportsDir`: operator report directory; default `memory/compiler/reports`
- `runtimeDir`: runtime state directory; default `memory/compiler`
- `docsDir`: operator docs/contracts directory; default `plugin:docs`
- `sessionStatePath`: session state file; default `SESSION-STATE.md`
- `workingBufferPath`: working buffer file; default `memory/working-buffer.md`
- `dailyMemoryDir`: daily memory directory; default `memory`

Recommended stance:
- leave these at defaults for a first install
- keep `memory/compiler/` as the active runtime/data root
- only point `docsDir` back to `reports/openclaw-memory-compiler` when intentionally inspecting legacy evidence

## Behavior settings

- `sceneHint`
- `maxPromptChars`
- `maxPromptTokens`
- `maxReviewItems`
- `includeReviewTriage`
- `preferredSourcePrefixes`
- `injectSourceDispatchSystemInstruction`

## Runtime / control-plane settings

- `enableRuntimeBridge`
- `enableSessionLifecycle`
- `enableControlPlane`
- `controlPlaneMode`
  - `plugin-preferred`: the only supported execution mode

## Recommended first-run validation

After enabling the plugin, run:

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

Healthy target state:
- `doctor.ok = true`
- `verify.ok = true`
- `trustLevel = trusted`
- ideally `operatorVerdict = trusted-and-clear`
