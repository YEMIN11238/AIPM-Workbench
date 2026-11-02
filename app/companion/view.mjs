/** Show the cloud console through its local SSH forwarding port, without workbench IPC. */
export class CompanionConsoleView {
  constructor({ WebContentsView, window, getUrl }) { Object.assign(this, { WebContentsView, window, getUrl }); this.revision = 0; this.attached = false }
  bounds(value) {
    if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) throw new Error('控制台显示区域无效')
    const content = this.window().getContentBounds()
    const x = Math.max(200, Math.round(value.x)), y = Math.max(72, Math.round(value.y))
    return { x, y, width: Math.max(0, Math.min(Math.round(value.width), content.width - x)), height: Math.max(0, Math.min(Math.round(value.height), content.height - y)) }
  }
  resize(value) { const bounds = this.bounds(value); if (this.view && this.attached) this.view.setBounds(bounds); return true }
  async show(value) {
    const revision = ++this.revision, bounds = this.bounds(value), destination = await this.getUrl()
    if (revision !== this.revision || this.window()?.isDestroyed()) return false
    const { url, allowedOrigin, partition } = destination
    const target = new URL(url)
    if (target.origin !== 'http://127.0.0.1:16185' || allowedOrigin !== target.origin || target.username || target.password || !/^persist:aipm-companion-astrbot-[a-f0-9]{16,64}$/.test(partition)) throw new Error('云端后台的本机连接无效')
    if (this.view && this.partition !== partition) this.disposeView()
    if (!this.view) {
      this.partition = partition
      this.view = new this.WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition } })
      this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const contain = (event, next) => {
        try { if (new URL(next).origin === allowedOrigin) return }
        catch (error) { /* Invalid destinations are denied like external origins. */ }
        event.preventDefault()
      }
      this.view.webContents.on('will-navigate', contain)
      this.view.webContents.on('will-redirect', contain)
    }
    this.view.setBounds(bounds)
    if (!this.attached) { this.window().contentView.addChildView(this.view); this.attached = true }
    await this.view.webContents.loadURL(url)
    return revision === this.revision
  }
  hide() { ++this.revision; if (this.attached && this.window() && !this.window().isDestroyed()) this.window().contentView.removeChildView(this.view); this.attached = false; return true }
  disposeView() { if (this.attached && this.window() && !this.window().isDestroyed()) this.window().contentView.removeChildView(this.view); this.attached = false; if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close({ waitForBeforeUnload: false }); this.view = null; this.partition = null }
  close() { ++this.revision; this.disposeView() }
}
