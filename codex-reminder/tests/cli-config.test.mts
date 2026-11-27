import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser'
import template from '../resources/codex-attention-hooks.json' with { type: 'json' }
import { mergeHooks, mergeNotify, updateCliConfig } from '../src/main/cli-config.mts'

function workspace(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'codex config-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('fresh setup targets the root table and preserves profile settings and comments', (t) => {
  const directory = workspace(t)
  const config = join(directory, 'config.toml')
  const hooks = join(directory, 'hooks.json')
  const forwarder = join(directory, 'forward.sh')
  const original = '# settings\r\n[profiles.work]\r\nnotify = ["other"]\r\n'
  writeFileSync(config, original)
  const setup = (): void => {
    updateCliConfig(config, '', (text) => mergeNotify(text, forwarder))
    updateCliConfig(hooks, '{}\n', mergeHooks)
  }
  setup()
  const content = readFileSync(config, 'utf8')
  assert.ok(content.endsWith('\r\n' + original))
  assert.deepEqual(getStaticTOMLValue(parseTOML(content)).notify, ['/bin/sh', forwarder])
  assert.deepEqual(JSON.parse(readFileSync(hooks, 'utf8')), template)
  const stats = [config, hooks].map((file) => statSync(file).ino)
  setup()
  assert.deepEqual(
    [config, hooks].map((file) => statSync(file).ino),
    stats
  )
  assert.equal(statSync(hooks).mode & 0o777, 0o600)
})

test('an existing callback receives its original argv, JSON event and stdin even if the reminder fails', (t) => {
  const directory = workspace(t)
  const forwarder = join(directory, 'forward $ test.sh')
  const eventFile = join(directory, 'event')
  writeFileSync(forwarder, 'printf %s "$1" > "$EVENT_FILE"\ncat >/dev/null\nexit 1\n')
  const originalArgs = [
    process.execPath,
    '-e',
    'process.stdout.write(JSON.stringify([process.argv.slice(1), require("fs").readFileSync(0,"utf8")]))',
    '--',
    'a b',
    '$HOME',
    "'",
    ''
  ]
  const source =
    '"notify" = [ # existing command\n' +
    originalArgs.map((arg) => JSON.stringify(arg)).join(',\n') +
    ',\n]\n'
  const updated = mergeNotify(source, forwarder)
  assert.ok(updated.endsWith(source.slice(source.indexOf('[') + 1)))
  assert.equal(mergeNotify(updated, forwarder), updated)
  const command = getStaticTOMLValue(parseTOML(updated)).notify
  assert.ok(Array.isArray(command) && command.every((arg) => typeof arg === 'string'))
  const [program, ...args] = command
  const event = JSON.stringify({ text: 'spaces, quotes, $() and a\nnewline' })
  const run = spawnSync(program, [...args, event], {
    input: 'original stdin',
    encoding: 'utf8',
    env: { ...process.env, EVENT_FILE: eventFile }
  })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), [[...originalArgs.slice(4), event], 'original stdin'])
  assert.equal(readFileSync(eventFile, 'utf8'), event)
})

test('an existing direct integration is kept, and an empty notify can be filled', () => {
  const existing = "notify = [ '/bin/sh', '/forward' ] # mine\n"
  assert.equal(mergeNotify(existing, '/forward'), existing)
  assert.deepEqual(getStaticTOMLValue(parseTOML(mergeNotify('notify = [ ]', '/forward'))).notify, [
    '/bin/sh',
    '/forward'
  ])
})

test('hooks merge preserves custom groups, options, large integers and partially installed handlers', () => {
  const custom = { type: 'command', command: 'my-command' }
  const manual = template.hooks.PreToolUse[0]
  const mixed = { ...manual, hooks: [custom, { ...manual.hooks[0], timeout: 12 }] }
  const existing = {
    version: 'INTEGER',
    hooks: {
      PreToolUse: [mixed],
      Stop: [{ hooks: [custom] }],
      PermissionRequest: [{ hooks: [custom] }]
    }
  }
  const updated = mergeHooks(JSON.stringify(existing).replace('"INTEGER"', '9007199254740993'))
  assert.ok(updated.includes('9007199254740993'))
  assert.deepEqual(JSON.parse(updated).hooks, {
    PreToolUse: [mixed, template.hooks.PreToolUse[1]],
    Stop: existing.hooks.Stop,
    PermissionRequest: [...existing.hooks.PermissionRequest, ...template.hooks.PermissionRequest]
  })
  assert.equal(mergeHooks(updated), updated)
})

test('malformed files and incompatible configuration shapes survive a failed merge', (t) => {
  const file = join(workspace(t), 'config')
  for (const [original, merge] of [
    ['notify = [', mergeNotify],
    ['notify = "mine"', mergeNotify],
    ['[notify]\nname="mine"', mergeNotify],
    ['{', mergeHooks],
    ['{"hooks":null}', mergeHooks],
    ['{"hooks":{"PreToolUse":{}}}', mergeHooks]
  ] as const) {
    writeFileSync(file, original)
    assert.throws(() => updateCliConfig(file, '', (text) => merge(text, '/forward')))
    assert.equal(readFileSync(file, 'utf8'), original)
  }
})

test('symlink, permissions and concurrent edits are preserved', (t) => {
  const directory = workspace(t)
  const file = join(directory, 'config.toml')
  const target = join(directory, 'dotfile')
  writeFileSync(target, '# mine\n', { mode: 0o640 })
  symlinkSync(target, file)
  updateCliConfig(file, '', (text) => mergeNotify(text, '/forward'))
  assert.ok(lstatSync(file).isSymbolicLink())
  assert.equal(statSync(target).mode & 0o777, 0o640)
  assert.throws(() =>
    updateCliConfig(file, '', () => {
      writeFileSync(target, '# changed concurrently')
      return '# stale'
    })
  )
  assert.equal(readFileSync(target, 'utf8'), '# changed concurrently')
})
