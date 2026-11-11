# followup-agent：用户回访与总结 Agent（MVP 规格包）

这是一份交给 Claude Code / Codex 的实现规格。目标是用现有 agent 框架（Mastra + TypeScript）搭出一个「流失用户回访 → 收集回复 → 结构化总结 → 汇报给决策者」的最小可用闭环，并以此学习和验证 agent 框架。

## 文档索引

| 文件 | 内容 | 谁需要读 |
|---|---|---|
| `AGENTS.md` / `CLAUDE.md` | 给编码 agent 的工作规则与硬性约束 | 编码 agent（必读） |
| `docs/01-architecture.md` | 架构图、分层、数据流、隐私边界 | 所有人 |
| `docs/02-modules.md` | 模块划分、端口接口、workflow 步骤、状态机 | 实现者 |
| `docs/03-project-structure.md` | 目录结构、脚本、环境变量 | 实现者 |
| `docs/04-tech-stack.md` | 技术选型、理由、不用什么 | 实现者 |
| `docs/05-deployment-and-cost.md` | 运行部署方案（本机 → Cloudflare）与成本估算 | 你 |
| `docs/06-materials-checklist.md` | 需要你提供的资料清单与降级方案 | 你 |
| `docs/07-mvp-scope.md` | MVP 边界、里程碑、验收标准 | 所有人 |
| `docs/08-playbook-evolution.md` | Playbook 演进：AI 提议、人审批的业务规划 | 所有人 |
| `docs/09-product-modules.md` | 平台业务模块划分、角色、对象与读写矩阵 | 实现者 |
| `docs/10-prototype-wireframes.md` | 原型图文字稿（各界面布局与状态） | 实现者 |
| `docs/11-core-interactions.md` | 核心交互流程、状态变化、异常与验收点 | 实现者 |
| `docs/12-ui-design-spec.md` | 界面布局、风格、主题色、组件与可访问性规范 | 实现者（控制台） |
| `docs/assets/design-tokens.css` | 设计令牌（浅色与深色主题） | 实现者（控制台） |

## 产品形态说明

产品形态是一个本机网页「控制台」，由 9 个业务模块组成（见 `docs/09`）。控制台随 M0 到 M4 逐步建设，M5 做完善与验收，这些共同构成 MVP；CLI 保留为定时任务入口与备用。Playbook 演进（AI 提议、人审批）是 M6，在 MVP 之后，需要你明确指示才开始。界面规范见 `docs/10`、`docs/11`、`docs/12`。

## 如何交给编码 agent

1. 新建仓库，把本包内容放到仓库根目录（`docs/` 保持原样）。
2. 先按 `docs/06-materials-checklist.md` 准备好 M0 所需资料（M0 不需要真实密钥）。
3. 在 Claude Code 或 Codex 中打开仓库，首条指令建议：
   「阅读 AGENTS.md 和 docs/ 下全部文档，然后只实现里程碑 M0，完成后停下来汇报，不要继续 M1。」
4. 每完成一个里程碑，人工验收后再进入下一个（验收标准见 `docs/07-mvp-scope.md`）。

## 一句话原则

固定流程为主，agent 只用在开放问题（周报洞察）；核心通用，平台与业务差异放在适配器和 playbook；默认 dry-run，任何真实发送都必须经过审批；playbook 的演进由 AI 提议、人审批，AI 不直接修改规则。
