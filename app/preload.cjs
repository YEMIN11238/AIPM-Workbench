/** Restricted IPC interface exposed only to the local desktop renderer. */
const { contextBridge, ipcRenderer } = require('electron')
const methods = ['resumeShow', 'resumeHide', 'resumeBounds', 'boot', 'appearance', 'theme', 'transparency', 'create', 'project', 'evidence', 'removeEvidence', 'readDocument', 'listVersions', 'readVersion', 'saveDocument', 'copyText', 'openLink', 'confirm', 'openFolder', 'key', 'import', 'send', 'stop', 'geoStatus', 'geoList', 'geoGet', 'geoCreate', 'geoSaveProfile', 'geoKeywords', 'geoSaveKeywords', 'geoGenerate', 'geoSaveContent', 'geoReview', 'geoExport', 'geoOpenExport', 'geoCancel', 'blueprintStatus', 'blueprintList', 'blueprintStart', 'blueprintGet', 'blueprintReadReport', 'blueprintCancel', 'blueprintResume', 'blueprintPick', 'blueprintOpenFolder']
const api = Object.fromEntries(methods.map(name => [name, (...args) => ipcRenderer.invoke(`aipm:${name}`, ...args)]))
for (const name of ['videoStudioList', 'videoStudioGet', 'videoStudioCreate', 'videoStudioSend', 'videoStudioCancel', 'videoStudioOutput', 'videoStudioRead', 'videoStudioReply', 'videoStudioSave', 'videoStudioUpgrade', 'videoStudioRender', 'videoStudioPreview', 'videoStudioImport', 'videoStudioOpenFolder', 'videoStudioExport', 'videoStudioAudioImport', 'videoStudioAudioSelect', 'videoStudioAudioPreview']) api[name] = (...args) => ipcRenderer.invoke(`aipm:${name}`, ...args)
api.onVideoStudioUpdate = callback => {
  if (typeof callback !== 'function') throw new TypeError('视频工作区更新需要回调函数')
  const listener = (_event, project) => { try { callback(project) } catch (error) { console.error('视频工作区更新通知失败') } }
  ipcRenderer.on('aipm:video-studio-update', listener)
  return () => ipcRenderer.removeListener('aipm:video-studio-update', listener)
}
for (const name of ['lemoInfo', 'lemoStyles', 'lemoRead', 'lemoList', 'lemoGet', 'lemoPrepare', 'lemoOpenChat', 'lemoRun', 'lemoJob', 'lemoCancel', 'lemoOutput', 'lemoPreview', 'lemoExport', 'lemoSaveStyle', 'lemoOpenFolder', 'lemoVoiceConsent']) api[name] = (...args) => ipcRenderer.invoke(`aipm:${name}`, ...args)
api.onLemoUpdate = callback => {
  if (typeof callback !== 'function') throw new TypeError('Lemo 更新需要回调函数')
  const listener = (_event, project) => { try { callback(project) } catch (error) { console.error('Lemo 更新通知失败') } }
  ipcRenderer.on('aipm:lemo-update', listener)
  return () => ipcRenderer.removeListener('aipm:lemo-update', listener)
}
for (const name of ['modelStatus', 'modelSelect']) api[name] = (...args) => ipcRenderer.invoke(`aipm:${name}`, ...args)
api.onModelUpdate = callback => {
  if (typeof callback !== 'function') throw new TypeError('模型选项更新需要回调函数')
  const listener = (_event, status) => { try { callback(status) } catch (error) { console.error('模型选项更新通知失败') } }
  ipcRenderer.on('aipm:model-update', listener)
  return () => ipcRenderer.removeListener('aipm:model-update', listener)
}
for (const name of ['videoList', 'videoGet', 'videoCreate', 'videoSend', 'videoSaveStoryboard', 'videoRender', 'videoCancel', 'videoOpenFolder', 'videoImport', 'videoPreview', 'videoExport', 'motionSkillInfo', 'motionSkillRead', 'motionPrepare', 'motionGenerate', 'motionGeneration', 'motionOutput', 'motionPreview', 'motionProjects']) api[name] = (...args) => ipcRenderer.invoke(`aipm:${name}`, ...args)
api.onVideoUpdate = callback => {
  if (typeof callback !== 'function') throw new TypeError('视频更新需要回调函数')
  const listener = (_event, project) => { try { callback(project) } catch (error) { console.error('视频更新通知失败') } }
  ipcRenderer.on('aipm:video-update', listener)
  return () => ipcRenderer.removeListener('aipm:video-update', listener)
}
for (const name of ['companyList', 'companyGet', 'companyCreate', 'companySend', 'companyCancel', 'companyReply', 'companyRead', 'companyPublish', 'companyAddMaterial', 'companySearch', 'companyFetch', 'companyLibrary', 'companyReadLibrary', 'companyOpenFolder', 'companyImport', 'companyExport', 'companyPreview']) api[name] = (...args) => ipcRenderer.invoke(`aipm:${name}`, ...args)
api.onCompanyUpdate = callback => {
  if (typeof callback !== 'function') throw new TypeError('调研更新需要回调函数')
  const listener = (_event, project) => { try { callback(project) } catch (error) { console.error('调研更新通知失败') } }
  ipcRenderer.on('aipm:company-update', listener)
  return () => ipcRenderer.removeListener('aipm:company-update', listener)
}
for (const name of ['blueprintProductStatus', 'blueprintProducts', 'blueprintProductGet', 'blueprintProductRead', 'blueprintProductSave', 'blueprintProductStart', 'blueprintProductJobs', 'blueprintProductReply', 'blueprintProductCancel', 'blueprintLibrary', 'blueprintLibraryRead', 'blueprintProductJobRead', 'blueprintProductFolder']) api[name] = (...args) => ipcRenderer.invoke(`aipm:${name}`, ...args)
for (const name of ['blueprintChatContexts', 'blueprintChatGet', 'blueprintChatSend', 'blueprintChatCancel', 'blueprintChatCreateProduct']) api[name] = (...args) => ipcRenderer.invoke(`aipm:${name}`, ...args)
api.onBlueprintChatUpdate = callback => {
  if (typeof callback !== 'function') throw new TypeError('聊天更新需要回调函数')
  const listener = (_event, chat) => { try { callback(chat) } catch (error) { console.error('聊天更新监听失败', error) } }
  ipcRenderer.on('aipm:blueprint-chat-update', listener)
  return () => ipcRenderer.removeListener('aipm:blueprint-chat-update', listener)
}
api.onBlueprintProductUpdate = callback => {
  if (typeof callback !== 'function') throw new TypeError('产品任务监听需要回调函数')
  const listener = (_event, job) => { try { callback(job) } catch (error) { console.error('产品任务监听失败', error) } }
  ipcRenderer.on('aipm:blueprint-product-update', listener)
  return () => ipcRenderer.removeListener('aipm:blueprint-product-update', listener)
}
api.onSystemTheme = callback => {
  if (typeof callback !== 'function') throw new TypeError('系统外观监听需要回调函数')
  const listener = (_event, theme) => {
    if (theme !== 'light' && theme !== 'dark') return
    try { callback(theme) }
    catch (error) { console.error('系统外观监听失败', error) }
  }
  ipcRenderer.on('aipm:system-theme', listener)
  return () => ipcRenderer.removeListener('aipm:system-theme', listener)
}
api.onBlueprintUpdate = callback => {
  if (typeof callback !== 'function') throw new TypeError('任务状态监听需要回调函数')
  const listener = (_event, task) => {
    if (!task || typeof task.id !== 'string') return
    try { callback(task) }
    catch (error) { console.error('任务状态监听失败', error) }
  }
  ipcRenderer.on('aipm:blueprint-update', listener)
  return () => ipcRenderer.removeListener('aipm:blueprint-update', listener)
}
for (const name of ['starterList','starterGet','starterCreate','starterSend','starterCancel','starterReply','starterRead','starterRate','starterReview','starterAdvance','starterLibrary','starterReadLibrary','starterFolder','starterImport','starterSources','starterFromSource','starterOpenPreview','starterCapture','starterStopPreview','starterSaveCloud','starterRemoveCloud']) api[name] = (...args) => ipcRenderer.invoke(`aipm:${name}`, ...args)
api.onStarterUpdate = callback => {
  if (typeof callback !== 'function') throw new TypeError('开发更新需要回调函数')
  const listener = (_event, project) => { try { callback(project) } catch (error) { console.error('开发更新监听失败', error) } }
  ipcRenderer.on('aipm:starter-update', listener)
  return () => ipcRenderer.removeListener('aipm:starter-update', listener)
}
for (const name of ['piList','piGet','piCreate','piSend','piCancel','piReply','piStatus','piPickFolder','piOpenFolder','piArtifact','piPermissions','piRequestPermission','piCatalog','piManualRead']) api[name] = (...args) => ipcRenderer.invoke(`aipm:${name}`, ...args)
api.onPiUpdate = callback => { const listener = (_event, chat) => { try { callback(chat) } catch (error) { console.error('Pi更新通知失败') } }; ipcRenderer.on('aipm:pi-update', listener); return () => ipcRenderer.removeListener('aipm:pi-update', listener) }
for (const name of ['companionSnapshot', 'companionModelKey', 'companionStart', 'companionStop', 'companionSaveConnection', 'companionPickKey', 'companionDeploy', 'companionShowConsole', 'companionHideConsole', 'companionConsoleBounds']) api[name] = (...args) => ipcRenderer.invoke(`aipm:${name}`, ...args)
api.companionControlReady = () => ipcRenderer.invoke('aipm:companionControlReady')
api.onCompanionOpen = callback => {
  if (typeof callback !== 'function') throw new TypeError('后台打开通知需要回调函数')
  const listener = (_event, requestId) => {
    void Promise.resolve().then(() => callback()).then(
      () => ipcRenderer.invoke('aipm:companionControlOpened', requestId, true),
      () => ipcRenderer.invoke('aipm:companionControlOpened', requestId, false),
    ).catch(() => console.error('大肥鱼后台显示确认未送达'))
  }
  ipcRenderer.on('aipm:companion-open', listener)
  return () => ipcRenderer.removeListener('aipm:companion-open', listener)
}
contextBridge.exposeInMainWorld('aipm', api)
