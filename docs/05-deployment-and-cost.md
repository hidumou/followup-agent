# 05 运行部署与成本

## 阶段一：本机运行（已实现的定时回访）

用户确认的计划为 **每周一至周五 09:00，Asia/Taipei**，不包含节假日历。休眠、关机、服务不可用导致漏过计划时全部跳过，不补跑。失败、取消和中断的运行仍只允许人工重试。当前流程到草稿、人工审批、模拟发送；真实邮件、回复和报告仍待后续里程碑。

```sh
pnpm schedule:install   # macOS：安装并开启当前项目/数据库的后台任务
pnpm schedule:status    # 查看开启状态、下次时间、检查时间、launchd 是否已加载
pnpm schedule:uninstall # 暂停计划并卸载后台任务
```

- 安装完成后，关闭网页或停止 UI 服务不影响定时触发。电脑必须开机、用户登录且处于唤醒状态；退出登录期间不运行。
- UI「自动回访」可暂停/开启未来计划；暂停不会取消正在执行或等待审批的任务。恢复从下一个未来时间开始，不立即运行。
- 使用当前 `.env` 的 `PLAYBOOK` 和 `MAX_USERS_PER_RUN`，默认 demo / 10 位；模型、日 token、调用次数、累计费用预算继续生效。`.env` 每次启动检查进程时读取，密钥不进入 plist 或日志。
- 安装记录绑定当前项目路径及数据库，默认 `data/followup.db`。此前真实 AI 验收的 `data/ai-validation.db` 保持独立，不会自动变成日常调度库。运行 UI 与调度时应使用同一个 DB_URL。
- 后台每 30 秒调用 `schedule:tick`。只有计划的 09:00:00–09:00:59 这一分钟内可以发起；09:01 后恢复只记录 `MISSED_WINDOW`。每个计划时间最多创建一次运行。
- 同一 SQLite 写事务保存计划触发记录、新运行及下一个时间；唯一索引防止与手工任务并发。已有 queued/running/waiting_approval 时记录 `RUN_ALREADY_ACTIVE`，原任务不变。
- 错过多个工作日，恢复时逐项记录跳过。UI 展示最近 100 次，关联到运行详情，并区分「已发起」与运行的最终状态；生成完草稿仍显示等待审批。
- 进程在创建后退出，下一次检查会将遗留的运行标记为中断，不会再次执行同一个计划。后台检查不是运行重试。
- 采用 launchd 的 `StartInterval`，未使用会在唤醒时合并触发的 `StartCalendarInterval`，并由应用再检查计划窗口。参考 [Apple 定时任务说明](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html) 及本机 `man launchd.plist`。

安装器使用绝对 Node 可执行路径和项目工作目录，不依赖终端的 nvm / pnpm PATH。plist 位于 `~/Library/LaunchAgents/local.followup-agent.schedule.<hash>.plist`；日志在 `logs/schedule.log` 和 `logs/schedule-error.log`，只输出运行 ID、状态或稳定错误码。Node 升级导致原可执行文件删除后，应先卸载再重新安装。

本项目后续在本地主目录使用普通 Git 分支开发，不再新建 worktree。**迁移项目目录或清理旧 worktree 前，必须先在原目录执行 `pnpm schedule:uninstall`。** `.env`、数据和日志不跟随 Git 合并；停止旧服务、完整迁移业务库和工作流库并校验后，在目标目录重新安装定时任务，避免留下指向已删除目录的后台任务。UI 显示「后台未连接」「最近检查异常」「检查延迟」时，先检查 `schedule:status` 与日志，不把计划开启等同于后台正常。

Linux 可由用户 cron 每分钟调用 `schedule:tick`，时区由程序处理，不依赖 cron 的宿主时区；当前仅验证 macOS 自动安装，未自动修改 Linux crontab。例如（替换实际绝对路径并保证日志目录存在）：

```cron
* * * * * cd /path/to/followup-agent && /absolute/path/to/node --env-file-if-exists=.env src/cli/schedule-tick.ts >> logs/schedule.log 2>> logs/schedule-error.log
```

### 本轮验证

`pnpm typecheck && pnpm test && pnpm build` 通过。调度覆盖台北时间、周末、到点与截止边界、多日漏跑、两个数据库连接并发、待审批冲突、暂停恢复、进程中断、调用上限、创建失败、HTTP 版本与同源限制，并发启动两个实际 tick CLI 进程，验证无 Web 服务也可产出一项待审批任务且不重复触发。测试使用临时数据库和 stub，不增加真实模型消费。已有真实 AI 核心的验证见 `11-real-ai-validation.md`。

## 阶段二：迁移到 Cloudflare（MVP 之后，非必须）
触发条件：本机常开不可靠，或需要远程访问网页审批。
- 定时：Workers Cron Trigger；审批页与周报页放在你的域名上，用 Cloudflare Access 限制访问；存储改 D1 或 KV。
- 邮件仍用 Resend：Cloudflare 的邮件发送目前为 Beta 且需要 Workers 付费计划，免费账号只能用其 Email Routing 收信。
- 免费计划需核实的限制（各来源描述不完全一致，以官方文档为准）：每日请求数上限、单次调用 CPU 时间、单次调用子请求数（约 50）、每个 Worker 的 Cron Trigger 数量。一次处理多个用户容易超过子请求上限，需要按用户拆分调用。
- Mastra 官网称有 Cloudflare 部署器，迁移前先读其文档确认。

## 成本估算

主要成本是模型 token，其余基本为零。

| 项目 | 阶段一 | 说明 |
|---|---|---|
| 模型 API | 见下方估算 | 唯一有意义的成本 |
| Resend | 以官网当前套餐为准 | 回访量很小，通常在免费额度内，请核实 |
| Cloudflare | 0 | 免费账号，阶段二才使用 |
| 本机 | 0 | 需保证运行时在线 |
| 域名 | 已有 | 用子域名发信 |

### 模型成本粗估（假设，需用真实数据校正）
- 假设：每天 10 个用户，每个用户 3 次模型调用（分类、写草稿、抽取回复），每次平均输入 2,000 token、输出 500 token；周报每周约 5 万输入、1 万输出 token。
- 月用量约：输入 2.0M token，输出 0.5M token。
- 以 Mastra 模型列表中的火山引擎价格举例（每百万 token，输入/输出）：小模型 0.03/0.30 美元 → 约 0.2 美元/月；较强模型 0.89/4 美元 → 约 3.8 美元/月。价格以服务商当前报价为准。
- 结论：每月在几美分到几美元量级。OpenAI 模型请代入所选型号的价格重算。

### 成本控制规则（实现时必须有）
- `MAX_USERS_PER_RUN`、`MAX_LLM_CALLS_PER_RUN`、`DAILY_TOKEN_BUDGET`，超限中止。
- 本轮分类与写稿先统一使用 GPT-6 Luna；回复抽取和周报到对应里程碑再用样例评估模型。
- 日汇总基于结构化记录用代码聚合，不重读原始回复。
- 每次运行记录调用次数与 token，写入运行日志。
- 在模型服务商控制台同时设置额度上限。

## 当前实现的模型预算

标准单价与配置见 `10-ai-integration.md`。`LLM_BUDGET_USD` 限制当前数据库全部运行的累计估算费用（含未知用量预留），默认 0；日 token 预算按 `BUDGET_TIMEZONE` 的调用日期统计。不能覆盖其他应用或数据库的消费，也不能代替供应商账单或控制台设置。
