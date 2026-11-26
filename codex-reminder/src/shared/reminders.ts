export type ReminderKind = 'completed' | 'attention'

export interface ReminderSettings {
  popup: boolean
  sound: boolean
  edgeGlow: boolean
}

export interface PhoneState {
  enabled: boolean
  status:
    'disabled' | 'starting' | 'waiting' | 'connected' | 'off' | 'unsupported' | 'denied' | 'error'
  code: string
}

export interface ReminderAPI {
  phoneState(): Promise<PhoneState>
  enablePhone(enabled: boolean): Promise<PhoneState>
  pairPhone(): Promise<PhoneState>
  supportsEdgeGlow: boolean
  getSettings(): Promise<ReminderSettings>
  saveSettings(settings: ReminderSettings): Promise<void>
  test(kind: ReminderKind): Promise<void>
  openChatGPTSettings(): Promise<void>
}
