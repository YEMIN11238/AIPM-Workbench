import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { defaultModelId, defaultOptimizeModelId, reviewModelOptions } from '../data/reviewConfig'
import { hasStoredApiKey, setStoredApiKey } from '../lib/openrouter'
import { getDesktopStatus, isDesktopHost, refreshDesktopStatus, selectDesktopModel, subscribeDesktopStatus } from '../lib/desktopHost'
import type { ModelOption } from '../types'

interface AppSettings {
  reviewModel: string
  optimizeModel: string
  setReviewModel: (model: string) => void
  setOptimizeModel: (model: string) => void
  hasApiKey: boolean
  saveApiKey: (key: string) => void
  modelOptions: ModelOption[]
  modelPending: boolean
  hostError: string | null
}

const AppSettingsContext = createContext<AppSettings | null>(null)

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [reviewModel, updateReviewModel] = useState(getDesktopStatus()?.model || defaultModelId)
  const [optimizeModel, updateOptimizeModel] = useState(getDesktopStatus()?.model || defaultOptimizeModelId)
  const [hasKey, setHasKey] = useState(hasStoredApiKey)
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(isDesktopHost ? [] : reviewModelOptions)
  const [modelPending, setModelPending] = useState(isDesktopHost)
  const [hostError, setHostError] = useState<string | null>(null)

  useEffect(() => {
    if (!isDesktopHost) return
    let disposed = false
    const unsubscribe = subscribeDesktopStatus(status => {
      if (disposed) return
      updateReviewModel(status.model)
      updateOptimizeModel(status.model)
      setHasKey(status.configured)
      setModelOptions(status.choices.map(choice => ({ id: choice.id, label: choice.name || choice.label, shortLabel: choice.label })))
      setHostError(null)
    })
    const refresh = () => { void refreshDesktopStatus().catch(error => {
      if (!disposed) setHostError(error instanceof Error ? error.message : '工作台模型连接未就绪。')
    }).finally(() => { if (!disposed) setModelPending(false) }) }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { disposed = true; unsubscribe(); window.removeEventListener('focus', refresh) }
  }, [])

  const chooseModel = (model: string, optimize: boolean) => {
    if (!isDesktopHost) {
      if (optimize) updateOptimizeModel(model)
      else updateReviewModel(model)
      return
    }
    setModelPending(true)
    setHostError(null)
    void selectDesktopModel(model).catch(error => {
      setHostError(error instanceof Error ? error.message : '模型选择未保存，请重试。')
    }).finally(() => setModelPending(false))
  }

  const saveApiKey = (key: string) => {
    setStoredApiKey(key)
    setHasKey(true)
  }

  return (
    <AppSettingsContext.Provider value={{
      reviewModel, optimizeModel,
      setReviewModel: model => chooseModel(model, false),
      setOptimizeModel: model => chooseModel(model, true),
      hasApiKey: hasKey, saveApiKey, modelOptions, modelPending, hostError,
    }}>
      {children}
    </AppSettingsContext.Provider>
  )
}

// The routed pages consume the same provider and hook.
// eslint-disable-next-line react-refresh/only-export-components
export function useAppSettings() {
  const context = useContext(AppSettingsContext)
  if (!context) throw new Error('useAppSettings must be used within AppSettingsProvider')
  return context
}
