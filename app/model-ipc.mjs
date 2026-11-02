/** Shared model preference actions; credentials never enter renderer responses. */
export function registerModelIpc({ handle, settings, syncStandalone = () => {}, onUpdate = () => {} }) {
  handle('modelStatus', () => settings.get())
  handle('modelSelect', async model => {
    const before = settings.get()
    const selected = settings.select(model)
    try { await syncStandalone(selected) }
    catch (error) {
      settings.select(before.model)
      throw new Error('模型设置未生效，已恢复原模型：' + error.message)
    }
    try { onUpdate(selected) }
    catch (error) { console.error('模型选项已保存，界面通知失败') }
    return selected
  })
}
