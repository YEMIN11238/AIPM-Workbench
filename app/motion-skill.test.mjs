/** Full-skill discovery and project preparation use local files without any model traffic. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync, realpathSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { motionSkillInfo, motionSkillRead, prepareMotionWorkspace, motionSkillDirectory } from './motion-skill.mjs'
import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent'

test('Pi discovers the actual complete skill and all seven design references remain readable', () => {
  const loaded = loadSkillsFromDir({ dir: motionSkillDirectory, source: 'path' })
  assert.equal(loaded.skills.filter(item => item.name === 'motion-design-prompt-generator').length, 1)
  const info = motionSkillInfo(); assert.equal(info.commit, 'dd0e05264a6cd7ad714c0899e17157584290bad4'); assert.equal(info.designSystems.length, 7); assert.equal(info.ready, true)
  assert.match(motionSkillRead('SKILL.md').content, /## Stage 5 — Build in Remotion/)
  for (const system of info.designSystems) assert.ok(motionSkillRead(`design-systems/${system.id}.md`).content.length > 100)
  assert.throws(() => motionSkillRead('../../.app-data/credential.bin'), /名称无效/)
})

test('preparing a full motion project retains upstream helpers, source and music and returns only an unsent instruction', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aipm-motion-'))); t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = prepareMotionWorkspace({ root, title: '排版演示', brief: '米白黑字，动态字体与形状变形', duration: 10, designSystem: 'swiss-kinetic' })
  assert.equal(project.title, '排版演示'); assert.match(project.prompt, /先不要渲染整片/)
  assert.equal(realpathSync(join(project.cwd, 'node_modules')), realpathSync(new URL('./motion-engine/node_modules', import.meta.url)))
  for (const name of ['src/lib/motion.tsx', 'scripts/score.mjs', 'scripts/check.sh']) assert.equal(readFileSync(join(project.cwd, name), 'utf8'), readFileSync(join(motionSkillDirectory, 'templates/remotion-starter', name), 'utf8'))
  assert.equal(readFileSync(join(project.cwd, 'docs/skill/SKILL.md'), 'utf8'), motionSkillRead('SKILL.md').content)
  for (const name of ['docs/skill/REFERENCE.md', 'docs/skill/LICENSE', 'docs/skill/SOURCE.json', 'package-lock.json', 'scripts/workbench-check.mjs']) assert.equal(existsSync(join(project.cwd, name)), true)
  const metadata = JSON.parse(readFileSync(join(project.cwd, '.aipm-motion.json'))); assert.equal(metadata.status, 'prepared'); assert.equal(metadata.duration, 10); assert.equal(metadata.fps, 30)
  const second = prepareMotionWorkspace({ root, brief: '另一部片子' }); assert.notEqual(second.cwd, project.cwd)
  const before = readdirSync(root)
  for (const options of [{ brief: '' }, { brief: 'x', duration: 0 }, { brief: 'x', designSystem: '../secrets' }]) assert.throws(() => prepareMotionWorkspace({ root, ...options }))
  assert.deepEqual(readdirSync(root), before)
})
