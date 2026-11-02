/** Resolve the actual desktop entry graphs without running services or model requests. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const directory = fileURLToPath(new URL('.', import.meta.url))

for (const [entry, platform] of [['main.mjs', 'node'], ['preload.cjs', 'node'], ['v2/app.mjs', 'browser']]) {
  test(`desktop entry ${entry} resolves its local module dependencies`, async () => {
    const result = await build({
      absWorkingDir: directory, entryPoints: [entry], bundle: true, write: false,
      platform, format: 'esm', packages: 'external', external: ['*.node'],
      logLevel: 'silent', metafile: true,
    })
    assert.ok(Object.keys(result.metafile.inputs).length > 0)
  })
}
