/** Load the resume feature on demand so an incomplete installation cannot prevent desktop startup. */
const hostUrl = new URL('./resume-clinic/host.mjs', import.meta.url)

/** Preserve the host lifecycle while reporting load failures in the resume page. */
export function registerResumeClinic(options, loadHost = () => import(hostUrl.href)) {
  let host, pending, closing, closed = false, visible = false, revision = 0
  function load() {
    if (!pending) pending = Promise.resolve().then(loadHost).then(module => {
      if (closed) return null
      host = module.registerResumeClinic(options)
      return host
    }).catch(error => {
      pending = undefined
      if (error.code === 'ERR_MODULE_NOT_FOUND') throw new Error('简历检查模块的安装文件尚未齐全，请稍后点“重新打开”。其它工作台功能可以正常使用。', { cause: error })
      throw error
    })
    return pending
  }
  return {
    async show(bounds) {
      if (closed) return false
      visible = true; const token = ++revision
      const service = await load()
      if (closed || !visible || revision !== token) return false
      const result = await service.show(bounds)
      if (closed || !visible) { service.hide(); return false }
      return revision === token ? result : false
    },
    hide() { visible = false; ++revision; return host?.hide() },
    resize(bounds) { return host?.resize(bounds) },
    publishModel(status) { return host?.publishModel(status) },
    close() {
      if (closing) return closing
      closed = true; visible = false; ++revision
      closing = Promise.resolve(pending).catch(() => null).then(() => host?.close())
      return closing
    },
  }
}
