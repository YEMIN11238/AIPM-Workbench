/** Per-run execution ceilings are independent of the model's current context window. */
import { validatePiCostLimit } from './pi-cost-guard.mjs'
export function resolveExecutionLimits(config={}) {
 if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('执行上限配置须为对象')
 const result={maxCalls:config.maxCalls??120,maxOutputTokens:config.maxOutputTokens??120000,contextWindowTokens:config.contextWindowTokens??96000}
 if(config.maxTokens!==undefined)result.maxTokens=config.maxTokens
 for(const [name,value] of Object.entries(result))if(!Number.isSafeInteger(value)||value<=0)throw new Error('执行上限须为正整数：'+name)
 if(config.maxCostYuan!==undefined)result.maxCostYuan=validatePiCostLimit(config.maxCostYuan)
 return result
}

/** Return a resumable pause only when a configured execution ceiling is reached. */
export function executionPause(usage,limits) {
 const suffix='，进度已保存，已暂停，可以继续'
 if(limits.maxCostYuan!==undefined&&usage.cost?.accountedUpperBoundYuan>=limits.maxCostYuan)return{kind:'cost_limit',reason:`本轮模型费用预留已达到 ¥${limits.maxCostYuan} 预算，进度已保存，已暂停；费用估算不是实际账单，也不代表 API 余额用完`}
 if(usage.calls>=limits.maxCalls)return{kind:'call_limit',reason:`本轮已请求模型 ${usage.calls} 次，达到 ${limits.maxCalls} 次执行上限${suffix}`}
 if(usage.output_tokens>=limits.maxOutputTokens)return{kind:'output_token_limit',reason:`本轮模型已输出 ${usage.output_tokens} 个 token，达到 ${limits.maxOutputTokens} 个输出上限${suffix}`}
 if(limits.maxTokens!==undefined&&usage.input_tokens+usage.output_tokens>=limits.maxTokens)return{kind:'input_token_limit',reason:`本轮累计处理 ${usage.input_tokens+usage.output_tokens} 个 token，达到手动配置的 ${limits.maxTokens} 个累计上限${suffix}`}
 return null
}
