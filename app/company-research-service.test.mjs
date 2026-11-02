import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CompanyResearchService } from './company-research-service.mjs'

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aipm-company-')), chats = new Map(), calls = [], updates = []
  const skillRoot = join(root, 'skill'); mkdirSync(join(skillRoot, 'references'), { recursive: true })
  for (const file of ['SKILL.md', 'references/company-research-framework.md', 'references/report-spec.md', 'references/client-investor-extension.md', 'references/company-html-layout.md', 'references/discovery-question-quality-standard.md']) writeFileSync(join(skillRoot, file), '# 完整资料 ' + file)
  const pi = {
    create(input) { const chat = { id: randomUUID(), ...input, status: 'idle', messages: [], runs: [], artifacts: [] }; chats.set(chat.id, chat); calls.push(['create', input]); return structuredClone(chat) },
    get(id) { const chat = chats.get(id); if (!chat) throw new Error('会话不存在'); return structuredClone(chat) },
    send(id, content) { calls.push(['send', id, content]); chats.get(id).status = 'running'; chats.get(id).messages.push({ role: 'user', content }); return this.get(id) },
    async cancel(id) { calls.push(['cancel', id]); chats.get(id).status = 'cancelled'; return this.get(id) },
    reply(id, token, approved) { calls.push(['reply', id, token, approved]); chats.get(id).status = 'running'; return this.get(id) },
  }
  const args = { root: join(root, 'projects'), skillRoot, pi, getApi: () => ({ model: 'deepseek-v4-pro', apiKey: 'must-not-persist' }), onUpdate: p => updates.push(p), reportBuilder: async ({ outputPath }) => { writeFileSync(outputPath, '<html>一致报告</html>'); return { htmlPath: outputPath, audit: { passed: true, exitCode: 0, output: '严格审计通过' } } }, ...options }
  const service = new CompanyResearchService(args)
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, service, args, pi, chats, calls, updates }
}
const draft = '# 测试公司\n\n这是用户草稿，不代表事实已核验。\n'

test('all modes reuse actual Pi conversations; create never starts a model turn', t => {
  const f = fixture(t)
  for (const mode of ['company', 'client', 'investor']) {
    const p = f.service.create({ subject: '示例公司', mode, website: 'https://example.com', purpose: '合作评估', region: '中国', competitors: '待核实竞对', asOf: '2026-10-20' })
    assert.equal(p.depth, mode === 'company' ? 'quick' : 'standard'); assert.equal(p.chat.id, p.chatId); assert.equal(p.model, 'deepseek-v4-pro'); assert.equal(p.chat.status, 'idle')
    assert.equal(p.region, '中国'); assert.equal(p.competitors, '待核实竞对'); assert.equal(p.asOf, '2026-10-20')
    const context = f.service.contextForChat(p.chat); assert.match(context.system, /companySearch/); assert.match(context.system, /不可信|待判断的证据数据/); assert.ok(context.files.some(file => file.path.endsWith(mode === 'company' ? 'report-spec.md' : 'client-investor-extension.md')))
    const sent = f.service.send(p.id, '请开始研究并明确缺口'); assert.equal(sent.chat.status, 'running'); assert.equal(sent.chat.messages[0].content, '请开始研究并明确缺口')
    assert.doesNotMatch(readFileSync(join(f.service.folder(p.id), 'project.json'), 'utf8'), /must-not-persist/)
  }
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 3); assert.equal(f.calls.filter(call => call[0] === 'send').length, 3)
  assert.equal(f.service.contextForChat({ id: randomUUID() }), null)
  assert.equal(f.service.projectIdForChat(randomUUID()), null)
  for (const p of f.service.list()) assert.equal(f.service.projectIdForChat(p.chatId), p.id)
  assert.throws(() => f.service.create({ subject: '' }), /主体/)
  assert.throws(() => f.service.create({ subject: '示例公司', asOf: '2026-02-31' }), /截止日期/)
})

test('materials and fetched evidence are durable and source snippets never become verified evidence', async t => {
  const f = fixture(t, { webSearch: async query => ({ query, engine: 'fixture', searchedAt: '2026-10-25', results: [{ title: '原网页', url: 'https://example.com', snippet: '只有线索' }] }), webFetch: async url => ({ requestedUrl: url, url, title: '原始披露', text: '原始正文', contentType: 'text/html', fetchedAt: '2026-10-25', links: [] }) })
  const p = f.service.create({ subject: '示例公司' })
  f.service.addMaterial(p.id, { name: '会后纪要.txt', content: '客户说预算仍待确认。' })
  const search = await f.service.search(p.id, '公司 公告'); assert.equal(search.results.length, 1); assert.equal(f.service.get(p.id).sources.length, 0)
  const source = await f.service.fetch(p.id, 'https://example.com'); assert.equal(source.id, 'S01'); assert.equal(source.readable, true); assert.match(readFileSync(source.path, 'utf8'), /不是执行指令/)
  await f.service.fetch(p.id, 'https://example.com'); assert.equal(f.service.get(p.id).sources.length, 1); assert.equal(f.service.get(p.id).sourceHistory.length, 1)
  const reopened = new CompanyResearchService(f.args); assert.equal(reopened.get(p.id).materials[0].id, 'M01'); assert.match(reopened.contextForChat(p.chat).system, /S01/); assert.match(reopened.contextForChat(p.chat).system, /会后纪要/); await reopened.close()
})

test('publish archives immutable versions and persists failed audit results without claiming success', async t => {
  const f = fixture(t), p = f.service.create({ subject: 'ACME公司' }), draftPath = p.draft.path
  assert.equal(f.service.read(p.id, 'draft').content, '')
  assert.equal(f.service.read(p.id).version, 'draft')
  writeFileSync(draftPath, `---\nsubject: ACME公司\nmode: company\ndepth: quick\nas_of: "${p.asOf}"\nversion: v1\n---\n\n` + draft)
  const first = await f.service.publish(p.id); assert.equal(first.versions[0].version, 'v1'); assert.equal(first.lastAudit.passed, true)
  const old = f.service.read(p.id, 'v1').content
  writeFileSync(draftPath, '---\nsubject: ACME公司\nversion: v1\n---\n\n修改后的草稿。')
  f.service.reportBuilder = async ({ outputPath }) => { writeFileSync(outputPath, '<html>缺少来源</html>'); return { audit: { passed: false, exitCode: 1, output: '缺少来源和主体口径' } } }
  const second = await f.service.publish(p.id); assert.equal(second.versions.length, 2); assert.equal(second.lastAudit.passed, false); assert.match(second.lastAudit.output, /缺少来源/)
  assert.equal(f.service.read(p.id, 'v1').content, old); assert.match(f.service.read(p.id).content, /version: v2/); assert.match(f.service.read(p.id).content, /修改后/)
  assert.equal(f.service.read(p.id, 'draft').version, 'draft'); assert.equal(f.service.reportPath(p.id, 2, 'html'), second.versions[1].htmlPath)
  assert.throws(() => f.service.reportPath(p.id, '../outside'), /不存在/)
  const reopened = new CompanyResearchService(f.args); assert.equal(reopened.get(p.id).lastAudit.version, 'v2'); await reopened.close()
})

test('missing HTML or a failed builder is recorded as an incomplete delivery', async t => {
  const f = fixture(t, { reportBuilder: async () => ({ audit: { passed: true, exitCode: 0, output: '误报' } }) }), p = f.service.create({ subject: '示例公司' })
  writeFileSync(p.draft.path, draft)
  let result = await f.service.publish(p.id); assert.equal(result.lastAudit.passed, false); assert.equal(result.versions[0].htmlPath, null)
  f.service.reportBuilder = async () => { throw new Error('Python执行失败') }
  result = await f.service.publish(p.id); assert.equal(result.versions.length, 2); assert.equal(result.lastAudit.passed, false); assert.match(result.lastAudit.output, /Python执行失败/)
})

test('report reads and archives reject symlink substitution and library traversal', async t => {
  const f = fixture(t), p = f.service.create({ subject: '示例公司' }), outside = join(f.root, 'outside.txt')
  writeFileSync(outside, '不能读取'); unlinkSync(p.draft.path); symlinkSync(outside, p.draft.path)
  assert.throws(() => f.service.read(p.id, 'draft'), /符号链接/); await assert.rejects(f.service.publish(p.id), /符号链接/)
  assert.throws(() => f.service.readLibrary('../outside.txt'), /名称无效/)
  assert.ok(f.service.library().some(file => file.name === 'SKILL.md'))
})

test('unreadable PDF evidence remains explicitly unverified and concurrent sources keep unique IDs', async t => {
  const f = fixture(t, { webFetch: async url => ({ requestedUrl: url, url, title: 'PDF公告', text: '', pdfBytes: Buffer.from('%PDF-1.7'), contentType: 'application/pdf', links: [] }) }), p = f.service.create({ subject: '示例公司' })
  f.service._extractPdf = async () => { await new Promise(resolve => setTimeout(resolve, 5)); throw new Error('扫描件') }
  const results = await Promise.all([f.service.fetch(p.id, 'https://example.com/a.pdf'), f.service.fetch(p.id, 'https://example.com/b.pdf')])
  assert.deepEqual(results.map(result => result.id), ['S01', 'S02']); assert.ok(results.every(result => result.readable === false && result.warning.includes('不能据此编造')))
  assert.equal(f.service.get(p.id).sources.length, 2)
})

test('cancel and close abort owned network operations and await Pi cancellation', async t => {
  const f = fixture(t, { webSearch: (_query, { signal }) => new Promise((resolve, reject) => { if (signal.aborted) return reject(new Error('已停止')); signal.addEventListener('abort', () => reject(new Error('已停止')), { once: true }) }) }), p = f.service.create({ subject: '示例公司' })
  const pending = f.service.search(p.id, '公司'), failure = assert.rejects(pending, /已停止/)
  await new Promise(resolve => setImmediate(resolve)); const result = await f.service.cancel(p.id); await failure
  assert.equal(result.chat.status, 'cancelled'); assert.equal(f.service.operations.size, 0)
  f.service.reply(p.id, 'approval-token', true); assert.deepEqual(f.calls.at(-1), ['reply', p.chatId, 'approval-token', true])
  await f.service.close(); assert.throws(() => f.service.send(p.id, '继续'), /已关闭/)
})

test('each archived version freezes its source and material ledger across later refreshes', async t => {
  let body = '旧来源正文'
  const f = fixture(t, { webFetch: async url => ({ url, text: body, title: body, fetchedAt: new Date().toISOString(), contentType: 'text/html' }) }), p = f.service.create({ subject: '示例公司' })
  await f.service.fetch(p.id, 'https://example.com'); f.service.addMaterial(p.id, { name: '旧材料', content: '旧会后纪要' }); writeFileSync(p.draft.path, draft)
  await f.service.publish(p.id)
  const original = f.service.read(p.id, 'v1'), oldPath = original.sources[0].path
  body = '新来源正文'; await f.service.fetch(p.id, 'https://example.com'); f.service.addMaterial(p.id, { name: '新材料', content: '新会后纪要' })
  const current = f.service.get(p.id), archived = f.service.read(p.id, 'v1')
  assert.equal(current.sources[0].title, '新来源正文'); assert.equal(archived.sources[0].title, '旧来源正文'); assert.equal(archived.sources[0].path, oldPath)
  assert.equal(archived.materials.length, 1); assert.equal(current.materials.length, 2); assert.match(readFileSync(oldPath, 'utf8'), /旧来源正文/)
})

test('PDF truncation is explicit and every listed library item can be read within its limit', async t => {
  const f = fixture(t, { webFetch: async url => ({ url, text: '', title: '财报', pdfBytes: Buffer.from('%PDF-1.7'), contentType: 'application/pdf' }) }), p = f.service.create({ subject: '示例公司' })
  f.service._extractPdf = async () => ({ text: '被截断的正文', truncated: true })
  const source = await f.service.fetch(p.id, 'https://example.com/report.pdf'); assert.equal(source.truncated, true); assert.match(source.warning, /截断/)
  writeFileSync(join(f.args.skillRoot, 'offline.html'), 'a'.repeat(5 * 1024 * 1024))
  assert.ok(f.service.library().some(file => file.name === 'offline.html')); assert.equal(f.service.readLibrary('offline.html').content.length, 5 * 1024 * 1024)
})

test('publish checks only host-owned subject, mode, depth and date without rewriting user identity', async t => {
  const f = fixture(t), subject = 'ACME "品牌" 公司', p = f.service.create({ subject, mode: 'client', depth: 'deep', asOf: '2026-10-20' })
  const frontmatter = values => '---\n' + Object.entries(values).map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join('\n') + '\n---\n\n正文可写真实法人全称，与用户输入名称区分。\n'
  const expected = { subject, mode: 'client', depth: 'deep', as_of: '2026-10-20' }
  writeFileSync(p.draft.path, frontmatter(expected))
  const first = await f.service.publish(p.id); assert.equal(first.lastAudit.passed, true)
  for (const [field, wrong] of [['subject', '擅自更换的法人名'], ['mode', 'company'], ['depth', 'quick'], ['as_of', '2026-10-21']]) {
    const content = frontmatter({ ...expected, [field]: wrong }); writeFileSync(p.draft.path, content)
    const failed = await f.service.publish(p.id)
    assert.equal(failed.lastAudit.passed, false); assert.match(failed.lastAudit.output, new RegExp(field + ' 与项目配置错配'))
    assert.equal(f.service.read(p.id, 'draft').content, content); assert.equal(f.service.read(p.id).audit.passed, false)
  }
  const context = f.service.contextForChat(p.chat).system; assert.ok(context.includes('subject: ' + JSON.stringify(subject))); assert.match(context, /法人全称与集团边界写在报告正文/)
})

test('source ledger is frozen when publish starts even if the same source refreshes during audit', async t => {
  let finishAudit, auditStarted, body = '发布前来源'
  const started = new Promise(resolve => { auditStarted = resolve }), gate = new Promise(resolve => { finishAudit = resolve })
  const f = fixture(t, { webFetch: async url => ({ url, title: body, text: body, contentType: 'text/html' }), reportBuilder: async ({ outputPath }) => { auditStarted(); await gate; writeFileSync(outputPath, '<html>归档</html>'); return { audit: { passed: true, exitCode: 0, output: '通过' } } } }), p = f.service.create({ subject: '示例公司' })
  await f.service.fetch(p.id, 'https://example.com'); writeFileSync(p.draft.path, draft)
  const pending = f.service.publish(p.id); await started
  body = '审核中复抓的新来源'; await f.service.fetch(p.id, 'https://example.com'); f.service.addMaterial(p.id, { name: '审核中新材料', content: '不能混进旧版账本' })
  finishAudit(); await pending
  assert.equal(f.service.get(p.id).sources[0].title, '审核中复抓的新来源')
  const archived = f.service.read(p.id, 'v1'); assert.equal(archived.sources[0].title, '发布前来源'); assert.equal(archived.materials.length, 0)
})
