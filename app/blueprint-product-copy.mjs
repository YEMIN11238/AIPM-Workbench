/** Chinese copy for the full Agent Blueprint adapter. */
export const productCopy = Object.freeze({
  product: '产品闭环', tools: '方案与检查', library: '组件与资料', title: '从一个想法，到可以运行和迭代的产品',
  subtitle: '复用工作台 API。需求、方案、代码和验证记录保存在同一个产品文件夹。',
  create: '新建产品并生成方案', name: '产品名称', idea: '想为谁解决什么问题？', products: '产品工作区', noProducts: '建立第一个产品，从这里开始。',
  plan: '生成 / 续推方案', build: '生成 / 更新骨架', verify: '检查骨架差距', run: '运行我的骨架', folder: '打开产品文件夹',
  template: '生成原版模板', level: '模板层级', levels: ['L0 · 循环与命令工具', 'L1 · 文件工具与权限', 'L2 · 加入任务计划', 'L3 · 加入子 Agent', 'L4 · 加入 Skill 加载'],
  revise: '增加新需求并升版', requirement: '这一版想增加什么？', strategies: { full: '完整重推方案', quick: '快速重选组件（方案保留旧版）', none: '只升版 PRD（不调用模型）' },
  workflow: '① 需求与方案  →  ② 回答待确认问题  →  ③ 代码骨架  →  ④ 运行与检查  →  ⑤ 下一版',
  empty: '选择产品查看 PRD、方案、代码和历史版本。', files: '产品文件', read: '阅读', source: '编辑 / 源码', save: '保存修改', saved: '已保存，旧内容已备份', unsaved: '有未保存的修改，请先保存或放弃。', discard: '放弃修改',
  draftNote: '骨架是待验证代码；检查报告只做静态对照。实际运行结果和人工验证结论由你确认。',
  job: '当前任务', jobs: '运行历史', cancel: '停止任务', reply: '发送输入', replyHint: '原版程序正在等待输入；权限问题请按原提示回答 y / n，输入 q 结束对话。', noJob: '尚未执行任务。', report: '查看任务结果', jobFolder: '打开任务文件夹',
  busy: '当前任务结束后可继续操作。', libraryTitle: '17 个组件 · 原版资料 · 工具', search: '搜索组件、文件或指南', componentRun: '运行这个原版组件', demoNote: '示例会实际调用 API，并可能读写文件、运行工具。每次在单独的示例工作目录运行，完整保留原版交互。它与工作台的默认聊天引擎分别运行。每次运行最多 8 次模型调用、15 分钟，可随时停止。',
  eval: '运行离线题库', realEval: '运行真实模型题库', package: '导出原版学生包', installed: '当前适配版本',
  actions: { init: '新建产品', plan: '推导方案', revise: '需求升版', build: '骨架更新', template: '原版模板', verify: '骨架检查', demo: '组件示例', run: '骨架运行', eval: '题库评估', package: '导出学生包' },
  statuses: { running: '执行中', waiting: '等待输入', completed: '已完成', needs_review: '待复核', failed: '执行失败', cancelled: '已停止', interrupted: '已中断' },
})
