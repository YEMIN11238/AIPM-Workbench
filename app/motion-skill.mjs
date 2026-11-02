/** Full, pinned motion-design resources and project preparation without a model call. */
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, lstatSync, readdirSync, realpathSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installMotionProjectTools } from './motion-project-tools.mjs'

const appDirectory = dirname(fileURLToPath(import.meta.url))
export const motionSkillDirectory = join(appDirectory, 'integrations/motion-design-prompt-generator-upstream/motion-design-prompt-generator')
const upstream = dirname(motionSkillDirectory), runtime = join(appDirectory, 'motion-engine')
const repository = 'https://github.com/8533502-dev/deepseek-opus-motion-skill'
const commit = 'dd0e05264a6cd7ad714c0899e17157584290bad4'
const systems = [
  ['swiss-kinetic', '瑞士排版 · 大字动效'], ['drafting-table', '工程绘图'], ['editorial-ink', '水墨与编辑排版'],
  ['data-instrument', '数据讲解'], ['bold-poster', '醒目海报'], ['riso-halftone', '印刷网点'], ['storybook-scene', '角色故事'],
].map(([id, name]) => ({ id, name }))
const library = ['SKILL.md', 'REFERENCE.md', '安装说明.md', ...systems.map(item => `design-systems/${item.id}.md`)]
const text = (value, name, max, fallback = '') => {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.includes('\0') || value.length > max) throw new Error(name + '无效或超长')
  return value.trim()
}
function plainTree(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name)
    if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) throw new Error('动效源材料含不支持的链接或文件类型')
    if (entry.isDirectory()) plainTree(file)
  }
}
function sourceRecord() {
  const bytes = readFileSync(join(motionSkillDirectory, 'SKILL.md'))
  return { name: 'motion-design-prompt-generator', repository, commit, sha256: createHash('sha256').update(bytes).digest('hex'), skillPath: join(motionSkillDirectory, 'SKILL.md') }
}

/** Return installed resources and runtime availability without loading a credential or starting work. */
export function motionSkillInfo() {
  let ready = false
  try {
    const packageJson = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8'))
    ready = packageJson.dependencies?.remotion === '4.0.537' && packageJson.dependencies?.react === '19.1.0' && existsSync(join(runtime, 'package-lock.json')) && existsSync(join(runtime, 'node_modules/@remotion/cli/package.json')) && existsSync(join(runtime, 'tools/ffmpeg'))
  } catch (error) { /* An absent runtime remains visible as not ready; preparation fails before creating a project. */ }
  return { ...sourceRecord(), ready, designSystems: systems, files: library, capabilities: ['完整 Skill 与参考源码', '7 套设计方向', '自由 TSX 动画与形状变形', '原版配乐与关键帧检查'], limitations: ['建立工程不调用模型，发送主聊天后按统一 API 计费；不自动占用或重置快速视频试做额度。', '检查报告只验证可测项目，实际画面需看静帧；五项自审不等于五个独立评审模型。'] }
}

/** Read a named text resource from the pinned skill package. */
export function motionSkillRead(name) {
  if (!library.includes(name)) throw new Error('动效 Skill 资料名称无效')
  const path = join(motionSkillDirectory, name)
  if (lstatSync(path).isSymbolicLink()) throw new Error('动效 Skill 资料不能为链接')
  return { name, content: readFileSync(path, 'utf8') }
}

/**
 * Create one self-contained motion project from the complete upstream starter.
 * @param {{root:string,title?:string,brief:string,duration?:number,designSystem?:string}} options Owned project root and user brief.
 * @returns {{id:string,cwd:string,title:string,prompt:string,source:object}} Prepared files and an unsent Pi instruction.
 */
export function prepareMotionWorkspace({ root, title, brief, duration = 10, designSystem = 'swiss-kinetic' } = {}) {
  brief = text(brief, '动效创意', 10000)
  if (!brief) throw new Error('请先填写一句话创意或具体要求')
  title = text(title, '动效名称', 100) || brief.slice(0, 24)
  if (!Number.isFinite(duration) || duration < 1 || duration > 120 || !systems.some(item => item.id === designSystem)) throw new Error('动效时长须为1至120秒，并使用已安装设计方向')
  if (!motionSkillInfo().ready) throw new Error('完整版动效运行环境尚未就绪，请先恢复 motion-engine 的锁定依赖')
  if (typeof root !== 'string' || !root) throw new Error('缺少动效工程目录')
  const destination = resolve(root)
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  if (lstatSync(destination).isSymbolicLink()) throw new Error('动效工程目录不能为符号链接')
  const source = sourceRecord(), id = randomUUID(), cwd = join(realpathSync(destination), id)
  plainTree(motionSkillDirectory)
  mkdirSync(cwd, { mode: 0o700 })
  cpSync(join(motionSkillDirectory, 'templates/remotion-starter'), cwd, { recursive: true, force: false, errorOnExist: true })
  cpSync(join(runtime, 'package-lock.json'), join(cwd, 'package-lock.json'), { errorOnExist: true, force: false })
  mkdirSync(join(cwd, 'docs'), { recursive: true, mode: 0o700 })
  cpSync(motionSkillDirectory, join(cwd, 'docs/skill'), { recursive: true, force: false, errorOnExist: true })
  cpSync(join(upstream, 'LICENSE'), join(cwd, 'docs/skill/LICENSE'))
  cpSync(join(upstream, 'SOURCE.json'), join(cwd, 'docs/skill/SOURCE.json'))
  cpSync(join(runtime, 'credits'), join(cwd, 'credits'), { recursive: true, force: false, errorOnExist: true })
  cpSync(join(runtime, 'tools'), join(cwd, 'tools'), { recursive: true, force: false, errorOnExist: true })
  symlinkSync(join(runtime, 'node_modules'), join(cwd, 'node_modules'), 'dir')
  installMotionProjectTools(cwd)
  const instruction = `# ${title}\n\n## 制作要求\n\n${brief}\n\n## 当前约定\n\n目标时长 ${duration} 秒，1920 × 1080，30fps。设计方向 ${designSystem} 只是起点，按用户要求调整。每个新视频保存在本工程，不复用别的片子的场景设计。\n\n## 工作顺序\n\n1. 读 docs/skill/SKILL.md 全文，按需读 REFERENCE.md、design-systems 与 examples。先写风格规范、需求/变形/元素清单与逐秒分镜，保存到 docs/，给用户核对。\n2. 分镜明确后写 src/spec.ts、src/lib/film.tsx、src/Film.tsx、src/scenes/ 与 scripts/cues.json。保留原工具函数，不把自由创作限制成玻璃四镜头模板。替换原版 TITLE 占位片及原先时长/帧率，不能声称占位工程已是成片。\n3. 先做类型检查和关键静帧。至少覆盖开场、各镜头主画面、收尾，建议先看第1、3、6、9秒（超出片长则调整）。明确展示实际文件，不伪造模型已看过画面或用户已确认。\n4. 用户确认静帧后再生成整片、运行检查、展示 MP4 与工程路径。按具体秒数修改，保留历史结果。主聊天已有模型计费，不能自动重置快速模式的5元试做总账，也不能声称这一模式免费。\n\n## 本机适配\n\nnpm 脚本已装工作台包装器，检查原脚本的 FAIL 输出，校验声音参数，使用固定 Headless Shell 与 PNG 捕获。正式操作用 npm run score、npm run render/preview/still、npm run check，不绕过包装直接执行原脚本；读取 out/check/workbench-check.json 再报告检查结果。原始 helper、score.mjs、check.sh 均保留。npm run check 不能替代用户看画面。运行 npm run studio 需用工作台 start_preview 管理预览，不用 bash &。缺字体时优先用本机字体，未经说明不依赖远程字体CDN。不要读取、复制或另存 API 密钥；此项目没有独立模型密钥。\n\n## 来源\n\n${repository}\ncommit ${commit}\nMIT；Remotion 依赖使用自己的许可证。该项目的 Opus 效果描述属于设计目标，不能当作本片效果保证。\n`
  writeFileSync(join(cwd, '任务说明.md'), instruction, { mode: 0o600, flag: 'wx' })
  writeFileSync(join(cwd, '.aipm-motion.json'), JSON.stringify({ schema: 1, id, title, brief, duration, width: 1920, height: 1080, fps: 30, designSystem, source, status: 'prepared', createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  return { id, cwd, title, source, prompt: `使用完整 motion-design-prompt-generator Skill，为「${title}」制作自由动效。先完整读取 ${join(cwd, '任务说明.md')} 和 docs/skill/SKILL.md。本轮先完成风格规范和逐秒分镜给我核对，先不要渲染整片。制作要求：${brief}` }
}
