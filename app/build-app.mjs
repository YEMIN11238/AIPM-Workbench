/** Create a local, ad-hoc signed macOS app that loads this workspace checkout. */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync, writeFileSync, existsSync, copyFileSync, lstatSync, renameSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const directory = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(import.meta.url)
const electron = require('electron')
const workspace = resolve(directory, '..', 'dist')
const bundle = join(workspace, 'ORVYN.app')
mkdirSync(workspace, { recursive: true })
if (!existsSync(bundle)) execFileSync('/usr/bin/ditto', [dirname(dirname(dirname(electron))), bundle])
const plist = join(bundle, 'Contents/Info.plist')
for (const [key, value] of Object.entries({ CFBundleIdentifier: 'local.personal.aipm.workbench', CFBundleName: 'ORVYN', CFBundleDisplayName: 'ORVYN', CFBundleExecutable: 'AIPMWorkbench', CFBundleIconFile: 'AIPM.icns', CFBundleShortVersionString: '0.4.0', CFBundleVersion: '0.4.0', LSApplicationCategoryType: 'public.app-category.productivity' })) {
  execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist])
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`
const launcher = `#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexport AIPM_NODE=${quote(process.execPath)}\nexport PATH=${quote(dirname(process.execPath))}:$PATH\naipm_binary_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd) || exit 1\ncd ${quote(directory)} || exit 1\nexec "$aipm_binary_dir/Electron" ${quote(directory)} "$@"\n`
writeFileSync(join(bundle, 'Contents/MacOS/AIPMWorkbench'), launcher, { mode: 0o755 })
copyFileSync(join(directory, 'assets/AIPM.icns'), join(bundle, 'Contents/Resources/AIPM.icns'))
writeFileSync(join(bundle, 'Contents/Resources/aipm-local.json'), JSON.stringify({ directory, version: '0.4.0', kind: 'local-workspace-app' }))
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'pipe' })
execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', bundle])
console.log(bundle)

if (process.argv.includes('--install')) {
  const destination = '/Applications/ORVYN.app'
  const registration = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
  const staged = `/Applications/.aipm-install-${randomUUID()}.app`
  const previous = `/Applications/.aipm-previous-${randomUUID()}.app`
  if (existsSync(destination)) {
    if (lstatSync(destination).isSymbolicLink()) throw new Error('应用程序中的目标为符号链接，无法替换')
    const identifier = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(destination, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()
    if (identifier !== 'local.personal.aipm.workbench') throw new Error('应用程序中存在同名的其他软件，无法替换')
  }
  try {
    execFileSync('/usr/bin/ditto', [bundle, staged])
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', staged])
    if (existsSync(destination)) renameSync(destination, previous)
    try { renameSync(staged, destination) }
    catch (error) { if (existsSync(previous)) renameSync(previous, destination); throw error }
  } finally {
    if (existsSync(staged)) rmSync(staged, { recursive: true })
  }
  if (existsSync(previous)) rmSync(previous, { recursive: true })
  execFileSync(registration, ['-f', destination])
  execFileSync(registration, ['-u', bundle])
  execFileSync('/usr/bin/mdimport', [destination])
  console.log(destination)
}
