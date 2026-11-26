import { app, ipcMain, Notification, shell } from 'electron'
import { chmodSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ReminderKind, ReminderSettings } from '../shared/reminders'
import macNotifier from '../../resources/show-reminder.sh?asset&asarUnpack'
import cliForwarder from '../../resources/notify-macos.sh?asset&asarUnpack'
import cliClassifier from '../../resources/classify-codex-turn.py?asset&asarUnpack'

type MacEvent = 'completed' | 'reply' | 'approval' | 'input'

function updateInstalledScript(name: string, source: string, previousDigests: string[]): void {
  const hook = join(app.getPath('home'), '.codex', name)
  try {
    const digest = createHash('sha256').update(readFileSync(hook)).digest('hex')
    if (!previousDigests.includes(digest)) return
    const temp = hook + '.' + randomUUID()
    writeFileSync(temp, readFileSync(source), { mode: 0o700, flag: 'wx' })
    renameSync(temp, hook)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error('更新旧版提醒脚本失败', error)
  }
}

function listenForCliEvents(deliver: (event: MacEvent) => Promise<void>): void {
  const route = join(app.getPath('userData'), 'reminder-route')
  const endpoint = join(app.getPath('temp'), 'ir-' + randomUUID().slice(0, 12))
  let quitting = false
  const server = createServer((socket) => {
    socket.setEncoding('ascii')
    socket.setTimeout(1000, () => socket.destroy())
    socket.on('error', () => {})
    let event = ''
    socket.on('data', (chunk) => {
      event += chunk
      if (event.length > 9) socket.destroy()
    })
    socket.on('end', () => {
      if (quitting || !existsSync(macNotifier)) return
      if (event === 'completed' || event === 'reply' || event === 'approval' || event === 'input')
        deliver(event).catch((error) => console.error('发送提醒失败', error))
    })
  })
  server.on('error', (error) => console.error('无法接收 CLI 提醒', error))
  server.listen(endpoint, () => {
    if (quitting) return
    chmodSync(endpoint, 0o600)
    const temp = route + '.' + process.pid
    writeFileSync(temp, endpoint + '\n', { mode: 0o600 })
    renameSync(temp, route)
  })
  app.once('will-quit', () => {
    quitting = true
    server.close()
    rmSync(route, { force: true })
  })
}

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

export function registerReminders(sendToPhone: (kind: ReminderKind) => boolean): void {
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

  async function deliver(event: MacEvent, test = false): Promise<void> {
    const sent = sendToPhone(event === 'completed' ? 'completed' : 'attention')
    await promisify(execFile)('/bin/sh', [macNotifier, test ? '--test' : '--event', file, event])
    if (test && !sent) throw new Error('iPhone 未连接')
  }
  if (process.platform === 'darwin') {
    if (!app.commandLine.hasSwitch('user-data-dir')) {
      updateInstalledScript('classify-codex-turn.py', cliClassifier, [
        '0b73ddd4f543f5e4ffba1ccf59cb9a97d43a8fdc6691d37461ada2e5b808bd05'
      ])
      updateInstalledScript('icon-app-reminder.sh', cliForwarder, [
        '40f7f29c7392cd10283153275f23c725ef2174abc9d6039824fee464968dc23c',
        'a777c88c2394d30e625ad5e0068ba0c554bed936970652bf270732d76dbfb686',
        '4b602050fa3581b28f9e563873b946013d10f9b687488dcd1e569d18bfdd3fd3'
      ])
    }
    listenForCliEvents(deliver)
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
      await deliver(kind === 'completed' ? kind : 'input', true)
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
