import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import jsdom from 'jsdom'
import { buildCompanyReport, DEFAULT_COMPANY_RESEARCH_SKILL_ROOT } from './company-research-report.mjs'

const skillRoot = DEFAULT_COMPANY_RESEARCH_SKILL_ROOT
const { JSDOM, requestInterceptor, VirtualConsole } = jsdom
const sourceTable = `| ID | 来源 | 发布方/类型 | 发布日期 | 访问日期 | 支持内容 |
|---|---|---|---|---|---|
| [S01] | [本地测试来源](https://example.invalid/company) | 测试固定材料 | 未标明 | 2026-10-25 | 主体、产品与财务局限 |`

function companyMarkdown({ version = 'v1', extra = '' } = {}) {
  return `---
title: 测试公司 · 公司调研
report_id: fixture-company-20261025
subject: 测试公司有限公司
mode: company
depth: quick
market_status: private
version: ${version}
as_of: 2026-10-25
generated_at: 2026-10-25
---
# 测试公司 · 公司调研
## 公司总览
### 决策摘要
公司称其向企业提供会议记录软件，付费规模仍待确认。[S01]
### 主体与研究范围
本报告只覆盖测试公司有限公司，不包含同名品牌。[S01]
### 近期变化
本轮公开渠道未见近期变化，不能据此断言业务未变化。
### 结论与下一步
据此判断，下一步应向公司确认客户与续费数据。
## 业务报告
### 业务与产品
公司称其提供会议记录软件。[S01]
### 经营链贯通矩阵
| 产品/服务 | 客户与付费方 | 交付方式 | 技术支撑 | 变现方式 | 来源 |
|---|---|---|---|---|---|
| 会议软件 | 公司称目标为企业，实际付费方未披露 | 网页产品 | 只能确认产品能力，底层实现未知 | 公司称按年订阅，收入未披露 | [S01] |
### 商业化与客户
公司称目标客户为企业，实际付费客户公开未披露。[S01]
### 竞争与替代
客户自建与人工记录属于待验证的替代方案，未确认直接竞对。
## 技术报告
### 技术与研发
只可确认产品描述，底层模型、架构与自研边界无法确认。[S01]
${extra}
## 财务、商业质量与风险
### 财务与资本
非上市公司公开未披露经审计财务报表，营收、利润和现金流无法确认。
### 风险与反对证据
公开产品描述不能证明客户采用或规模化收入，商业质量仍待验证。
## 来源与信息缺口
### 来源
${sourceTable}
### 信息缺口与待确认
需要向公司取得客户案例与财务资料，才能继续验证商业质量。
`
}

function visitMarkdown(mode) {
  const chapters = mode === 'client'
    ? ['公司底图与当前业务', '机会背景与真实需求', '决策链与关键人', '我方切入与最小验证', '双向问题', '会议议程与后续动作', '风险与待确认']
    : ['机构与基金主体', '投资主题与出手节奏', '近期案例与投资组合', '决策人与投决流程', '我方项目匹配与差异化', '双向问题与下一步', '风险与待确认']
  return `---
title: 测试主体 · 拜访作战地图
report_id: fixture-${mode}
subject: 测试主体
mode: ${mode}
depth: standard
version: v1
as_of: 2026-10-25
generated_at: 2026-10-25
---
# 测试主体
${chapters.map(title => `## ${title}\n公司称相关信息仍待确认。[S01]`).join('\n')}
## 来源
${sourceTable}
`
}

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-company-report-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('the skill keeps every upstream file and pins self-contained dependencies with hashes and licenses', async () => {
  const manifest = JSON.parse(await readFile(path.join(skillRoot, 'SOURCE.json'), 'utf8'))
  assert.equal(manifest.originalFiles.length, 15)
  for (const entry of [...manifest.originalFiles, ...manifest.runtimeAssets, ...manifest.adaptedFiles]) {
    const bytes = await readFile(path.join(skillRoot, entry.path))
    assert.equal(bytes.byteLength, entry.bytes, entry.path)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path)
  }
  const original = await readFile(path.join(skillRoot, 'company_report_template.html'), 'utf8')
  assert.match(original, /src="https:\/\/cdn\.jsdelivr\.net/)
  const offline = await readFile(path.join(skillRoot, 'company_report_template.offline.html'), 'utf8')
  const scripts = [...offline.matchAll(/<script\b([^>]*)>/g)]
  const embedded = scripts.filter(match => /data-vendored=/.test(match[1]))
  assert.equal(embedded.length, 4)
  for (const script of embedded) {
    const encoded = script[1].match(/src="data:application\/javascript;base64,([^"]+)"/)[1]
    const decoded = Buffer.from(encoded.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))), 'base64')
    const name = script[1].match(/data-vendored="([^"]+)"/)[1]
    const asset = manifest.runtimeAssets.find(entry => `${entry.package}@${entry.version}` === name && entry.path.endsWith('.js'))
    assert.equal(createHash('sha256').update(decoded).digest('hex'), asset.sha256)
  }
  assert.doesNotMatch(offline, /<(?:script|link|img)\b[^>]*(?:src|href)=["'](?:https?:)?\/\//i)
  assert.match(offline, /Content-Security-Policy/)
  assert.match(offline, /connect-src 'none'/)
  assert.match(offline, /object-src 'none'/)
  assert.match(offline, /html:false/)
  assert.match(offline, /securityLevel:'strict'/)
  assert.doesNotMatch(offline, /unsafe-eval/)
})

test('the real Python builder produces a strict audited report with byte-identical Markdown', async t => {
  const root = await workspace(t)
  const markdownPath = path.join(root, '公司调研_v1.md')
  const markdown = companyMarkdown({ extra: '\n正文保留中文和特殊字符 & < >。\n' })
  await writeFile(markdownPath, markdown)
  const result = await buildCompanyReport({ markdownPath })
  assert.equal(result.audit.passed, true, result.audit.output)
  assert.equal(result.audit.exitCode, 0)
  assert.equal(result.audit.report.checks.company_layout, 'five-module-v2')
  assert.equal(result.audit.report.checks.company_v2_modules, 5)
  assert.equal(result.offline, true)
  assert.equal(result.embeddedMarkdownMatches, true)
  const html = await readFile(result.htmlPath, 'utf8')
  const payload = html.match(/<script id="md-source" type="text\/plain">([^<]+)<\/script>/)[1]
  assert.deepEqual(Buffer.from(payload, 'base64'), Buffer.from(markdown))
  assert.equal(await readFile(markdownPath, 'utf8'), markdown)
})

test('client and investor report structures both pass the original mode-specific strict audit', async t => {
  const root = await workspace(t)
  for (const mode of ['client', 'investor']) {
    const markdownPath = path.join(root, `${mode}_v1.md`)
    await writeFile(markdownPath, visitMarkdown(mode))
    const result = await buildCompanyReport({ markdownPath })
    assert.equal(result.audit.passed, true, result.audit.output)
    assert.equal(result.audit.report.checks.mode, mode)
  }
})

test('audit errors remain visible and retain the report instead of turning a failed audit into completion', async t => {
  const root = await workspace(t)
  const markdownPath = path.join(root, '缺少来源_v1.md')
  await writeFile(markdownPath, companyMarkdown().replace(sourceTable, '公开未披露有效来源。'))
  const result = await buildCompanyReport({ markdownPath })
  assert.equal(result.audit.passed, false)
  assert.equal(result.audit.exitCode, 1)
  assert.match(result.audit.output, /来源/)
  assert.equal(result.embeddedMarkdownMatches, true)
  assert.ok((await readFile(result.htmlPath)).byteLength > 0)
})

test('build failures do not overwrite existing output or Markdown source', async t => {
  const root = await workspace(t)
  const markdownPath = path.join(root, '保留历史_v1.md')
  const outputPath = path.join(root, '保留历史_v1.html')
  await writeFile(markdownPath, companyMarkdown())
  await writeFile(outputPath, '已有历史报告')
  await assert.rejects(buildCompanyReport({ markdownPath, outputPath }), /already exists/)
  assert.equal(await readFile(outputPath, 'utf8'), '已有历史报告')
  await assert.rejects(buildCompanyReport({ markdownPath, outputPath: markdownPath }), /overwrite/)
  assert.equal(await readFile(markdownPath, 'utf8'), companyMarkdown())
})

test('script arguments preserve literal filenames and subprocesses do not receive API credentials', async t => {
  const root = await workspace(t)
  const python = path.join(root, '受信 Python wrapper')
  const marker = path.join(root, 'should-not-exist')
  await writeFile(python, `#!/usr/bin/python3\nimport os,sys\nassert not any('SECRET' in key or 'TOKEN' in key or 'KEY' in key or 'PASSWORD' in key for key in os.environ), 'credentials leaked'\nos.execv('/usr/bin/python3',['/usr/bin/python3']+sys.argv[1:])\n`, { mode: 0o700 })
  const markdownPath = path.join(root, '名字包含 $HOME 与 $(printf injected)_v1.md')
  await writeFile(markdownPath, companyMarkdown())
  const previous = process.env.AIPM_REPORT_TEST_SECRET
  process.env.AIPM_REPORT_TEST_SECRET = 'test-only-never-forward'
  t.after(() => { if (previous === undefined) delete process.env.AIPM_REPORT_TEST_SECRET; else process.env.AIPM_REPORT_TEST_SECRET = previous })
  const result = await buildCompanyReport({ markdownPath, python })
  assert.equal(result.audit.passed, true, result.audit.output)
  assert.match(result.htmlPath, /\$\(printf injected\)/)
  await assert.rejects(readFile(marker), { code: 'ENOENT' })
  await assert.rejects(buildCompanyReport({ markdownPath, python: 'python3' }), /绝对路径/)
})

test('the exported report renders offline, keeps navigation and collapses, and escapes active source content', async t => {
  const root = await workspace(t)
  const markdownPath = path.join(root, '离线阅读_v1.md')
  const extra = '\n<script>window.reportCompromised = true</script>\n\n![证据图片](https://tracker.invalid/pixel.png)\n\n```mermaid\ngraph TD\n A[产品] --> B[客户]\n```\n'
  await writeFile(markdownPath, companyMarkdown({ extra }))
  const result = await buildCompanyReport({ markdownPath })
  assert.equal(result.audit.passed, true, result.audit.output)
  const requests = []
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error))
  const dom = new JSDOM(await readFile(result.htmlPath, 'utf8'), {
    url: 'https://report.invalid/local.html',
    runScripts: 'dangerously',
    resources: { interceptors: [requestInterceptor(request => {
      requests.push(request.url)
      if (!request.url.startsWith('data:')) throw new Error(`unexpected remote request: ${request.url}`)
    })] },
    virtualConsole,
    beforeParse(window) {
      window.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} }
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
      window.structuredClone = structuredClone
      window.SVGElement.prototype.getBBox = function () { return { x: 0, y: 0, width: 120, height: 30 } }
      window.SVGElement.prototype.getComputedTextLength = function () { return this.textContent.length * 10 }
    },
  })
  t.after(() => dom.window.close())
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }))
  const document = dom.window.document
  assert.equal(dom.window.reportCompromised, undefined)
  assert.equal(document.querySelectorAll('#content .bm-ch').length, 5)
  assert.equal(document.querySelectorAll('nav#view-nav a').length, 2)
  assert.equal(document.querySelectorAll('#toc-content a').length > 5, true)
  assert.equal(document.querySelector('tr#source-s01 td').textContent, '[S01]')
  assert.equal(document.querySelector('.evidence-tag[href="#source-s01"]').textContent, '[S01]')
  assert.equal(document.querySelector('#content img, #content script, #content iframe'), null)
  assert.match(document.querySelector('#content').textContent, /证据图片/)
  assert.match(document.querySelector('#content').textContent, /<script>/)
  const externalSource = document.querySelector('#source-s01 a')
  assert.equal(externalSource.getAttribute('rel'), 'noopener noreferrer')
  document.querySelector('#collapse-all').click()
  assert.equal(document.querySelectorAll('.bm-ch.collapsed').length, 5)
  assert.equal(document.querySelector('#business-report button').getAttribute('aria-expanded'), 'false')
  document.querySelector('[data-view-link="business"]').click()
  assert.equal(document.querySelector('#business-report').classList.contains('collapsed'), false)
  document.querySelector('#expand-all').click()
  assert.equal(document.querySelectorAll('.bm-ch.collapsed').length, 0)
  assert.equal(document.querySelectorAll('script[data-vendored][src^="data:"]').length, 4)
  assert.equal(typeof dom.window.markdownit, 'function')
  assert.equal(typeof dom.window.jsyaml.load, 'function')
  assert.equal(typeof dom.window.mermaid.render, 'function')
  assert.deepEqual(requests, [])
  assert.deepEqual(errors, [])
})
