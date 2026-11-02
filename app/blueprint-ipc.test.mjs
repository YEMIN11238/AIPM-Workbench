/** Desktop picker and task actions retain host ownership of filesystem destinations. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerBlueprintIpc } from './blueprint-ipc.mjs'

test('picker returns only a selected directory or bounded text and cancelled selection is inert', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aipm-picker-'))
  const file = join(root, 'idea.md'), actions = new Map()
  await writeFile(file, '# 演示需求')
  let selection = { canceled: true, filePaths: [] }, options
  const window = {}
  registerBlueprintIpc({ handle: (name, action) => actions.set(name, action), service: {}, window: () => window, shell: {}, dialog: { showOpenDialog: async (parent, value) => { assert.equal(parent, window); options = value; return selection } } })
  try {
    assert.equal(await actions.get('blueprintPick')('idea'), null)
    selection = { canceled: false, filePaths: [file] }
    assert.deepEqual(await actions.get('blueprintPick')('idea'), { path: file, text: '# 演示需求' })
    assert.deepEqual(options.filters[0].extensions, ['md', 'txt'])
    selection = { canceled: false, filePaths: [root] }
    assert.deepEqual(await actions.get('blueprintPick')('project'), { path: root })
    assert.deepEqual(options.properties, ['openDirectory'])
    await assert.rejects(actions.get('blueprintPick')('arbitrary'), /有效/)
    await writeFile(file, '字'.repeat(60001)); selection = { canceled: false, filePaths: [file] }
    await assert.rejects(actions.get('blueprintPick')('prd'), /60000/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('opening output resolves a task id through the service rather than accepting a renderer path', async () => {
  const actions = new Map(), opened = []
  registerBlueprintIpc({ handle: (name, action) => actions.set(name, action), service: { resolveFolder: async id => { if (id !== 'task-id') throw new Error('invalid id'); return '/fixture/task' } }, window: () => ({}), dialog: {}, shell: { openPath: async path => { opened.push(path); return '' } } })
  await actions.get('blueprintOpenFolder')('task-id')
  assert.deepEqual(opened, ['/fixture/task'])
  await assert.rejects(actions.get('blueprintOpenFolder')('/private/data'), /invalid id/)
  assert.equal(opened.length, 1)
})
