/** Safe Markdown presentation and bounded review excerpts for local documents. */
import { Marked, Renderer } from 'marked'
import createDOMPurify from 'dompurify'
import { diffLines } from 'diff'

const SUMMARY_LIMIT = 200
const CONTEXT_LINES = 3
const sanitizeOptions = {
  ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'div'],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'tabindex', 'align', 'start'],
  ADD_URI_SAFE_ATTR: ['target', 'rel', 'tabindex', 'align', 'start'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOWED_URI_REGEXP: /^https:\/\//i,
  RETURN_TRUSTED_TYPE: false,
}
let sanitizerWindow, sanitizer

function textSource(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  return value
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

/**
 * Returns a normalized HTTPS URL; rejects unsupported destinations.
 * @param {string} href Markdown link destination.
 * @returns {string|null} Safe destination, or null for an unsupported URL.
 */
export function safeMarkdownHref(href) {
  if (typeof href !== 'string' || /[\u0000-\u0020\u007f-\u009f]/.test(href)) return null
  let url
  try { url = new URL(href) }
  catch (error) { return null } // Invalid destinations remain readable text.
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return url.href
}

const renderer = new Renderer()
renderer.html = ({ text }) => escapeHtml(text)
renderer.image = ({ text }) => escapeHtml(text)
renderer.checkbox = ({ checked }) => checked ? '☑ ' : '☐ '
renderer.link = function ({ href, title, tokens }) {
  const content = this.parser.parseInline(tokens)
  const destination = safeMarkdownHref(href)
  if (!destination) return content
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${escapeHtml(destination)}"${titleAttribute} target="_blank" rel="noopener noreferrer">${content}</a>`
}
renderer.table = function (token) {
  return `<div class="markdown-table-scroll" tabindex="0">${Renderer.prototype.table.call(this, token)}</div>\n`
}
const markdown = new Marked({ renderer, gfm: true, breaks: false, async: false })

function browserSanitizer() {
  const browserWindow = globalThis.window
  if (!browserWindow?.document) throw new Error('Markdown rendering requires a browser DOM')
  if (sanitizerWindow !== browserWindow) {
    sanitizerWindow = browserWindow
    sanitizer = createDOMPurify(browserWindow)
  }
  if (!sanitizer.isSupported) throw new Error('Safe Markdown rendering is unavailable in this browser')
  return sanitizer
}

/**
 * Renders GFM with escaped raw HTML, text-only images, and sanitized HTTPS links.
 * No generated HTML can load images, submit forms, or execute source HTML.
 * @param {string} source Saved document or assistant Markdown text.
 * @returns {string} Sanitized HTML for a .markdown-content element.
 */
export function renderMarkdown(source) {
  const html = markdown.parse(textSource(source, 'source'))
  return browserSanitizer().sanitize(html, sanitizeOptions)
}

function componentLines(value) {
  const lines = value.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Counts the full line diff and returns at most 200 lines for the review UI.
 * Text is plain, unescaped source: use textContent or escape it before HTML insertion.
 * Unchanged context is limited to three lines on each side; truncation affects
 * the excerpt only, never the added/removed totals. CRLF and LF compare equally.
 * @param {string} before Last saved document.
 * @param {string} after Proposed document.
 * @returns {{added: number, removed: number, lines: Array<{kind: 'added'|'removed'|'same', text: string}>, truncated: boolean}} Full counts and a bounded excerpt.
 */
export function summarizeChanges(before, after) {
  const components = diffLines(textSource(before, 'before'), textSource(after, 'after'), { stripTrailingCr: true })
  let added = 0, removed = 0, truncated = false
  for (const component of components) {
    if (component.added) added += component.count
    if (component.removed) removed += component.count
  }
  if (!added && !removed) return { added, removed, lines: [], truncated }
  const lines = []
  for (const component of components) {
    const kind = component.added ? 'added' : component.removed ? 'removed' : 'same'
    let excerpt = componentLines(component.value)
    if (kind === 'same' && excerpt.length > CONTEXT_LINES * 2) {
      excerpt = [...excerpt.slice(0, CONTEXT_LINES), ...excerpt.slice(-CONTEXT_LINES)]
      truncated = true
    }
    const capacity = SUMMARY_LIMIT - lines.length
    if (excerpt.length > capacity) truncated = true
    lines.push(...excerpt.slice(0, capacity).map(text => ({ kind, text })))
  }
  return { added, removed, lines, truncated }
}
