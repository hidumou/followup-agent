export const statuses: Record<string, string> = {
  queued: '准备中', running: '运行中', waiting_approval: '等待审批', completed: '已完成', failed: '运行失败', cancelled: '已取消', interrupted: '已中断',
  pending_approval: '待审批', approved: '已批准', rejected: '已拒绝', simulated: '已模拟发送',
};
export const steps: Record<string, string> = { discover: '发现用户', context: '匿名上下文', classify: '场景分类', draft: '撰写草稿', guard: '护栏检查', review: '人工审批', send: '模拟发送', done: '完成' };
export const messages: Record<string, string> = {
  RUN_CREATED: '回访任务已创建', RUN_STARTED: '开始执行工作流', STEP_STARTED: '开始步骤', STUB_CALL: '已计入一次模拟模型调用', USERS_SELECTED: '已筛选待回访用户',
  DRAFT_SAVED: '草稿通过护栏并保存', WAITING_APPROVAL: '工作流已暂停，等待人工审批', DRAFT_APPROVED: '草稿已批准', DRAFT_REJECTED: '草稿已拒绝', REVIEW_COMPLETED: '全部草稿已处理，继续工作流',
  SEND_SIMULATED: '模拟发送凭据已保存', RUN_COMPLETED: '本次回访已完成', CANCEL_REQUESTED: '已请求停止运行', RUN_CANCELLED: '运行已取消', RETRY_REQUESTED: '已提交人工重试', PROCESS_INTERRUPTED: '上次进程已退出，运行被标记为中断',
  RUN_ALREADY_ACTIVE: '已有进行中的任务，请先完成审批或取消该任务。', STALE_DRAFT: '草稿已被其他操作更新，请刷新后重试。', GUARD_REJECTED: '草稿未通过护栏：检查长度、退订说明、联系方式及禁止承诺。',
  CALL_LIMIT: '模型调用次数已达上限。可提高环境变量中的上限，重启后人工重试。', USER_LIMIT: '用户数超出运行上限。', TOKEN_LIMIT: '当日 token 预算已耗尽。',
  RUN_NOT_REVIEWABLE: '当前运行暂不可审批，请刷新状态。', RUN_NOT_RETRYABLE: '当前运行不可重试。', RUN_NOT_ACTIVE: '该运行已经结束。', RETRY_USER_CONFLICT: '这些用户已进入其他回访任务，不能重试以免重复联系。',
  WORKFLOW_FAILED: '工作流执行失败，请查看运行记录后人工重试。', STEP_FAILED: '当前步骤执行失败，可人工重试。', INVALID_INPUT: '输入格式不正确。', INTERNAL_ERROR: '服务暂时无法处理请求，请稍后重试。',
  LLM_CALL_STARTED: '已预留预算，正在调用真实 AI', LLM_USAGE_RECORDED: '已记录模型返回的 token 用量', LLM_USAGE_UNKNOWN: '本次用量未确认，保留预算预留',
  COST_LIMIT: '累计费用预算不足。请在本机设置 LLM_BUDGET_USD 后重启并人工重试。', MODEL_TIMEOUT: '模型调用超时，运行已停止，可人工重试。',
  MODEL_AUTH_FAILED: '模型认证或权限失败，请检查本机密钥。', MODEL_RATE_LIMIT: '模型服务限流或额度不足，运行已停止。', MODEL_REQUEST_FAILED: '模型请求失败，请检查配置和服务可用性后人工重试。',
  MODEL_OUTPUT_INVALID: '模型输出不符合要求，未进入审批。', MODEL_OUTPUT_LIMIT: '模型输出达到长度上限，未进入审批。', MODEL_USAGE_MISSING: '模型未返回完整用量，已停止并保留预算预留。', MODEL_USAGE_EXCEEDED: '实际用量超出预留，已记录用量并停止运行。',
  MODEL_INPUT_TOO_LARGE: '模型输入超过本次支持的长度。', MODEL_CHANGED: '运行使用的模型配置已变化，请恢复原配置后重试。', PLAYBOOK_AI_MISSING: '业务手册缺少 AI 指令。',
  NETWORK_ERROR: '无法连接本地服务，正在等待重新连接。',
};
export function time(value: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)); }
