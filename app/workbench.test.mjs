/** Search product records without mixing projects or turning templates into generated facts. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { projectSearchEntries, searchEntries, starters } from './workbench.mjs'

test('search reaches evidence sources and past conversations, filters types and keeps project references', () => {
  const entries = projectSearchEntries([
    { id: 'one', name: '康复产品', stage: 1, evidence: [{ id: 'e1', code: 'E03', title: '访谈', content: '用户难以坚持训练', source: 'interview.md', stage: 0 }], messages: [{ role: 'assistant', content: '复诊提醒是待验证假设', stage: 0 }] },
    { id: 'two', name: '阅读助手', stage: 0, evidence: [], messages: [{ role: 'user', content: '保存阅读笔记', stage: 0 }] },
  ])
  assert.equal(searchEntries(entries, 'interview.md')[0].evidenceId, 'e1')
  const [message] = searchEntries(entries, '康复 复诊', 'message')
  assert.equal(message.projectId, 'one'); assert.equal(message.messageIndex, 0)
  assert.match(message.excerpt, /待验证假设/)
  assert.equal(searchEntries(entries, '复诊', 'evidence').length, 0)
  assert.equal(searchEntries(entries, '阅读')[0].projectId, 'two')
  assert.equal(searchEntries(entries, '没有出现的词').length, 0)
})

test('discussion starters ask for evidence and remain within the current stage', () => {
  assert.equal(starters.length, 4)
  for (const starter of starters) {
    assert.ok(starter.title && starter.description)
    assert.match(starter.prompt, /当前阶段/)
    assert.match(starter.prompt, /证据|来源|真实数据/)
  }
})
