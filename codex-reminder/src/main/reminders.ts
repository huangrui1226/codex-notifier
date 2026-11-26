import { app, ipcMain, Notification, shell } from 'electron'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ReminderSettings } from '../shared/reminders'
import macNotifier from '../../resources/notify-macos.sh?asset&asarUnpack'

function validate(value: unknown): ReminderSettings {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('popup' in value) ||
    typeof value.popup !== 'boolean' ||
    !('sound' in value) ||
    typeof value.sound !== 'boolean' ||
    ('edgeGlow' in value && typeof value.edgeGlow !== 'boolean')
  ) {
    throw new Error('提醒设置格式无效')
  }
  return {
    popup: value.popup,
    sound: value.sound,
    edgeGlow: 'edgeGlow' in value ? value.edgeGlow === true : value.popup || value.sound
  }
}

export function registerReminders(): void {
  const file = join(app.getPath('userData'), 'reminders.json')
  function read(): ReminderSettings {
    try {
      return validate(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { popup: true, sound: true, edgeGlow: true }
      throw error
    }
  }

  ipcMain.handle('reminders:read', read)
  ipcMain.handle('reminders:save', (_, value: unknown) => {
    const settings = validate(value)
    const temp = file + '.' + process.pid + '.tmp'
    writeFileSync(temp, JSON.stringify(settings), { mode: 0o600 })
    renameSync(temp, file)
  })
  ipcMain.handle('reminders:test', async (_, kind: unknown = 'completed') => {
    if (kind !== 'completed' && kind !== 'attention') throw new Error('无效的提醒类型')
    const settings = read()
    if (process.platform === 'darwin') {
      try {
        await promisify(execFile)('/bin/sh', [macNotifier, '--test', file, kind])
      } catch (error) {
        if ((error as { code?: number }).code === 2)
          throw new Error('iPhone 未连接', { cause: error })
        throw error
      }
      return
    }
    if (settings.popup) {
      if (!Notification.isSupported()) throw new Error('当前系统不支持桌面通知')
      new Notification({
        title: app.getName(),
        body: kind === 'attention' ? '等待你处理' : '回答已完成',
        silent: true
      }).show()
    }
    if (settings.sound) shell.beep()
  })
  ipcMain.handle('reminders:chatgpt-settings', () => shell.openExternal('codex://settings'))
}
