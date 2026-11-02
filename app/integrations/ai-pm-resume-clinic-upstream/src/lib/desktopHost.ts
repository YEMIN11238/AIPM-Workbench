/** Narrow renderer connection to the desktop's saved model configuration. */
export interface DesktopModelStatus {
  configured: boolean
  model: string
  choices: Array<{ id: string; label: string; name?: string }>
}

export interface DesktopCompletionResponse {
  model?: string
  usage?: Record<string, number>
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
  error?: { message?: string }
  message?: string
}

export interface DesktopResumeBridge {
  status(): Promise<DesktopModelStatus>
  selectModel(model: string): Promise<DesktopModelStatus>
  complete(payload: Record<string, unknown>): Promise<DesktopCompletionResponse>
  onModelUpdate(callback: (status: DesktopModelStatus) => void): () => void
  exportPdf?(payload: { html: string }): Promise<{ saved: boolean }>
}

declare global {
  interface Window {
    aipmResumeClinic?: DesktopResumeBridge
  }
}

export const desktopHost = typeof window === 'undefined' ? undefined : window.aipmResumeClinic
export const isDesktopHost = Boolean(desktopHost)
let currentStatus: DesktopModelStatus | null = null
let selection: Promise<void> = Promise.resolve()
const listeners = new Set<(status: DesktopModelStatus) => void>()

function applyStatus(status: DesktopModelStatus) {
  currentStatus = status
  for (const listener of listeners) listener(status)
  return status
}

if (desktopHost) desktopHost.onModelUpdate(applyStatus)

export function getDesktopStatus() {
  return currentStatus
}

export function subscribeDesktopStatus(callback: (status: DesktopModelStatus) => void) {
  listeners.add(callback)
  if (currentStatus) callback(currentStatus)
  return () => { listeners.delete(callback) }
}

export async function refreshDesktopStatus() {
  if (!desktopHost) return null
  return applyStatus(await desktopHost.status())
}

export function selectDesktopModel(model: string) {
  if (!desktopHost) return Promise.resolve()
  const host = desktopHost
  const next = selection.then(async () => { applyStatus(await host.selectModel(model)) })
  selection = next.catch(() => { /* The caller displays the selection error. */ })
  return next
}

/** Resolve the saved model after any pending selection has completed. */
export async function getDesktopRequestModel() {
  await selection
  const status = await refreshDesktopStatus()
  if (!status?.configured) throw new Error('请先在 AIPM 工作台的设置中配置模型连接。')
  return status.model
}
