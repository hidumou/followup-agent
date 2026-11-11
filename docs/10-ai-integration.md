# 10 真实 AI 接入与验证

## 本轮范围

用户明确允许流失用户继续 mock，并委托选择性价比合适的模型。本轮完成 M1 的模型接入部分：匿名用户 → AI 分类 → AI 草稿 → 护栏 → 人工审批 → 模拟发送。默认仍可离线使用 stub；M2 真实发信、M3 回复抽取、M4 汇总与周报没有提前实现。

代码接入与离线验证完成不代表 M1 整体验收：真实模型质量、账户访问权限和工具调用稳定性仍需联调。用户 API 继续使用 mock，不猜测真实字段或认证方式。

## 模型选择

分类和写稿统一选择 `openai/gpt-6-luna`。这两个任务输入短、目标明确，并且草稿要经过人工审批，适合先用低成本模型验证效果。当前未证明其在本项目上具有绝对最高的性价比；真实样例质量不达标时再评估替换。

2026-11-11 核对的标准价格：每百万输入 token $0.10、输出 token $0.50。以每人分类与写稿合计 4,000 输入 + 1,000 输出 token 假设，1,000 人约 $0.90；这不是实测费用，不包含额外重试或后续报告。

来源：[OpenAI 模型页](https://developers.openai.com/api/docs/models/gpt-6-luna)、[Mastra OpenAI 路由](https://mastra.ai/models/providers/openai)。模型 ID 已在项目锁定的 Mastra 类型与注册表中确认。

通过 Responses API、原生结构化输出运行；`reasoningEffort=none`，标准服务档位，关闭响应存储。每次只允许一步模型调用，无自动重试、无第二个结构化整理模型。分类输出上限 256 token，写稿 2,048 token。当前配置只接受已定价的 Luna 型号，防止换成未知价格模型后继续按旧价控制预算。后续换供应商只需替换适配器及其配置。

## 本机配置

先创建本机配置（已有文件时保留）：

```sh
test -f .env || cp .env.example .env
chmod 600 .env
```

在本机编辑 `.env`：

```dotenv
ADAPTER_PROFILE=mock
MODEL_MODE=openai
MODEL_FAST=openai/gpt-6-luna
MODEL_WRITER=openai/gpt-6-luna
SEND_MODE=dry-run
MAX_USERS_PER_RUN=3
MAX_LLM_CALLS_PER_RUN=6
DAILY_TOKEN_BUDGET=100000
LLM_BUDGET_USD=0
LLM_TIMEOUT_MS=45000
BUDGET_TIMEZONE=Asia/Taipei
```

将新密钥仅填写到本机 `OPENAI_API_KEY`，不要复制到聊天、示例或提交。确认联调预算后再把 `LLM_BUDGET_USD` 改成对应金额；例如本次若批准 $1，则设置为 `1`。默认 `0` 会在发出任何模型请求前阻止付费运行。

`pnpm dev:ui` 启动界面；`pnpm job:daily` 使用相同配置。已有 M0 待审批运行可继续审批和模拟发送，须处理完或取消后才能创建新任务。更换模型模式后不能重试旧模型运行，避免把历史 mock 草稿与真实 AI 结果混在同一批任务。

## 预算与运行状态

- 调用前持久化模型、日期、输入/输出预留、标准单价和费用预留，再执行网络请求。调用次数跨人工重试累计。
- 输入预留采用请求 UTF-8 字节数加协议余量，输出使用供应商请求中的硬上限。输入预留超过 32,000 时直接拒绝。该算法是保守估算，不是官方 tokenizer；真实用量若超出预留，先记录再停止后续调用。
- 响应返回用量后，用供应商报告的 input/output tokens 替换预留。费用按标准价格估算，未扣除缓存优惠，不能替代账单。
- 超时、断线、取消、解析异常或进程中断可能无法得到用量。保留 `unknown` 预留占用预算，真实 token 栏只累计已确认值，不伪装为零费用。
- `DAILY_TOKEN_BUDGET` 以每次调用开始时的 `BUDGET_TIMEZONE` 日期结算；跨日重试计入新日期。`LLM_BUDGET_USD` 是当前数据库整个历史的累计估算费用上限，包含未知用量预留，不随重启、重试或跨日清零。它不涵盖别的应用、别的数据库或供应商价格调整。
- 当前数据库仍只允许一个活动任务，逐用户串行调用。超时默认 45 秒；停止操作触发 AbortSignal，其他进程发起的停止最多约 250ms 后被检测。中止客户端请求不保证供应商未计费，因此保留预留。
- UI 显示模型来源、调用次数、已确认 token、估算费用及未知预留。密钥不通过 `/api/config` 返回；模型原始异常不进入事件、日志或数据库。
- AI 指令、分类规则、话术与禁区均在业务手册；模型只接收匿名特征，不获取联系方式。Agent 未开放独立 Studio 聊天入口，避免绕过工作流预算。

## 验证证据

2026-11-11：`pnpm typecheck`、`pnpm test`（4 个文件、29 项测试）和 `pnpm build` 均通过。浏览器读取旧 M0 待审批运行，确认模型来源、真实调用次数、token 和估算费用展示正确，旧数据保持可读。

`test/real-model.test.ts` 使用内置本地 HTTP 服务，经过真实 Mastra 路由与 Responses 解析器，验证请求结构、原生 JSON schema、匿名化、用量、审批与模拟发送、429 不重试、错误输出、PII 护栏、超时、取消、跨日统计、重启保留和调用/费用/token 预算。它证明应用如何处理给定协议响应，不证明真实模型质量。

Postman API Simulation 的独立进程验证覆盖 429：一次请求、运行 failed、`MODEL_RATE_LIMIT`、零草稿、保留未知预算。可复现：

```sh
postman simulation run postman/simulations/openai-rate-limit.sim.yaml --port auto --no-history --output ndjson
# Replace PORT with the port printed above, in a second terminal:
pnpm exec node scripts/check-model-simulation.ts http://127.0.0.1:PORT/openai/v1
```

CLI 1.75.0 不支持 `postman status`，未检索远端官方 mock，也未上传或部署替身。证据和未确认假设保存在对应 `.context.yaml`。

框架依据：[Agent.generate](https://mastra.ai/reference/agents/generate)、[结构化输出](https://mastra.ai/docs/agents/structured-output)；协议依据：[Responses](https://developers.openai.com/api/reference/resources/responses/methods/create)、[错误码](https://developers.openai.com/api/docs/guides/error-codes)。

下一步真实验证需要本机新密钥和明确费用上限。先用少量虚构用户检查分类正确性、中文话术、JSON schema 与护栏通过情况，再决定是否扩大样本；工具调用另需真实验证，不因文档声称支持就视为已通过。
