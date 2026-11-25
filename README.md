# icon-app

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
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
