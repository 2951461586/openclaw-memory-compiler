# OpenClaw 记忆编译层 — 完整实施待办

## 最新推进（2026-03-21）
- [x] 增加 operator-facing blocking triage 样本/报告：`plugins/memory-compiler/bin/memory-compiler.mjs operator-review-blocking-triage -`
- [x] control-plane / compiler-status / compiler-metrics 暴露 blocking backlog 提权证据：`memory/compiler/reports/operator-review-blocking-triage.latest.json`
- [x] durable batch import 拆分 latest/live/acceptance latest 口径，避免 acceptance replay latest 冒充 live truth
- [x] runtime source mix 差异化继续下压到 escalation / source action routing / budget profile
- [x] runtime probe / runtime probe trend 正式接入 control-plane / verify / metrics / acceptance，形成 operator-facing runtime contract 证据链
- [x] acceptance review governance 纳入自动治理，acceptance sample backlog 从高位压缩到稳定审计留样口径
- [x] `violet / laoda / lebang` 三节点 live 控制面已统一收口为 `trustLevel=trusted` + `operatorVerdict=trusted-with-acceptance-samples`


## A. 数据模型
- [x] 定义 facts.schema.json
- [x] 定义 threads.schema.json
- [x] 定义 continuity.schema.json
- [x] 定义 digest-manifest.schema.json
- [x] 定义 sourceRefs 规范（session / summary / memory item / file）

## B. 编译内核
- [x] 实现 Fact Compiler
- [x] 实现 Thread Compiler
- [x] 实现 Digest Compiler
- [x] 实现 Thread Aging Job
- [x] 实现 Fact Conflict Resolver
- [x] 实现 Digest Manifest Writer
- [x] 实现 Rebuild Job（由源层全量重建派生层）

## C. 运行时装配
- [x] 实现场景识别器（chat/task/precise/heartbeat）
- [x] 实现 token budget selector
- [x] 实现 source-first escalation policy
- [x] 实现 active thread selector
- [x] 实现 digest thin-slice selector

## D. 调度与执行
- [x] 高优先事件触发器（决策/偏好/任务里程碑）
- [x] session-end compiler hook
- [x] daily compiler job
- [x] weekly compiler job
- [x] low-frequency narrative rewrite job

## E. 治理与可靠性
- [x] source integrity audit
- [x] orphan digest detector
- [x] stale thread sweeper
- [x] inferred→confirmed promotion policy
- [x] disputed fact review flow
- [x] compiler metrics / run reports
- [x] burn-in steady-state report

## F. 集成
- [x] 与 memory-lancedb 对接
- [x] 与 LCM summaries / expand 对接
- [x] 与 SESSION-STATE / working-buffer 对接
- [x] 与 heartbeat / cron 对接
- [x] 与 subagent completion 事件对接

## G. 当前仍待收口
- [x] 全量 rebuild / replay 工具链收成 operator-facing 正式口径
- [x] orphan digest detector / 清扫策略补齐
- [x] 更长窗口（7d/30d）burn-in 基线与趋势归档
- [x] 统一 ingest adapter 入口扩展到 workspace / SESSION-STATE / durable memory 样本输入
- [x] source-backlinks 扩展到 lcm-summary / lcm-message / file / memory-item / session 多源覆盖
- [x] acceptance 增补多源 adapter / backlinks coverage 专项验证
- [x] 真实导入入口补成 operator-facing：daily memory / workspace scan / durable memory item 统一由 import-real-sources 驱动并产出 replayable report
- [x] source kind authority / confidence / precise-scene 约束显式写入 runtime contract 与专项 diagnostics
- [x] runtime selector / bridge 对 source mix / coverage quality 可见性补齐到 operator-facing 报表
- [x] durable memory export/import 提升到 operator-facing 批量导入链路（manifest / batch replay / report）
- [x] source-kind contract 细化到 kind 级 authority / exact-claim rule / sceneRule
- [x] runtime source mix 开始实际影响 budget / escalation，并在 metrics / acceptance 中给出 before/after 口径
- [x] runtime source mix v2：剔除 totalRefs/trustedRefs 聚合口径噪声，supportingKinds 收敛为 trusted-only，新增 before/after evidence
- [x] source-kind contract 下沉到 review/source dispatch blocking 决策点，并把 blocking 状态暴露到 diagnostics / runtime bridge
- [x] durable memory batch import v2：补齐 incremental skip / failed batch replay / operator-facing batch outcome 报表
- [x] sourceDispatchBlockingOpen 正式接入 scheduler / review triage / operator backlog ordering，并在 control-plane/operator 报表暴露
- [x] durable batch failure fixture + replay acceptance：把 failedBatchIds / replayFailedBatchIds 从报表字段推进到真实 acceptance 证据
- [x] runtime source mix 把 derived-heavy 细分为 artifact-heavy / session-heavy，并按类型分别 tighten budget / escalation
