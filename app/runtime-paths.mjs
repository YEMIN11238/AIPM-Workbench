/** Host-specific paths are resolved at startup; credentials and user projects stay outside the checkout. */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
export const dataRoot = resolve(process.env.AIPM_HOME || join(homedir(), 'Library/Application Support/AIPM-Workbench'))
export const nodeExecutable = process.env.AIPM_NODE || (process.versions.electron ? execFileSync('/usr/bin/which', ['node'], { encoding: 'utf8' }).trim() : process.execPath)
export const piPackage = process.env.AIPM_PI_PACKAGE || dirname(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))))
