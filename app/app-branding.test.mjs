import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'
import test from 'node:test'
import { configureApplicationBrand, productName } from './app-branding.mjs'

test('existing encryption namespace remains in effect during Electron initialization', () => {
  const app = new EventEmitter()
  const names = []
  app.setName = name => names.push(name)
  configureApplicationBrand(app)
  assert.deepEqual(names, ['AIPM 工作台'])
  app.emit('ready')
  assert.deepEqual(names, ['AIPM 工作台', productName])
})

test('the public name is applied once when the application is ready', () => {
  const app = new EventEmitter()
  const names = []
  app.setName = name => names.push(name)
  configureApplicationBrand(app)
  app.emit('ready')
  app.emit('ready')
  assert.equal(names.at(-1), 'ORVYN')
  assert.equal(names.length, 2)
})
