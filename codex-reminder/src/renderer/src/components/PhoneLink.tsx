import type { PhoneState } from '../../../shared/reminders'

import { Icon } from './Icon'

const labels: Record<PhoneState['status'], string> = {
  disabled: '关闭',
  starting: '蓝牙启动中',
  waiting: '等待 iPhone 连接',
  connected: 'iPhone 已连接，提醒仅发送到手机',
  off: '请开启 Mac 蓝牙',
  denied: '请在系统设置的「隐私与安全性 → 蓝牙」中允许此 App',
  unsupported: '此 Mac 不支持低功耗蓝牙外设模式',
  error: '启动失败，请关闭后重新开启'
}

export function PhoneLink({
  phone,
  update,
  report
}: {
  phone: PhoneState | null
  update: (phone: PhoneState) => void
  report: (message: string) => void
}): React.JSX.Element {
  async function change(action: Promise<PhoneState>): Promise<void> {
    try {
      update(await action)
    } catch {
      report('无法更新 iPhone 蓝牙设置。')
    }
  }
  return (
    <div className="phone-row">
      <div className="row">
        <span className="channel-icon">
          <Icon name="phone" />
        </span>
        <div className="row-copy">
          <label id="phone-label" htmlFor="phone-switch">
            附近的 iPhone
          </label>
          <p id="phone-description">
            {phone?.enabled ? labels[phone.status] : '通过蓝牙发送已就绪和待处理提醒。'}
          </p>
        </div>
        <button
          id="phone-switch"
          role="switch"
          aria-labelledby="phone-label"
          aria-describedby="phone-description"
          aria-checked={phone?.enabled ?? false}
          disabled={!phone}
          onClick={() => change(window.api.enablePhone(!phone?.enabled))}
        >
          <span />
        </button>
      </div>
      {phone?.enabled && (
        <div className="phone-pair">
          <p>
            在 iPhone 的「Codex 叮咚」中允许通知，点「查找 Mac」并输入配对码。连接期间请保持 Mac
            应用运行。
          </p>
          {phone.code && (
            <strong className="pair-code" aria-label="配对码">
              {phone.code}
            </strong>
          )}
          <button
            className="button"
            disabled={!['waiting', 'connected'].includes(phone.status)}
            onClick={() => change(window.api.pairPhone())}
          >
            {phone.code ? '重新生成配对码' : '生成配对码'}
          </button>
        </div>
      )}
    </div>
  )
}
