import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

import type { ReminderAPI } from '../shared/reminders'

const api: ReminderAPI = {
  phoneState: () => ipcRenderer.invoke('iphone:state'),
  enablePhone: (enabled) => ipcRenderer.invoke('iphone:enable', enabled),
  pairPhone: () => ipcRenderer.invoke('iphone:pair'),
  supportsEdgeGlow: process.platform === 'darwin',
  getSettings: () => ipcRenderer.invoke('reminders:read'),
  saveSettings: (settings) => ipcRenderer.invoke('reminders:save', settings),
  test: (kind) => ipcRenderer.invoke('reminders:test', kind),
  openChatGPTSettings: () => ipcRenderer.invoke('reminders:chatgpt-settings')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
