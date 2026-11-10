# 04 技术栈

## 选型

| 领域 | 选择 | 理由 |
|---|---|---|
| 语言 | TypeScript（strict） | 你习惯 TypeScript；与 Mastra 一致 |
| 运行时 | Node.js LTS | Mastra 与 Resend SDK 均支持；版本要求以 Mastra 文档为准 |
| 包管理 | pnpm | 遵循用户全局偏好，锁定 pnpm-lock.yaml |
| Agent 框架 | Mastra（`@mastra/core` 等） | 覆盖 agent、workflow、暂停恢复、记忆、评估、追踪、模型路由，TypeScript 原生 |
| 模型接入 | Mastra 模型路由 | 用 `provider/model` 指定；支持 OpenAI、火山引擎（OpenAI 兼容接口），也可配置自定义 OpenAI 兼容地址 |
| Schema 与校验 | zod | 结构化输出、环境变量、工具入参统一校验 |
| 存储 | libSQL / SQLite 文件 | 零运维；Mastra 存储与业务记录可共用；迁移用 `.sql` 文件 |
| 邮件 | Resend（官方 SDK） | 一套服务同时支持发送与接收；免费账号下比 Cloudflare 邮件发送更可行 |
| 触发 | 阶段一：cron / launchd；阶段二：Cloudflare Cron | 低成本，见 `05` |
| 前端 | React + Vite + TypeScript | 本地工作台与 mock 审批，用户已确认 |
| 测试 | vitest | 轻量；隐私与护栏必须有单测 |
| 配置 | `.env` + zod 校验 | 密钥不入库 |

## 明确不用（MVP）
- 公网后台与多用户权限系统（本地 React + Vite UI 已由用户明确纳入 M0）
- 向量数据库与语义检索
- 消息队列、独立调度服务
- 多 agent 编排、子 agent
- Cloudflare Agents / Durable Objects（当前是批处理场景，用不上）
- 其他 agent 框架（Strands、Claude Agent SDK）：作为后续对照学习，不进入 MVP

## 版本策略
- 不在文档里写死版本号。脚手架时使用当前稳定版并锁定到 lockfile。
- 依赖框架 API 前先读当前官方文档，不凭记忆。

## 需要实测的两点（M1 必做）
1. 所选模型在**工具调用**与**结构化输出**上的稳定性。
2. 火山引擎等 OpenAI 兼容接口下，是否存在 provider 特有功能缺失；不稳定则该步骤换模型或降级为纯文本加解析。
