import test from 'node:test'
import assert from 'node:assert/strict'
import { companyModelResult } from './company-research-model.mjs'

test('project responses exclude recursive history and retain traceable report metadata without mutation', () => {
  const input = {
    id: 'research-1', subject: '示例公司', mode: 'company', depth: 'quick', asOf: '2026-10-25', purpose: '了解业务', region: '中国', website: 'https://example.com', chatId: 'chat-1', status: 'running',
    draft: { name: 'draft.md', path: '/research/workspace/draft.md', exists: true, size: 100 },
    sources: [{ id: 'S01', title: '原始公告', url: 'https://example.com/report', path: '/research/sources/S01.txt', text: 'large-body'.repeat(100000), fetchedAt: '2026-10-25', readable: true }],
    materials: [{ id: 'M01', name: '纪要', path: '/research/materials/M01.txt', content: 'private-material-body' }],
    versions: [{ version: 'v1', markdownPath: '/research/versions/v1/report.md', htmlPath: '/research/versions/v1/report.html', sources: [{ text: 'old source body'.repeat(10000) }], materials: [{ content: 'old material body'.repeat(10000) }], audit: { passed: false, output: 'raw audit dump'.repeat(10000), report: { errors: ['缺少主体口径'], warnings: ['公开财务不足'], checks: { huge: 'irrelevant-checks'.repeat(10000) } } } }],
    lastAudit: { passed: false, report: { errors: ['缺少主体口径'], warnings: [] }, hostMetadataIssues: ['subject 与宿主错配'] },
    chat: { id: 'chat-1', messages: [{ content: 'recursive-history'.repeat(100000) }], runs: [{ tools: [{ result: { chat: { messages: ['nested-recursive-history'] } } }] }], usage: { tokens: 999999 } },
    messages: ['do not retain'], runs: ['do not retain'], usage: { input: 999999 }, sourceHistory: ['do not retain'],
  }
  input.chat.runs[0].tools.push({ result: input })
  for (const action of ['companyGet', 'companyCreate', 'companyPublish', 'companyAddMaterial']) {
    const output = companyModelResult(action, input), encoded = JSON.stringify(output)
    assert.ok(encoded.length < 3000, `${action}: ${encoded.length}`)
    for (const key of ['chat', 'messages', 'runs', 'usage', 'sourceHistory']) assert.equal(Object.hasOwn(output, key), false)
    assert.equal(output.chatId, 'chat-1'); assert.equal(output.sources[0].path, '/research/sources/S01.txt'); assert.equal(output.materials[0].path, '/research/materials/M01.txt'); assert.equal(output.versions[0].markdownPath, '/research/versions/v1/report.md')
    assert.equal(output.sources[0].text, undefined); assert.equal(output.versions[0].sources, undefined); assert.deepEqual(output.versions[0].audit.errors, ['缺少主体口径']); assert.deepEqual(output.versions[0].audit.warnings, ['公开财务不足'])
    assert.ok(output.lastAudit.errors.includes('subject 与宿主错配'))
  }
  assert.equal(input.chat.runs[0].tools[1].result, input); assert.equal(input.sources[0].text.length, 1000000); assert.equal(input.versions[0].sources.length, 1)
})

test('fetch returns an explicit bounded excerpt and leaves the complete archived content unchanged', () => {
  const original = { id: 'S01', title: '长财报', url: 'https://example.com/report', path: '/research/S01.txt', text: '中'.repeat(120000), truncated: false, readable: true, links: [{ title: '下一份公告', url: 'https://example.com/next' }] }
  const output = companyModelResult('companyFetch', original)
  assert.equal(output.text.length, 24000); assert.equal(output.excerpted, true); assert.equal(output.fullContentChars, 120000); assert.equal(output.truncated, false); assert.match(output.excerptNote, /完整正文已归档/); assert.match(output.excerptNote, /read/)
  assert.equal(output.path, original.path); assert.equal(original.text.length, 120000); assert.equal(original.excerpted, undefined)
  const small = companyModelResult('companyFetch', { ...original, text: '完整短正文' }); assert.equal(small.excerpted, false); assert.equal(small.text, '完整短正文')
})

test('HTML report reads omit megabytes of scripts while Markdown and source IDs remain available', () => {
  const html = { name: '报告.html', path: '/research/v1/report.html', kind: 'html', version: 'v1', content: '<script>' + 'mermaid'.repeat(700000) + '</script>', audit: { passed: true }, sources: [{ id: 'S01' }] }
  const output = companyModelResult('companyRead', html)
  assert.equal(output.path, html.path); assert.equal(output.name, html.name); assert.equal(output.content, undefined); assert.equal(output.contentOmitted, true); assert.ok(JSON.stringify(output).length < 1000)
  assert.equal(html.content.length > 4 * 1024 * 1024, true)
  const md = companyModelResult('companyRead', { ...html, name: '报告.md', path: '/research/v1/report.md', kind: 'markdown', content: '事实来源 [S01]', sources: [{ id: 'S01', path: '/research/S01.txt', text: 'not retained' }] })
  assert.equal(md.content, '事实来源 [S01]'); assert.equal(md.sources[0].id, 'S01'); assert.equal(md.sources[0].path, '/research/S01.txt'); assert.equal(md.sources[0].text, undefined)
})

test('library excerpts retain exact names and caller-supplied file paths for full local reading', () => {
  const input = { name: 'company_report_template.offline.html', path: '/app/skills/hjh-company-research/company_report_template.offline.html', content: 'template-script'.repeat(400000) }
  const output = companyModelResult('companyReadLibrary', input)
  assert.equal(output.name, input.name); assert.equal(output.path, input.path); assert.equal(output.content.length, 24000); assert.equal(output.excerpted, true); assert.equal(input.content.length, 6000000)
  assert.deepEqual(companyModelResult('companyLibrary', [{ name: 'SKILL.md', path: '/app/SKILL.md', size: 500, kind: 'md', content: 'unused' }]), [{ name: 'SKILL.md', path: '/app/SKILL.md', size: 500, kind: 'md' }])
})

test('wrapped project results, summaries and unrelated workbench tools preserve their response contracts', () => {
  const wrapped = companyModelResult('companyPublish', { project: { id: 'research-1', chatId: 'chat-1', chat: { status: 'idle', messages: ['big'] } }, audit: { passed: true, output: '通过' } })
  assert.equal(wrapped.project.status, 'idle'); assert.equal(wrapped.project.chat, undefined); assert.equal(wrapped.audit.passed, true)
  const listed = companyModelResult('companyList', [{ id: 'research-1', subject: '公司', lastAudit: { passed: false, output: 'x'.repeat(1000000) } }]); assert.ok(JSON.stringify(listed).length < 4500)
  const other = { untouched: true }; assert.equal(companyModelResult('geoGet', other), other); assert.equal(companyModelResult('companyGet', null), null)
})
