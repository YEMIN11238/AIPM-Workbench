import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveExecutionLimits,executionPause } from './pi-execution-limits.mjs'

test('repeated input accounting does not exhaust default development runs',()=>{
 const limits=resolveExecutionLimits();assert.deepEqual(limits,{maxCalls:120,maxOutputTokens:120000,contextWindowTokens:96000})
 assert.equal(executionPause({calls:10,input_tokens:800000,output_tokens:10000},limits),null)
 assert.equal(executionPause({calls:120,input_tokens:0,output_tokens:10},limits).kind,'call_limit')
 assert.equal(executionPause({calls:2,input_tokens:0,output_tokens:120000},limits).kind,'output_token_limit')
})
test('explicit cumulative limits remain enforceable and invalid ceilings are rejected',()=>{
 const limits=resolveExecutionLimits({maxTokens:400000,maxCalls:50});assert.equal(executionPause({calls:8,input_tokens:395000,output_tokens:12000},limits).kind,'input_token_limit')
 assert.throws(()=>resolveExecutionLimits({maxCalls:0}),/正整数/);assert.throws(()=>resolveExecutionLimits({maxOutputTokens:1.5}),/正整数/)
})

test('an optional money ceiling remains separate from numerical call and output ceilings',()=>{
 const limits=resolveExecutionLimits({maxCostYuan:2,maxCalls:16,maxOutputTokens:24000});assert.equal(limits.maxCostYuan,2)
 assert.equal(executionPause({calls:1,output_tokens:10,cost:{accountedUpperBoundYuan:2}},limits).kind,'cost_limit')
 assert.equal(executionPause({calls:1,output_tokens:10,cost:{accountedUpperBoundYuan:.2}},limits),null)
 for(const maxCostYuan of [0,-2,'2',Infinity])assert.throws(()=>resolveExecutionLimits({maxCostYuan}),/费用上限/)
})
