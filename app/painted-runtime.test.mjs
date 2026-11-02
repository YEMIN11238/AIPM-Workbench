/** Local preparation keeps the full pinned drawing kit and preserves authored user files. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preparePaintedProject, paintedRuntimeInfo } from './painted-runtime.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'painted-runtime-')), runtimeRoot = join(root, 'runtime'), cwd = join(root, 'project')
  const put = (path, content) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, content) }
  mkdirSync(cwd)
  for (const [name, version] of [['p5', '2.3.3'], ['p5.brush', '2.2.3'], ['puppeteer-core', '25.11.0']]) put(join(runtimeRoot, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }))
  for (const path of ['p5/lib/p5.min.js', 'p5/license.txt', 'p5.brush/dist/p5.brush.js', 'p5.brush/LICENSE.md']) put(join(runtimeRoot, 'node_modules', path), 'retained ' + path)
  for (const path of ['src/core.js', 'src/config.js', 'src/clawd.js', 'src/timeline.js', 'src/karaoke.js', 'src/sheets.js', 'src/scenes/demo.js', 'render.mjs', 'ANIMATION_GUIDE.md', 'LICENSE', 'docs/emotions.jpg']) put(join(runtimeRoot, 'template', path), path === 'src/core.js' ? "const W = 1920, H = 1080;\nif (!location.search.includes('render')) devUI();\nbrush.spline(P, curv);\n" : 'original ' + path)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, runtimeRoot, cwd, prepare: args => preparePaintedProject({ cwd, runtimeRoot, duration: 27, ...args }) }
}

test('a new project retains all drawing modules and local browser libraries without remote font requests', t => {
  const f = fixture(t), ready = paintedRuntimeInfo({ runtimeRoot: f.runtimeRoot }); assert.equal(ready.ready, true)
  const p = f.prepare(); assert.equal(p.engine, 'painted-animation'); assert.equal(p.duration, 27); assert.match(p.scenePath, /painted\/src\/scenes\/film\.js$/)
  for (const path of ['painted/src/clawd.js', 'painted/src/timeline.js', 'painted/src/karaoke.js', 'painted/src/sheets.js', 'painted/render.mjs', 'painted/ANIMATION_GUIDE.md', 'painted/LICENSE', 'painted/docs/emotions.jpg', 'painted/vendor/p5.min.js', 'painted/vendor/p5.brush.js', 'painted/vendor/p5-LICENSE.txt', 'painted/vendor/p5.brush-LICENSE.md']) assert.ok(existsSync(join(f.cwd, path)), path)
  const html = readFileSync(join(f.cwd, 'index.html'), 'utf8'); assert.doesNotMatch(html, /https?:|node_modules|iframe/); assert.match(html, /painted\/src\/scenes\/film.js/); assert.doesNotMatch(html, /scenes\/demo.js/)
  const core = readFileSync(join(f.cwd, 'painted/src/core.js'), 'utf8'); assert.match(core, /W = PROJECT.width/); assert.match(core, /P.length === 2 \? 0 : curv/)
  assert.equal(JSON.parse(readFileSync(p.markerPath)).initialSources['painted/src/scenes/film.js'].length, 64)
})

test('an explicit untouched Lemo starter replacement keeps its original page and script in a private backup', t => {
  const f = fixture(t), html = '<canvas></canvas><script src="./film.js"></script>', code = 'ctx.fillText(C.title,w/2,h*.57);w*.6*Math.min(1,t/.8);ctx.translate(w*.85,h*.2)'
  writeFileSync(join(f.cwd, 'index.html'), html); writeFileSync(join(f.cwd, 'film.js'), code)
  assert.throws(() => f.prepare(), /已有影片源码保留/)
  const p = f.prepare({ replaceStarter: true }); assert.equal(readFileSync(join(p.backupPath, 'index.html'), 'utf8'), html); assert.equal(readFileSync(join(p.backupPath, 'film.js'), 'utf8'), code); assert.equal(readFileSync(join(f.cwd, 'film.js'), 'utf8'), code)
})

test('authored or linked pages cannot be replaced, including an explicit starter flag', t => {
  const f = fixture(t); writeFileSync(join(f.cwd, 'index.html'), '<script src="./film.js"></script>'); writeFileSync(join(f.cwd, 'film.js'), 'drawMyAuthoredFilm()')
  assert.throws(() => f.prepare({ replaceStarter: true }), /已有影片源码保留/); assert.equal(readFileSync(join(f.cwd, 'film.js'), 'utf8'), 'drawMyAuthoredFilm()'); assert.equal(existsSync(join(f.cwd, 'painted')), false)
  rmSync(join(f.cwd, 'index.html')); symlinkSync(join(f.cwd, 'film.js'), join(f.cwd, 'index.html')); assert.throws(() => f.prepare({ replaceStarter: true }), /符号链接/)
})

test('reopening a prepared project never rewrites authored scene code or the project dimensions', t => {
  const f = fixture(t), first = f.prepare(); writeFileSync(first.scenePath, 'shots([[0,myRealFilm]]);')
  const reopened = f.prepare({ duration: 10, width: 640, height: 360 }); assert.equal(reopened.duration, 27); assert.equal(readFileSync(reopened.scenePath, 'utf8'), 'shots([[0,myRealFilm]]);'); assert.equal(reopened.preparedAt, first.preparedAt)
})

test('invalid specifications, dirty target directories and missing pinned dependencies fail before page mutation', t => {
  const f = fixture(t)
  for (const patch of [{ duration: 0 }, { duration: Infinity }, { width: 481 }, { fps: 0 }, { bpm: 0 }, { offset: 27 }]) assert.throws(() => f.prepare(patch), /规格无效/)
  mkdirSync(join(f.cwd, 'painted')); assert.throws(() => f.prepare(), /已有 painted/); rmSync(join(f.cwd, 'painted'), { recursive: true })
  rmSync(join(f.runtimeRoot, 'node_modules/p5/lib/p5.min.js')); assert.equal(paintedRuntimeInfo({ runtimeRoot: f.runtimeRoot }).ready, false); assert.throws(() => f.prepare(), /运行文件缺失/); assert.equal(existsSync(join(f.cwd, 'index.html')), false)
})
