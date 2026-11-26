import { useEffect, useState } from 'react'
import { PhoneLink } from './components/PhoneLink'
import type { PhoneState, ReminderKind, ReminderSettings } from '../../shared/reminders'

const options: { key: keyof ReminderSettings; title: string; description: string }[] = [
  { key: 'popup', title: '桌面弹窗', description: '在通知中心显示完成或待处理提醒。' },
  { key: 'sound', title: '声音提醒', description: '回答完成时响两声，需要你处理时响一声。' }
]
if (window.api.supportsEdgeGlow) {
  options.push({
    key: 'edgeGlow',
    title: '屏幕边缘警示光',
    description: '绿色表示回答完成，橙色表示需要你回答、选择或授权。'
  })
}

function hasEnabledReminder(settings: ReminderSettings | null): boolean {
  return options.some(({ key }) => settings?.[key])
}

function App(): React.JSX.Element {
  const [settings, setSettings] = useState<ReminderSettings | null>(null)
  const [phone, setPhone] = useState<PhoneState | null>(null)
  const anyEnabled = hasEnabledReminder(settings) || !!phone?.enabled
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    window.api
      .getSettings()
      .then(setSettings)
      .catch(() => setStatus('无法读取提醒设置，请重新打开应用。'))
  }, [])

  useEffect(() => {
    if (!window.api.supportsEdgeGlow) return
    let active = true
    const refresh = (): void => {
      window.api
        .phoneState()
        .then((value) => {
          if (active) setPhone(value)
        })
        .catch(() => {
          if (active) setStatus('无法读取 iPhone 连接状态。')
        })
    }
    refresh()
    const timer = setInterval(refresh, 1500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  async function toggle(key: keyof ReminderSettings): Promise<void> {
    if (!settings || busy) return
    setBusy(true)
    const next = { ...settings, [key]: !settings[key] }
    try {
      await window.api.saveSettings(next)
      setSettings(next)
      setStatus(hasEnabledReminder(next) ? '设置已保存' : '')
    } catch {
      setStatus('保存失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  async function test(kind: ReminderKind): Promise<void> {
    setBusy(true)
    setStatus('正在发送测试提醒…')
    try {
      await window.api.test(kind)
      setStatus(kind === 'completed' ? '已发送完成提醒' : '已发送待处理提醒')
    } catch (error) {
      setStatus(
        String(error).includes('iPhone 未连接')
          ? 'iPhone 未连接，请检查配对和蓝牙距离。'
          : '测试失败，请检查提醒权限和设备连接。'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <h1>回答完成提醒</h1>
      <p className="intro">应用运行期间接收 Codex CLI 提醒。退出应用即可暂停所有提醒。</p>
      <section className="settings" aria-label="Codex CLI 提醒方式">
        {options.map(({ key, title, description }) => (
          <div className="row" key={key}>
            <div>
              <label id={key} htmlFor={key + '-switch'}>
                {title}
              </label>
              <p>{description}</p>
            </div>
            <button
              id={key + '-switch'}
              type="button"
              role="switch"
              aria-labelledby={key}
              aria-checked={settings?.[key] ?? false}
              disabled={!settings || busy}
              onClick={() => toggle(key)}
            >
              <span />
            </button>
          </div>
        ))}
        {window.api.supportsEdgeGlow && (
          <PhoneLink phone={phone} update={setPhone} report={setStatus} />
        )}
        <div className="test-row">
          <button
            className="primary"
            disabled={busy || !anyEnabled}
            onClick={() => test('completed')}
          >
            测试完成
          </button>
          <button
            className="attention-test"
            disabled={busy || !anyEnabled}
            onClick={() => test('attention')}
          >
            测试待处理
          </button>
          <span role="status">{status || (settings && !anyEnabled ? '所有提醒均已关闭' : '')}</span>
        </div>
      </section>
      <section className="chat">
        <div>
          <h2>ChatGPT 桌面端</h2>
          <p>在 ChatGPT 的通知设置中选择提醒时机和声音。</p>
        </div>
        <button
          className="link"
          onClick={() =>
            window.api
              .openChatGPTSettings()
              .catch(() => setStatus('无法打开 ChatGPT。请在桌面客户端按 ⌘ , 打开设置。'))
          }
        >
          打开 ChatGPT 设置 <span aria-hidden="true">↗</span>
        </button>
      </section>
    </main>
  )
}

export default App
