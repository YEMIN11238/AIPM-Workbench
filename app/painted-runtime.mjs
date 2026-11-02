/** Genuine p5.brush scenes adapted to the workbench's owned local renderer. */
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = dirname(fileURLToPath(import.meta.url))
const COMMIT = '59744a69c7b916cfbe4c4ec84006b0c2f5e2fde1'
const PATCHES = [{ source: 'https://github.com/jumpersun/framecraft-skills', commit: '734a9093fecf1589cd5be51fa5ee62e9c37584dd', change: 'Two-point ink strokes use a straight segment instead of a curved spline.' }]
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const DEFAULT_SCENE = `// Workbench starter: replace this entire scene file with the user's authored animation.\n(function () {\n  function paintedStarter(t) {\n    boilSeed('painted-starter');\n    paint(ellPts(W*.5,H*.5,W*.3,H*.27,24,1),{fill:'#8ca6ac',fillOp:100,bleed:.2,ink:null});\n    inkLine([[W*.3,H*.65],[W*.5,H*(.6+.025*Math.sin(t))],[W*.7,H*.65]],1.4,'#536979');\n  }\n  shots([[0,paintedStarter]]);\n})();\n`

function regular(path) { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('水彩运行文件不能为符号链接'); return stat }
function directory(path) { mkdirSync(path, { recursive: true, mode: 0o700 }); const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('水彩工程目录无效'); return realpathSync(path) }
function put(path, value) { const temp = path + '.' + randomUUID(); writeFileSync(temp, value, { flag: 'wx', mode: 0o600 }); renameSync(temp, path) }
function copyTree(source, destination) {
  directory(destination)
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (['node_modules', '.git', 'out'].includes(entry.name)) continue
    const path = join(source, entry.name), target = join(destination, entry.name)
    if (entry.isSymbolicLink()) throw new Error('水彩模板不能包含符号链接')
    if (entry.isDirectory()) copyTree(path, target)
    else if (entry.isFile()) { regular(path); copyFileSync(path, target) }
  }
}
function starter(indexPath, filmPath) {
  if (!existsSync(filmPath)) return false
  regular(indexPath); regular(filmPath)
  const index = readFileSync(indexPath, 'utf8'), code = readFileSync(filmPath, 'utf8')
  return code.length < 3500 && index.includes('./film.js') && (['ctx.fillText(C.title,w/2,h*.57)', 'w*.6*Math.min(1,t/.8)', 'ctx.translate(w*.85,h*.2)'].every(value => code.includes(value)) || ['new THREE.BoxGeometry(1.8,1.8,1.8)', 'mesh.rotation.set(.2+t*.2,t*.65,0)', 'window.TEXTS=()=>[]'].every(value => code.includes(value)))
}

/**
 * Describe the pinned drawing engine without executing npm scripts or contacting a provider.
 * @param {{runtimeRoot?:string,sourceRoot?:string}} options Installed template and dependency locations.
 * @returns {object} Readiness, fixed source identity, versions and reference locations.
 */
export function paintedRuntimeInfo({ runtimeRoot = join(APP, 'painted-engine'), sourceRoot = join(APP, 'integrations/painted-animation-upstream') } = {}) {
  const messages = [], versions = {}
  for (const [name, expected, key] of [['p5', '2.3.3', 'p5'], ['p5.brush', '2.2.3', 'brush'], ['puppeteer-core', '25.11.0', 'puppeteer']]) {
    try { const path = join(runtimeRoot, 'node_modules', name, 'package.json'); regular(path); const pkg = JSON.parse(readFileSync(path, 'utf8')); if (pkg.version !== expected) throw new Error('版本不符'); versions[key] = pkg.version }
    catch (error) { messages.push('水彩依赖尚未就绪：' + name) }
  }
  for (const path of [join(runtimeRoot, 'template/src/core.js'), join(runtimeRoot, 'node_modules/p5/lib/p5.min.js'), join(runtimeRoot, 'node_modules/p5.brush/dist/p5.brush.js')]) try { regular(path) } catch (error) { messages.push('水彩运行文件缺失：' + relative(runtimeRoot, path)) }
  return { ready: messages.length === 0, engine: 'painted-animation', source: { repository: 'https://github.com/tuzhechen2005/opus-video-skills', commit: COMMIT }, compatibilityPatches: structuredClone(PATCHES), versions, templatePath: join(runtimeRoot, 'template'), sourceRoot, messages }
}

function resultFor(cwd, record, runtime) {
  return { ...record, cwd, scenePath: join(cwd, 'painted/src/scenes/film.js'), configPath: join(cwd, 'painted/src/config.js'), markerPath: join(cwd, '.painted-animation.json'), guidePath: join(cwd, 'painted/ANIMATION_GUIDE.md'), runtime }
}

/**
 * Prepare an owned p5.brush project; only an unchanged Lemo starter can be explicitly replaced and backed up.
 * @param {object} options Owned cwd, video specifications, optional starter replacement and installed runtime locations.
 * @returns {object} Source paths, initial-scene digest and runtime details; no model or render request starts here.
 */
export function preparePaintedProject({ cwd, duration, width = 1920, height = 1080, fps = 30, bpm = 80, offset = 0, replaceStarter = false, runtimeRoot = join(APP, 'painted-engine'), sourceRoot } = {}) {
  if (typeof cwd !== 'string' || !cwd) throw new Error('缺少水彩工程目录')
  if (!Number.isFinite(duration) || duration < 1 || duration > 3600 || !Number.isInteger(fps) || fps < 1 || fps > 120 || [width, height].some(value => !Number.isInteger(value) || value < 16 || value > 8192 || value % 2) || !Number.isFinite(bpm) || bpm < 20 || bpm > 300 || !Number.isFinite(offset) || offset < 0 || offset >= duration) throw new Error('水彩影片规格无效')
  const root = directory(resolve(cwd)), runtime = paintedRuntimeInfo({ runtimeRoot, sourceRoot })
  if (!runtime.ready) throw new Error(runtime.messages.join('；'))
  const markerPath = join(root, '.painted-animation.json')
  if (existsSync(markerPath)) {
    regular(markerPath); const record = JSON.parse(readFileSync(markerPath, 'utf8'))
    if (record.schema !== 1 || record.engine !== 'painted-animation' || record.source?.commit !== COMMIT) throw new Error('已有水彩工程记录无效，未覆盖')
    regular(join(root, 'painted/src/scenes/film.js')); return resultFor(root, record, runtime)
  }
  const indexPath = join(root, 'index.html'), hadIndex = existsSync(indexPath)
  if (hadIndex) regular(indexPath)
  const before = hadIndex ? readFileSync(indexPath) : null
  if (hadIndex && (!replaceStarter || !starter(indexPath, join(root, 'film.js')))) throw new Error('已有影片源码保留；请新建水彩工程，或仅明确替换未创作的初始化示例')
  if (existsSync(join(root, 'painted'))) throw new Error('已有 painted 目录，未覆盖')
  copyTree(runtime.templatePath, join(root, 'painted'))
  const vendor = directory(join(root, 'painted/vendor'))
  for (const [input, output] of [['p5/lib/p5.min.js', 'p5.min.js'], ['p5/license.txt', 'p5-LICENSE.txt'], ['p5.brush/dist/p5.brush.js', 'p5.brush.js'], ['p5.brush/LICENSE.md', 'p5.brush-LICENSE.md']]) {
    const path = join(runtimeRoot, 'node_modules', input); regular(path); copyFileSync(path, join(vendor, output))
  }
  const config = { duration, bpm, offset, width, height, fps }, corePath = join(root, 'painted/src/core.js')
  put(join(root, 'painted/src/config.js'), 'const PROJECT = ' + JSON.stringify(config) + ';\n')
  const core = readFileSync(corePath, 'utf8').replace('const W = 1920, H = 1080;', 'const W = PROJECT.width, H = PROJECT.height;').replace("if (!location.search.includes('render')) devUI();", "if (document.getElementById('scrub') && !location.search.includes('render')) devUI();").replace('brush.spline(P, curv);', 'brush.spline(P, P.length === 2 ? 0 : curv);')
  put(corePath, core)
  put(join(root, 'painted/src/scenes/film.js'), DEFAULT_SCENE)
  const bridge = `// Adapt the original p5.brush canvas to managed local production.\nwindow.DUR=PROJECT.duration;window.EV=[];window.TEXTS=()=>[];\nObject.defineProperty(window,'READY',{configurable:true,get:()=>window.ready===true});\nwindow.PAINTED_RUNTIME=${JSON.stringify({ engine: 'painted-animation', sourceCommit: COMMIT, versions: runtime.versions })};\nwindow.render=async t=>{if(!window.ready)throw new Error('p5.brush is not ready');if(!Number.isFinite(t)||t<0||t>PROJECT.duration)throw new Error('Frame time outside the film');T=t;await redraw();composite(t);};\n`
  put(join(root, 'painted/bridge.js'), bridge)
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>水彩动画</title><style>html,body{margin:0;overflow:hidden;background:#F3EBDC}#out{display:block;width:100vw;height:100vh;object-fit:contain}.p5Canvas{display:none!important}</style><script src="painted/vendor/p5.min.js"></script><script src="painted/vendor/p5.brush.js"></script><canvas id="out" width="${width}" height="${height}"></canvas><script src="painted/src/config.js"></script><script src="painted/src/core.js"></script><script src="painted/src/clawd.js"></script><script src="painted/src/timeline.js"></script><script src="painted/src/karaoke.js"></script><script src="painted/src/sheets.js"></script><script src="painted/src/scenes/film.js"></script><script src="painted/bridge.js"></script></html>\n`
  let backupPath
  if (hadIndex) {
    if (!readFileSync(indexPath).equals(before)) throw new Error('初始化页面在准备过程中变化，未替换')
    backupPath = directory(join(root, '.painted-backup', randomUUID())); copyFileSync(indexPath, join(backupPath, 'index.html')); copyFileSync(join(root, 'film.js'), join(backupPath, 'film.js'))
  }
  put(indexPath, html)
  const record = { schema: 1, engine: 'painted-animation', ...config, source: runtime.source, compatibilityPatches: runtime.compatibilityPatches, versions: runtime.versions, preparedAt: new Date().toISOString(), initialSources: { 'painted/src/scenes/film.js': hash(DEFAULT_SCENE) }, ...(backupPath ? { backupPath } : {}) }
  put(markerPath, JSON.stringify(record, null, 2) + '\n')
  return resultFor(root, record, runtime)
}
