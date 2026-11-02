/** Recorded product-loop UI: edits, explicit model actions and original demo input. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountBlueprintProduct } from './blueprint-product-view.mjs'
import { productCopy as c } from './blueprint-product-copy.mjs'

test('product UI keeps unsaved PRD edits, sends revision strategy and relays original demo prompts', async () => {
  const dom = new JSDOM('<div id="app"></div>'); globalThis.window = dom.window; globalThis.document = dom.window.document
  const container = dom.window.document.querySelector('#app'), calls = [], notifications = []
  const product = { id: 'p1', name: '复习助手', version: 1, files: [{ name: 'PRD.md' }, { name: '方案.md' }], jobs: [] }
  let jobs = [], listener, content = '# 需求\n\n用户提供的事实。'
  const api = async (name, ...args) => {
    calls.push([name, ...args])
    if (name === 'blueprintProducts') return [product]
    if (name === 'blueprintProductJobs') return jobs
    if (name === 'blueprintProductGet') return product
    if (name === 'blueprintProductRead') return { name: args[1], content, hash: 'before' }
    if (name === 'blueprintProductSave') { content = args[2]; return { name: args[1], content, hash: 'after' } }
    if (name === 'blueprintProductStatus') return { revision: 'pinned-revision' }
    if (name === 'blueprintLibrary') return [{ name: '使用引导.md' }, { name: 's01_agent_loop/README.md' }]
    if (name === 'blueprintLibraryRead') return { name: args[0], content: '# 示例' }
    if (name === 'blueprintProductStart') { const job = { id: 'j1', action: args[0].action, title: '示例任务', productId: args[0].productId, status: 'running', logs: [], usage: {}, stage: '生成' }; jobs = [job]; return job }
    if (name === 'blueprintProductReply') { jobs = [{ ...jobs[0], status: 'running', waiting: null }]; return }
  }
  const view = mountBlueprintProduct({ container, api, toast: text => notifications.push(text), onUpdate: callback => { listener = callback; return () => {} } })
  const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text)
  const settle = () => new Promise(resolve => setTimeout(resolve, 15))
  try {
    await view.show()
    assert.equal(calls.some(([name]) => name === 'blueprintProductStart'), false)
    button(c.source).click(); await settle()
    const editor = container.querySelector('.bpf-editor'); editor.value += '\n用户补充'; editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    assert.equal(view.canLeave(), false); assert.match(notifications[0], /未保存/)
    button(c.save).click(); await settle(); assert.equal(view.canLeave(), true)
    assert.equal(calls.find(([name]) => name === 'blueprintProductSave')[4], 'before')
    const requirement = container.querySelector('textarea[aria-label="' + c.requirement + '"]'); requirement.value = '增加跨会话记忆'; requirement.dispatchEvent(new dom.window.Event('input'))
    const strategy = container.querySelector('select[aria-label="' + c.revise + '"]'); strategy.value = 'quick'; strategy.dispatchEvent(new dom.window.Event('change'))
    button(c.revise).click(); await settle()
    assert.deepEqual(calls.find(([name]) => name === 'blueprintProductStart')[1], { action: 'revise', productId: 'p1', requirement: '增加跨会话记忆', strategy: 'quick' })
    jobs = [{ ...jobs[0], status: 'completed' }]; listener(jobs[0]); await settle()
    await view.show('library'); button('s01_agent_loop/README.md').click(); await settle(); button(c.componentRun).click(); await settle()
    assert.equal(calls.filter(([name]) => name === 'blueprintProductStart').at(-1)[1].component, 's01_agent_loop')
    jobs = [{ ...jobs[0], status: 'waiting', waiting: 'Allow write_file? [y/N]' }]; listener(jobs[0]); await settle()
    const reply = container.querySelector('textarea[aria-label="' + c.reply + '"]'); reply.value = 'n'; reply.dispatchEvent(new dom.window.Event('input'))
    container.querySelector('.bpf-reply').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await settle()
    assert.deepEqual(calls.find(([name]) => name === 'blueprintProductReply'), ['blueprintProductReply', 'j1', 'n'])
  } finally { view.destroy(); dom.window.close(); delete globalThis.window; delete globalThis.document }
})
