# Codex Notifier

当 Codex CLI 完成任务或需要你输入、授权时，Codex Notifier 会在 Mac 或已连接的 iPhone 上提醒你。

| 项目 | 入口 |
| --- | --- |
| 桌面应用 | [codex-reminder/](codex-reminder/) |
| iPhone 接收端 | [iphone/](iphone/) · [Xcode 工程](iphone/NearbyReminders.xcodeproj) |

打开应用可以分别开启弹窗、声音和 macOS 屏幕边缘光。「测试完成」预览绿色，「测试待处理」预览橙色。两种光效都向屏幕中心渐隐，每次提醒亮起、熄灭两次，共约 3.8 秒。

Codex CLI 的 `notify` 回调通过 `/bin/sh` 调用 `codex-reminder/resources/notify-macos.sh`。脚本在本地核对会话记录，只有回调对应主对话当前轮的最终回答才显示绿色。如果回答末尾明确要求回复、选择或确认，则按中英文常见表达识别并显示橙色。自然语言识别可能遗漏或误判。缺少会话记录或最终回答标记时会跳过这次回调。

授权和结构化提问通过 [Codex hooks](https://learn.chatgpt.com/docs/hooks) 触发。将 `codex-reminder/resources/codex-attention-hooks.json` 中的条目合并到用户级 `~/.codex/hooks.json`，再在 Codex CLI 的 `/hooks` 中审阅并信任这三个提醒项。授权请求只有在能确认当前轮使用人工审批时才会触发橙光。选择「帮我批准」后，自动审批会静默处理，Codex 明确向你提问时仍会提醒。

本机 hooks 调用 `~/.codex/icon-app-reminder.sh`。该脚本只向正在运行的 Mac 应用转发事件。关闭窗口后应用仍可接收提醒，按 **⌘Q** 退出即可暂停桌面和 iPhone 的所有新提醒，重新打开应用会恢复。退出期间的事件会被丢弃。删除应用后，即使 CLI 仍保留回调也不会触发提醒。ChatGPT 普通聊天使用桌面客户端自己的通知设置。

新版 Mac 应用首次运行时会更新本项目的原版旧脚本。如果需要手动安装或更新，从仓库根目录运行以下命令，然后通过 Codex CLI 的 `notify` 或已有回调调用 `/bin/sh "$HOME/.codex/icon-app-reminder.sh"`，将事件参数原样传入。

```sh
install -m 700 codex-reminder/resources/notify-macos.sh ~/.codex/icon-app-reminder.sh
install -m 600 codex-reminder/resources/classify-codex-turn.py ~/.codex/classify-codex-turn.py
```

## iPhone 蓝牙提醒

两台设备打开蓝牙。Mac 应用保持运行，允许在后台接收提醒的 iPhone App 会在切换到其他 App 后通过系统横幅显示「已就绪」或「等待你的输入或授权」。手机和 Mac 之间通过系统加密蓝牙连接传递一个状态字节。首次配对还需输入 Mac 上的六位码，有效期五分钟。

1. 用 Xcode 打开 [NearbyReminders.xcodeproj](iphone/NearbyReminders.xcodeproj)，在 Signing & Capabilities 选择自己的开发团队。连接 iPhone（iOS 16 或更新版本），在 Xcode 选择这台设备并运行；按系统提示开启开发者模式。如果 bundle ID 已被占用，改成自己的唯一标识。
2. 在 Mac 的「Codex 提醒」中打开「附近的 iPhone」。首次出现权限提示时，允许「Codex 提醒蓝牙助手」使用蓝牙，再点「生成配对码」。
3. 在 iPhone 打开「Codex 提醒」，点「允许通知」及「查找 Mac」，填入六位码并选择附近的 Mac。按系统提示确认蓝牙配对。下次启动会自动重连之前配对的 Mac。
4. 保持两台设备在蓝牙范围内，在手机切换到其他 App 后，从 Mac 点击「测试完成」和「测试待处理」。iPhone 通知设置里的横幅和专注模式控制实际展示。配对新手机后只有新手机会收到事件。

iPhone 已连接时，实际提醒和测试提醒都只发送到手机。手机断开或关闭蓝牙提醒后，Mac 自动按已保存的弹窗、声音和屏幕边缘光设置提醒。离线期间的手机提醒不补发。手动从多任务界面划掉 iPhone App 后，需重新打开它恢复接收。

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

桌面项目的以下命令均在 `codex-reminder/` 内运行。

### Install

```bash
cd codex-reminder
npm install
```

### Development

```bash
$ npm run dev
```

### 更换 macOS Dock 图标

用透明背景的 PNG 替换 `build/logo.png`，尽量裁掉素材四周多余的透明区域。在安装了 Xcode 命令行工具的 Mac 上运行：

```bash
npm run icon:mac
```

脚本将 Logo 等比居中，添加白色圆角底和统一留白，并生成包含 16 至 1024 像素图像的 `build/icon.icns`。也可以用 `npm run icon:mac -- "./新图标.png"` 指定输入文件。重启开发应用即可查看效果，发布时重新运行 `npm run build:mac`。

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
