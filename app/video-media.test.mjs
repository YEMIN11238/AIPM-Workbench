/** The embedded player reads registered media ranges, never arbitrary local paths. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VideoMedia } from './video-media.mjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aipm-embedded-media-'))), owner = join(root, 'project'); mkdirSync(owner)
  const file = join(owner, 'film.mp4'); writeFileSync(file, '0123456789')
  const media = new VideoMedia(); t.after(() => { media.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, owner, file, media }
}
test('a registered video supports full streaming, seeking byte ranges, suffix ranges and HEAD', async t => {
  const { media, owner, file } = fixture(t), url = await media.register({ owner, path: file })
  assert.match(url, /^aipm-media:\/\/local\/[a-f\d-]+$/); assert.equal(url.includes(file), false)
  let response = await media.respond(new Request(url)); assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'video/mp4'); assert.equal(await response.text(), '0123456789')
  response = await media.respond(new Request(url, { headers: { Range: 'bytes=3-6' } })); assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Range'), 'bytes 3-6/10'); assert.equal(await response.text(), '3456')
  response = await media.respond(new Request(url, { headers: { Range: 'bytes=-2' } })); assert.equal(await response.text(), '89')
  response = await media.respond(new Request(url, { method: 'HEAD' })); assert.equal(response.headers.get('Content-Length'), '10'); assert.equal(await response.text(), '')
})
test('unknown tokens, paths, methods and invalid ranges do not disclose files', async t => {
  const { media, owner, file, root } = fixture(t), url = await media.register({ owner, path: file })
  for (const range of ['bytes=10-', 'bytes=6-3', 'bytes=0-1,3-4', 'bytes=-0', 'items=0-1']) assert.equal((await media.respond(new Request(url, { headers: { Range: range } }))).status, 416)
  assert.equal((await media.respond(new Request('aipm-media://local/etc/passwd'))).status, 404)
  assert.equal((await media.respond(new Request(url, { method: 'POST' }))).status, 405)
  await assert.rejects(media.register({ owner, path: root }), /不在当前项目/)
  const script = join(owner, 'script.html'); writeFileSync(script, '<script>'); await assert.rejects(media.register({ owner, path: script }), /不能在视频预览/)
})
test('swapping registered media for a symlink and closing the registry revoke access', async t => {
  const { media, owner, file, root } = fixture(t), url = await media.register({ owner, path: file }), secret = join(root, 'private.mp4'); writeFileSync(secret, 'private')
  rmSync(file); symlinkSync(secret, file)
  assert.equal((await media.respond(new Request(url))).status, 404)
  media.close(); assert.equal((await media.respond(new Request(url))).status, 410); await assert.rejects(media.register({ owner, path: secret }), /已关闭/)
})
test('a modified file invalidates its old URL while an explicitly re-registered version receives a new token', async t => {
  const { media, owner, file } = fixture(t), url = await media.register({ owner, path: file })
  writeFileSync(file, 'changed video')
  assert.equal((await media.respond(new Request(url))).status, 404)
  const next = await media.register({ owner, path: file }); assert.notEqual(next, url); assert.equal(await (await media.respond(new Request(next))).text(), 'changed video')
})

test('owned song formats stream inline with seeking and retain the same path and mutation checks', async t => {
  const {media,owner}=fixture(t)
  for(const[extension,type]of [['mp3','audio/mpeg'],['wav','audio/wav'],['m4a','audio/mp4'],['flac','audio/flac']]){
    const path=join(owner,'song.'+extension);writeFileSync(path,'0123456789');const url=await media.register({owner,path})
    const response=await media.respond(new Request(url,{headers:{Range:'bytes=2-4'}}))
    assert.equal(response.status,206);assert.equal(response.headers.get('Content-Type'),type);assert.equal(await response.text(),'234')
    writeFileSync(path,'changed song');assert.equal((await media.respond(new Request(url))).status,404)
  }
})
