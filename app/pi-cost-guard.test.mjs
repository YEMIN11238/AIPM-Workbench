import test from 'node:test'
import assert from 'node:assert/strict'
import { createPiCostGuard, piRequestCostQuote, validatePiCostLimit } from './pi-cost-guard.mjs'

const payload = { model: 'deepseek-flash', max_tokens: 10000, messages: [{ role: 'user', content: '画一幅水彩' }] }
test('a request quote covers encoded bytes and protocol margin at the model peak prices', () => {
  const quote=piRequestCostQuote(payload,'deepseek-flash')
  assert.equal(quote.inputTokenUpperBound,Buffer.byteLength(JSON.stringify(payload),'utf8')+8192)
  assert.equal(quote.reservedMicroYuan,Math.ceil(quote.inputTokenUpperBound*2+10000*8))
  assert.throws(()=>piRequestCostQuote({...payload,max_tokens:0},'deepseek-flash'),/输出上限/)
  for(const value of [0,-1,NaN,Infinity,'2',10001,.0000001])assert.throws(()=>validatePiCostLimit(value),/费用上限/)
})
test('valid cached provider usage settles conservatively and releases only its unused reservation', () => {
  const guard=createPiCostGuard({model:'deepseek-flash',maxCostYuan:2}),reserved=guard.reserve(payload)
  assert.ok(reserved.reservedYuan>.09)
  const done=guard.settle({input:100,cacheRead:8000,cacheWrite:0,output:100})
  assert.equal(done.spentUpperBoundYuan,.00132);assert.equal(done.reservedYuan,0);assert.equal(done.remainingYuan,1.99868);assert.equal(done.uncertainRequests,0)
})
test('missing, zero, interrupted and excessive usage never return an unknown request reservation', () => {
  for(const[usage,options]of [[undefined,{}],[{input:0,cacheRead:0,cacheWrite:0,output:0},{}],[{input:20,cacheRead:0,cacheWrite:0,output:10},{completed:false}],[{input:999999,cacheRead:0,cacheWrite:0,output:100},{}]]){
    const guard=createPiCostGuard({model:'deepseek-flash',maxCostYuan:2}),before=guard.reserve(payload),after=guard.settle(usage,options)
    assert.equal(after.uncertainRequests,1);assert.ok(after.accountedUpperBoundYuan>=before.accountedUpperBoundYuan);assert.equal(after.reservedYuan,0)
  }
})
test('an unaffordable next request is rejected before it can add a receipt or reduce the retained amount', () => {
  const quote=piRequestCostQuote(payload,'deepseek-flash'),limit=Math.ceil(quote.reservedMicroYuan*1.5)/1e6,guard=createPiCostGuard({model:'deepseek-flash',maxCostYuan:limit})
  guard.reserve(payload);guard.settle(undefined)
  assert.throws(()=>guard.reserve(payload),e=>e.kind==='cost_limit'&&e.cost.requests===1&&e.message.includes('不是实际账单'))
  assert.equal(guard.snapshot().requests,1);assert.equal(guard.snapshot().uncertainRequests,1)
})
test('a later complete request cannot settle the retained receipt of an earlier failed compaction', () => {
  const guard=createPiCostGuard({model:'deepseek-flash',maxCostYuan:2}),first=guard.reserve(payload)
  guard.settle(undefined,{completed:false});guard.reserve(payload)
  const done=guard.settle({input:20,cacheRead:0,cacheWrite:0,output:10})
  assert.equal(done.uncertainRequests,1);assert.equal(done.requests,2);assert.equal(done.reservedYuan,0)
  assert.equal(Math.round(done.spentUpperBoundYuan*1e6),Math.round(first.reservedYuan*1e6)+120)
})
