## Summary
What problem does this PR solve?

## Main change
- 
- 
- 

## Boundaries / risk
- source-first impact:
- control-plane / operator impact:
- install / migration / publish impact:

## Validation
List the exact commands you ran.

```bash
npm test
```

Add or remove as needed:

```bash
npm run smoke:clean-install
npm run smoke:trusted-install
npm run check:publish
node ./bin/memory-compiler.mjs doctor -
node ./bin/memory-compiler.mjs verify - <<'JSON'
{
  "pluginConfig": {
    "enabled": true,
    "controlPlaneMode": "plugin-preferred"
  }
}
JSON
```

## Docs updated
- [ ] README.md
- [ ] README.zh-CN.md
- [ ] docs/CONFIG.md
- [ ] docs/ARCHITECTURE.md
- [ ] docs/OPERATOR-REVIEW-FLOW.md
- [ ] docs/PUBLISHING.md
- [ ] docs/RETIREMENT-PLAN.md
- [ ] not needed

## Checklist
- [ ] I kept source-first behavior explicit where exact claims matter
- [ ] I did not reintroduce bridge/legacy defaults into clean-install paths
- [ ] I included enough evidence for operator-facing behavior changes
