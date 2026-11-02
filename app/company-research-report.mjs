import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Preserved research package and its offline report resources shipped with the desktop app. */
export const DEFAULT_COMPANY_RESEARCH_SKILL_ROOT = fileURLToPath(new URL('./skills/hjh-company-research/', import.meta.url))

const requiredFiles = [
  'scripts/build_report_html.py',
  'scripts/audit_client_report.py',
  'company_report_template.offline.html',
]

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function verifiedSkillFiles(skillRoot) {
  const root = await realpath(skillRoot)
  const source = JSON.parse(await readFile(path.join(root, 'SOURCE.json'), 'utf8'))
  const recorded = [...source.originalFiles, ...source.adaptedFiles]
  const result = {}
  for (const relativePath of requiredFiles) {
    const absolutePath = await realpath(path.join(root, relativePath))
    if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error(`调研资源超出模块目录：${relativePath}`)
    const expected = recorded.find(file => file.path === relativePath)
    const bytes = await readFile(absolutePath)
    if (!expected || digest(bytes) !== expected.sha256) throw new Error(`调研资源完整性检查失败：${relativePath}`)
    result[relativePath] = absolutePath
  }
  return { root, files: result }
}

function pythonEnvironment() {
  const environment = {
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONIOENCODING: 'utf-8',
  }
  for (const name of ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SYSTEMROOT', 'WINDIR']) {
    if (process.env[name]) environment[name] = process.env[name]
  }
  return environment
}

function runPython(python, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-B', ...args], {
      cwd,
      env: pythonEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks = []
    let byteLength = 0
    let outputError
    const receive = chunk => {
      byteLength += chunk.length
      if (byteLength > 1024 * 1024) {
        outputError = new Error('调研报告脚本输出超过允许大小')
        child.kill('SIGKILL')
        return
      }
      chunks.push(chunk)
    }
    child.stdout.on('data', receive)
    child.stderr.on('data', receive)
    child.once('error', reject)
    child.once('close', (exitCode, signal) => {
      if (outputError) reject(outputError)
      else resolve({ exitCode, signal, output: Buffer.concat(chunks).toString('utf8') })
    })
  })
}

/**
 * Build an offline HTML report with the preserved upstream builder and audit it strictly.
 * Audit failures retain the generated report and are returned as data; build failures throw.
 * The selected Python executable receives no application credentials or shell expansion.
 * @param {{markdownPath:string, outputPath?:string, skillRoot?:string, python?:string}} options
 * @returns {Promise<{markdownPath:string,htmlPath:string,offline:boolean,embeddedMarkdownMatches:boolean,audit:{passed:boolean,exitCode:number|null,signal:string|null,output:string,report:object|null}}>} Report files and the static audit outcome, which does not verify real-world facts.
 */
export async function buildCompanyReport({
  markdownPath,
  outputPath,
  skillRoot = DEFAULT_COMPANY_RESEARCH_SKILL_ROOT,
  python = '/usr/bin/python3',
}) {
  if (!path.isAbsolute(python)) throw new Error('报告生成器需要可信 Python 的绝对路径')
  if (!(await stat(python)).isFile()) throw new Error('Python 路径不是可执行文件')
  if (!path.isAbsolute(markdownPath)) throw new Error('报告 Markdown 必须使用绝对路径')
  if (outputPath && !path.isAbsolute(outputPath)) throw new Error('报告 HTML 必须使用绝对路径')
  const mdPath = await realpath(markdownPath)
  const htmlPath = path.resolve(outputPath || `${mdPath.slice(0, mdPath.length - path.extname(mdPath).length)}.html`)
  const { root, files } = await verifiedSkillFiles(skillRoot)
  const build = await runPython(python, [
    files['scripts/build_report_html.py'],
    mdPath,
    '--output', htmlPath,
    '--template', files['company_report_template.offline.html'],
  ], root)
  if (build.exitCode !== 0) throw new Error(`调研报告 HTML 构建失败：${build.output.trim() || build.signal || build.exitCode}`)

  const markdown = await readFile(mdPath)
  const reportHtml = await readFile(htmlPath, 'utf8')
  const embedded = [...reportHtml.matchAll(/<script\b[^>]*\bid=["']md-source["'][^>]*>([\s\S]*?)<\/script>/gi)]
  const embeddedMarkdownMatches = embedded.length === 1 && Buffer.from(embedded[0][1].trim(), 'base64').equals(markdown)
  if (!embeddedMarkdownMatches) throw new Error('报告 HTML 内嵌内容与 Markdown 不一致')

  let result
  try {
    result = await runPython(python, [files['scripts/audit_client_report.py'], mdPath, htmlPath, '--strict'], root)
  } catch (error) {
    result = { exitCode: null, signal: null, output: error.message }
  }
  let report = null
  try {
    report = JSON.parse(result.output)
  } catch (error) {
    // Process diagnostics stay visible when the auditor cannot produce its JSON result.
    if (!(error instanceof SyntaxError)) throw error
  }
  return {
    markdownPath: mdPath,
    htmlPath,
    offline: true,
    embeddedMarkdownMatches,
    audit: {
      passed: result.exitCode === 0 && result.signal === null && report?.passed === true,
      ...result,
      report,
    },
  }
}
