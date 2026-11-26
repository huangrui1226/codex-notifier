import { app, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { PhoneState, ReminderKind } from '../shared/reminders'

export type PhoneDelivery = 'disabled' | 'unavailable' | 'sent'

export function registerPhone(): (kind: ReminderKind) => Promise<PhoneDelivery> {
  const dir = app.getPath('userData')
  const enabledFile = join(dir, 'iphone-enabled')
  let channel: Socket | undefined
  let closeSession: (() => void) | undefined
  let status: PhoneState['status'] = 'disabled'
  let code = ''
  let expires = 0

  function state(): PhoneState {
    return { enabled: existsSync(enabledFile), status, code: Date.now() < expires ? code : '' }
  }

  function stop(): void {
    const close = closeSession
    closeSession = undefined
    close?.()
    channel = undefined
    code = ''
    status = 'disabled'
  }

  function start(): void {
    if (closeSession || process.platform !== 'darwin') return
    mkdirSync(dir, { recursive: true })
    status = 'starting'
    const helperRoot = app.isPackaged
      ? join(process.resourcesPath, '../Helpers')
      : join(app.getAppPath(), 'build/generated')
    const helper = join(helperRoot, 'Codex Bluetooth Helper.app')
    // A short, private directory also fits Darwin's Unix socket path limit.
    const socketDir = mkdtempSync('/tmp/codex-ble-')
    const endpoint = join(socketDir, 'link')
    let listenerClosed = false
    const server = createServer((socket) => {
      if (closeSession !== close || channel) {
        socket.destroy()
        return
      }
      channel = socket
      clearTimeout(timer)
      closeListener()
      socket.on('error', lost)
      socket.on('close', lost)
      const reports = createInterface({ input: socket })
      reports.on('error', lost)
      reports.on('line', (line) => {
        if (channel !== socket) return
        if (line === 'code-ended') code = ''
        if (['waiting', 'connected', 'off', 'unsupported', 'denied', 'error'].includes(line))
          status = line as PhoneState['status']
      })
    })
    function closeListener(): void {
      if (listenerClosed) return
      listenerClosed = true
      if (server.listening) server.close()
      rmSync(socketDir, { recursive: true, force: true })
    }
    function close(): void {
      clearTimeout(timer)
      closeListener()
      channel?.destroy()
    }
    function lost(): void {
      if (closeSession !== close) return
      stop()
      status = 'error'
    }
    closeSession = close
    const timer = setTimeout(lost, 30000)
    server.on('error', lost)
    server.listen(endpoint, () => {
      if (closeSession !== close) return
      // LaunchServices can present the system BLE pairing sheet for this session.
      execFile(
        '/usr/bin/open',
        ['-n', helper, '--args', endpoint, join(dir, 'iphone-peer')],
        (err) => {
          if (err) lost()
        }
      )
    })
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
    if (!channel || !['waiting', 'connected'].includes(status)) throw new Error('请先启用蓝牙')
    code = String(randomInt(1000000)).padStart(6, '0')
    expires = Date.now() + 300000
    channel.write('pair ' + code + '\n')
    return state()
  })
  if (existsSync(enabledFile)) start()
  app.on('before-quit', stop)
  return async (kind) => {
    if (!existsSync(enabledFile)) return 'disabled'
    const socket = channel
    if (!socket?.writable || status !== 'connected') return 'unavailable'
    return new Promise<PhoneDelivery>((resolve) => {
      socket.write(kind + '\n', (error) => resolve(error ? 'unavailable' : 'sent'))
    })
  }
}
