/** Chinese copy and bounded demonstration input for the GEO workspace. */
export const geoCopy = {
  title: 'GEO 内容运营', eyebrow: '从资料到内容', subtitle: '把客户事实变成有依据的选题与文章，逐步审阅，再导出。', navHint: '客户资料 · 选题 · 写稿 · 导出',
  steps: ['客户资料', '关键词与选题', '文章主稿', '平台改写与审阅', '导出'],
  new: '新建内容项目', example: '填入演示资料', saveProfile: '保存资料并生成关键词', saveKeywords: '确认选词，进入写稿',
  recent: '内容项目', empty: '先创建一个内容项目，或用演示资料走一遍。', back: '上一步', saved: '已保存到本机', unsaved: '有未保存修改，请先保存当前内容。',
  labels: { brand: '品牌或机构名称', industry: '行业', businessType: '业务类型', city: '服务地区', services: '核心业务（多个业务用逗号分隔）', audience: '目标用户', objective: '本轮目标', facts: '事实与来源（每行：事实 | 来源）', avoid: '内容边界与不能承诺的事项' },
  business: { local: '本地服务', national: '全国品牌', b2b: 'B2B 业务' },
  profileHint: '来源可以是官网链接或本地材料名称。填写来源不代表已独立核验；客户资料仅在点击生成文章或改写时发送给 DeepSeek。',
  keywordHint: '候选词按客户业务和课程公式生成，没有搜索量或收录数据。请删改并勾选要保留的词。',
  keyword: '关键词', selected: '保留', remove: '移除', add: '添加关键词', topic: '本篇目标关键词', type: '文章类型', generate: '生成文章主稿', regenerate: '重新生成主稿（替换现有主稿与平台稿）',
  titleLabel: '文章标题', bodyLabel: '文章正文（Markdown）', saveArticle: '保存主稿修改', adapt: '生成四个平台版本', preview: '阅读预览', edit: '编辑正文',
  draftHint: '生成内容是待审稿。品牌事实应保留 [F01] 等引用，来源清单单独导出。主稿改变后需重新生成平台稿。',
  saveVariant: '保存当前平台修改', review: '我已逐份核对标题、事实来源、品牌关系与风险提示', confirmReview: '确认审阅，进入导出',
  checkHint: '下列为课程经验规则的辅助检查，不能代替平台审核、事实核验或法律判断。请透明说明品牌关系，不编造中立榜单。',
  export: '导出本次内容包', exported: '打开最近导出文件夹', exportHint: '包含客户档案、关键词、主稿、四个平台稿、证据清单和监测记录模板。每次新建导出目录，不覆盖旧文件。',
  noMonitor: '第一版不登录平台、不发布、不自动监测。监测模板需要你填入实际回答与来源。',
  cancel: '停止生成', loading: '正在读取本地内容…', running: '正在调用 DeepSeek，请稍候；可切换页面，结果会保留。',
  statuses: { draft: '草稿', running: '生成中', failed: '生成失败', cancelled: '已停止', interrupted: '上次生成已中断', ready: '待审阅', reviewed: '已人工审阅' },
  usage: '模型用量', noKey: '模型未配置，请先到工作台设置填写 API Key。', model: '使用现有 DeepSeek 配置', noArticle: '文章生成后会在这里显示。', savedToast: '修改已保存', exportToast: '内容包已导出',
  factTitle: '证据与来源', diagnostic: '待补资料', exampleHint: '当前为虚构演示资料，所有文章和导出包都会标记“仅供演示”。',
}
export const geoDemo = {
  demo: true, brand: '青禾桌面整理（虚构演示）', industry: '家庭整理服务', businessType: 'local', city: '杭州', services: '书桌整理,居家收纳', audience: '居家办公、桌面经常杂乱的成年人', objective: '解释服务流程和选择标准，帮助读者判断是否需要整理服务。',
  facts: '提供书桌整理与居家收纳服务 | 演示服务说明 A（虚构）\n服务前先沟通物品保留意愿，再制定分区方案 | 演示流程卡 B（虚构）\n整理时由用户决定物品去留，不代替用户丢弃物品 | 演示服务边界 C（虚构）',
  avoid: '这是课堂演示，不存在真实客户、经营资质、价格、评分或案例。不得编造排名、成交数量、客户评价；不得承诺整理后的心理或健康效果。',
}
Object.assign(geoCopy, {
  platformNames: { toutiao: '今日头条', sohu: '搜狐号', zhihu: '知乎', '36kr': '36氪' }, types: ['选择判断型', '认知科普型', '行业观察型', '案例成果型', '人物机构型'],
  titlePlaceholder: '例如：青禾整理', servicesPlaceholder: '例如：书桌整理、居家收纳', factsPlaceholder: '提供哪些具体服务 | 官网链接或材料名称\n服务流程是什么 | 流程说明文件',
  gap: '资料缺口', ready: '资料可用于生成候选词', unverified: '已记录来源，不代表事实已独立核验',
  keywordsCount: n => `已选 ${n} 个词`, usageValue: u => `${u.calls} 次调用 · ${(u.inputTokens + u.outputTokens).toLocaleString()} tokens`,
  keywordPlaceholder: '填写真实用户可能提出的问题', articleReady: '主稿已保存，可生成平台版本', noVariants: '先生成主稿，再生成四个平台版本。',
  blocked: '需修改', warning: '待核对', selectPlatform: '选择平台稿', noCampaign: '还没有内容项目', saveFirst: '请先保存当前修改',
  exportCount: n => `已生成 ${n} 个内容包`, noExport: '审阅后即可导出', sourceHelp: '来源编号与状态随内容包导出，原始资料保存在本机。',
  goVariants: '查看平台稿', goArticle: '返回主稿', reviewRequired: '请勾选人工审阅确认', exportReady: '已确认当前版本的人工审阅',
})
