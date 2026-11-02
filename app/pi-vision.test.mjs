import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { withPiImage } from './pi-vision.mjs'
import { createPiToolGate } from './pi-runtime-policy.mjs'

async function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aipm-pi-image-'))); t.after(() => rmSync(root, { recursive: true, force: true }))
  const owner = join(root, 'owned'); mkdirSync(owner); const file = join(owner, 'capture.png')
  await sharp({ create: { width: 240, height: 120, channels: 3, background: '#e9e4d6' } }).png().toFile(file)
  return { root, owner, file }
}
test('Flash gets actual bounded image data from an owned capture, Pro keeps OCR without reading an image', async t => {
  const f = await fixture(t), capture = { file: f.file, ocr: [{ text: '真实界面文字' }], snapshotId: 'snapshot-1' }
  const result = await withPiImage(capture, { model: 'deepseek-flash', root: f.owner, file: f.file })
  assert.equal(result.vision.attached, true); assert.equal(result.image.mimeType, 'image/jpeg'); assert.ok(Buffer.from(result.image.data, 'base64').length < 2000000); assert.equal(result.vision.width, 240); assert.equal(result.snapshotId, capture.snapshotId); assert.deepEqual(result.ocr, capture.ocr)
  assert.deepEqual(await withPiImage(capture, { model: 'deepseek-v4-pro', root: '/does-not-exist', file: '/does-not-exist' }), capture)
})
test('outside files, symlinks, invalid images and cancellation cannot be called successful visual observations', async t => {
  const f = await fixture(t), outside = join(f.root, 'outside.png'); writeFileSync(outside, 'private bytes')
  const linked = join(f.owner, 'linked.png'); symlinkSync(outside, linked)
  const bad = join(f.owner, 'bad.png'); writeFileSync(bad, 'not image')
  for (const file of [outside, linked, bad]) { const result = await withPiImage({ file, ocr: [] }, { model: 'deepseek-flash', root: f.owner, file }); assert.equal(result.vision.attached, false); assert.equal(result.image, undefined); assert.match(result.note, /图片未送入模型/) }
  const controller = new AbortController(); controller.abort(); const result = await withPiImage({ file: f.file }, { model: 'deepseek-flash', root: f.owner, file: f.file, signal: controller.signal }); assert.equal(result.vision.attached, false)
})
test('Pi file gate follows model vision while protecting credentials for both choices', async t => {
  const f = await fixture(t); writeFileSync(join(f.owner, '.env'), 'fixture only')
  for (const model of ['deepseek-v4-pro', 'deepseek-flash']) {
    const gate = createPiToolGate({ config: { mode: 'starter', phase: 2, workspace: f.owner, api: { model } }, ask: async () => false })
    const result = await gate({ toolName: 'read', input: { path: 'capture.png' } })
    assert.equal(Boolean(result?.block), model === 'deepseek-v4-pro')
    assert.equal((await gate({ toolName: 'read', input: { path: '.env' } })).block, true)
  }
})
