/** Local discussion starters and searchable project content; no model calls or writes. */
export const starters = [
  { title: '从一句想法开始', description: '找到用户、场景和具体问题', prompt: '我想做的产品是：\n目标用户可能是：\n我观察到的问题是：\n\n请按当前阶段帮我澄清，每轮最多问三个关键问题。先区分已有事实和待验证假设，不要编造证据。' },
  { title: '整理已有材料', description: '把访谈、反馈和研究变成依据', prompt: '我已经添加了一些证据材料。请按当前阶段梳理：哪些结论有证据支持，哪些只是推测，哪些资料仍需补充。引用证据编号，每轮最多追问三个关键问题。' },
  { title: '检查事实与假设', description: '检查结论是否有来源', prompt: '请审阅当前阶段草稿与证据：逐项区分事实、用户陈述和假设，指出缺少来源、互相矛盾或无法支持结论的地方。不要把“用户提供”直接当作已核验事实。先补齐问题，停在当前阶段。' },
  { title: '梳理下一步验证', description: '明确要验证什么、怎样判断', prompt: '基于当前阶段已知信息，列出最影响产品决策的待验证问题，以及适合的验证方法、需要收集的证据、通过或停止的条件。没有真实数据的指标请标为建议，先与我讨论，不进入下一阶段。' },
]

/** Return project, evidence and conversation entries for a local search index. */
export function projectSearchEntries(projects) {
  return projects.flatMap(project => [
    { type: 'project', projectId: project.id, projectName: project.name, title: project.name, stage: project.stage, content: '' },
    ...project.evidence.map(item => ({ type: 'evidence', projectId: project.id, projectName: project.name, title: `${item.code} · ${item.title}`, stage: item.stage, content: `${item.content}\n${item.source}`, evidenceId: item.id })),
    ...project.messages.map((item, index) => ({ type: 'message', projectId: project.id, projectName: project.name, title: `${item.role === 'user' ? '你' : '产品搭档'}的对话`, stage: item.stage, content: item.content, messageIndex: index })),
  ])
}

/** Search all query terms and return a short excerpt around the first match. */
export function searchEntries(entries, query, type = 'all') {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter(item => (type === 'all' || item.type === type) && terms.every(term => `${item.projectName} ${item.title} ${item.content}`.toLocaleLowerCase().includes(term))).map(item => {
    const content = item.content.replace(/\s+/g, ' ')
    const offset = terms.length ? Math.max(0, content.toLocaleLowerCase().indexOf(terms[0]) - 35) : 0
    return { ...item, excerpt: `${offset ? '…' : ''}${content.slice(offset, offset + 130)}${content.length > offset + 130 ? '…' : ''}` }
  })
}
