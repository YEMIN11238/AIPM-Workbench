import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { isNonPublicAddress, publicUrl, requestPublicUrl, searchPublicWeb, fetchPublicPage } from './company-research-web.mjs'

const dnsPublic = async () => [{ address: '93.184.216.34', family: 4 }]
function requester(responses, observed = []) {
  return (url, options, callback) => {
    const request = new EventEmitter(); request.end = () => {
      observed.push({ url: url.href, options })
      queueMicrotask(() => {
        const response = new PassThrough(), data = responses.shift() || {}; response.statusCode = data.status || 200; response.headers = data.headers || { 'content-type': 'text/plain' }
        callback(response); if (!response.destroyed) response.end(data.body || 'hello')
      })
    }; return request
  }
}

test('public URL checks reject private, encoded, IPv6, credentials and non-web schemes', () => {
  for (const url of ['file:///etc/passwd', 'http://localhost', 'http://local.local', 'http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://10.1.2.3', 'http://169.254.169.254', 'http://100.64.1.1', 'http://198.18.0.1', 'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://[64:ff9b::7f00:1]', 'https://user:secret@example.com', 'https://example.com:3101']) assert.throws(() => publicUrl(url), url)
  assert.equal(publicUrl('https://example.com/report#section').href, 'https://example.com/report')
  assert.equal(isNonPublicAddress('2606:4700:4700::1111'), false)
  assert.equal(isNonPublicAddress('not-an-ip'), true)
})

test('DNS answers are pinned and mixed public/private resolutions are refused', async () => {
  const calls = [], fake = requester([{ body: '实际正文' }], calls)
  const value = await requestPublicUrl('https://example.com', { dnsLookup: dnsPublic, requestHttps: fake })
  assert.equal(value.body, '实际正文')
  const pinned = await new Promise((resolve, reject) => calls[0].options.lookup('example.com', {}, (error, address, family) => error ? reject(error) : resolve({ address, family })))
  assert.deepEqual(pinned, { address: '93.184.216.34', family: 4 })
  await assert.rejects(requestPublicUrl('https://example.com', { dnsLookup: async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }], requestHttps: fake }), /本机、内网/)
  assert.equal(calls.length, 1)
})

test('redirects are validated before following and response size/HTTP errors are explicit', async () => {
  const calls = []
  await assert.rejects(requestPublicUrl('https://example.com', { dnsLookup: dnsPublic, requestHttps: requester([{ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }], calls) }), /内网/)
  assert.equal(calls.length, 1)
  await assert.rejects(requestPublicUrl('https://example.com', { dnsLookup: dnsPublic, maxBytes: 10, requestHttps: requester([{ body: 'a'.repeat(20) }]) }), /读取上限/)
  await assert.rejects(requestPublicUrl('https://example.com', { dnsLookup: dnsPublic, requestHttps: requester([{ status: 403 }]) }), /HTTP 403/)
})

test('proxy fake-IP recognition is narrow and literal benchmark IPs remain blocked', async () => {
  const dnsProxy = async () => [{ address: '198.18.1.2', family: 4 }]
  const result = await requestPublicUrl('https://example.com', { dnsLookup: dnsProxy, requestHttps: requester([{ body: '经代理的公开页面' }]) })
  assert.equal(result.body, '经代理的公开页面')
  await assert.rejects(requestPublicUrl('http://198.18.1.2', { dnsLookup: dnsProxy, requestHttp: requester([]) }), /内网/)
  const dnsSingle = async host => host === 'source.example.com' ? [{ address: '198.18.1.2', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]
  await assert.rejects(requestPublicUrl('https://source.example.com', { dnsLookup: dnsSingle, requestHttps: requester([]) }), /保留地址/)
})

test('compressed and Chinese sources retain readable text without executing page markup', async () => {
  const result = await requestPublicUrl('https://example.com', { dnsLookup: dnsPublic, requestHttps: requester([{ headers: { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' }, body: gzipSync('<title>公司 &amp; 技术</title><body><script>steal()</script><h1>经营报告</h1><p>收入为公开未知。</p><a href="/annual.pdf">年报</a></body>') }]) })
  const page = await fetchPublicPage('https://example.com', { fetcher: async () => result })
  assert.equal(page.title, '公司 & 技术'); assert.match(page.text, /公开未知/); assert.doesNotMatch(page.text, /steal/)
  assert.deepEqual(page.links, [{ title: '年报', url: 'https://example.com/annual.pdf' }])
  const pdf = await fetchPublicPage('https://example.com/annual.pdf', { fetcher: async () => ({ url: 'https://example.com/annual.pdf', body: null, bytes: Buffer.from('%PDF-1.7'), contentType: 'application/pdf' }) })
  assert.equal(pdf.pdfBytes.toString(), '%PDF-1.7'); assert.equal(pdf.text, '')
})

test('Bing RSS results are source leads and DuckDuckGo is a real fallback', async () => {
  const result = await searchPublicWeb('company official', { fetcher: async () => ({ body: '<rss><item><title>公司 &amp; 产品</title><link>https://example.com</link><description>发现线索</description><pubDate>2026-10-20</pubDate></item></rss>' }) })
  assert.equal(result.engine, 'bing'); assert.equal(result.results[0].title, '公司 & 产品'); assert.match(result.warning, /只用于发现线索/)
  let count = 0
  const fallback = await searchPublicWeb('company official', { fetcher: async () => ({ body: count++ ? '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F">公开官网</a><a class="result__snippet">公开摘要</a>' : '<rss/>' }) })
  assert.equal(fallback.engine, 'duckduckgo'); assert.equal(fallback.results[0].url, 'https://example.com/'); assert.equal(fallback.results[0].snippet, '公开摘要')
  await assert.rejects(searchPublicWeb('企业', { fetcher: async () => { throw new Error('网络不可用') } }), /未取得结果/)
})

test('Chinese company search uses the China HTML market and extracts real result cards instead of page chrome', async () => {
  const requests = []
  const result = await searchPublicWeb('红海无限 官网', { fetcher: async value => {
    const url = new URL(value); requests.push(url)
    return { url: value, body: '<html><title>红海无限 官网 - 搜索</title><ol><li class="b_algo"><h2><a href="https://www.redinfinity.net/sy">北京 <strong>红海无限</strong> 科技发展有限公司 - RED INFINITY</a></h2><div class="b_caption"><p>红海无限的公开官网线索，需另读原文。</p></div></li></ol></html>' }
  } })
  assert.equal(requests.length, 1); assert.equal(requests[0].hostname, 'cn.bing.com'); assert.equal(requests[0].searchParams.get('mkt'), 'zh-CN'); assert.equal(requests[0].searchParams.get('ensearch'), '0')
  assert.equal(result.engine, 'bing-cn-html'); assert.equal(result.effectiveQuery, '红海无限 官网'); assert.equal(result.results[0].url, 'https://www.redinfinity.net/sy'); assert.match(result.results[0].title, /红海无限/)
  assert.equal(result.results[0].publishedAt, null); assert.equal(result.results[0].id, undefined); assert.match(result.warning, /摘要只用于发现线索/)
})

test('irrelevant city results do not satisfy the company anchor and a disclosed short-query retry finds company leads', async () => {
  const requests = [], result = await searchPublicWeb('北京红海无限科技公司', { fetcher: async value => {
    const url = new URL(value), query = url.searchParams.get('q'); requests.push(query)
    return { body: query === '北京红海无限科技公司' ? '<title>北京红海无限科技公司</title><nav>红海无限</nav><li class="b_algo"><h2><a href="https://www.beijing.gov.cn/">北京市政府</a></h2><p>北京旅游攻略。</p></li>' : '<li class="b_algo"><h2><a href="https://www.redinfinity.net/">Red Infinity</a></h2><p>北京红海无限科技发展有限公司。</p></li>' }
  } })
  assert.deepEqual(requests, ['北京红海无限科技公司', '红海无限']); assert.equal(result.query, '北京红海无限科技公司'); assert.equal(result.effectiveQuery, '红海无限'); assert.match(result.queryAdjustment, /不代表已确认法人/)
  assert.equal(result.results[0].url, 'https://www.redinfinity.net/'); assert.equal(result.results.some(row => row.url.includes('beijing.gov')), false)
})

test('unrelated English RSS results are rejected and China HTML failure never becomes invented company evidence', async () => {
  const requests = []
  await assert.rejects(searchPublicWeb('红海无限', { fetcher: async value => {
    requests.push(value)
    if (value.includes('format=rss')) return { body: '<rss><item><title>Beijing Travel Guide</title><link>https://example.com/travel</link><description>Travel around the city.</description></item></rss>' }
    if (value.includes('duckduckgo')) return { body: '<a class="result__a" href="https://example.com/travel">English tourism</a><a class="result__snippet">Visit Beijing</a>' }
    return { body: '<title>红海无限 搜索</title><li class="b_algo"><h2><a href="https://example.com/travel">English tourism</a></h2><p>Visit Beijing</p></li>' }
  } }), /未出现输入主体关键词/)
  assert.equal(requests.length, 3); assert.ok(requests.every(url => !url.includes('api.deepseek')))
})

test('Bing tracking redirects resolve to public original URLs and never expose private destinations', async () => {
  const publicTarget = Buffer.from('https://www.redinfinity.net/').toString('base64url'), privateTarget = Buffer.from('http://127.0.0.1/admin').toString('base64url')
  const result = await searchPublicWeb('红海无限', { fetcher: async () => ({ body: `<li class="b_algo"><h2><a href="https://cn.bing.com/ck/a?u=a1${publicTarget}&amp;ntb=1">红海无限官网</a></h2><p>仅为线索。</p></li><li class="b_algo"><h2><a href="https://cn.bing.com/ck/a?u=a1${privateTarget}">红海无限私网</a></h2><p>不得访问。</p></li>` }) })
  assert.equal(result.results.length, 1); assert.equal(result.results[0].url, 'https://www.redinfinity.net/')
})

test('long unsegmented Chinese questions do not require results to repeat the whole question as a company name', async () => {
  for (const [query, title] of [['红海无限融资情况', '红海无限公司动态'], ['腾讯最新财报', '腾讯控股季度业绩公告']]) {
    const requests = [], result = await searchPublicWeb(query, { fetcher: async value => { requests.push(value); return { body: `<li class="b_algo"><h2><a href="https://example.com/announcement">${title}</a></h2><p>请继续核对原始披露，不能仅凭摘要作结论。</p></li>` } } })
    assert.equal(requests.length, 1); assert.equal(result.effectiveQuery, query); assert.equal(result.results[0].title, title); assert.equal(result.queryAdjustment, undefined)
    assert.match(result.warning, /只用于发现线索/)
  }
})
