/** Verify command ownership and secret filtering at process stream boundaries. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLocalCommand } from './local-command.mjs'
function setup(t){const dir=realpathSync(mkdtempSync(join(tmpdir(),'aipm-cmd-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir}
test('secrets split across stdout chunks are redacted after the complete bounded output',async t=>{
 const workspace=setup(t),api={apiKey:'fixture-secret-key',model:'deepseek-v4-pro',baseUrl:'https://api.deepseek.com',anthropicBaseUrl:'https://api.deepseek.com/anthropic'}
 const command=`python3 -c 'import os,sys,time; s=os.environ["DEEPSEEK_API_KEY"]; sys.stdout.write(s[:8]); sys.stdout.flush(); time.sleep(.03); sys.stdout.write(s[8:]); sys.stdout.flush()'`
 const result=await runLocalCommand({workspace,command,api});assert.equal(result.exitCode,0);assert.equal(result.output,'[已隐藏]');assert.equal(result.usedSharedApi,true)
})
test('abort settles even if the child traps SIGTERM and exits zero',async t=>{
 const workspace=setup(t),controller=new AbortController();let pid
 const promise=runLocalCommand({workspace,command:`python3 -c 'import signal,time; signal.signal(signal.SIGTERM,lambda *_: exit(0)); time.sleep(30)'`,signal:controller.signal,onChild:value=>{pid=value}})
 await new Promise(r=>setTimeout(r,80));controller.abort();const result=await promise;assert.equal(result.aborted,true);assert.equal(result.timedOut,false);assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH')
})
test('an already-aborted command never spawns and an outside cwd is rejected',async t=>{
 const workspace=setup(t),controller=new AbortController();controller.abort();let spawned=false
 const result=await runLocalCommand({workspace,command:'echo should-not-run',signal:controller.signal,onChild:()=>{spawned=true}});assert.equal(result.aborted,true);assert.equal(spawned,false)
 assert.throws(()=>runLocalCommand({workspace,command:'pwd',cwd:'..'}),/选定项目/)
})
