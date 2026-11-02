/** Chinese product copy for the Blueprint workspace. */
export const blueprintCopy = Object.freeze({
  eyebrow: 'AGENT BLUEPRINT', title: '把想法变成可以讨论的方案', subtitle: '澄清需求、搭建架构，或检查已有 Agent 的缺口。每份结果都保留在这台电脑。',
  plan: '生成产品方案', audit: '检查已有项目', planHint: '说清用户、场景和你想解决的问题。资料不足时，方案会列出待确认事项。', auditHint: '选择本地项目，检查能力、工具、权限和运行机制，并生成改进建议。',
  titleLabel: '任务名称', titlePlaceholder: '例如：课堂笔记助手', ideaLabel: '你的产品想法', ideaPlaceholder: '我想为谁解决什么问题？\n他们现在怎样处理？\n我已有的材料或限制是什么？',
  projectLabel: '要检查的本地项目', projectPlaceholder: '尚未选择项目文件夹', pickProject: '选择文件夹', importIdea: '导入需求文档', importPrd: '添加需求文档（可选）', replacePrd: '更换需求文档', clearPrd: '移除',
  importHint: '支持 Markdown 和纯文本。点击开始后，需求或项目扫描摘要会发送给已配置的模型，报告保存在本机。', startPlan: '开始生成方案', startAudit: '开始检查项目', starting: '正在创建任务…',
  loading: '正在读取工作台状态…', configured: '模型已配置', noConfig: '请先在设置中配置模型 API Key，再开始任务。', unavailable: 'Blueprint 运行环境尚未就绪，请检查项目安装。', activeHint: '已有任务正在运行，完成或取消后可创建新任务。',
  history: '最近任务', noHistory: '还没有任务。完成左侧输入后即可开始。', refresh: '刷新', results: '任务与报告', emptyTitle: '从一个真实问题开始', emptyBody: '生成结果会显示在这里。你可以阅读、复制报告，打开本地文件夹，或从中断处继续。',
  draftNote: '生成内容是待复核草稿。请核对证据、权限设计和测试要求后再用于开发。', emptyReport: '这份报告目前没有正文。', reportLoading: '正在读取报告…', noReports: '报告生成后会出现在这里。你可以切换页面，任务仍会继续。',
  copy: '复制报告', copied: '报告已复制', openFolder: '打开任务文件夹', cancel: '取消任务', cancelling: '正在取消…', resume: '继续执行', resuming: '正在恢复…', failure: '操作未完成，请重试', retryReport: '重新读取报告',
  progress: '当前进度', usage: '用量', calls: '次模型调用', tokens: 'tokens', error: '任务信息', chooseTask: '查看任务', report: '报告', reviewNotice: '请阅读审稿意见，并自行核验结果。模型审稿不等于人工验收。',
  statuses: { running: '执行中', completed: '草稿已生成', needs_review: '需要复核', failed: '执行失败', cancelled: '已取消', interrupted: '已中断，可继续' },
  stages: { extract: '提取需求', model: '分析需求', select: '选择能力组件', design_retry: '修订架构', review_retry: '再次审稿', infer: '反推需求', audit_review: '审查改进建议', scan: '扫描项目', compare: '对比能力缺口', intake: '整理输入', requirements: '拆解需求', design: '生成架构', review: '审查方案', done: '生成结束', completed: '生成结束', audit: '检查项目', scanning: '扫描项目', starting: '准备执行', planning: '生成方案', ideation: '澄清需求', architecture: '设计架构', writing: '整理报告' },
})
