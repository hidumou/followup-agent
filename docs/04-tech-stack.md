# 04 技术栈

## 选型

| 领域 | 选择 | 理由 |
|---|---|---|
| 语言 | TypeScript（strict） | 你习惯 TypeScript；与 Mastra 一致 |
| 运行时 | Node.js LTS | Mastra 与 Resend SDK 均支持；版本要求以 Mastra 文档为准 |
| 包管理 | npm | 与 Mastra 官方脚手架一致，减少摩擦 |
| Agent 框架 | Mastra（`@mastra/core` 等） | 覆盖 agent、workflow、暂停恢复、记忆、评估、追踪、模型路由，TypeScript 原生 |
| 模型接入 | Mastra 模型路由 | 用 `provider/model` 指定；支持 OpenAI、火山引擎（OpenAI 兼容接口），也可配置自定义 OpenAI 兼容地址 |
| Schema 与校验 | zod | 结构化输出、环境变量、工具入参统一校验 |
| 存储 | libSQL / SQLite 文件 | 零运维；Mastra 存储与业务记录可共用；迁移用 `.sql` 文件 |
| 邮件 | Resend（官方 SDK） | 一套服务同时支持发送与接收；免费账号下比 Cloudflare 邮件发送更可行 |
| 触发 | 阶段一：cron / launchd；阶段二：Cloudflare Cron | 低成本，见 `05` |
| 测试 | vitest | 轻量；隐私与护栏必须有单测 |
| 配置 | `.env` + zod 校验 | 密钥不入库 |

## 明确不用（MVP）
- 重型全栈框架（如 Next.js）与大型 UI 套件
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

## 控制台技术方案（自 M0 起）

默认方案如下。开始 M0 前，编码 agent 先复述方案并等你确认；你有偏好时可替换。版本以当前稳定版为准。

| 项目 | 选择 | 理由 |
|---|---|---|
| 服务端 | Hono（Node 运行） | 轻量，TypeScript 原生，路由直接调用 `core/services`，以后迁移到 Cloudflare 也方便 |
| 前端 | React + Vite + TypeScript | 编码 agent 熟悉，适合分栏、diff、编辑器这类交互 |
| 样式 | CSS 变量（`design-tokens.css`）+ CSS Modules | 不引入大型 UI 套件，颜色与尺寸统一来自令牌 |
| 图标 | Lucide（随包分发，使用前核实许可证） | 线性风格，与 `12` 一致 |
| Diff | 成熟的文本 diff 库（如 `diff`） | 不自己实现 |
| 数据交互 | 简单 JSON API，手动刷新或轮询 | MVP 不需要实时推送 |

约束：
- 仅本机使用，监听 `127.0.0.1`；不引入账号体系。
- 本机服务也需要防护：校验 `Host` 与 `Origin`，写操作必须携带启动时生成的随机会话令牌，防止浏览器里的其他网页向本机服务发请求触发审批或发送。
- 发送模式不能通过任何接口修改。
- 无外部资源依赖：不使用 CDN、在线字体、外链图标。
- 样式以 `docs/assets/design-tokens.css` 为唯一颜色与尺寸来源，深浅两套主题。
- 界面语言为简体中文。
