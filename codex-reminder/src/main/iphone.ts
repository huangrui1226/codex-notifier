import { app, ipcMain } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomInt, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { PhoneState } from '../shared/reminders'

export function registerPhone(): void {
  const dir = app.getPath('userData')
  const enabledFile = join(dir, 'iphone-enabled')
  const route = join(dir, 'iphone-route')
  let child: ChildProcessWithoutNullStreams | undefined
  let server: Server | undefined
  let socketPath = ''
  let status: PhoneState['status'] = 'disabled'
  let code = ''
  let expires = 0

  function state(): PhoneState {
    return { enabled: existsSync(enabledFile), status, code: Date.now() < expires ? code : '' }
  }

  function stop(): void {
    if (socketPath && existsSync(route) && readFileSync(route, 'utf8') === socketPath) rmSync(route)
    server?.close()
    server = undefined
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
    // Only a local Unix socket is exposed. Each running copy owns its own socket.
    socketPath = join(app.getPath('temp'), 'ir-' + randomUUID().slice(0, 12))
    const path = socketPath
    server = createServer({ allowHalfOpen: true }, (socket) => {
      socket.setEncoding('utf8')
      socket.setTimeout(1000, () => socket.destroy())
      socket.on('error', () => {})
      let input = ''
      socket.on('data', (part) => {
        input += part
        if (input.length > 12) socket.destroy()
      })
      socket.on('end', () => {
        const kind = input.trim()
        const ready =
          child === proc && status === 'connected' && (kind === 'completed' || kind === 'attention')
        if (ready) proc.stdin.write(kind + '\n')
        socket.end(ready ? 'ok' : 'offline')
      })
    })
    server.on('error', lost)
    server.listen(path, () => {
      if (child !== proc) return
      chmodSync(path, 0o600)
      const temp = route + '.' + process.pid
      writeFileSync(temp, path, { mode: 0o600 })
      renameSync(temp, route)
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
    if (!child || !['waiting', 'connected'].includes(status)) throw new Error('请先启用蓝牙')
    code = String(randomInt(1000000)).padStart(6, '0')
    expires = Date.now() + 300000
    child.stdin.write('pair ' + code + '\n')
    return state()
  })
  if (existsSync(enabledFile)) start()
  app.on('before-quit', stop)
}
