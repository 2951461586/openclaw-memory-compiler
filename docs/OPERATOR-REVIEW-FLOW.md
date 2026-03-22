# Operator Review Flow

## 目标
把 `inferred → confirmed` 从“验收里间接证明”收成 operator-facing 正式流程，并把 acceptance 样本 backlog 与真实 operator backlog 分开看。

## 1. 正式 flow：inferred → confirmed

### 入口
先看控制面：
- `memory/compiler/control-plane/overview.md`
- `memory/compiler/control-plane/status.json`
- `memory/compiler/reports/control-plane-verify.latest.json`

### operator triage
```bash
node plugins/memory-compiler/bin/memory-compiler.mjs review-triage - <<'JSON'
{
  "pluginConfig": {
    "enabled": true,
    "controlPlaneMode": "plugin-preferred"
  },
  "status": "open",
  "operatorOnly": true,
  "limit": 5
}
JSON
```

这一步默认只看真实 operator backlog，不把 acceptance 样本 review 混进值班面。

### operator apply
```bash
node plugins/memory-compiler/bin/memory-compiler.mjs review-apply - <<'JSON'
{
  "pluginConfig": {
    "enabled": true,
    "controlPlaneMode": "plugin-preferred"
  },
  "decisions": []
}
JSON
```
典型决策：
- `promote`: 把 `inferred` 升到 `confirmed`
- `refresh`: 先补 trusted evidence；若仍未 confirmed，会自动生成 follow-up `promotion-review`
- `dispute`: 转成 `arbitration-review`
- `reject`: 转成 stale/rejected，并保留 rejection evidence

### promote 的正式语义
`promote` 不是直接改字段，而是：
1. `review-apply` 生成 lifecycle action
2. `fact-lifecycle` 判断 source discipline
3. 有 trusted source 时才真正进入 `confirmed`
4. 无 trusted source 时保持 `inferred`，并把 review 留在 open/blocked 状态
5. 所有动作都会写回 review queue、fact lifecycle、backlinks、control-plane

这意味着 `inferred → confirmed` 现在是**显式 operator flow**，不是 acceptance 样本里“顺带测到”。

## 2. acceptance 样本隔离口径

review item 新口径：
- `origin=operator | acceptance`
- `namespace=operator | acceptance`
- `operatorVisible=true | false`
- `evidenceMode=source-first | sample`

默认原则：
- 真实待处理项：`origin=operator` 且 `operatorVisible=true`
- acceptance 样本：`origin=acceptance` / `namespace=acceptance` / `operatorVisible=false`
- acceptance 样本不删除，继续留在 `review-queue.jsonl` 里供审计和回放
- control-plane 默认报 `operatorOpenReviews`，把 acceptance 样本单列成 `acceptanceOpenReviews`

### 查看 acceptance 样本
```bash
node plugins/memory-compiler/bin/memory-compiler.mjs review-triage - <<'JSON'
{
  "pluginConfig": {
    "enabled": true,
    "controlPlaneMode": "plugin-preferred"
  },
  "status": "open",
  "includeAcceptance": true,
  "namespace": "acceptance",
  "limit": 5
}
JSON
```

## 3. 控制面口径
控制面现在同时给出：
- `openReviews`: 全部 open review（含样本）
- `operatorOpenReviews`: 默认 operator backlog 口径
- `acceptanceOpenReviews`: acceptance 样本 backlog

operator trust 判断以 `operatorOpenReviews` 为主；acceptance 样本只作为 warning / evidence，不再污染“真实待处理项”口径。

## 4. 证据文件
- `memory/compiler/review-queue.jsonl`
- `memory/compiler/reports/review-apply.latest.json`
- `memory/compiler/reports/control-plane-verify.latest.json`
- `memory/compiler/control-plane/overview.md`
- `memory/compiler/control-plane/status.json`
- `memory/compiler/reports/acceptance-smoke.latest.json`
tance-smoke.latest.json`
