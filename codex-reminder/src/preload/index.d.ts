import { ElectronAPI } from '@electron-toolkit/preload'

import type { ReminderAPI } from '../shared/reminders'

declare global {
  interface Window {
    electron: ElectronAPI
    api: ReminderAPI
  }
}
