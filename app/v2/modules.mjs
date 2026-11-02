/** Domain tools within the new Pi workbench; business state remains in native services. */
import { renderMarkdown } from '../assets/document-format.js'
import { mountBlueprintProduct } from '../blueprint-product-view.mjs'
import { mountGeo } from '../geo-view.mjs'
import { mountStarter } from '../starter-view.mjs'
import { mountCompanyResearch } from './company-research.mjs'
import { mountVideo } from './video.mjs'
import { starters, projectSearchEntries, searchEntries } from '../workbench.mjs'

const STAGES=['需求池','竞品分析','MVP 范围','立项报告','PRD']
const KIND_NAMES={discovery:'产品梳理与文档',blueprint:'Agent Blueprint',task:'方案与项目检查',geo:'GEO 内容运营',starter:'AI 产品开发',company:'公司与客户调研',video:'视频创作'}
const STATUS={running:'执行中',completed:'草稿已生成',needs_review:'需要复核',failed:'执行失败',cancelled:'已取消',interrupted:'已中断'}

/** Mount preserved feature tools independently of the discarded application layout. */
export function mountModules({container,api,events={},toast=()=>{},discuss=()=>{},openChat=()=>{},lemoFactory}){
 const doc=container.ownerDocument
 const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
 const guard=fn=>async()=>{try{await fn()}catch(error){toast(error.message)}}
 const button=(label,action,cls='v2-tool-button')=>{const n=el('button',cls,label);n.type='button';n.onclick=guard(action);return n}
 const subscription=(name,callback)=>typeof events[name]==='function'?events[name](callback):()=>{}
 const state={kind:null,id:null,mode:null,revision:0,disposed:false,leaf:null,dirty:false,project:null,editor:null,draft:'',hash:null,documentStage:null,documentName:null,editorRevision:0,reader:true,version:null,review:null,task:null,taskList:[],taskMode:'plan',taskDraft:{title:'',input:'',projectPath:'',prdText:''},taskBusy:false,report:null,archive:null}
 const root=el('section','v2-modules'),header=el('header','v2-module-header'),title=el('h2'),navigation=el('nav','v2-module-navigation'),actions=el('div','v2-module-actions'),body=el('div','v2-module-body')
 const auxiliary=el('aside','v2-module-auxiliary');auxiliary.hidden=true
 header.append(title,actions);root.append(header,navigation,body,auxiliary);container.append(root);root.hidden=true
 const canLeave=()=>{if(body.querySelector('[data-unsaved-form=true]')){toast('当前表单还未保存，请先保存或取消。');return false}if(state.kind==='starter'&&[...body.querySelectorAll('.stk-composer textarea,.stk-create input,.stk-create textarea')].some(n=>n.value.trim())){toast('开发流程中还有未发送的输入，请先发送或清空。');return false}if(state.dirty){toast('文档草稿未保存，请先保存或明确放弃。');return false}if(state.leaf?.canLeave&&!state.leaf.canLeave())return false;if(state.leaf?.hasUnsaved?.()){toast('当前内容未保存，请先保存。');return false}return true}
 function resetLeaf(){state.leaf?.destroy?.();state.leaf=null;body.replaceChildren();auxiliary.hidden=true;auxiliary.replaceChildren()}
 function setHeader(kind){header.hidden=kind==='video';title.textContent=KIND_NAMES[kind]||'工具';actions.replaceChildren();navigation.replaceChildren();if(kind==='blueprint'||kind==='task'){
   for(const[label,kind,mode]of[['产品闭环','blueprint','product'],['方案与检查','task',state.taskMode],['17 个组件与资料','blueprint','library'],['原有对话记录','blueprint','archive']]){
    const n=button(label,()=>open({kind,mode}),'v2-tool-tab');n.setAttribute('aria-current',String(state.kind===kind&&state.mode===mode));navigation.append(n)
   }
  }
  if(kind==='discovery')actions.append(button('搜索全部资料',showDiscoverySearch),button('全部阶段文档',showDocumentLibrary))
  if(kind==='starter')actions.append(button('三份手册 · 同一个开发流程',showManuals))
  if(kind!=='company'&&kind!=='video')actions.append(button('用 Pi 继续讨论',()=>{if(!canLeave())return;return discuss(state.project?`继续梳理「${state.project.name}」的${STAGES[state.project.stage]}，先读取工作台已保存的项目资料与证据，再协助我推进。`:`继续使用${KIND_NAMES[kind]||'工作台工具'}，先读取已有资料，说明当前结果与下一步。`)}))
 }
 async function showManuals(){
  const status=await api('piStatus');if(state.disposed)return
  auxiliary.hidden=false;auxiliary.replaceChildren(button('收起资料',()=>{auxiliary.hidden=true}),el('h3','','AI 产品开发手册'),el('p','v2-tool-muted','这三份手册共同覆盖后端、正式前端与上线，是一项完整开发功能。'))
  for(const manual of status.manuals||[])auxiliary.append(button(manual.name,async()=>{const file=await api('piManualRead',manual.name);const article=el('article','markdown-content');article.innerHTML=renderMarkdown(file.content);auxiliary.replaceChildren(button('返回手册列表',showManuals),el('h3','',file.name),article)}))
 }
 async function mountLeaf(kind,id,mode){
  const holder=el('div','v2-domain-leaf '+kind);body.append(holder)
  if(kind==='video'){
   const leaf=mountVideo({container:holder,api,events,toast});state.leaf=leaf;await leaf.open({kind,id,mode})
  }else if(kind==='company'){
   const leaf=mountCompanyResearch({container:holder,api,events,toast,openChat});state.leaf=leaf;await leaf.open({kind,id,mode})
  }else if(kind==='blueprint'){
   const leaf=mountBlueprintProduct({container:holder,api,onUpdate:callback=>subscription('onBlueprintProductUpdate',callback),toast});state.leaf=leaf;await leaf.show(mode==='library'?'library':'product',id)
  }else if(kind==='starter'){
   const leafApi=async(name,...args)=>{const value=await api(name,...args);return name==='starterList'&&id?[...value].sort((a,b)=>(a.id===id?-1:b.id===id?1:0)):value}
   const leaf=mountStarter({container:holder,api:leafApi,onUpdate:callback=>subscription('onStarterUpdate',callback),toast});state.leaf=leaf;await leaf.show()
  }else if(kind==='geo'){
   let selected
   const leafApi=(name,...args)=>{const promise=api(name,...args);if(name==='geoGet'&&args[0]===id)selected=promise;return promise}
   const leaf=mountGeo({container:holder,api:leafApi,toast});state.leaf=leaf;await leaf.show()
   if(id){const row=[...holder.querySelectorAll('[data-geo-id]')].find(n=>n.dataset.geoId===id);if(row){row.click();if(selected)await selected;await Promise.resolve()}}
  }
 }
 async function open({kind,id,mode}={}){
  if(state.disposed||!canLeave())return false
  const revision=++state.revision
  state.leaf?.hide?.();resetLeaf();state.kind=kind||'discovery';state.id=id||null;state.mode=mode||(state.kind==='blueprint'?'product':state.kind==='task'?state.taskMode:null);state.project=null;state.archive=null;root.hidden=false
  setHeader(state.kind)
  if(state.kind==='discovery')await showDiscovery(id,revision)
  else if(state.kind==='task')await showTasks(id,mode,revision)
  else if(state.kind==='blueprint'&&state.mode==='archive')await showArchive(revision)
  else await mountLeaf(state.kind,id,state.mode)
  return revision===state.revision
 }
 function field(label,value,onInput,{area=false,placeholder='',type='text'}={}){
  const row=el('label','v2-tool-field',label),input=el(area?'textarea':'input','v2-tool-input');input.value=value||'';if(!area)input.type=type;else input.rows=4;input.placeholder=placeholder;input.setAttribute('aria-label',label);input.oninput=()=>onInput(input.value);row.append(input);return row
 }
 function markdown(text){const article=el('article','markdown-content');article.innerHTML=renderMarkdown(text||'尚未生成内容。');return article}
 function details(label,children=[]){const n=el('details','v2-tool-details');n.append(el('summary','',label),...children);return n}
 function clearDocument(){state.hash=null;state.documentName=null;state.documentStage=state.project?.stage??0;state.draft='';state.dirty=false;state.review=null;state.version=null;state.reader=true;state.editorRevision++}
 async function showDiscovery(id,revision){
  const boot=await api('boot');if(revision!==state.revision||state.disposed)return
  if(id)state.project=await api('project',id)
  else state.project=boot.projects?.[0]||null
  if(revision!==state.revision||state.disposed)return
  clearDocument();renderDiscovery(boot.projects||[])
  const current=state.project?.documents?.find(f=>f.stage===state.project.stage)
  if(current)await loadDocument(current.name,current.stage)
 }
 let discoveryProjects=[]
 function renderDiscovery(projects=discoveryProjects){
  discoveryProjects=projects;body.replaceChildren();const p=state.project
  const toolbar=el('div','v2-tool-toolbar'),selector=el('select','v2-tool-input');selector.setAttribute('aria-label','产品项目')
  const blank=el('option','','选择已有产品');blank.value='';selector.append(blank)
  for(const item of projects){const option=el('option','',item.name);option.value=item.id;selector.append(option)}selector.value=p?.id||''
  selector.onchange=guard(()=>{if(!canLeave()){selector.value=state.project?.id||'';return}return open({kind:'discovery',id:selector.value})})
  toolbar.append(selector,button('新建产品',()=>{
   if(!canLeave())return
   const form=el('form','v2-tool-form');form.oninput=()=>{form.dataset.unsavedForm='true'};let name='';form.append(field('产品名称','',v=>{name=v}),button('创建产品',async()=>{if(!name.trim())throw new Error('请填写产品名称');const created=await api('create',name);delete form.dataset.unsavedForm;await open({kind:'discovery',id:created.id})},'v2-tool-button primary'));body.replaceChildren(form)
  }));body.append(toolbar)
  if(!p){body.append(el('p','v2-tool-empty','建立一个产品，保存想法、证据、阶段对话和文档。'));return}
  const progress=el('ol','v2-discovery-stages');STAGES.forEach((name,i)=>{const item=el('li',i===p.stage?'current':p.confirmed.includes(i)?'complete':'',`${i+1}. ${name}${p.confirmed.includes(i)?' ✓':''}`);progress.append(item)});body.append(progress)
  const heading=el('div','v2-tool-toolbar');heading.append(el('h3','',p.name),el('span','v2-tool-muted',p.completed?'已完成全部阶段':`${STAGES[p.stage]} · ${p.review?'等待人工确认':'进行中'}`),button('打开文件夹',()=>api('openFolder',p.id)));body.append(heading)
  const tabs=el('nav','v2-tool-local-tabs');for(const[label,section]of[['阶段文档','documents'],['证据与材料','evidence'],['原有阶段对话','conversation']])tabs.append(button(label,()=>{const target=body.querySelector('[data-section="'+section+'"]');target?.scrollIntoView?.({block:'start'});target?.querySelector('summary')?.click()}));body.append(tabs)
  const docs=el('section','v2-discovery-documents');docs.dataset.section='documents';const documentTabs=el('div','v2-tool-toolbar')
  for(const file of p.documents||[])documentTabs.append(button(file.name,()=>loadDocument(file.name,file.stage),'v2-tool-chip'))
  documentTabs.append(button('当前阶段草稿',async()=>{if(!canLeave())return;const current=p.documents.find(f=>f.stage===p.stage);if(current)await loadDocument(current.name,current.stage);else{clearDocument();renderEditor()}}));docs.append(documentTabs)
  const editor=el('div','v2-document-editor');editor.dataset.documentEditor='';docs.append(editor);body.append(docs);renderEditor()
  const evidence=details(`证据与材料（${p.evidence.length}）`);evidence.dataset.section='evidence'
  for(const item of p.evidence){const card=el('article','v2-evidence');card.append(el('strong','',`${item.code} · ${item.title}`),el('small','v2-tool-muted',({provided:'用户提供',verified:'用户已核验',hypothesis:'待验证假设'})[item.kind]||item.kind),el('p','',item.content),el('p','v2-tool-muted',item.source||'来源待补充'),button('移除这份材料',()=>{
    const confirm=el('div','v2-inline-confirm');confirm.append(el('p','','确认从此产品移除这份证据？'),button('确认移除',async()=>{state.project=await api('removeEvidence',p.id,item.id);renderDiscovery()}),button('保留',()=>confirm.remove()));card.append(confirm)
   }));evidence.append(card)}
  evidence.append(button('添加证据',()=>renderEvidenceForm(evidence)),button('导入本地材料',async()=>{const imported=await api('import');if(imported)renderEvidenceForm(evidence,imported)}));body.append(evidence)
  const conversation=details(`原有阶段对话（${p.messages.length}）`);conversation.dataset.section='conversation'
  for(const message of p.messages){const row=el('article','v2-domain-message');row.append(el('small','v2-tool-muted',`${message.role==='user'?'你':'产品搭档'} · ${STAGES[message.stage]||'产品讨论'}`),markdown(message.content));if(message.role==='assistant')row.append(button('载入当前阶段草稿',()=>{if(!canLeave())return;state.documentStage=p.stage;state.documentName=p.documents.find(f=>f.stage===p.stage)?.name||null;state.hash=null;state.draft=message.content;state.dirty=true;state.reader=false;state.editorRevision++;renderEditor();const current=p.documents.find(f=>f.stage===p.stage);if(current){const revision=state.editorRevision;void api('readDocument',p.id,current.name).then(file=>{if(state.editorRevision===revision)state.hash=file.hash}).catch(e=>toast(e.message))}}));conversation.append(row)}
  let message='';const templates=details('从讨论模板开始');for(const starter of starters)templates.append(button(starter.title,()=>discuss(`关于「${p.name}」：${starter.prompt}`)));conversation.append(templates)
  const input=field('继续原有阶段对话','',v=>{message=v},{area:true,placeholder:'补充产品背景、用户问题或已有证据…'}),send=button('发送阶段消息',async()=>{if(!message.trim())return;send.disabled=true;try{state.project=await api('send',p.id,message);renderDiscovery()}finally{send.disabled=false}})
  const messageComposer=el('div');messageComposer.dataset.modelComposer=''
  messageComposer.append(input,send,button('停止阶段生成',async()=>{await api('stop');state.project=await api('project',p.id);renderDiscovery()}),button('由 Pi 整理当前阶段',()=>discuss(`请读取工作台中「${p.name}」现有需求和证据，只推进${STAGES[p.stage]}，先解决必要问题，生成有来源的阶段文档，等待我人工验收。`)));conversation.append(messageComposer);body.append(conversation)
 }
 async function loadDocument(name,stage){
  if(!canLeave())return
  const revision=state.revision,editorRevision=++state.editorRevision,id=state.project.id,file=await api('readDocument',id,name)
  if(state.disposed||revision!==state.revision||editorRevision!==state.editorRevision||state.project?.id!==id||state.dirty)return
  state.documentName=name;state.documentStage=stage;state.draft=file.content;state.hash=file.hash;state.reader=true;state.review=null;state.version=null;renderEditor()
 }
 function renderEditor(){
  const host=body.querySelector('[data-document-editor]');if(!host||!state.project)return;host.replaceChildren();const p=state.project,stage=state.documentStage??p.stage,name=state.documentName||`${String(stage+1).padStart(2,'0')}-${STAGES[stage]}.md`
  const toolbar=el('div','v2-tool-toolbar');toolbar.append(el('strong','',name),el('span','v2-tool-muted',state.dirty?'草稿未保存':state.hash?'已保存':'尚无文档'),button(state.reader?'编辑源码':'阅读预览',()=>{state.reader=!state.reader;renderEditor()}),button('复制 Markdown',async()=>{await api('copyText',state.draft);toast('已复制 Markdown')}))
  const history=button('版本历史',showVersions);history.disabled=!state.hash||state.dirty;toolbar.append(history)
  const save=button('检查并保存',()=>{if(!state.draft.trim())throw new Error('文档不能为空');state.review={content:state.draft,hash:state.hash,stage,editorRevision:state.editorRevision};renderEditor()},'v2-tool-button primary');save.disabled=!state.dirty;toolbar.append(save)
  if(state.dirty)toolbar.append(button('放弃草稿',async()=>{state.dirty=false;if(state.documentName)await loadDocument(state.documentName,stage);else{clearDocument();renderEditor()}}));host.append(toolbar)
  if(state.reader)host.append(markdown(state.draft))
  else{const area=el('textarea','v2-source-editor');area.setAttribute('aria-label','阶段文档源码');area.value=state.draft;area.oninput=()=>{state.draft=area.value;state.dirty=true;state.editorRevision++;state.review=null;save.disabled=false;const hint=toolbar.querySelector('.v2-tool-muted');if(hint)hint.textContent='草稿未保存'};host.append(area);state.editor=area}
  if(state.review){const review=el('section','v2-save-review');review.append(el('h4','','保存前检查'),el('p','v2-tool-muted','保存只更新文档并保留旧版本，不会自动确认阶段。'),markdown(state.review.content),button('确认保存这个版本',async()=>{const input=state.review;if(!input||input.editorRevision!==state.editorRevision)throw new Error('草稿已改变，请重新检查');const id=p.id,revision=state.revision;const saved=await api('saveDocument',id,{content:input.content,hash:input.hash,stage:input.stage});if(revision!==state.revision)return;state.project=saved;state.review=null;const name=`${String(input.stage+1).padStart(2,'0')}-${STAGES[input.stage]}.md`;if(state.editorRevision!==input.editorRevision){const latest=await api('readDocument',id,name);if(revision!==state.revision)return;state.hash=latest.hash;state.documentName=name;state.dirty=true;toast('核对的版本已保存，新输入的草稿继续保留。');renderDiscovery();return}state.dirty=false;await loadDocument(name,input.stage);renderDiscovery()},'v2-tool-button primary'),button('继续修改',()=>{state.review=null;renderEditor()}));host.append(review)}
  if(state.version){const version=state.version;host.append(details(`历史正文 · ${new Date(version.createdAt).toLocaleString('zh-CN')}`,[markdown(version.content),button('载入历史版本为草稿',()=>{state.draft=version.content;state.dirty=true;state.reader=false;state.version=null;state.editorRevision++;renderEditor()})]))}
  if(stage===p.stage&&!p.completed){const gate=el('section','v2-phase-gate');gate.append(el('strong','','人工确认当前阶段'),el('p','v2-tool-muted','请核对证据、文档与实际结果，确认后才会进入下一阶段。'))
   const check=el('input');check.type='checkbox';check.setAttribute('aria-label','我已核对当前阶段文档与证据');const label=el('label','v2-tool-check');label.append(check,el('span','','我已核对当前阶段文档与证据'));const confirm=button(stage===4?'确认完成产品流程':'确认并进入下一阶段',async()=>{if(!check.checked)throw new Error('请先人工核对');if(state.dirty)throw new Error('请先保存草稿');state.project=await api('confirm',p.id);clearDocument();renderDiscovery()},'v2-tool-button');confirm.disabled=!p.review||state.dirty;gate.append(label,confirm);host.append(gate)
  }
 }
 async function showVersions(){
  if(state.dirty||!state.documentName)return
  const id=state.project.id,name=state.documentName,revision=state.revision,editorRevision=state.editorRevision,list=await api('listVersions',id,name)
  if(revision!==state.revision||editorRevision!==state.editorRevision)return
  auxiliary.hidden=false;auxiliary.replaceChildren(button('收起版本历史',()=>{auxiliary.hidden=true}),el('h3','','版本历史'),el('p','v2-tool-muted','载入历史只建立草稿，检查并保存后才替换当前文档。'))
  if(!list.length)auxiliary.append(el('p','','下一次保存修改时会保留当前版本。'))
  for(const version of list)auxiliary.append(button(new Date(version.createdAt).toLocaleString('zh-CN'),async()=>{const result=await api('readVersion',id,name,version.id);if(revision!==state.revision||editorRevision!==state.editorRevision||state.dirty)return;state.version=result;auxiliary.hidden=true;renderEditor();const detail=body.querySelector('.v2-document-editor details');if(detail)detail.open=true}))
 }
 function renderEvidenceForm(target,imported){
  const form=el('form','v2-tool-form');form.oninput=()=>{form.dataset.unsavedForm='true'};const value={title:imported?.title||imported?.name||'导入的材料',content:imported?.content||imported?.text||'',kind:'provided',source:imported?.source||imported?.path||''}
  form.append(field('材料名称',value.title,v=>{value.title=v}),field('内容',value.content,v=>{value.content=v},{area:true}),field('来源',value.source,v=>{value.source=v}))
  const kind=el('select','v2-tool-input');kind.setAttribute('aria-label','证据类型');for(const[key,label]of Object.entries({provided:'用户提供',verified:'我已核验来源',hypothesis:'待验证假设'})){const option=el('option','',label);option.value=key;kind.append(option)}kind.onchange=()=>{value.kind=kind.value};form.append(kind,el('p','v2-tool-muted','已核验表示你本人已检查来源，并非系统自动完成事实核验。'),button('添加材料',async()=>{state.project=await api('evidence',state.project.id,value);renderDiscovery()},'v2-tool-button primary'),button('取消添加',()=>form.remove()));form.onsubmit=e=>e.preventDefault();target.append(form)
 }
 async function showDocumentLibrary(){
  if(!canLeave())return
  const revision=state.revision,boot=await api('boot');if(revision!==state.revision)return
  auxiliary.hidden=false;auxiliary.replaceChildren(button('收起文档列表',()=>{auxiliary.hidden=true}),el('h3','','全部阶段文档'))
  for(const project of boot.projects||[])for(const file of project.documents||[])auxiliary.append(button(project.name+' / '+file.name,async()=>{await open({kind:'discovery',id:project.id});await loadDocument(file.name,file.stage)}))
 }
 async function showDiscoverySearch(){
  if(!canLeave())return
  const revision=state.revision,boot=await api('boot');if(revision!==state.revision)return
  const projects=boot.projects||[],index=projectSearchEntries(projects),results=el('div'),input=el('input','v2-tool-input'),filter=el('select','v2-tool-input');input.type='search';input.placeholder='搜索项目、正文、证据、来源或历史对话';input.setAttribute('aria-label','搜索全部产品资料')
  for(const[key,label]of Object.entries({all:'全部类型',project:'项目',document:'阶段文档',evidence:'证据与来源',message:'历史对话'})){const option=el('option','',label);option.value=key;filter.append(option)}filter.setAttribute('aria-label','搜索资料类型')
  const render=()=>{const matches=searchEntries(index,input.value,filter.value).slice(0,80);results.replaceChildren(el('p','v2-tool-muted',matches.length+' 项匹配'));for(const item of matches){const row=button(item.projectName+' · '+item.title,async()=>{await open({kind:'discovery',id:item.projectId});if(item.type==='document')await loadDocument(item.name,item.stage);else if(item.type==='message'||item.type==='evidence'){const section=body.querySelector('[data-section="'+(item.type==='message'?'conversation':'evidence')+'"]');if(section){section.open=true;section.scrollIntoView?.({block:'start'})}}});results.append(row);if(item.excerpt)results.append(el('p','v2-tool-muted',item.excerpt))}}
  input.oninput=render;filter.onchange=render;auxiliary.hidden=false;auxiliary.replaceChildren(button('收起搜索',()=>{auxiliary.hidden=true}),el('h3','','搜索全部产品资料'),input,filter,results);render()
  const docs=await Promise.allSettled(projects.flatMap(project=>(project.documents||[]).map(async file=>({...file,type:'document',projectId:project.id,projectName:project.name,title:file.name,content:(await api('readDocument',project.id,file.name)).content}))))
  if(revision!==state.revision||auxiliary.hidden)return
  index.push(...docs.filter(r=>r.status==='fulfilled').map(r=>r.value));render();if(docs.some(r=>r.status==='rejected'))toast('部分文档读取失败，其他资料仍可搜索。')
 }
 async function showTasks(id,mode,revision){
  state.taskMode=mode==='audit'?'audit':'plan';state.taskStatus=null;state.report=null
  const [status,tasks]=await Promise.all([api('blueprintStatus'),api('blueprintList')]);if(revision!==state.revision||state.disposed)return
  state.taskStatus=status;state.taskList=tasks;state.task=id?tasks.find(t=>t.id===id)||await api('blueprintGet',id):tasks.find(t=>t.id===state.task?.id)||tasks[0]||null
  if(revision!==state.revision)return;renderTasks()
 }
 function renderTasks(){
  body.replaceChildren();const grid=el('div','v2-task-grid'),form=el('form','v2-task-form'),result=el('section','v2-task-result');result.dataset.taskResult=''
  const modeNav=el('div','v2-tool-toolbar');for(const mode of ['plan','audit']){const n=button(mode==='plan'?'从想法生成方案':'检查已有代码项目',()=>{state.taskMode=mode;state.mode=mode;renderTasks()});n.setAttribute('aria-pressed',String(state.taskMode===mode));modeNav.append(n)}form.append(modeNav)
  const draft=state.taskDraft;form.append(field('任务名称',draft.title,v=>{draft.title=v}))
  if(state.taskMode==='plan')form.append(field('产品想法与已有需求',draft.input,v=>{draft.input=v},{area:true,placeholder:'为谁解决什么问题，已有材料和约束是什么？'}),button('导入需求文档',async()=>{const picked=await api('blueprintPick','idea');if(picked){draft.input=picked.text||'';renderTasks()}}))
  else{
   form.append(el('p','v2-tool-muted',draft.projectPath||'选择要检查的本地项目。'),button('选择代码项目',async()=>{const picked=await api('blueprintPick','project');if(picked){draft.projectPath=picked.path;renderTasks()}}),button(draft.prdText?'更换需求文档':'添加需求文档（可选）',async()=>{const picked=await api('blueprintPick','prd');if(picked){draft.prdText=picked.text||'';renderTasks()}}))
   if(draft.prdText)form.append(el('p','v2-tool-muted',draft.prdText.slice(0,160)+'…'),button('移除需求文档',()=>{draft.prdText='';renderTasks()}))
  }
  form.append(el('p','v2-tool-muted','开始后，需求或项目扫描摘要会发送给工作台已配置的模型；不会自动执行被检查项目。'))
  const ready=state.taskStatus?.available&&state.taskStatus?.configured
  const submit=button(state.taskBusy?'正在创建任务…':state.taskMode==='plan'?'开始生成方案':'开始检查项目',async()=>{
   if(state.taskBusy)return;if(!ready)throw new Error(state.taskStatus?.reason||'请先配置模型与运行环境');if(state.taskMode==='plan'&&!draft.input.trim())throw new Error('请先填写产品想法');if(state.taskMode==='audit'&&!draft.projectPath)throw new Error('请先选择代码项目')
   state.taskBusy=true;submit.disabled=true
   try{const task=await api('blueprintStart',{mode:state.taskMode,title:draft.title.trim(),input:draft.input,projectPath:draft.projectPath,prdText:draft.prdText});state.taskList=[task,...state.taskList.filter(t=>t.id!==task.id)];state.task=task;state.report=null;renderTaskResult()}finally{state.taskBusy=false;submit.disabled=!ready}
  },'v2-tool-button primary');submit.disabled=!ready||state.taskBusy||state.taskList.some(t=>t.status==='running');form.append(submit)
  if(!ready)form.append(el('p','v2-tool-error',state.taskStatus?.reason||'请先在设置中配置模型 API，并确认 Blueprint 环境可用。'))
  const history=details('原有任务记录');for(const task of state.taskList)history.append(button(`${task.title} · ${STATUS[task.status]||task.status}`,async()=>{const revision=state.revision,value=await api('blueprintGet',task.id);if(revision!==state.revision)return;state.task=value;state.report=null;renderTaskResult()}));form.append(history)
  form.onsubmit=e=>{e.preventDefault();submit.click()};grid.append(form,result);body.append(grid);renderTaskResult()
 }
 function renderTaskResult(){
  const host=body.querySelector('[data-task-result]');if(!host)return;host.replaceChildren();const task=state.task
  if(!task){host.append(el('p','v2-tool-empty','方案、审稿与差距报告会保留在这里。'));return}
  host.append(el('h3','',task.title),el('p','v2-tool-muted',`${STATUS[task.status]||task.status} · ${task.stage||'准备执行'}`))
  const controls=el('div','v2-tool-toolbar')
  if(task.status==='running')controls.append(button('停止这个任务',async()=>{state.task=await api('blueprintCancel',task.id);renderTaskResult()}))
  if(['failed','cancelled','interrupted'].includes(task.status))controls.append(button('继续执行',async()=>{state.task=await api('blueprintResume',task.id);renderTaskResult()}))
  controls.append(button('打开任务文件夹',()=>api('blueprintOpenFolder',task.id)),button('让 Pi 解释结果',()=>discuss(`请读取工作台里「${task.title}」的方案或差距报告，用我能听懂的话解释它实际生成了什么、还有哪些问题、下一步做什么。不要把模型审稿当作人工验收。`)));host.append(controls)
  if(task.error)host.append(el('p','v2-tool-error',task.error))
  if(task.usage){const u=task.usage;host.append(el('small','v2-tool-muted',`${u.calls??u.modelCalls??0} 次调用 · ${u.totalTokens??u.total_tokens??((u.input_tokens||0)+(u.output_tokens||0))} tokens`))}
  host.append(el('p','v2-tool-muted','方案与审稿是待核对的设计结果，不等于产品代码已经完成。'))
  const reports=el('div','v2-tool-toolbar');for(const file of task.reports||[])reports.append(button(file.name,()=>loadTaskReport(task.id,file.name),'v2-tool-chip'));host.append(reports)
  const reader=el('article','markdown-content');reader.dataset.taskReport='';if(state.report?.taskId===task.id){reader.innerHTML=renderMarkdown(state.report.content);host.append(button('复制报告',()=>api('copyText',state.report.content)))}else reader.textContent=task.reports?.length?'选择一份报告阅读。':'报告生成后会显示在这里。';host.append(reader)
 }
 async function loadTaskReport(id,name){const revision=state.revision,token=++state.editorRevision,file=await api('blueprintReadReport',id,name);if(state.disposed||revision!==state.revision||state.task?.id!==id||token!==state.editorRevision)return;state.report={...file,taskId:id};renderTaskResult()}
 const unsubscribeTask=subscription('onBlueprintUpdate',task=>{if(state.disposed)return;state.taskList=[task,...state.taskList.filter(t=>t.id!==task.id)];if(state.kind==='task'&&state.task?.id===task.id){state.task=task;renderTaskResult()}})
 async function showArchive(revision){
  const contexts=await api('blueprintChatContexts');if(revision!==state.revision||state.disposed)return;body.replaceChildren(el('p','v2-tool-muted','旧版产品讨论完整保留。新对话和执行统一交给 Pi。'))
  const list=el('div','v2-tool-toolbar'),reader=el('section','v2-archive-reader');reader.dataset.archiveReader=''
  for(const item of contexts)list.append(button(item.title,async()=>{const token=++state.editorRevision,chat=await api('blueprintChatGet',item.scope);if(revision!==state.revision||token!==state.editorRevision)return;state.archive={...chat,title:item.title};renderArchive(reader)}))
  body.append(list,reader);if(!contexts.length)reader.append(el('p','v2-tool-empty','还没有旧版产品讨论记录。'))
 }
 function renderArchive(reader){
  const chat=state.archive;if(!chat)return;reader.replaceChildren(el('h3','',chat.title),button('在 Pi 中继续这项产品讨论',()=>discuss(`继续讨论「${chat.title}」。请读取工作台中该项目原有需求、方案和对话记录，先解释当前进度，再根据我的新指令推进。`)))
  if(chat.context?.summary)reader.append(el('p','v2-tool-muted',chat.context.summary))
  for(const message of chat.messages||[]){const row=el('article','v2-domain-message');row.append(el('small','v2-tool-muted',`${message.role==='user'?'你':'原产品搭档'}${message.demo?' · 演示内容':''}`),markdown(message.content),button('复制这条消息',()=>api('copyText',message.content)));reader.append(row)}
 }
 return{
  open,
  hide(){root.hidden=true;state.leaf?.hide?.()},
  canLeave,
  destroy(){state.disposed=true;++state.revision;state.leaf?.destroy?.();unsubscribeTask();root.remove()},
 }
}
