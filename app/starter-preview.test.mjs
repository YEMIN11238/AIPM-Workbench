/** Real local server lifecycle, secret scrubbing and screenshot ownership. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtempSync, realpathSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StarterPreview } from './starter-preview.mjs'
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
test('owned preview runs, captures locally and is reaped on close',async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'aipm-preview-'))),p=await port();const preview=new StarterPreview({capturePage:async(url,size)=>({bytes:Buffer.from('actual-host-capture-fixture'),text:'会议助手'})});t.after(async()=>{await preview.close();rmSync(root,{recursive:true,force:true})})
 const v=await preview.start('test',root,{command:`python3 -m http.server ${p} --bind 127.0.0.1`,port:p},{apiKey:'private-test'});assert.equal(v.status,'running');assert.equal((await fetch(v.url)).status,200)
 const evidence=await preview.capture('test',root,{url:v.url,mobile:true,phase:3});assert.equal(evidence.mobile,true);assert.match(readFileSync(join(root,evidence.file),'utf8'),/actual-host/)
 await assert.rejects(preview.capture('test',root,{url:'https://example.com'}),/当前项目/);await preview.stop('test',p);assert.deepEqual(preview.list('test'),[]);await assert.rejects(fetch(v.url))
})
