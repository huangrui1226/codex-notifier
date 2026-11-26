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
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

function prepareMacDevElectron(): string {
  const dist = join(dirname(require.resolve('electron/package.json')), 'dist')
  const version = readFileSync(join(dist, 'version'), 'utf8').trim()
  const icon = readFileSync(join(__dirname, 'build/icon.icns'))
  const iconHash = createHash('sha256').update(icon).digest('hex').slice(0, 16)
  const cache = join(
    __dirname,
    'node_modules/.cache/icon-app',
    `${version}-${process.arch}-${iconHash}`
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
