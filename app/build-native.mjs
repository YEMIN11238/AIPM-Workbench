/** Compile and ad-hoc sign the local main-process AppKit bridge using installed Node headers. */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('Native glass builds require macOS')
const directory = fileURLToPath(new URL('.', import.meta.url))
const headers = [resolve(dirname(process.execPath), '../include/node'), join(homedir(), '.local/node/include/node')].find(path => existsSync(join(path, 'node_api.h')))
if (!headers) throw new Error('Installed Node headers are required to build native glass')
const compiler = execFileSync('/usr/bin/xcrun', ['--find', 'clang++'], { encoding: 'utf8' }).trim()
const sdk = execFileSync('/usr/bin/xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim()
const architecture = { arm64: 'arm64', x64: 'x86_64' }[process.arch]
if (!architecture) throw new Error(`Unsupported macOS architecture: ${process.arch}`)
const assets = join(directory, 'assets')
await mkdir(assets, { recursive: true })
const output = join(assets, 'native-glass.node')
const temporary = join(assets, `.native-glass-${randomUUID()}.node`)
try {
  execFileSync(compiler, ['-std=c++17', '-fobjc-arc', '-O2', '-dynamiclib', '-undefined', 'dynamic_lookup', '-DNAPI_VERSION=8', '-mmacosx-version-min=12.0', '-arch', architecture, '-isysroot', sdk, '-I', headers, '-framework', 'Cocoa', join(directory, 'native-glass.mm'), '-o', temporary], { stdio: 'inherit' })
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', temporary], { stdio: 'inherit' })
  await rename(temporary, output)
} finally {
  await rm(temporary, { force: true })
}
console.log(`Native AppKit glass bridge built: ${output}`)

const computerOutput = join(assets, 'native-computer.node')
const computerTemporary = join(assets, `.native-computer-${randomUUID()}.node`)
try {
  execFileSync(compiler, ['-std=c++17', '-fobjc-arc', '-O2', '-dynamiclib', '-undefined', 'dynamic_lookup', '-DNAPI_VERSION=8', '-mmacosx-version-min=14.0', '-arch', architecture, '-isysroot', sdk, '-I', headers, '-framework', 'Cocoa', '-framework', 'ApplicationServices', '-framework', 'Vision', join(directory, 'native-computer.mm'), '-o', computerTemporary], { stdio: 'inherit' })
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', computerTemporary], { stdio: 'inherit' })
  await rename(computerTemporary, computerOutput)
} finally { await rm(computerTemporary, { force: true }) }
console.log(`Native computer bridge built: ${computerOutput}`)
