import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

function buildMacHelper(sourceName: string, name: string, frameworks: string[]): void {
  const source = join(__dirname, 'build', sourceName)
  const binary = join(__dirname, 'resources', name)
  if (existsSync(binary) && statSync(binary).mtimeMs >= statSync(source).mtimeMs) return

  const staging = mkdtempSync(join(__dirname, 'resources/.edge-glow-'))
  try {
    const output = join(staging, name)
    execFileSync('/usr/bin/clang', [
      '-arch',
      'arm64',
      '-arch',
      'x86_64',
      '-mmacosx-version-min=12.0',
      '-fobjc-arc',
      ...frameworks.flatMap((framework) => ['-framework', framework]),
      source,
      '-o',
      output
    ])
    renameSync(output, binary)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function prepareMacDevElectron(): string {
  const dist = join(dirname(require.resolve('electron/package.json')), 'dist')
  const version = readFileSync(join(dist, 'version'), 'utf8').trim()
  const icon = readFileSync(join(__dirname, 'build/icon.icns'))
  const iconHash = createHash('sha256').update(icon).digest('hex').slice(0, 16)
  const cache = join(
    __dirname,
    'node_modules/.cache/codex-reminder',
    `ble-${version}-${process.arch}-${iconHash}`
  )
  const bundle = join(cache, 'Electron.app')
  const executable = join(bundle, 'Contents/MacOS/Electron')
  if (existsSync(executable)) return executable

  // Publish the complete bundle atomically so concurrent dev sessions can share it.
  mkdirSync(cache, { recursive: true })
  const staging = mkdtempSync(join(cache, 'staging-'))
  try {
    const stagedBundle = join(staging, 'Electron.app')
    cpSync(join(dist, 'Electron.app'), stagedBundle, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE
    })
    writeFileSync(join(stagedBundle, 'Contents/Resources/electron.icns'), icon)
    execFileSync('/usr/bin/plutil', [
      '-replace',
      'CFBundleIdentifier',
      '-string',
      'com.electron.app.dev',
      join(stagedBundle, 'Contents/Info.plist')
    ])
    execFileSync('/usr/bin/plutil', [
      '-replace',
      'NSBluetoothAlwaysUsageDescription',
      '-string',
      '通过蓝牙向已配对的 iPhone 发送 Codex 状态。',
      join(stagedBundle, 'Contents/Info.plist')
    ])
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      execFileSync('/usr/bin/plutil', [
        '-replace',
        key,
        '-string',
        'Codex 提醒',
        join(stagedBundle, 'Contents/Info.plist')
      ])
    }
    try {
      renameSync(stagedBundle, bundle)
    } catch (error) {
      if (!existsSync(executable)) throw error
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  return executable
}

export default defineConfig(({ command }) => {
  if (process.platform === 'darwin') {
    buildMacHelper('edge-glow.m', 'icon-app-edge-glow', ['AppKit', 'QuartzCore'])
    buildMacHelper('iphone-bluetooth.m', 'icon-app-ble', ['Foundation', 'CoreBluetooth'])
  }
  if (command === 'serve' && process.platform === 'darwin' && !process.env.ELECTRON_EXEC_PATH) {
    process.env.ELECTRON_EXEC_PATH = prepareMacDevElectron()
  }
  return {
    main: {},
    preload: {},
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src')
        }
      },
      plugins: [react()]
    }
  }
})
