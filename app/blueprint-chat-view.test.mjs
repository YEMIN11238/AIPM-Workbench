/** Chat UI keeps the composer stable and offers real product actions beside grounded replies. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountBlueprintChat } from './blueprint-chat-view.mjs'
import { chatCopy as c } from './blueprint-chat-copy.mjs'

test('chat opens an existing plan, accepts follow-up questions, streams safely and opens its product files', async () => {
  const dom = new JSDOM('<div id="app"></div>'); globalThis.window = dom.window; globalThis.document = dom.window.document
  const container = document.querySelector('#app'), calls = [], opened = [], scope = { kind: 'task', id: 'wine' }
  let update, jobUpdate
  const context = { title: '酒水助手', summary: '位置、预算和偏好 → 推荐方案；尚未接入真实商家数据。' }
  let chat = { scope, status: 'idle', messages: [], context }
  const api = async (name, ...args) => {
    calls.push([name, ...args])
    if (name === 'blueprintChatContexts') return [{ scope, title: '酒水助手', label: '方案' }]
    if (name === 'blueprintChatGet') return { ...chat, scope: args[0] }
    if (name === 'blueprintChatSend') {
      const messages = [{ id: 'u', role: 'user', content: args[1] }, { id: 'a', role: 'assistant', content: '', status: 'streaming' }]
      chat = { scope, status: 'running', messages, context }; update(chat)
      update({ ...chat, status: 'idle', messages: [messages[0], { ...messages[1], content: '**方案已生成**，代码还没有写。<img src=x onerror=alert(1)>', status: 'complete' }] })
      return chat
    }
    if (name === 'blueprintChatCreateProduct') { chat = { ...chat, scope: { kind: 'product', id: 'p1' } }; return { productId: 'p1' } }
    if (name === 'blueprintProductGet') return { jobs: [] }
  }
  const view = mountBlueprintChat({ container, api, toast: () => {}, openFiles: id => opened.push(id), onUpdate: cb => { update = cb; return () => {} }, onProductUpdate: cb => { jobUpdate = cb; return () => {} } })
  const settle = () => new Promise(resolve => setTimeout(resolve, 15))
  const button = label => [...container.querySelectorAll('button')].find(n => n.textContent === label)
  try {
    await view.show(); assert.match(container.textContent, /酒水助手/); assert.match(container.textContent, /尚未接入真实/)
    assert.equal(calls.some(([name]) => name === 'blueprintChatSend'), false)
    const input = container.querySelector('textarea'); input.value = '为什么现在还不能用？'; input.dispatchEvent(new dom.window.Event('input'))
    container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await settle()
    assert.deepEqual(calls.find(([name]) => name === 'blueprintChatSend'), ['blueprintChatSend', scope, '为什么现在还不能用？'])
    assert.match(container.textContent, /代码还没有写/); assert.equal(container.querySelectorAll('img').length, 0)
    assert.equal(container.querySelector('textarea'), input); assert.equal(input.value, '')
    button(c.fromTask).click(); await settle(); assert.match(container.textContent, /根据当前需求更新方案/)
    button(c.files).click(); await settle(); assert.deepEqual(opened, ['p1'])
    jobUpdate({ id: 'j1', action: 'build', productId: 'p1', status: 'needs_review', stage: '已完成' })
    await settle()
  } finally { view.destroy(); dom.window.close(); delete globalThis.window; delete globalThis.document }
})
