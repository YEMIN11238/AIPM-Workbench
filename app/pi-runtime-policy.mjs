/** Deterministic policies shared by the Pi SDK host and durable starter workflow. */
import { existsSync, realpathSync, lstatSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { modelCapabilities } from './model-api.mjs'

/** Validate model-produced decisions before they can alter durable workflow state. */
export function validateDecisions(items) {
  if (!Array.isArray(items) || items.length > 10 || items.some(item => !item || typeof item.question !== 'string' || !item.question.trim() || item.question.length > 2000 || typeof item.answer !== 'string' || item.answer.length > 5000 || !['pending', 'confirmed', 'default', 'deferred'].includes(item.status) || item.status === 'deferred' && ![2, 4].includes(item.revisitPhase))) throw new Error('决策须为不超过10项的有效问题、答案与状态；延后项注明阶段2或4')
  return items
}

/** Validate a stage report without accepting the AI's proposed checks as human approval. */
export function validateStageReport(report) {
  if (!report || typeof report.summary !== 'string' || !report.summary.trim() || report.summary.length > 15000 || typeof report.nextStep !== 'string' || report.nextStep.length > 10000 || !Array.isArray(report.unresolved) || report.unresolved.length > 50 || report.unresolved.some(v => typeof v !== 'string' || v.length > 3000) || !Array.isArray(report.checks) || !report.checks.length || report.checks.length > 100 || report.checks.some(check => !check || typeof check.item !== 'string' || !check.item.trim() || typeof check.evidence !== 'string' || !['yes', 'no', 'na', 'pending'].includes(check.status))) throw new Error('阶段报告格式无效，请提供总结、下一步、待解决事项及非空是否表')
  return report
}

/** Check a model-command record before storing actual execution evidence. */
export function validateCommand(record) {
  if (!record || typeof record.command !== 'string' || !record.command.trim() || record.command.length > 16000 || record.exitCode !== null && !Number.isInteger(record.exitCode) || typeof record.timedOut !== 'boolean' || typeof record.usedSharedApi !== 'boolean') throw new Error('命令执行记录无效')
  return record
}

function safeTarget(base, path) {
  if (typeof path !== 'string' || !path.trim() || path.includes('\0')) throw new Error('文件路径无效')
  const target = resolve(base, path), missing = []; let parent = target
  while (!existsSync(parent)) { const next = dirname(parent); if (next === parent) break; missing.unshift(basename(parent)); parent = next }
  if (lstatSync(parent).isSymbolicLink()) throw new Error('请直接选择真实路径，不通过符号链接修改文件')
  return { target, canonical: join(realpathSync(parent), ...missing) }
}

/** Run Pi's real tool-call gate before built-in file or command execution. */
export function createPiToolGate({ config, ask, isStopping = () => false, exhausted = () => false }) {
  return async event => {
    if (isStopping()) return { block: true, reason: '已停止' }
    if (exhausted() && !(config.workerMode === 'video-authoring' && config.mode !== 'starter' && event.toolName === 'finish_video')) return { block: true, reason: '本轮已达到模型执行上限，进度已保存；这不代表 API 余额用完' }
    const starter = config.mode === 'starter', input = event.input || {}, path = input.path
    if (['read', 'edit', 'write'].includes(event.toolName)) {
      let resolved
      try { resolved = safeTarget(config.workspace, path) } catch (error) { return { block: true, reason: error.message } }
      const privatePath = /(?:\/\.app-data\/(?:credential|cloud-[^/]+)\.bin|\/\.pi\/agent\/auth\.json|\/\.ssh(?:\/|$)|\/Keychains(?:\/|$)|\/runtime\/auth\.json)/i
      if (/(?:^|\/)\.env(?:$|\.(?!example$)[^/]+$)/.test(resolved.target) || privatePath.test(resolved.target) || privatePath.test(resolved.canonical)) return { block: true, reason: '认证凭证不通过模型工具读取；请使用工作台统一配置' }
      if (event.toolName === 'read' && /\.(?:png|jpe?g|gif|webp|heic|tiff?|bmp)$/i.test(resolved.target) && !modelCapabilities(config.api?.model).vision) return { block: true, reason: '当前Pro仅接收文字；电脑界面请用computer inspect或capture获取辅助功能/OCR，截图可供用户查看' }
      const inside = target => target === config.workspace || target.startsWith(config.workspace + '/')
      if (starter && (!inside(resolved.target) || !inside(resolved.canonical))) return { block: true, reason: '当前开发阶段只操作当前产品项目，不跨目录读写' }
      if (['edit', 'write'].includes(event.toolName)) {
        if ([resolved.target, resolved.canonical].some(path => /\/(?:\.video-audio|\.painted-animation)\.json$/.test(path))) return { block: true, reason: '歌曲和动画运行记录由工作台管理，请修改影片场景，不修改宿主记录' }
        const content = input.content ?? input.newText ?? input.new_text
        if (typeof content === 'string' && [config.api?.apiKey, ...Object.values(config.cloudCredentials || {})].some(secret => secret && content.includes(secret))) return { block: true, reason: '不能把密钥写入项目文件' }
        if (starter) {
          const local = resolved.target.slice(config.workspace.length + 1)
          if (['AGENTS.md', 'CLAUDE.md', 'docs/项目状态.md', 'docs/样例评分.md'].includes(local) || local.startsWith('docs/手册/') || local.startsWith('.starter/')) return { block: true, reason: '规则、手册、状态与评分由工作台维护，请使用对应工具' }
          if (config.phase < 2 && !local.startsWith('docs/') && !['README.md', '.gitignore'].includes(local)) return { block: true, reason: '当前阶段只整理需求与适配，从阶段2才开发代码' }
        } else if ((!inside(resolved.target) || !inside(resolved.canonical)) && await ask('approval', { command: event.toolName + ' ' + resolved.canonical, reason: '该文件位于选定工作目录之外，请核对修改范围' }) !== true) return { block: true, reason: '未批准项目外文件修改' }
      }
    }
    if (event.toolName === 'bash') {
      const command = input.command
      if (typeof command !== 'string' || !command.trim() || command.length > 16000) return { block: true, reason: '命令无效' }
      if (starter && config.phase < 2 && !/^(?:python3? --version|node --version|git --version|npm --version|pwd)$/.test(command.trim())) return { block: true, reason: '本阶段只做环境检查，从阶段2运行产品代码' }
      if (/(?:^|\s)&(?:\s|$)/.test(command)) return { block: true, reason: '后台服务请用start_preview，由工作台管理停止和退出' }
      if (/(?:tccutil|chmod.*auth\.json|System Events|osascript|sudo|rm\s+-|git\s+(?:reset.*hard|push)|\b(?:vefaas|volcengine|terraform|aws|gcloud|aliyun)\b)/i.test(command) || starter && config.phase >= 4) {
        if (await ask('approval', { command, reason: '请核对该系统、删除或上线命令的范围、对象与费用' }) !== true) return { block: true, reason: '用户未批准本次操作' }
      }
    }
  }
}
