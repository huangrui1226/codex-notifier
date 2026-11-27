# Codex Notifier

Codex Notifier 在 Codex CLI 完成回答、等你回复或需要你授权时发出提醒。平时由 Mac 提醒；连上已配对的 iPhone 后，实际提醒和测试提醒都只发到手机。手机断开或关闭「附近的 iPhone」后，Mac 自动恢复本机提醒。

| 状态 | Mac 屏幕边缘光 | Mac 声音 | iPhone 通知 |
| --- | --- | --- | --- |
| 回答完成 | 绿色 | 两声 | 🟢 已就绪 |
| 等待回复、选择或人工授权 | 橙色 | 一声 | 🟠 等待你的输入或授权 |

## 在 Mac 上运行

准备 macOS、Node.js 22.12 或更高版本、npm 和 Xcode 命令行工具。从仓库根目录运行以下命令。

```sh
cd codex-reminder
npm ci
npm run dev
```

在「Codex 提醒」里分别设置桌面弹窗、声音和屏幕边缘光。点击「测试完成」和「测试待处理」即可预览两种提醒。关闭窗口后应用继续接收事件，按 **⌘Q** 退出会暂停 Mac 和 iPhone 提醒。退出期间的事件会被丢弃。

## 接入 Codex CLI

**1. 安装转发脚本。** 从仓库根目录执行一次。脚本会在本机核对会话记录，并把识别出的事件转发给运行中的 Mac 应用。

```sh
mkdir -p "$HOME/.codex"
install -m 700 codex-reminder/resources/notify-macos.sh "$HOME/.codex/icon-app-reminder.sh"
install -m 600 codex-reminder/resources/classify-codex-turn.py "$HOME/.codex/classify-codex-turn.py"
```

**2. 接收回答完成和等待回复事件。** 在 `~/.codex/config.toml` 顶层设置 `notify`，把示例路径换成转发脚本的实际绝对路径。如果已经配置了回调，可以在原回调中调用转发脚本，并将事件参数原样传入。

```toml
notify = ["/bin/sh", "/Users/你的用户名/.codex/icon-app-reminder.sh"]
```

转发脚本只处理主对话当前轮的最终回答。回答末尾明确要求回复、选择或确认时，脚本会按常见中英文表达识别为待处理，因此可能误判或漏判。缺少对应会话记录或最终回答标记时，脚本会跳过该事件。

**3. 接收授权和结构化提问。** 将模板中的三个 hook 条目合并到 `~/.codex/hooks.json`，保留已有条目。重新打开 Codex CLI，在 `/hooks` 中审阅并信任这三个提醒项。只有确认当前轮使用人工审批时才会发出授权提醒，自动审批期间的明确提问仍会提醒。[Hook 配置模板](codex-reminder/resources/codex-attention-hooks.json)

**4. 验证接入。** 保持 Mac 应用运行，在新的 Codex CLI 会话中发起一个简单请求，等它给出最终回答。如果应用内测试成功，但真实回答没有提醒，先核对 `notify` 的绝对路径以及两个脚本是否在同一目录。ChatGPT 普通聊天的提醒由桌面客户端自己的通知设置控制。

## 配对附近的 iPhone

1. 用 Xcode 打开 iPhone 工程，在 **Signing & Capabilities** 选择自己的开发团队。如果 Bundle ID 已被占用，换成自己的唯一标识。连接 iOS 16 或更高版本的 iPhone，按系统提示开启开发者模式，选择真机并运行。[iPhone 工程](iphone/NearbyReminders.xcodeproj)
2. 两台设备都打开蓝牙。在 Mac 应用中开启「附近的 iPhone」，允许「Codex 提醒蓝牙助手」使用蓝牙，再点「生成配对码」。六位码在五分钟内有效。
3. 在 iPhone 上点「允许通知」和「查找 Mac」，填入六位码后点选对应的 Mac。如果系统显示蓝牙配对数字，在两端核对并确认。
4. iPhone 显示「已连接，可以切换到其他 App。」后，将它切到后台，在 Mac 上各点一次测试按钮。若手机没有显示横幅，检查 iPhone 的通知权限、横幅设置和专注模式。

手机和 Mac 通过加密蓝牙连接传递一个状态字节。iPhone 会尝试重连已配对的 Mac，断开期间的提醒不会补发。配对新手机后，后续提醒发往新手机。手动从多任务界面划掉 iPhone 应用后，需重新打开才能恢复接收。[首次配对故障记录](docs/postmortems/2026-11-26-iphone-ble-pairing.md)

## 开发、测试与打包

在 `codex-reminder/` 目录运行以下命令。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Electron 开发应用 |
| `npm run lint` | 运行 ESLint |
| `python3 -B -m unittest discover -s tests` | 检查会话分类和本地事件转发 |
| `npm run build` | 运行 TypeScript 类型检查并构建桌面应用，输出到 `out/` |
| `npm run build:mac` | 生成 macOS 安装包，输出到 `dist/` |
| `npm run build:win`、`npm run build:linux` | 生成对应平台的桌面安装包 |

CLI 事件转发、屏幕边缘光和 iPhone 蓝牙连接在 macOS 上运行。Windows 和 Linux 桌面端可在应用内测试弹窗和声音。
