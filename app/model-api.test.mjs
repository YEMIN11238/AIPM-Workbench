/** Every protocol adapter resolves a current shared key without exposing it. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sharedModelApi, syncStandaloneApi, completeWithSharedApi, ModelSettings, modelCapabilities, modelPricing } from './model-api.mjs'

test('shared route rotates one key, preserves standalone settings, and redacts returned text', async t => {
  let key = 'first-private'; const api = () => sharedModelApi(() => key)
  assert.equal(api().anthropicBaseUrl, api().baseUrl + '/anthropic')
  key = 'second-private'; assert.equal(api().apiKey, key)
  const dir = mkdtempSync(join(tmpdir(), 'aipm-api-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, '.env'); writeFileSync(file, 'OTHER_SETTING=yes\nANTHROPIC_API_KEY=old\nANTHROPIC_AUTH_TOKEN=old-token\n')
  syncStandaloneApi(file, api()); const saved = readFileSync(file, 'utf8')
  assert.match(saved, /OTHER_SETTING=yes/); assert.match(saved, /MODEL_ID="deepseek-v4-pro"/); assert.equal(saved.includes('old-token'), false); assert.equal(statSync(file).mode & 0o777, 0o600)
  const result = await completeWithSharedApi(api(), [{ role: 'user', content: '你好' }], { fetcher: async (url, options) => { assert.equal(url, 'https://api.deepseek.com/chat/completions'); assert.equal(options.headers.Authorization, 'Bearer ' + key); assert.equal(JSON.parse(options.body).model, api().model); return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '不泄露 ' + key } }] }) } } })
  assert.equal(result.text.includes(key), false)
})

test('model selection persists without credentials, keeps Pro default and rejects unsupported or damaged settings', t => {
  const dir = mkdtempSync(join(tmpdir(), 'aipm-model-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'model.json'), settings = new ModelSettings({ path })
  assert.equal(settings.get().model, 'deepseek-v4-pro'); assert.equal(existsSync(path), false)
  const first = settings.get(); first.choices[0].pricing.inputYuanPerMillion = 100; assert.equal(settings.get().choices[0].pricing.inputYuanPerMillion, 9)
  const selected = settings.select('deepseek-flash'); assert.equal(selected.model, 'deepseek-flash'); assert.equal(selected.choices.find(x => x.id === selected.model).vision, true)
  assert.equal(new ModelSettings({ path }).get().model, 'deepseek-flash'); assert.equal(statSync(path).mode & 0o777, 0o600)
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, 'utf8'))).sort(), ['model', 'schema', 'updatedAt'])
  const saved = readFileSync(path, 'utf8'); assert.throws(() => settings.select('deepseek-v4.1-1610'), /请选择/); assert.equal(readFileSync(path, 'utf8'), saved)
  const link = join(dir, 'link.json'); symlinkSync(path, link); assert.throws(() => new ModelSettings({ path: link }), /无效/)
  writeFileSync(path, '{broken'); assert.throws(() => new ModelSettings({ path })); assert.equal(readFileSync(path, 'utf8'), '{broken')
})

test('Flash and Pro share endpoint/key while capabilities, standalone mapping and pricing follow the selected snapshot', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'aipm-model-snapshot-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const settings = new ModelSettings({ path: join(dir, 'model.json') }), current = () => sharedModelApi(() => 'fixture-key', settings.get().model), running = current()
  settings.select('deepseek-flash'); const flash = current()
  assert.equal(running.model, 'deepseek-v4-pro'); assert.equal(flash.model, 'deepseek-flash'); assert.equal(flash.apiKey, running.apiKey); assert.equal(flash.baseUrl, running.baseUrl)
  assert.deepEqual(modelCapabilities('deepseek-flash').input, ['text', 'image']); assert.equal(modelCapabilities('deepseek-v4-pro').vision, false)
  assert.equal(modelPricing('deepseek-flash').inputYuanPerMillion, 2); assert.equal(modelPricing('deepseek-flash').outputYuanPerMillion, 8)
  const file = join(dir, '.env'); writeFileSync(file, 'MODEL_ID="deepseek-v4-pro"\nOTHER=value\n'); syncStandaloneApi(file, flash)
  assert.match(readFileSync(file, 'utf8'), /MODEL_ID="deepseek-flash"/); assert.match(readFileSync(file, 'utf8'), /OTHER=value/)
  await completeWithSharedApi(flash, [{ role: 'user', content: 'test' }], { fetcher: async (_url, options) => { assert.equal(JSON.parse(options.body).model, 'deepseek-flash'); return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] }) } } })
})
