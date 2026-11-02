/** Shared model menus preserve domain drafts and order future requests behind saved choices. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountModelSelectors } from './model-selector.mjs'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const choices = [{ id: 'deepseek-v4-pro', label: 'Pro', vision: false }, { id: 'deepseek-flash', label: 'Flash（V4.1）', vision: true }]
const status = model => ({ schema: 1, model, choices })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function fixture(select) {
  const dom = new JSDOM('<div id="root"><div class="v2-model"></div><form class="cr-composer"><textarea>未发送的调研问题</textarea><div class="cr-actions"></div></form><textarea class="document-editor">文档草稿</textarea></div>', { pretendToBeVisual: true })
  const container = dom.window.document.getElementById('root'), calls = [], toasts = []; let update, unsubscribed = false
  const view = mountModelSelectors({ container, api: async (name, ...args) => { calls.push([name, ...args]); return name === 'modelStatus' ? status('deepseek-v4-pro') : select ? select(...args) : status(args[0]) }, events: { onModelUpdate: callback => { update = callback; return () => { unsubscribed = true } } }, toast: message => toasts.push(message) })
  const choose = value => { const input = container.querySelector('select'); input.value = value; input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); return input }
  return { dom, container, view, calls, toasts, choose, update: value => update(value), unsubscribed: () => unsubscribed, close() { view.destroy(); dom.window.close() } }
}

test('compact current-model menus save one choice across all composers without replacing drafts or running snapshots', async () => {
  const f = fixture(); await f.view.ready
  try {
    const draft = f.container.querySelector('textarea'), run = Object.freeze({ model: 'deepseek-v4-pro', status: 'running' }); draft.focus(); draft.setSelectionRange(4, 4)
    assert.equal(f.container.querySelectorAll('select[aria-label="模型选择"]').length, 2)
    assert.equal(f.container.querySelector('.document-editor').nextSibling, null)
    f.choose('deepseek-flash'); await tick()
    assert.deepEqual(f.calls.at(-1), ['modelSelect', 'deepseek-flash'])
    assert.ok([...f.container.querySelectorAll('select')].every(input => input.value === 'deepseek-flash'))
    assert.equal(f.container.querySelector('textarea'), draft); assert.equal(draft.value, '未发送的调研问题'); assert.equal(draft.selectionStart, 4); assert.equal(f.dom.window.document.activeElement, draft)
    assert.equal(run.model, 'deepseek-v4-pro'); assert.match(f.toasts.at(-1), /进行中的任务保持原模型/)
  } finally { f.close() }
})

test('all preserved chat families and new marked composers get one menu; technical editors and Blueprint templates do not', async () => {
  const f = fixture(); await f.view.ready
  try {
    const panel = f.dom.window.document.createElement('section')
    panel.innerHTML = '<form class="vs-composer"><div class="vs-actions"></div></form><form class="stk-composer"><textarea>开发草稿</textarea></form><form class="bpc-composer"><textarea></textarea></form><form class="bpf-reply"><textarea></textarea></form><form class="bpf-create"><textarea></textarea></form><details class="bpf-options"><textarea>修订需求</textarea></details><details class="bpf-options"><select aria-label="模板"></select></details><form class="v2-task-form"><textarea></textarea></form><div data-model-composer><textarea></textarea></div><fieldset class="geo-body" disabled></fieldset><textarea class="material-editor"></textarea>'
    f.container.append(panel); await tick()
    assert.equal(panel.querySelectorAll('.v2-model-picker').length, 9)
    assert.equal(panel.querySelectorAll('.bpf-options')[1].querySelector('.v2-model-picker'), null)
    assert.equal(panel.querySelector('.geo-body').nextElementSibling.className, 'v2-model-picker')
    assert.equal(panel.querySelector('.geo-body').nextElementSibling.querySelector('select').disabled, false)
    await tick(); assert.equal(panel.querySelectorAll('.v2-model-picker').length, 9)
    f.update(status('deepseek-flash')); assert.ok([...panel.querySelectorAll('[aria-label="模型选择"]')].every(input => input.value === 'deepseek-flash'))
    panel.remove(); await tick(); f.view.destroy(); assert.equal(f.unsubscribed(), true); assert.equal(f.container.querySelector('.v2-model-picker'), null)
  } finally { f.close() }
})

test('the next model request waits for model persistence and a failed switch rolls back without losing text', async () => {
  const save = deferred(), f = fixture(() => save.promise); await f.view.ready
  try {
    f.choose('deepseek-flash'); let sent = false
    const send = f.view.beforeRequest().then(() => { sent = true })
    assert.ok([...f.container.querySelectorAll('select')].every(input => input.disabled)); await tick(); assert.equal(sent, false)
    save.reject(new Error('保存失败')); await assert.rejects(send, /本次请求尚未发送/)
    assert.equal(sent, false); assert.ok([...f.container.querySelectorAll('select')].every(input => input.value === 'deepseek-v4-pro' && !input.disabled))
    assert.equal(f.container.querySelector('textarea').value, '未发送的调研问题'); assert.match(f.toasts.at(-1), /保存失败/)
  } finally { f.close() }
})

test('a late switch acknowledgement does not replace a newer host model event', async () => {
  const save = deferred(), f = fixture(() => save.promise); await f.view.ready
  try {
    f.choose('deepseek-flash'); const next = f.view.beforeRequest()
    f.update(status('deepseek-flash')); f.update(status('deepseek-v4-pro'))
    save.resolve(status('deepseek-flash')); await next
    assert.equal(f.container.querySelector('select').value, 'deepseek-v4-pro')
  } finally { f.close() }
})

test('a newer host event wins over delayed initial status and unknown read errors leave no invented model', async () => {
  const initial = deferred(), dom = new JSDOM('<div id="root"><span class="v2-model"></span></div>'); let emit
  const container = dom.window.document.getElementById('root'), view = mountModelSelectors({ container, api: () => initial.promise, events: { onModelUpdate: callback => { emit = callback } } })
  try { emit(status('deepseek-flash')); initial.resolve(status('deepseek-v4-pro')); await view.ready; assert.equal(container.querySelector('select').value, 'deepseek-flash') } finally { view.destroy(); dom.window.close() }
  const f = fixture(); await f.view.ready
  try { f.update({ model: 'unknown', choices }); assert.match(f.toasts.at(-1), /无法读取/); assert.equal(f.container.querySelector('select').value, 'deepseek-v4-pro') } finally { f.close() }
})
