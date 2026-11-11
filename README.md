# 回访 · 用户回访 Agent

本地用户回访工作台。使用 Mastra 编排、SQLite 持久化、React + Vite UI，把虚构用户名单转成可人工编辑、批准或拒绝的草稿，再执行模拟发送。支持离线 stub 或通过 OpenAI 生成真实 AI 草稿。

**当前进度：M0 已完成；M1 的真实 AI 核心已通过小批量实测。** 用户来源保持 mock，邮件只模拟发送。六个场景、两套手册及只读工具调用验证通过；M2–M4 未完成，真实用户平台仍未接入。详见 [真实 AI 验收](docs/11-real-ai-validation.md)。

## 本地启动

需要 Node.js ≥ 22.18 和 pnpm 10。当前在 Node.js 26.12.1、pnpm 10.29.2 上验证。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev:ui
```

打开终端打印的本地地址，默认 `http://127.0.0.1:4180`。只监听本机；端口被占用时会报错，不自动换端口。`pnpm dev` 保留为 Mastra Studio 开发服务（默认 4111）。

UI 的「自动回访」页可查看工作日 09:00（Asia/Taipei）的计划、下一次时间、后台检查、触发记录并暂停/开启计划。macOS 首次执行 `pnpm schedule:install`，即可在关闭网页和 UI 服务后继续触发。漏过计划全部跳过；已有活动任务（含待审批）时也跳过。详见 [定时运行](docs/05-deployment-and-cost.md)。

UI 操作：发起回访 → 选择 demo 或 demo-alt → 查看运行现场 → 草稿审批 → 编辑、批准或拒绝 → 全部草稿处理后自动模拟发送。任务、草稿、事件、人工编辑都来自本地持久化记录。

## 真实 AI

默认模型选择 GPT-6 Luna，分类与写稿均使用 `openai/gpt-6-luna`。在本机配置新 `OPENAI_API_KEY`、`MODEL_MODE=openai` 和确认的 `LLM_BUDGET_USD` 后启用；默认 stub，费用预算默认 0。用户仍为虚构数据，发信仍为 dry-run。详见 [AI 配置、预算与验证边界](docs/10-ai-integration.md)。

## 命令

| 命令 | 行为 |
|---|---|
| `pnpm dev:ui` | UI 与本地 HTTP 服务，开发模式 |
| `pnpm build && pnpm start` | 构建 UI 并提供本地静态页面与 API |
| `pnpm dev` | Mastra Studio，查看已注册的 daily-followup |
| `pnpm schedule:install` | 安装并开启当前项目/数据库的 macOS 后台定时任务 |
| `pnpm schedule:status` | 查看计划与后台任务状态 |
| `pnpm schedule:uninstall` | 暂停计划并卸载后台任务 |
| `pnpm schedule:tick` | 检查计划；仅当前到点的计划可发起，不强制运行 |
| `pnpm job:daily` | 使用当前 PLAYBOOK 生成草稿，暂停等待审批 |
| `pnpm approve` | CLI 审批、编辑、拒绝，审批完继续模拟发送 |
| `pnpm db:migrate` | 初始化业务库与 Mastra 工作流存储 |
| `pnpm typecheck && pnpm test` | 类型检查、隐私/护栏/流程/API 测试 |
| `pnpm test:ai:tools` | 真实只读工具调用与结果消费验证，共享累计费用预算 |
| `pnpm test:ai` | 真实 AI 核心验收，需本机密钥；虚构用户、独立测试库、dry-run、费用最多 $1 |

`job:weekly`、`eval` 在后续里程碑实现。按用户确认的策略不提供 `job:catchup`；启动识别中断记录，漏跑只记录跳过，不自动补跑。

## 数据与输出

- `data/followup.db`：业务运行、草稿、事件、人工编辑、计划和触发记录；`data/followup.db.workflow.db`：Mastra 暂停快照。两库均不包含外键。
- `out/drafts/<draftId>.json`：生成的草稿快照；工作流完成时更新为最终状态。运行期间以 SQLite / UI 中的数据为准。
- `out/simulated/<draftId>.json`：模拟发送凭据，不包含邮箱或收件人；重复执行同一草稿写入同一文件。
- `.env`、`data/`、`out/`、`logs/` 均被 Git 忽略。所有示例用户都是虚构的 opaque ID。

默认 mock 数据有 6 位用户。相同业务手册会去重已进入其他任务的用户（拒绝也会保留），因此已完成一轮后再次运行可能为 0 人；可用另一套手册验证业务切换。取消任务释放未模拟发送的用户；失败任务保留草稿，优先人工重试原任务。

## 运行与隐私约束

- 本阶段 `ADAPTER_PROFILE` 只接受 `mock`，`SEND_MODE` 只接受 `dry-run`，错误配置会阻止启动。
- 三层状态、取消、重启与重试语义见 [运行状态与 UI](docs/08-runtime-and-ui.md)。同一数据库一次只允许一个活动任务，包含等待审批的任务；CLI 与 UI 共用审批规则。
- 模拟模型调用同样受 `MAX_LLM_CALLS_PER_RUN` 限制；UI 单列真实 LLM 调用、已确认 token 与估算费用。重试不清零累计调用数。
- `MAX_USERS_PER_RUN` 限制选入的用户；候选读取最多 1000 条，超过本次处理上限的候选不进入模型。M1 的真实分页需另行确认。
- 模型上下文只接受手册允许的数值/布尔特征，丢弃字符串和联系人字段；当前模拟链路从不调用 `getContact()`。
- `redact()` 是确定性的常见邮箱、电话、URL、带标签姓名过滤器，不承诺识别任意自然语言中的人名。M3 接真实回复之前必须扩展并验证隐私边界。
- 模型请求前持久化预算预留，收到响应后记录实际 token；用量未知时保留预留。调用、日 token 与累计费用均有上限，取消/超时不会自动重试。实际费用以供应商账单为准。

## 实现索引

`src/core/` 保持领域逻辑与端口，不引用 Mastra、平台 SDK 或 adapters；SQLite、文件输出、模拟用户和模型在 `src/adapters/`。Mastra 工作流在 `src/mastra/`，HTTP 服务、环境校验与依赖装配在 `src/runtime/`，界面在 `src/ui/`。

分类标签、条件、话术、护栏与报告模板在 `playbooks/`；M0 使用 JSON 配置，避免为简单配置引入 YAML 解析依赖。每次运行保存所用手册快照，后续编辑配置不会改变已待审的内容。

完整规格见 [docs](docs/01-architecture.md)，API 契约见 [OpenAPI](docs/api.openapi.json)，验收记录见 [M0 验证](docs/09-m0-validation.md)。
