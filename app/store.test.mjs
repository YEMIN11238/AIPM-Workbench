/** Keyless checks for user confirmation, local files and concurrent changes. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, symlink, lstat, readdir, unlink, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ProjectStore, stages } from './store.mjs'

test('documents stay at the current phase until the user confirms; every phase produces a local Markdown file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aipm-'))
  try {
    const store = new ProjectStore(root); await store.init()
    let project = await store.create('验收产品')
    await assert.rejects(store.confirm(project.id), /先保存/)
    for (let stage = 0; stage < stages.length; stage++) {
      project = await store.saveDocument(project.id, { content: `# ${stages[stage]}\n待验证`, stage })
      assert.equal(project.stage, stage)
      assert.equal(project.review, true)
      assert.equal((await store.readDocument(project.id, project.documents[stage].name)).content, `# ${stages[stage]}\n待验证\n`)
      project = await store.confirm(project.id)
      assert.equal(project.stage, Math.min(stage + 1, stages.length - 1))
      assert.equal(project.review, false)
    }
    assert.equal(project.completed, true)
    await assert.rejects(store.confirm(project.id), /先保存/)
    const first = await store.readDocument(project.id, project.documents[0].name)
    await store.saveDocument(project.id, { content: '# 补充需求', hash: first.hash, stage: 0 })
    const restored = new ProjectStore(root); await restored.init()
    assert.equal((await restored.get(project.id)).documents.length, 5)
    assert.equal((await restored.get(project.id)).completed, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('evidence ids survive removal, verified evidence requires a source, and external edits are preserved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aipm-'))
  try {
    const store = new ProjectStore(root); await store.init(); let project = await store.create('证据检查')
    await assert.rejects(store.addEvidence(project.id, { title: '统计', content: '数据', source: '', kind: 'verified' }), /来源/)
    project = await store.addEvidence(project.id, { title: '用户陈述', content: '原话', source: '访谈', kind: 'provided' })
    const removed = project.evidence[0].id
    await store.removeEvidence(project.id, removed)
    project = await store.addEvidence(project.id, { title: '假设', content: '待访谈验证', source: '', kind: 'hypothesis' })
    assert.equal(project.evidence[0].code, 'E02')
    project = await store.saveDocument(project.id, { content: '# 草稿' })
    const document = await store.readDocument(project.id, project.documents[0].name)
    const path = join(root, project.folder, '产出物', document.name)
    await writeFile(path, '# 外部修改\n')
    await assert.rejects(store.saveDocument(project.id, { content: '# 覆盖', hash: document.hash }), /外部修改/)
    assert.equal(await readFile(path, 'utf8'), '# 外部修改\n')
    await assert.rejects(store.safe('../outside.md'), /超出/)
    await symlink(tmpdir(), join(root, 'link'))
    await assert.rejects(store.safe('link', 'outside.md'), /符号链接/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('prior document contents are published before replacement, stay immutable, and survive restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aipm-history-'))
  try {
    const store = new ProjectStore(root); await store.init()
    let project = await store.create('版本历史')
    project = await store.saveDocument(project.id, { content: '# 第一版' })
    const name = project.documents[0].name, path = join(store.root, project.folder, '产出物', name)
    assert.deepEqual(await store.listVersions(project.id, name), [])
    const first = await store.readDocument(project.id, name), atomic = store.atomic.bind(store)
    let observedPriorSnapshot = false
    store.atomic = async (target, value, options) => {
      if (target === path) {
        observedPriorSnapshot = true
        assert.equal(await readFile(path, 'utf8'), first.content)
        const versions = await store.listVersions(project.id, name)
        assert.equal(versions.length, 1)
        assert.equal((await store.readVersion(project.id, name, versions[0].id)).content, first.content)
      }
      return atomic(target, value, options)
    }
    await store.saveDocument(project.id, { content: '# 第二版', hash: first.hash })
    assert.equal(observedPriorSnapshot, true)
    store.atomic = atomic
    const [version] = await store.listVersions(project.id, name)
    assert.deepEqual(Object.keys(version).sort(), ['createdAt', 'hash', 'id', 'name', 'stage'])
    assert.equal(version.hash, first.hash); assert.equal(version.stage, 0)
    const snapshotPath = join(root, project.folder, '.history', '0', `${version.id}.json`)
    const immutableBytes = await readFile(snapshotPath, 'utf8')
    assert.equal((await lstat(snapshotPath)).mode & 0o222, 0)
    const second = await store.readDocument(project.id, name)
    await store.saveDocument(project.id, { content: '# 第三版', hash: second.hash })
    assert.equal(await readFile(snapshotPath, 'utf8'), immutableBytes)
    const restarted = new ProjectStore(root); await restarted.init()
    const versions = await restarted.listVersions(project.id, name)
    assert.equal(versions.length, 2)
    assert.equal(versions.some(item => item.id === version.id), true)
    assert.equal((await restarted.readVersion(project.id, name, version.id)).content, '# 第一版\n')
    assert.equal((await restarted.readDocument(project.id, name)).content, '# 第三版\n')
    assert.equal((await restarted.get(project.id)).documents.length, 1)
    assert.deepEqual(await readdir(join(root, project.folder, '产出物')), [name])
    assert.equal((await readdir(join(root, project.folder, '.history', '0'))).every(file => file.endsWith('.json')), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('projects without history remain readable; failed archival and intervening external edits never replace their contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aipm-history-'))
  try {
    const oldStore = new ProjectStore(root); await oldStore.init()
    let project = await oldStore.create('旧产品')
    project = await oldStore.saveDocument(project.id, { content: '# 旧文档' })
    const name = project.documents[0].name, path = join(root, project.folder, '产出物', name)
    const history = join(root, project.folder, '.history')
    assert.equal(Object.hasOwn(project, 'history'), false)
    const store = new ProjectStore(root); await store.init()
    assert.deepEqual(await store.listVersions(project.id, name), [])
    const old = await store.readDocument(project.id, name)
    await writeFile(history, '此处不能建目录')
    await assert.rejects(store.saveDocument(project.id, { content: '# 不应覆盖', hash: old.hash }))
    assert.equal(await readFile(path, 'utf8'), old.content)
    await unlink(history)
    const archive = store.archiveDocument.bind(store)
    store.archiveDocument = async (...args) => { await archive(...args); await writeFile(path, '# 保存期间的外部修改\n') }
    await assert.rejects(store.saveDocument(project.id, { content: '# 不应覆盖', hash: old.hash }), /外部修改/)
    assert.equal(await readFile(path, 'utf8'), '# 保存期间的外部修改\n')
    store.archiveDocument = archive
    const external = await store.readDocument(project.id, name)
    await store.saveDocument(project.id, { content: '# 新文档', hash: external.hash })
    assert.equal((await store.readDocument(project.id, name)).content, '# 新文档\n')
    assert.equal((await store.get(project.id)).stage, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('first save refuses an unregistered file, including one arriving during publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aipm-history-'))
  try {
    const store = new ProjectStore(root); await store.init()
    const project = await store.create('文件碰撞'), name = '01-需求池.md'
    const path = join(store.root, project.folder, '产出物', name)
    await writeFile(path, '# 已有本地文件\n')
    await assert.rejects(store.saveDocument(project.id, { content: '# 覆盖' }), /已存在但未登记/)
    assert.equal(await readFile(path, 'utf8'), '# 已有本地文件\n')
    assert.equal((await store.get(project.id)).documents.length, 0)
    await unlink(path)
    const atomic = store.atomic.bind(store)
    store.atomic = async (target, value, options) => {
      if (target === path) await writeFile(path, '# 刚出现的本地文件\n')
      return atomic(target, value, options)
    }
    await assert.rejects(store.saveDocument(project.id, { content: '# 覆盖' }), /已存在但未登记/)
    assert.equal(await readFile(path, 'utf8'), '# 刚出现的本地文件\n')
    assert.equal((await store.get(project.id)).documents.length, 0)
    assert.deepEqual(await readdir(join(root, project.folder, '产出物')), [name])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('queued stale saves, invalid version requests and modified snapshots are rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aipm-history-'))
  try {
    const store = new ProjectStore(root); await store.init()
    let project = await store.create('冲突与校验')
    project = await store.saveDocument(project.id, { content: '# 初始' })
    const name = project.documents[0].name, initial = await store.readDocument(project.id, name)
    const results = await Promise.allSettled([
      store.saveDocument(project.id, { content: '# 被保存', hash: initial.hash }),
      store.saveDocument(project.id, { content: '# 过期覆盖', hash: initial.hash }),
    ])
    assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected')
    const versions = await store.listVersions(project.id, name)
    assert.equal(versions.length, 1)
    await assert.rejects(store.listVersions('bad-id', name), /标识无效/)
    await assert.rejects(store.listVersions(project.id, '../outside.md'), /名称无效/)
    await assert.rejects(store.readVersion(project.id, name, '../../outside'), /标识无效/)
    await assert.rejects(store.readVersion(project.id, name, randomUUID()), /不存在/)
    await assert.rejects(store.readVersion(project.id, '02-竞品分析.md', versions[0].id), /文档不存在/)
    for (const input of [null, { content: '' }, { content: 'x', stage: 5 }, { content: 'x'.repeat(100001) }]) await assert.rejects(store.saveDocument(project.id, input))
    assert.equal((await store.listVersions(project.id, name)).length, 1)
    const snapshotPath = join(root, project.folder, '.history', '0', `${versions[0].id}.json`)
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
    await chmod(snapshotPath, 0o600); snapshot.content = '# 被外部改写'
    await writeFile(snapshotPath, JSON.stringify(snapshot))
    await assert.rejects(store.readVersion(project.id, name, versions[0].id), /校验失败/)
    await assert.rejects(store.listVersions(project.id, name), /校验失败/)
    assert.equal((await store.readDocument(project.id, name)).content, '# 被保存\n')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('document and history symlinks cannot read or write outside the product directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aipm-history-')), outside = await mkdtemp(join(tmpdir(), 'aipm-outside-'))
  try {
    const store = new ProjectStore(root); await store.init()
    let project = await store.create('路径检查')
    project = await store.saveDocument(project.id, { content: '# 原文' })
    const name = project.documents[0].name, path = join(root, project.folder, '产出物', name)
    const history = join(root, project.folder, '.history'), first = await store.readDocument(project.id, name)
    await symlink(outside, history)
    await assert.rejects(store.saveDocument(project.id, { content: '# 覆盖', hash: first.hash }), /符号链接/)
    await assert.rejects(store.listVersions(project.id, name), /符号链接/)
    await assert.rejects(store.readVersion(project.id, name, randomUUID()), /符号链接/)
    assert.deepEqual(await readdir(outside), []); assert.equal(await readFile(path, 'utf8'), first.content)
    await unlink(history)
    await store.saveDocument(project.id, { content: '# 新文', hash: first.hash })
    const [version] = await store.listVersions(project.id, name)
    const snapshotPath = join(history, '0', `${version.id}.json`), snapshot = await readFile(snapshotPath, 'utf8')
    const outsideSnapshot = join(outside, 'snapshot.json'); await writeFile(outsideSnapshot, snapshot)
    await unlink(snapshotPath); await symlink(outsideSnapshot, snapshotPath)
    await assert.rejects(store.readVersion(project.id, name, version.id), /符号链接/)
    await assert.rejects(store.listVersions(project.id, name), /符号链接/)
    const outsideDocument = join(outside, 'document.md'); await writeFile(outsideDocument, '# 外部原文\n')
    await unlink(path); await symlink(outsideDocument, path)
    await assert.rejects(store.readDocument(project.id, name), /符号链接/)
    await assert.rejects(store.saveDocument(project.id, { content: '# 覆盖', hash: first.hash }), /符号链接/)
    assert.equal(await readFile(outsideDocument, 'utf8'), '# 外部原文\n')
    await unlink(path); await unlink(snapshotPath)
  } finally {
    await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true })
  }
})
