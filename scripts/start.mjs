import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'darwin') throw new Error('AIPM desktop currently supports macOS. The showcase website works on other platforms.')
const env = { ...process.env, AIPM_NODE: process.execPath }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [root, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1 })
