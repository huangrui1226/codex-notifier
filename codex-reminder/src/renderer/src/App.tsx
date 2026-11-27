import { useEffect, useState } from 'react'
import { Icon } from './components/Icon'
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
    <>
      <header className="app-bar">
        <div className="bar-content">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="terminal" />
            </span>
            Codex 叮咚
          </div>
          {settings && (
            <span className="summary">
              <span className={'status-dot' + (anyEnabled ? ' active' : '')} />
              {phone?.status === 'connected'
                ? 'iPhone 已连接'
                : anyEnabled
                  ? '提醒已开启'
                  : '提醒已关闭'}
            </span>
          )}
        </div>
      </header>
      <main>
        <h1>提醒设置</h1>
        <p className="intro">应用运行期间接收 Codex CLI 提醒。退出应用即可暂停所有提醒。</p>
        <div className="layout">
          <section className="card" aria-labelledby="channels-heading">
            <h2 className="channels-heading" id="channels-heading">
              提醒方式
            </h2>
            {options.map(({ key, title, description }) => (
              <div className="row" key={key}>
                <span className="channel-icon">
                  <Icon name={key} />
                </span>
                <div className="row-copy">
                  <label id={key} htmlFor={key + '-switch'}>
                    {title}
                  </label>
                  <p id={key + '-description'}>{description}</p>
                </div>
                <button
                  id={key + '-switch'}
                  type="button"
                  role="switch"
                  aria-labelledby={key}
                  aria-describedby={key + '-description'}
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
          </section>
          <div className="side-cards">
            <section className="card action-card" aria-labelledby="test-heading">
              <h2 id="test-heading">测试提醒</h2>
              <p>使用当前设置预览提醒效果。</p>
              <div className="actions">
                <button
                  className="button primary"
                  disabled={busy || !anyEnabled}
                  onClick={() => test('completed')}
                >
                  <Icon name="completed" /> 测试完成
                </button>
                <button
                  className="button"
                  disabled={busy || !anyEnabled}
                  onClick={() => test('attention')}
                >
                  <Icon name="attention" /> 测试待处理
                </button>
              </div>
              <p className="feedback" role="status">
                {status || (settings && !anyEnabled ? '所有提醒均已关闭' : '')}
              </p>
            </section>
            <section className="card action-card" aria-labelledby="chat-heading">
              <h2 id="chat-heading">ChatGPT 桌面端</h2>
              <p>在 ChatGPT 的通知设置中选择提醒时机和声音。</p>
              <button
                className="button chat-link"
                onClick={() =>
                  window.api
                    .openChatGPTSettings()
                    .catch(() => setStatus('无法打开 ChatGPT。请在桌面客户端按 ⌘ , 打开设置。'))
                }
              >
                打开 ChatGPT 设置 <Icon name="external" />
              </button>
            </section>
          </div>
        </div>
      </main>
    </>
  )
}

export default App
