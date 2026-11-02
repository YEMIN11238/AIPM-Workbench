/** Public search and bounded source fetching, with no model credentials or local-network access. */
import { lookup as lookupCallback } from 'node:dns'
import { isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'

const lookup = (hostname, options) => new Promise((resolve, reject) => lookupCallback(hostname, options, (error, addresses) => error ? reject(error) : resolve(addresses)))
const MAX_BYTES = 8 * 1024 * 1024
const PUBLIC_PORTS = new Set(['', '80', '443'])

/** Return whether a normalized IP belongs to a non-public or reserved destination. */
export function isNonPublicAddress(address, { allowProxyFakeIp = false } = {}) {
  const value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (value.includes('%') || !isIP(value)) return true
  if (isIP(value) === 4) {
    const [a, b, c] = value.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && c === 0 || b === 0 && c === 2) || a === 100 && b >= 64 && b <= 127 || a === 198 && ((b === 18 || b === 19) && !allowProxyFakeIp || b === 51 && c === 100) || a === 203 && b === 0 && c === 113 || a >= 224
  }
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1)
  if (canonical === '::' || canonical === '::1' || /^(?:f[cd]|fe[89abcdef]|ff)/.test(canonical) || /^2001:(?:db8|2|10|20):/.test(canonical) || canonical.startsWith('64:ff9b:1:')) return true
  const mapped = canonical.match(/^(?:::ffff:|64:ff9b::)([a-f\d]{1,4}):([a-f\d]{1,4})$/)
  if (mapped) {
    const number = parseInt(mapped[1], 16) * 65536 + parseInt(mapped[2], 16)
    return isNonPublicAddress(`${number >>> 24}.${number >>> 16 & 255}.${number >>> 8 & 255}.${number & 255}`)
  }
  const tunnel = canonical.match(/^2002:([a-f\d]{1,4}):([a-f\d]{1,4}):/)
  if (tunnel) {
    const number = parseInt(tunnel[1], 16) * 65536 + parseInt(tunnel[2], 16)
    if (isNonPublicAddress(`${number >>> 24}.${number >>> 16 & 255}.${number >>> 8 & 255}.${number & 255}`)) return true
  }
  return false
}

let proxyProbe
async function proxyFakeIpMode(dnsLookup) {
  if (dnsLookup === lookup && proxyProbe && Date.now() - proxyProbe.at < 300000) return proxyProbe.value
  const rows = await Promise.all(['www.baidu.com', 'www.qq.com', 'example.com'].map(async host => {
    let timeout
    try { return await Promise.race([dnsLookup(host, { all: true, verbatim: true }), new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error('代理探测超时')), 2000) })]) }
    catch (error) { return [] }
    finally { clearTimeout(timeout) }
  }))
  const value = rows.filter(records => Array.isArray(records) && records.length && records.every(record => /^198\.(?:18|19)\./.test(record.address))).length >= 2
  if (dnsLookup === lookup) proxyProbe = { at: Date.now(), value }
  return value
}

/** Validate URL syntax before DNS lookup; IPv4 alternative spellings are normalized by URL. */
export function publicUrl(value) {
  let url
  try { url = new URL(value) } catch (error) { throw new Error('请输入完整的公开 HTTP(S) 网页地址') }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !PUBLIC_PORTS.has(url.port) || !host || host === 'localhost' || /\.(?:localhost|local|internal|home|lan)$/.test(host) || isIP(host) && isNonPublicAddress(host)) throw new Error('只允许公开 HTTP(S) 网页，不能访问凭证地址、本机或内网')
  url.hash = ''
  return url
}

function decodeBytes(bytes, contentType) {
  const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType || '')?.[1] || 'utf-8'
  try { return new TextDecoder(charset).decode(bytes) }
  catch (error) { return new TextDecoder('utf-8').decode(bytes) }
}

/** Fetch public HTTP(S), pinning the checked DNS answer and checking every redirect. */
export async function requestPublicUrl(value, { signal, timeoutMs = 30000, maxBytes = MAX_BYTES, dnsLookup = lookup, requestHttp = http.request, requestHttps = https.request } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('网页读取上限无效')
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('网页读取超时')), timeoutMs)
  const cancel = () => controller.abort(signal?.reason || new Error('网页读取已停止'))
  signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel()
  try {
    let url = publicUrl(value)
    for (let hop = 0; hop <= 5; hop++) {
      controller.signal.throwIfAborted()
      const hostname = url.hostname.replace(/^\[|\]$/g, '')
      const records = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await new Promise((resolve, reject) => {
        const aborted = () => reject(controller.signal.reason || new Error('网页读取已停止'))
        controller.signal.addEventListener('abort', aborted, { once: true })
        Promise.resolve(dnsLookup(hostname, { all: true, verbatim: true })).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', aborted))
      })
      // This machine's TUN proxy maps public names to 198.18/15. Only DNS answers,
      // after independent fixed-host probes, may use that range; literal IP URLs stay blocked.
      const allowProxyFakeIp = !isIP(hostname) && Array.isArray(records) && records.some(record => /^198\.(?:18|19)\./.test(record.address)) && await proxyFakeIpMode(dnsLookup)
      if (!Array.isArray(records) || !records.length || records.some(record => isNonPublicAddress(record.address, { allowProxyFakeIp }))) throw new Error('网页域名解析到本机、内网或保留地址，已拒绝')
      const pinned = records[0]
      const response = await new Promise((resolve, reject) => {
        const request = (url.protocol === 'https:' ? requestHttps : requestHttp)(url, {
          signal: controller.signal,
          lookup: (_hostname, options, callback) => options?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
          headers: { 'user-agent': 'Mozilla/5.0 AIPM-Research/1.0', accept: 'text/html,application/xhtml+xml,application/xml,text/plain,application/pdf,*/*;q=0.5', 'accept-encoding': 'identity' },
        }, incoming => {
          const status = incoming.statusCode || 0
          if ([301, 302, 303, 307, 308].includes(status)) { incoming.destroy(); resolve({ status, location: incoming.headers.location, headers: incoming.headers }); return }
          const chunks = []; let size = 0
          incoming.on('data', chunk => { size += chunk.length; if (size > maxBytes) incoming.destroy(new Error(`网页超过 ${Math.floor(maxBytes / 1024)} KB 读取上限`)); else chunks.push(chunk) })
          incoming.once('error', reject)
          incoming.once('end', () => resolve({ status, headers: incoming.headers, bytes: Buffer.concat(chunks) }))
        })
        request.once('error', reject); request.end()
      })
      if (response.location) { if (hop === 5) throw new Error('网页重定向过多'); url = publicUrl(new URL(response.location, url).href); continue }
      if (response.status < 200 || response.status >= 300) throw new Error(`网页返回 HTTP ${response.status}，未获取可核验正文`)
      let bytes = response.bytes || Buffer.alloc(0)
      const encoding = String(response.headers['content-encoding'] || '').toLowerCase()
      if (encoding === 'gzip') bytes = gunzipSync(bytes, { maxOutputLength: maxBytes })
      else if (encoding === 'deflate') bytes = inflateSync(bytes, { maxOutputLength: maxBytes })
      else if (encoding === 'br') bytes = brotliDecompressSync(bytes, { maxOutputLength: maxBytes })
      else if (encoding && encoding !== 'identity') throw new Error('网页使用暂不支持的压缩格式')
      if (bytes.length > maxBytes) throw new Error('网页解压后的正文超过读取上限')
      const contentType = String(response.headers['content-type'] || '')
      return { url: url.href, status: response.status, contentType, bytes, body: /application\/pdf/i.test(contentType) || bytes.subarray(0, 5).toString() === '%PDF-' ? null : decodeBytes(bytes, contentType), fetchedAt: new Date().toISOString() }
    }
    throw new Error('未能读取网页')
  } catch (error) {
    if (controller.signal.aborted) throw new Error(signal?.aborted ? '网页读取已停止' : '网页读取超时，请稍后重试或提供可读材料')
    throw error
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}

/** Decode textual HTML entities without evaluating markup or scripts. */
export function decodeHtmlText(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', middot: '·' }
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#(x[a-f\d]+|\d+);?/gi, (_all, digits) => { const code = /^x/i.test(digits) ? parseInt(digits.slice(1), 16) : Number(digits); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ' }).replace(/&([a-z]+);/gi, (all, name) => named[name.toLowerCase()] ?? all)
}

function plainText(markup) {
  return decodeHtmlText(String(markup || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(?:script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg|template)>/gi, ' ').replace(/<(?:br|hr)\b[^>]*>|<\/(?:p|div|article|section|main|li|tr|h[1-6]|table)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function field(block, tag) { return plainText(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block)?.[1] || '') }

function searchDestination(value, base) {
  let url = new URL(decodeHtmlText(value), base)
  if (/(?:^|\.)bing\.com$/.test(url.hostname) && url.pathname === '/ck/a') {
    const encoded = url.searchParams.get('u')
    if (encoded?.startsWith('a1')) url = new URL(Buffer.from(encoded.slice(2), 'base64url').toString('utf8'))
  }
  if (/(?:^|\.)duckduckgo\.com$/.test(url.hostname)) { const target = url.searchParams.get('uddg'); if (target) url = new URL(target) }
  return publicUrl(url.href).href
}

function searchResults(body, format, base) {
  const results = [], add = (title, link, snippet, indexedAt = null) => {
    try { const url = searchDestination(link, base); if (title && !results.some(row => row.url === url)) results.push({ title, url, snippet, indexedAt, publishedAt: null }) } catch (error) { /* Only actual public destinations are offered as source leads. */ }
  }
  if (format === 'rss' || /<rss\b/i.test(body)) {
    for (const match of body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) add(field(match[1], 'title'), field(match[1], 'link'), field(match[1], 'description'), field(match[1], 'pubDate') || null)
  } else if (format === 'bing-html') {
    // Limit parsing to result-list items; navigation, advertisements and page query text
    // must not make an irrelevant result set appear to match the requested company.
    for (const block of body.split(/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>/i).slice(1)) {
      const item = block.split(/<\/li\s*>/i)[0], heading = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(item)?.[1] || '', link = /<a\b[^>]*href=["']([^"']+)["']/i.exec(heading)?.[1]
      if (link) add(plainText(heading), link, plainText(/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(item)?.[1] || ''))
    }
  } else {
    for (const match of body.matchAll(/<a\b(?=[^>]*class=["'][^"']*result__a\b)[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a\b[^>]*class=["'][^"']*result__a\b|$)/gi)) add(plainText(match[2]), match[1], plainText(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(match[3])?.[1] || ''))
  }
  return results
}

function companySearchAnchor(query) {
  const first = /^["'“「]?([\u3400-\u9fff]{2,})/.exec(query)?.[1]
  if (!first) return null
  const hasCompanySuffix = /公司/.test(first)
  // A long unsegmented Chinese query can include a question, not just a name.
  // Without an explicit company suffix, retain its search leads instead of
  // requiring result titles to repeat the whole financing/financial question.
  if (!hasCompanySuffix && first.length > 4) return null
  let anchor = first.replace(/(?:科技发展|科技|技术|网络科技|信息科技|文化传媒|文化|软件|实业)?(?:股份有限公司|有限责任公司|有限公司|集团公司|公司).*$/, '')
  if (hasCompanySuffix) anchor = anchor.replace(/^(?:北京市?|上海市?|深圳市?|广州市?|杭州市?|南京市?|苏州市?|成都市?|重庆市?|天津市?|武汉市?|西安市?|长沙市?|厦门市?|福州市?|青岛市?|济南市?|郑州市?|合肥市?|宁波市?|珠海市?|东莞市?)/, '')
  if (anchor.length < 2 || /^(?:企业|公司|科技|集团|银行|官网|新闻|金融|研究|最新新闻|搜索|查询)$/.test(anchor)) return null
  return anchor
}

function matchesAnchor(result, anchor) {
  const text = (result.title + ' ' + result.snippet).replace(/[\s\u200b-\u200d]/g, '')
  return text.includes(anchor)
}

/** Search public engines without a paid API; returned snippets are leads, never source evidence. */
export async function searchPublicWeb(query, { fetcher = requestPublicUrl, signal, limit = 8 } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 500 || /[\u0000-\u001f]/.test(query)) throw new Error('搜索词须为 1 至 500 字的文字')
  const clean = query.trim(), failures = [], chinese = /[\u3400-\u9fff]/.test(clean), anchor = chinese ? companySearchAnchor(clean) : null
  const attempts = chinese ? [
    { engine: 'bing-cn-html', format: 'bing-html', query: clean },
    ...(anchor && anchor !== clean ? [{ engine: 'bing-cn-html', format: 'bing-html', query: anchor }] : []),
    { engine: 'bing-cn-rss', format: 'rss', query: clean },
    { engine: 'duckduckgo', format: 'ddg', query: clean },
  ] : [{ engine: 'bing', format: 'rss', query: clean }, { engine: 'duckduckgo', format: 'ddg', query: clean }]
  for (const attempt of attempts) {
    try {
      const url = attempt.engine === 'duckduckgo' ? 'https://html.duckduckgo.com/html/?' + (chinese ? 'kl=cn-zh&' : '') + 'q=' + encodeURIComponent(attempt.query) : attempt.engine === 'bing' ? 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(attempt.query) : 'https://cn.bing.com/search?q=' + encodeURIComponent(attempt.query) + '&ensearch=0&cc=cn&mkt=zh-CN&setlang=zh-hans' + (attempt.format === 'rss' ? '&format=rss' : '')
      const response = await fetcher(url, { signal, maxBytes: 2 * 1024 * 1024 })
      const results = searchResults(response.body || '', attempt.format, response.url || url)
      if (results.length && anchor && !results.some(row => matchesAnchor(row, anchor))) {
        failures.push(attempt.engine + ' 的结果未出现输入主体关键词「' + anchor + '」，已舍弃，未当作相关证据')
        continue
      }
      if (results.length) {
        if (anchor) results.sort((left, right) => Number(matchesAnchor(right, anchor)) - Number(matchesAnchor(left, anchor)))
        return { query: clean, effectiveQuery: attempt.query, engine: attempt.engine, searchedAt: new Date().toISOString(), results: results.slice(0, Math.max(1, Math.min(10, limit))), ...(attempt.query !== clean ? { queryAdjustment: '原搜索未取得包含主体关键词的结果，本次使用从输入提取的简称检索；简称仅为线索，不代表已确认法人或集团边界。' } : {}), warning: '搜索摘要只用于发现线索。关键结论须继续读取原始网页正文，不得把摘要当作已核验来源。' }
      }
      failures.push(attempt.engine + ' 未返回可用结果')
    } catch (error) { if (signal?.aborted) throw error; failures.push(attempt.engine + '：' + error.message) }
  }
  throw new Error('公开搜索未取得结果：' + failures.join('；') + '。可以补充官网、证券公告链接或本地材料。')
}

/** Extract readable text and links from a successfully fetched source; never run page JavaScript. */
export async function fetchPublicPage(url, { fetcher = requestPublicUrl, signal, maxChars = 90000 } = {}) {
  const requestedUrl = publicUrl(url).href, response = await fetcher(requestedUrl, { signal })
  if (response.body === null) return { requestedUrl, url: response.url || requestedUrl, title: decodeURIComponent(new URL(response.url || requestedUrl).pathname.split('/').at(-1) || 'PDF 文档'), contentType: response.contentType || 'application/pdf', fetchedAt: response.fetchedAt, pdfBytes: response.bytes, text: '', links: [], truncated: false }
  const body = response.body || '', html = /<html\b|<!doctype html|<body\b/i.test(body) || /html/i.test(response.contentType || '')
  if (!html && response.contentType && !/(?:^text\/|json|xml|javascript|csv)/i.test(response.contentType)) throw new Error('此链接不是可读网页或 PDF，请提供正文或导入文档')
  const title = html ? field(body, 'title') || field(body, 'h1') : new URL(response.url || requestedUrl).hostname
  const text = html ? plainText(body.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, '')) : body.trim(), links = []
  if (!text) throw new Error('网页没有可读取正文，可能需要登录、验证码或浏览器渲染；请导入可读材料')
  if (html) for (const match of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (links.length >= 60) break
    try { const target = publicUrl(new URL(decodeHtmlText(match[1]), response.url || requestedUrl).href).href, label = plainText(match[2]); if (label && !links.some(link => link.url === target)) links.push({ title: label.slice(0, 200), url: target }) } catch (error) { /* Non-public or non-HTTP hyperlinks are not research destinations. */ }
  }
  return { requestedUrl, url: response.url || requestedUrl, title: title.slice(0, 300), contentType: response.contentType || 'text/plain', fetchedAt: response.fetchedAt || new Date().toISOString(), text: text.slice(0, maxChars), links, truncated: text.length > maxChars }
}
