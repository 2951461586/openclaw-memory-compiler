# OpenClaw 记忆编译层（完整优化方案）

## 目标

在 **不削弱 OpenClaw 现有 LCM / compaction / memory plugin / session transcript 能力** 的前提下，新增一层 **派生型记忆编译层（Derived Memory Compiler Layer）**，用于提供：

- 跨 session 的连续感
- 当前主线/活跃线程感知
- today / week / long-term narrative 风格摘要
- 稳定事实与阶段性印象分层
- 运行时按场景选择性注入

本方案不是 MVP，不以“最小可行”为目标，而是以 **完整、可扩展、长期可维护** 为目标。

---

## 一、设计原则

### 1. 源层与派生层严格分离

**源层（Source Layer）** 是真相与证据来源：
- 原始 session transcript
- tool results
- compaction summaries
- LCM DAG / lineage
- memory plugin 原始条目

**派生层（Derived Layer）** 是系统为连续感而编译出来的产物：
- Today Digest
- Week Digest
- Active Threads
- Stable Facts Digest
- Long-term Narrative

规则：
- 派生层不覆盖源层
- 精确问题优先回源层
- 派生层必须带来源引用

### 2. 事实、线程、摘要、叙事、推断必须分桶

绝不把以下内容混成一个“总记忆 blob”:
- confirmed facts
- inferred facts
- active threads
- summarized digests
- narrative impressions

### 3. 运行时按场景注入，不全塞

不同场景注入不同层：
- 闲聊/续聊：facts + active threads + today/week 薄片
- 复杂任务：working continuity + facts + related thread + 按需 LCM expand
- 精确问答：直接走 LCM / transcript / source-first

### 4. 所有编译产物都必须可追溯

每条派生产物都应至少记录：
- sourceRefs
- generatedAt
- model / strategy
- confidence / status
- supersedes / supersededBy（可选）

补充运行时约束：
- precise 场景默认 source-first，exact claim 必须附 evidence path
- digest / continuity 只能作 continuity support，不可充当 precise authority
- runtime 必须暴露当前 source mix / coverage quality，便于 operator 看清是哪些 source kind 在支撑注入

### 5. 自动整理是增强层，不是唯一入口

编译层负责让系统“更像会持续整理记忆的人”，而不是替代：
- memory_recall
- lcm_expand_query
- 原始 session 历史

---

## 二、五层架构

### Layer 1 — Source Layer

职责：证据与可审计来源。

组成：
- sessions JSONL
- tool results
- compaction summaries
- LCM summaries and leaves
- memory plugin raw items

特性：
- 不可被 narrative 覆盖
- 精确问答首选
- 保留 lineage

### Layer 2 — Durable Memory Layer

职责：长期稳定记忆。

组成：
- memory-lancedb 等长期记忆条目
- 手工确认 facts
- 长期偏好、约束、关系、系统事实

特性：
- 可 auto-capture / auto-recall
- 面向长期有效信息

### Layer 3 — Derived Digest Layer

职责：把复杂历史压缩成可读连续感。

组成：
- today digest
- week digest
- stable facts digest
- long-term narrative
- thread summaries

特性：
- 可读
- 可注入
- 可过期/重编译
- 不可替代证据

### Layer 4 — Working Continuity Layer

职责：保存“当前正在延续什么”。

组成：
- current focus
- next steps
- open risks
- current decisions
- active work threads

特性：
- 热数据
- 生命周期短
- 更新频率高
- 面向续聊与任务接力

### Layer 5 — Runtime Context Layer

职责：为当前运行组装上下文。

组成：
- recent history
- selected facts
- selected threads
- selected digests
- selected source expansions

特性：
- 严格受 token budget 控制
- 基于场景决策注入策略

---

## 三、核心对象模型

### A. Fact

适用于长期稳定信息。

字段：
- id
- scope: user | project | system | agent
- text
- status: confirmed | inferred | disputed | stale
- tags[]
- sourceRefs[]
- firstSeenAt
- lastConfirmedAt
- expiresAt
- confidence
- supersedes

规则：
- confirmed 只能由明确表达、明确决策、已验证行为产生
- inferred 不可直接作为高优先 recall 主体
- facts 去重时保留冲突链

### B. Thread

适用于近期活跃主线。

字段：
- id
- title
- scope
- status: active | stale | closed | blocked
- summary
- sourceRefs[]
- relatedFacts[]
- nextStepHint
- updatedAt
- staleAfterHours
- priority
- owner

规则：
- 默认有时效
- stale 后不再默认注入
- closed 可归档但仍保留索引

### C. Digest

适用于 today / week / thread digest / narrative。

字段：
- id
- type: today | week | thread | narrative | facts-digest
- title
- content
- sourceRefs[]
- generatedAt
- generationStrategy
- confidence
- tokenEstimate
- supersedes

规则：
- digest 永远可重编译
- digest 不作为唯一事实来源

### D. Working Continuity Record

适用于当前工作状态。

字段：
- id
- focus
- decisions[]
- risks[]
- nextActions[]
- relatedThreads[]
- updatedAt
- expiresAt

规则：
- 强时效
- 优先面向任务接续
- 不写成长久人物画像

---

## 四、存储布局建议

建议新增目录：

```text
memory/compiler/
  facts.jsonl
  threads.jsonl
  continuity.jsonl
  digests/
    today/
      2026-03-20.md
    week/
      2026-W12.md
    narrative/
      current.md
    manifests/
      2026-03-20.json
      2026-W12.json
  indexes/
    facts.by-scope.json
    threads.active.json
```

### 存储原则

- **JSONL**：适合可追加、可审计、可变更追踪的对象（facts / threads / continuity）
- **Markdown**：适合人类可读 digest
- **Manifest JSON**：适合编译追踪与回源

---

## 五、三条编译管线

### 管线 1：事实编译管线（Fact Compiler）

输入：
- 用户明确表达
- 经验证系统行为
- 明确决策
- 高置信 memory capture
- LCM 展开后确认的长期信息

流程：
1. 候选事实提取
2. 类型判定（confirmed / inferred / disputed）
3. 冲突检测
4. 去重/合并
5. 写入 facts.jsonl
6. 更新 facts scope index

输出：
- 高可靠 facts

### 管线 2：线程编译管线（Thread Compiler）

输入：
- 新 session 活动
- 任务推进
- 子代理结果
- heartbeat 补记
- 当前 working continuity

流程：
1. 将新事件聚类到现有 thread 或新建 thread
2. 更新 thread summary 与 nextStepHint
3. 更新时间与优先级
4. 标记 active / stale / closed
5. 生成 thread digest（按需）

输出：
- 活跃线程池

### 管线 3：摘要编译管线（Digest Compiler）

输入：
- recent facts
- active threads
- recent LCM summaries
- recent sessions
- recent decisions

流程：
1. 生成 today digest
2. 滚动生成 week digest
3. 根据 stable facts + inactive/active threads 生成 narrative
4. 写 manifest
5. 更新 compiler indexes

输出：
- today/week/narrative/facts-digest

---

## 六、调度策略（完整优化版）

### 高频：每 N 轮 / 每次重要事件后

触发：
- 关键用户决策
- 明确偏好
- 工程任务阶段推进
- 子代理完成

动作：
- 更新 continuity
- 增量更新相关 thread
- 若满足阈值，刷新 thread digest

### Session 结束时

动作：
- 生成 session-level event bundle
- 更新相关 facts（仅 confirmed 候选）
- 合并进 today digest 输入池
- 将 continuity 软关闭 / rollover

### 每日任务

动作：
- 编译当天 today digest
- 刷新 active thread summary
- 线程老化（stale detection）
- facts conflict review queue 生成
- 编译当日 manifest

### 每周任务

动作：
- 编译 week digest
- 收敛长期 narrative
- 归档已 closed / stale threads
- 对 facts 做过期与冲突巡检

### 低频维护任务

动作：
- narrative 重写
- dedupe sweep
- sourceRefs 完整性校验
- orphan digest / orphan thread 清理

---

## 七、运行时注入策略

### 场景 A：闲聊 / 日常续聊

默认注入：
- 3~8 条 stable facts
- 1~3 个 active threads 摘要
- today digest 薄片
- 若 today 为空则取 week digest 薄片

禁忌：
- 不自动注入 narrative 全文
- 不自动注入低置信 inferred facts

### 场景 B：复杂任务 / 工程推进

默认注入：
- working continuity
- related stable facts
- 当前 thread summary
- recent decisions

按需升级：
- 相关 LCM summaries
- lcm_expand_query
- transcript/tool-result evidence

### 场景 C：精确事实/证据提问

策略：
1. 不依赖 narrative
2. digest 只作定位线索
3. 先 grep / expand / source inspect
4. 最终回答附来源

### 场景 D：心跳/自动巡检

默认读取：
- active threads
- continuity
- today digest
- 必要时写入 heartbeat 补记

---

## 八、风险控制与防呆

### 1. 摘要覆盖风险

防护：
- 派生层不回写源层
- facts 与 digest 分桶
- 冲突自动记录为 disputed，不自动静默覆盖

### 2. 推断污染事实

防护：
- inferred facts 不自动进入高优先 recall
- 需要二次确认才能升级 confirmed

### 3. 线程无限膨胀

防护：
- staleAfterHours
- closed/archive 流程
- 每周清理 inactive thread

### 4. 来源丢失

防护：
- 每次编译都输出 manifest
- sourceRefs 不可为空
- 定期跑 source integrity audit

### 5. 上下文爆炸

防护：
- 运行时只注入薄片
- narrative 不默认全文注入
- 精确问题走 source-first，不走 digest stuffing

---

## 九、与 OpenClaw 现有能力的集成点

### 1. 与 memory-lancedb 集成

- memory-lancedb 继续承担长期记忆 capture/recall
- facts compiler 可消费其高置信条目
- 不要求替换 memory-lancedb

### 2. 与 LCM 集成

- digest compiler 可读取 recent summaries 作为输入
- 精确问答始终可回到 lcm_expand_query
- sourceRefs 可直接存 summary ids

### 3. 与 SESSION-STATE / working buffer 集成

- continuity compiler 优先读取 SESSION-STATE
- 长任务时可读取 working-buffer.md
- continuity 不等于 MEMORY.md，不混用

### 4. 与 heartbeat / cron 集成

- 每日 digest 与 thread aging 适合 heartbeat 或独立 cron
- 周 digest / narrative rewrite 更适合 cron
- 重型编译建议隔离 session / sub-agent 执行

---

## 十、推荐实施顺序（完整方案版）

### Phase 1 — 数据底座
- 定义 facts / threads / continuity / digest manifest schema
- 创建 compiler 存储布局
- 建立 sourceRefs 规范

### Phase 2 — 编译器内核
- Fact Compiler
- Thread Compiler
- Digest Compiler
- Aging / conflict / dedupe jobs

### Phase 3 — 运行时装配策略
- 场景路由器：chat / task / precise query / heartbeat
- token-budget aware selector
- source-first escalation policy

### Phase 4 — 维护与治理
- integrity audit
- compiler metrics
- stale thread cleanup
- drift detection
- confidence decay / refresh

### Phase 5 — 可观察性（非 UI）
- manifest logs
- compiler run reports
- digest provenance inspection command
- thread/fact health checks
- control-plane metrics panel (`memory/compiler/control-plane/metrics.md`)
- steady-state burn-in report (`memory/compiler/reports/burn-in.latest.json`)

---

## 十一、验收标准

### 用户体验验收
- 闲聊续聊时能自然接上最近主线
- 复杂任务不会被 narrative 摘要带偏
- 用户可明显感知近期主题延续

### 工程验收
- 精确问题可回源
- facts / threads / digests 可审计
- 冲突可见
- stale thread 自动收敛

### 稳定性验收
- 不显著增加上下文负担
- 派生层编译失败不影响基础会话能力
- 编译层可完全重建，不依赖不可逆状态

---

## 十二、一句话总结

这套方案的本质不是“把 OpenClaw 改成 Hanako”，而是：

> 在 OpenClaw 原有 **证据链 + 可回溯 + 工程稳态** 的基础上，增加一层 **可编译、可追溯、可衰减的连续感记忆层**。

即：
- 源层负责真相
- 派生层负责连续感
- 运行时按场景注入
- 精确问题永远回源
