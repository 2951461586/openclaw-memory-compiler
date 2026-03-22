# memory-compiler

[![发布版本](https://img.shields.io/github/v/release/2951461586/openclaw-memory-compiler?sort=semver)](https://github.com/2951461586/openclaw-memory-compiler/releases)
[![许可证](https://img.shields.io/github/license/2951461586/openclaw-memory-compiler)](./LICENSE)
[![开放 Issues](https://img.shields.io/github/issues/2951461586/openclaw-memory-compiler)](https://github.com/2951461586/openclaw-memory-compiler/issues)
[![收藏数](https://img.shields.io/github/stars/2951461586/openclaw-memory-compiler?style=social)](https://github.com/2951461586/openclaw-memory-compiler)

OpenClaw 派生效力与控制面插件。

`memory-compiler` 将源-backed 输入（workspace 文件、LCM recall、持久化内存导出、会话状态）编译为 operator/runtime 制品：facts、threads、continuity 记录、digests、session packs、source backlinks、review queues、control-plane 报告。

## 这个插件做什么

在以下场景使用本插件：
- 从源-backed 输入编译派生效力
- 统一管理 operator-facing review / control-plane 制品
- 在 prompt 构建前注入更紧凑的运行时上下文
- 对精确问题保持 source-first 行为

**不做什么：**
- 不是向量数据库
- 不是 LCM 的替代品
- 不是 `memory-lancedb-pro` 的替代品

## 环境要求

- OpenClaw `>= 2026.3.13`
- 与你的 OpenClaw 安装兼容的 Node.js
- 可写的 workspace（默认：`~/.openclaw/workspace`）

## 快速开始

### 1) 把插件放进 workspace

```bash
cd /path/to/your/openclaw/workspace
mkdir -p plugins
git clone https://github.com/2951461586/openclaw-memory-compiler.git plugins/memory-compiler
cd plugins/memory-compiler
npm install
```

### 2) 在 `openclaw.json` 中启用

最小配置：

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

注意：
- `plugins.load.paths` 建议使用**绝对路径**
- `controlPlaneMode: "plugin-preferred"` 是唯一支持的模式
- 全新安装时**不要**添加 `memory-compiler-bridge`

### 3) 重启 OpenClaw

```bash
openclaw gateway restart
```

### 4) 运行 operator 初始化检查

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

### 5) 运行验收测试

```bash
npm test
npm run smoke:clean-install
npm run smoke:trusted-install
npm run check:publish
```

如果全部通过，说明安装面和发布面都处于良好状态。

## 目录结构

```
plugins/memory-compiler/
├── bin/
│   └── memory-compiler.mjs      # 入口 CLI
├── docs/                         # operator 文档（权威默认）
│   ├── CONFIG.md
│   ├── ARCHITECTURE.md
│   ├── OPERATOR-REVIEW-FLOW.md
│   └── RETIREMENT-PLAN.md
├── scripts/memory-compiler/     # 插件自有脚本
│   ├── *.mjs
│   ├── adapters/
│   └── lib/
├── src/                          # 插件核心 TS 模块
├── contracts/schemas/            # JSON Schema 定义
├── package.json
└── openclaw.plugin.json
```

## 核心概念

### Source-First
精确问题（"到底是哪个文件"、"定位这个错误"）必须先回源再回答，不依赖 digest。

### Control Plane
派生效力的治理层：facts/threads/continuity 的审查、晋升、冲突消解。

### Digests
从源材料编译的今日/本周/叙事摘要，只引用可信源。

### Review Queue
事实晋升、冲突仲裁、阻塞提权的操作员面审查队列。

## 文档入口

| 场景 | 文档 |
|------|------|
| 安装 / 启用 | `README.md`、`CONFIG.md` |
| 日常运维 | `docs/ARCHITECTURE.md`、`docs/OPERATOR-REVIEW-FLOW.md` |
| 迁移 / 退役 | `MIGRATION.md`、`docs/RETIREMENT-PLAN.md` |
| 发布准备 | `docs/PUBLISHING.md` |

## 许可证

MIT License - 见 [LICENSE](./LICENSE) 文件。

## 反馈 / 贡献

- 发现 bug？请开 [Issue](https://github.com/2951461586/openclaw-memory-compiler/issues)
- 有新功能想法？请开 [Feature Request](https://github.com/2951461586/openclaw-memory-compiler/issues/new?labels=enhancement)
- 有问题或想讨论设计？请使用 [Discussions](https://github.com/2951461586/openclaw-memory-compiler/discussions)
- 路线图讨论：<https://github.com/2951461586/openclaw-memory-compiler/discussions/1>
