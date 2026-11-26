import { app, ipcMain } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { PhoneState, ReminderKind } from '../shared/reminders'

export function registerPhone(): (kind: ReminderKind) => boolean {
  const dir = app.getPath('userData')
  const enabledFile = join(dir, 'iphone-enabled')
  let child: ChildProcessWithoutNullStreams | undefined
  let status: PhoneState['status'] = 'disabled'
  let code = ''
  let expires = 0

  function state(): PhoneState {
    return { enabled: existsSync(enabledFile), status, code: Date.now() < expires ? code : '' }
  }

  function stop(): void {
    child?.stdin.end()
    child = undefined
    code = ''
    status = 'disabled'
  }

  function start(): void {
    if (child || process.platform !== 'darwin') return
    mkdirSync(dir, { recursive: true })
    status = 'starting'
    const binary = join(
      app.getAppPath().replace(/\.asar$/, '.asar.unpacked'),
      'resources/icon-app-ble'
    )
    const proc = spawn(binary, [join(dir, 'iphone-peer')])
    child = proc
    proc.stdin.on('error', () => {})
    proc.stderr.resume()
    createInterface({ input: proc.stdout }).on('line', (line) => {
      if (child !== proc) return
      if (line === 'code-ended') code = ''
      if (['waiting', 'connected', 'off', 'unsupported', 'denied', 'error'].includes(line))
        status = line as PhoneState['status']
    })
    const lost = (): void => {
      if (child !== proc) return
      stop()
      status = 'error'
    }
    proc.on('error', lost)
    proc.on('exit', lost)
  }

  ipcMain.handle('iphone:state', state)
  ipcMain.handle('iphone:enable', (_, enabled: boolean) => {
    if (process.platform !== 'darwin' || typeof enabled !== 'boolean')
      throw new Error('不支持蓝牙提醒')
    if (enabled) {
      writeFileSync(enabledFile, '', { mode: 0o600 })
      start()
    } else {
      rmSync(enabledFile, { force: true })
      stop()
    }
    return state()
  })
  ipcMain.handle('iphone:pair', () => {
    if (!child || !['waiting', 'connected'].includes(status)) throw new Error('请先启用蓝牙')
    code = String(randomInt(1000000)).padStart(6, '0')
    expires = Date.now() + 300000
    child.stdin.write('pair ' + code + '\n')
    return state()
  })
  if (existsSync(enabledFile)) start()
  app.on('before-quit', stop)
  return (kind) => {
    if (!existsSync(enabledFile)) return true
    if (!child || status !== 'connected') return false
    child.stdin.write(kind + '\n')
    return true
  }
}
