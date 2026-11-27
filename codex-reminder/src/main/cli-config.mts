import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  linkSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { applyEdits, modify } from 'jsonc-parser'
import { parseTOML } from 'toml-eslint-parser'
import template from '../../resources/codex-attention-hooks.json' with { type: 'json' }

// Codex appends the event as the last argument. Keep the original argv intact for exec.
const dispatch = 'for event do :; done; /bin/sh "$0" "$event" </dev/null; exec "$@"'

export function mergeNotify(text: string, forwarder: string): string {
  const entries = parseTOML(text).body[0].body
  const entry = entries.find(({ key }) => {
    const first = key.keys[0]
    return (first.type === 'TOMLBare' ? first.name : first.value) === 'notify'
  })
  const direct = ['/bin/sh', forwarder]
  if (!entry) {
    const newline = text.includes('\r\n') ? '\r\n' : '\n'
    return 'notify = ' + JSON.stringify(direct) + newline + text
  }
  if (
    entry.type !== 'TOMLKeyValue' ||
    entry.key.keys.length !== 1 ||
    entry.value.type !== 'TOMLArray'
  )
    throw new Error('顶层 notify 应为命令参数数组。')
  const args = entry.value.elements.map((item) => {
    if (item.type !== 'TOMLValue' || item.kind !== 'string')
      throw new Error('notify 的参数应为字符串。')
    return item.value
  })
  const chain = ['/bin/sh', '-c', dispatch, forwarder]
  if (
    chain.every((arg, index) => args[index] === arg) ||
    (args.length === 1 && args[0] === forwarder) ||
    (args.length === 2 && ['sh', '/bin/sh'].includes(args[0]) && args[1] === forwarder)
  )
    return text

  const start = entry.value.range[0] + 1
  const prefix = args.length
    ? JSON.stringify(chain).slice(1, -1) + ', '
    : JSON.stringify(direct).slice(1, -1)
  return text.slice(0, start) + prefix + text.slice(start)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mergeHooks(text: string): string {
  const config: unknown = JSON.parse(text)
  if (!isObject(config) || ('hooks' in config && !isObject(config.hooks)))
    throw new Error('hooks 配置应为 JSON 对象。')
  const hooks = isObject(config.hooks) ? config.hooks : {}
  for (const [event, groups] of Object.entries(template.hooks)) {
    const existing = event in hooks ? hooks[event] : []
    if (!Array.isArray(existing)) throw new Error(event + ' 应为数组。')
    for (const group of groups) {
      const matcher = 'matcher' in group ? group.matcher : undefined
      const present = existing.some(
        (item) =>
          isObject(item) &&
          item.matcher === matcher &&
          Array.isArray(item.hooks) &&
          item.hooks.some(
            (hook: unknown) =>
              isObject(hook) && hook.type === 'command' && hook.command === group.hooks[0].command
          )
      )
      if (!present) {
        text = applyEdits(
          text,
          modify(text, ['hooks', event, -1], group, {
            formattingOptions: { insertSpaces: true, tabSize: 2 }
          })
        )
      }
    }
  }
  return text
}

export function updateCliConfig(
  file: string,
  initial: string,
  merge: (text: string) => string
): void {
  // Edit the target of a dotfile symlink so the link itself survives installation.
  const target = lstatSync(file, { throwIfNoEntry: false }) ? realpathSync(file) : file
  const before = statSync(target, { bigint: true, throwIfNoEntry: false })
  if (before && !before.isFile()) throw new Error('配置路径应指向普通文件。')
  const original = before ? readFileSync(target, 'utf8') : initial
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : ''
  const updated = bom + merge(original.slice(bom.length))
  if (before && updated === original) return

  const temp = target + '.' + randomUUID()
  try {
    writeFileSync(temp, updated, { flag: 'wx', mode: 0o600 })
    if (before) {
      chmodSync(temp, Number(before.mode & 0o777n))
      const current = statSync(target, { bigint: true })
      if (
        current.ino !== before.ino ||
        current.ctimeNs !== before.ctimeNs ||
        realpathSync(file) !== target
      )
        throw new Error('配置已被其他程序修改，请重新打开应用。')
      renameSync(temp, target)
    } else {
      linkSync(temp, target)
    }
  } finally {
    rmSync(temp, { force: true })
  }
}
