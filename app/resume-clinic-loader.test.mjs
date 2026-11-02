import test from 'node:test'
import assert from 'node:assert/strict'
import { registerResumeClinic } from './resume-clinic-loader.mjs'

test('an unfinished resume installation leaves desktop startup available and can retry after installation', async () => {
  let loads = 0
  const calls = [], host = { show: bounds => { calls.push(bounds); return true }, close() {} }
  const feature = registerResumeClinic({}, async () => {
    if (++loads === 1) throw Object.assign(new Error('missing host'), { code: 'ERR_MODULE_NOT_FOUND' })
    return { registerResumeClinic: () => host }
  })
  assert.equal(loads, 0)
  feature.hide(); feature.resize({ width: 10 }); feature.publishModel({ model: 'pro' })
  assert.equal(loads, 0)
  await assert.rejects(feature.show({ width: 100 }), /安装文件尚未齐全/)
  assert.equal(await feature.show({ width: 200 }), true)
  assert.deepEqual(calls, [{ width: 200 }])
  await feature.close()
})

test('leaving the resume page during module loading does not display its native view over another page', async () => {
  let finish, shown = 0, closed = 0
  const feature = registerResumeClinic({}, () => new Promise(resolve => { finish = resolve }))
  const show = feature.show({ width: 100 }); await Promise.resolve()
  feature.hide()
  finish({ registerResumeClinic: () => ({ show() { ++shown }, close() { ++closed } }) })
  assert.equal(await show, false); assert.equal(shown, 0)
  await feature.close(); await feature.close(); assert.equal(closed, 1)
})

test('closing during module loading prevents late registration of resume services', async () => {
  let finish, registrations = 0
  const feature = registerResumeClinic({}, () => new Promise(resolve => { finish = resolve }))
  const show = feature.show({ width: 100 }); await Promise.resolve()
  const close = feature.close()
  finish({ registerResumeClinic() { ++registrations } })
  await close; assert.equal(await show, false); assert.equal(registrations, 0)
})
