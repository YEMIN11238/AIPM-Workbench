import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { dataRoot, nodeExecutable, piPackage } from './runtime-paths.mjs'

test('the desktop resolves the installed ESM-only Pi package and a real Node executable', () => {
  assert.equal(JSON.parse(readFileSync(join(piPackage, 'package.json'), 'utf8')).name, '@earendil-works/pi-coding-agent')
  assert.equal(statSync(join(piPackage, 'dist/index.js')).isFile(), true)
  assert.equal(isAbsolute(nodeExecutable), true)
  assert.equal(statSync(nodeExecutable).isFile(), true)
  assert.equal(isAbsolute(dataRoot), true)
})
