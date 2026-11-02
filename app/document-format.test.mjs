import assert from 'node:assert/strict'
import test from 'node:test'
import { performance } from 'node:perf_hooks'
import { JSDOM } from 'jsdom'
import { renderMarkdown, safeMarkdownHref, summarizeChanges } from './document-format.mjs'

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://fixture.invalid/' })
globalThis.window = dom.window
test.after(() => { delete globalThis.window; dom.window.close() })

function fragment(source) {
  const container = dom.window.document.createElement('div')
  container.innerHTML = renderMarkdown(source)
  return container
}

test('Markdown reading keeps headings, lists, tables, code, quotes and evidence markers', () => {
  const content = fragment('# 需求 [E01]\n\n## 范围\n\n- 第一项\n- **第二项**\n\n> 已核验\n\n| 功能 | 状态 |\n| --- | ---: |\n| 阅读 | 完成 |\n\n```js\nconst html = "<script>alert(1)</script>";\n```\n')
  assert.equal(content.querySelector('h1').textContent, '需求 [E01]')
  assert.equal(content.querySelectorAll('li').length, 2)
  assert.equal(content.querySelector('strong').textContent, '第二项')
  assert.equal(content.querySelector('blockquote').textContent.trim(), '已核验')
  assert.equal(content.querySelector('.markdown-table-scroll').getAttribute('tabindex'), '0')
  assert.equal(content.querySelectorAll('table th').length, 2)
  assert.match(content.querySelector('pre code').textContent, /<script>alert\(1\)<\/script>/)
  assert.equal(content.querySelector('script'), null)
})

test('raw HTML and resource elements remain escaped text without executable nodes', () => {
  const attacks = [
    '<script>window.compromised = true</script>',
    '<img src="https://remote.invalid/tracker" onerror="alert(1)">',
    '<iframe src="https://remote.invalid/"></iframe>',
    '<form action="https://remote.invalid"><input autofocus onfocus="alert(1)"></form>',
    '<svg><a href="javascript:alert(1)">attack</a></svg>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
  ]
  for (const attack of attacks) {
    const content = fragment(attack)
    assert.equal(content.querySelector('script,img,iframe,form,input,svg,math,style,object,embed'), null)
    assert.ok(content.textContent.includes('<'), 'source HTML remains readable as text')
    assert.equal(content.querySelector('[onclick],[onerror],[onfocus],[src],[srcset]'), null)
  }
})

test('Markdown images keep their alt text without issuing image requests', () => {
  const content = fragment('![证据截图](https://remote.invalid/track.png)\n\n![本地](file:///private/secret.png)\n\n![data](data:image/svg+xml,<svg onload=alert(1)>)')
  assert.equal(content.querySelector('img'), null)
  assert.match(content.textContent, /证据截图/)
  assert.match(content.textContent, /本地/)
  assert.equal(content.querySelector('[src],[srcset]'), null)
})

test('HTTPS links preserve formatting and safe attributes; other schemes become text', () => {
  const content = fragment('[**来源**](https://example.com/a?x=1&y=2 "来源说明")\n\n[跳转](#section)\n\n[js](javascript:alert%281%29) [data](data:text/html,test) [file](file:///tmp/x) [http](http://example.com) [relative](./local.html)')
  const links = [...content.querySelectorAll('a')]
  assert.equal(links.length, 1)
  assert.equal(links[0].getAttribute('href'), 'https://example.com/a?x=1&y=2')
  assert.equal(links[0].getAttribute('target'), '_blank')
  assert.equal(links[0].getAttribute('rel'), 'noopener noreferrer')
  assert.equal(links[0].getAttribute('title'), '来源说明')
  assert.equal(links[0].querySelector('strong').textContent, '来源')
  assert.match(content.textContent, /跳转/)
  assert.match(content.textContent, /js.*data.*file.*http.*relative/s)
  for (const url of ['javascript:alert(1)', 'jav\tascript:alert(1)', 'data:text/html,test', '//example.com', '#section', 'https://user:password@example.com', 'https://exa\nmple.com']) assert.equal(safeMarkdownHref(url), null)
  assert.equal(safeMarkdownHref('HTTPS://EXAMPLE.COM'), 'https://example.com/')
})

test('crafted link and image text cannot inject active attributes or tags', () => {
  const content = fragment('[x](https://example.com/\"onmouseover=\"alert "\" onmouseover=\"attack")\n\n![<img src=x onerror=alert(1)>](https://remote.invalid/)\n\n`<img src=x onerror=alert(1)>`')
  assert.equal(content.querySelector('img,[onmouseover],[onerror]'), null)
  for (const link of content.querySelectorAll('a')) assert.equal(new URL(link.getAttribute('href')).protocol, 'https:')
})

test('line summaries count separated additions and deletions and keep source as plain text', () => {
  const summary = summarizeChanges('first\nremove\nshared\nold\nlast\n', 'first\n<script>alert(1)</script>\nshared\nnew\nextra\nlast\n')
  assert.equal(summary.added, 3)
  assert.equal(summary.removed, 2)
  assert.equal(summary.lines.find(line => line.kind === 'added').text, '<script>alert(1)</script>')
  const safeReview = dom.window.document.createElement('div')
  for (const line of summary.lines) { const row = dom.window.document.createElement('p'); row.textContent = line.text; safeReview.append(row) }
  assert.equal(safeReview.querySelector('script'), null)
  assert.equal(summary.truncated, false)
  assert.deepEqual(summarizeChanges('same\r\n', 'same\n'), { added: 0, removed: 0, lines: [], truncated: false })
  assert.deepEqual(summarizeChanges('', ''), { added: 0, removed: 0, lines: [], truncated: false })
})

test('review truncation limits displayed lines without truncating full counts', () => {
  const before = Array.from({ length: 320 }, (_, index) => `old ${index}`).join('\n')
  const after = Array.from({ length: 350 }, (_, index) => `new ${index}`).join('\n')
  const summary = summarizeChanges(before, after)
  assert.equal(summary.removed, 320)
  assert.equal(summary.added, 350)
  assert.equal(summary.lines.length, 200)
  assert.equal(summary.truncated, true)
})

test('100000-character documents keep full counts and render within a bounded local budget', t => {
  const before = Array.from({ length: 2000 }, (_, index) => `${String(index).padStart(4, '0')} ${'a'.repeat(43)}\n`).join('')
  assert.ok(before.length <= 100000)
  const after = before.replace('1000 a', '1000 b')
  const diffStart = performance.now()
  const summary = summarizeChanges(before, after)
  const diffMs = performance.now() - diffStart
  assert.equal(summary.added, 1)
  assert.equal(summary.removed, 1)
  assert.ok(summary.lines.some(line => line.kind === 'added' && line.text.startsWith('1000 b')))
  assert.ok(diffMs < 1500, `line diff took ${diffMs}ms`)
  const renderStart = performance.now()
  const output = renderMarkdown(before)
  const renderMs = performance.now() - renderStart
  assert.ok(output.length > 0)
  assert.ok(renderMs < 5000, `render took ${renderMs}ms`)
  t.diagnostic(`98000-character diff: ${diffMs.toFixed(1)}ms; render: ${renderMs.toFixed(1)}ms`)
})
