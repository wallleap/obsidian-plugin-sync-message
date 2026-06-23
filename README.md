# OB Sync Plugin

Obsidian 笔记同步插件，用于将服务端的消息同步到本地笔记库。

**项目地址**：[https://github.com/wallleap/obsidian-plugin-sync-message](https://github.com/wallleap/obsidian-plugin-sync-message)

**注意**：本插件不会发布到 Obsidian 社区市场，请通过以下方式安装。

## 安装

### 方式一：从 GitHub Releases 下载（推荐）

1. 访问 [GitHub Releases](https://github.com/wallleap/obsidian-plugin-sync-message/releases) 页面

2. 下载最新版本的 `main.js`、`manifest.json` 和 `styles.css` 文件

3. 在 Obsidian 笔记库中创建插件目录：
   ```
   <Vault>/.obsidian/plugins/ob-sync/
   ```

4. 将下载的三个文件复制到该目录

5. 重启 Obsidian，在设置中启用插件

### 方式二：从源码构建

1. 克隆仓库：
   ```bash
   git clone https://github.com/wallleap/obsidian-plugin-sync-message.git
   cd obsidian-plugin-sync-message/obsidian-plugin
   npm install
   npm run build
   ```

2. 将构建产物复制到插件目录：
   ```bash
   cp main.js <Vault>/.obsidian/plugins/ob-sync/
   cp manifest.json <Vault>/.obsidian/plugins/ob-sync/
   cp styles.css <Vault>/.obsidian/plugins/ob-sync/
   ```

3. 重启 Obsidian，在设置中启用插件

## 配置

在 Obsidian 设置中找到 "OB Sync" 选项：

### 插件更新

插件支持自动更新检测：

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| **Auto update** | 启动时自动检查更新 | `true` |

**手动检查更新**：

1. **设置页面**：在插件设置中点击 "Check" 按钮
2. **命令面板**：使用 `Ctrl/Cmd + P` 打开命令面板，搜索 "Check for updates"

**更新流程**：

1. 点击检查更新按钮后，插件会自动检测 GitHub 上的最新版本
2. 如果检测到新版本，会自动下载并安装
3. 安装完成后，提示重启 Obsidian 完成更新

### 基础设置

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| **Server URL** | 服务端地址 | `http://localhost:8080` |
| **User ID** | 用户唯一标识 | 空（需填写） |
| **Save Folder** | 笔记保存文件夹 | `ObSync` |
| **Attachment Folder** | 附件子文件夹 | `ObSync/attachments` |
| **Image Folder** | 图片子文件夹 | `ObSync/images` |

### 模板设置

| 设置项 | 说明 |
|--------|------|
| **Time Format** | 时间格式，如 `YYYY-MM-DD HH:mm:ss` |
| **Title Template** | 标题模板，支持变量 `{{title}}`、`{{date}}`、`{{time}}` |
| **Frontmatter Template** | YAML 前言模板 |

### Frontmatter 模板变量

支持以下变量：

- `{{title}}` - 文章标题
- `{{created_at}}` - 创建时间
- `{{url}}` - 原始 URL
- `{{date}}` - 日期
- `{{time}}` - 时间

默认模板：
```yaml
title: {{title}}
date: {{created_at}}
updated: {{created_at}}
image-auto-upload: true
source: {{url}}
```

## 使用方法

### 同步消息

三种方式触发同步：

1. **侧边栏图标**：点击左侧边栏的同步图标
2. **命令面板**：使用 `Ctrl/Cmd + P` 打开命令面板，搜索 "Sync messages"
3. **设置页面**：在插件设置中点击 "Sync now" 按钮

### 消息类型处理

#### 文本消息

文本消息会按日期归档到对应的 Markdown 文件：

```
ObSync/
└── 2024-01-15.md    # 当天的文本消息
```

文件格式：
```markdown
## 14:30:00

这是发送的文本内容...
```

#### URL 消息

URL 消息会创建独立的 Markdown 文件：

```
ObSync/
└── 文章标题.md
```

文件格式：
```markdown
---
title: 文章标题
date: 2024-01-15 14:30:00
source: https://example.com/article
---

文章内容...
```

#### 附件消息

附件会下载到指定文件夹，并在 `attachments.md` 中记录：

```
ObSync/
├── attachments/
│   └── document.pdf
└── attachments.md
```

## 命令

| 命令 | 说明 |
|------|------|
| `OB Sync: Sync messages` | 同步消息 |
| `OB Sync: Open settings` | 打开设置页面 |
| `OB Sync: Check for updates` | 检查插件更新 |
| `OB Sync: Download and install update` | 下载并安装更新 |

## 项目结构

```
obsidian-plugin/
├── src/
│   ├── main.ts           # 插件入口
│   └── settings.ts       # 设置管理
├── manifest.json         # 插件清单
├── styles.css            # 样式文件
├── package.json          # 项目配置
├── tsconfig.json         # TypeScript 配置
└── esbuild.config.mjs    # 构建配置
```

## 开发

### 环境要求

- Node.js 18+
- npm 或 yarn

### 开发流程

1. **克隆仓库**：
   ```bash
   git clone https://github.com/wallleap/obsidian-plugin-sync-message.git
   cd obsidian-plugin-sync-message/obsidian-plugin
   ```

2. **安装依赖**：
   ```bash
   npm install
   ```

3. **开发模式**：
   ```bash
   npm run dev
   ```
   监听文件变化自动编译，构建产物输出到 `dist/` 目录。

4. **链接到 Obsidian**（开发调试用）：
   ```bash
   # 创建符号链接
   ln -s /path/to/obsidian-plugin/main.js /path/to/vault/.obsidian/plugins/ob-sync/main.js
   ln -s /path/to/obsidian-plugin/manifest.json /path/to/vault/.obsidian/plugins/ob-sync/manifest.json
   ln -s /path/to/obsidian-plugin/styles.css /path/to/vault/.obsidian/plugins/ob-sync/styles.css
   ```

5. **调试插件**：
   - 打开 Obsidian 并启用插件
   - 打开开发者工具：`Ctrl+Shift+I`（Windows/Linux）或 `Cmd+Option+I`（Mac）
   - 在 Console 面板中查看日志（需勾选 Verbose 级别）

### 构建命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式，监听文件变化自动编译 |
| `npm run build` | 生产构建，输出到 `dist/` 目录 |
| `npm run lint` | ESLint 代码检查 |
| `npm run lint -- --fix` | ESLint 自动修复 |

### 项目结构

```
obsidian-plugin/
├── src/
│   ├── main.ts           # 插件入口，注册命令和事件
│   └── settings.ts       # 设置页面和配置管理
├── dist/                 # 构建产物（自动生成）
│   └── main.js
├── manifest.json         # 插件清单（版本号、名称、描述等）
├── styles.css            # 插件样式
├── package.json          # 项目依赖和脚本
├── tsconfig.json         # TypeScript 配置
└── esbuild.config.mjs    # esbuild 构建配置
```

### 发布新版本

1. 更新 `manifest.json` 中的版本号（可省略）
2. 创建 GitHub Release，Tag 命名格式为 `vX.X.X`（如 `v1.0.0`）`git tag v1.0.0`
3. 提交并推送代码到 GitHub `git push origin v1.0.0`
4. 插件会自动检测并提示更新

## 数据存储

插件使用 Obsidian 的数据存储 API 保存设置：

- 用户 ID
- 服务器地址
- 上次同步时间
- 上次同步消息 ID

## 注意事项

1. **首次使用**：需要先在 Web 前端生成用户 ID，然后填入插件设置
2. **网络要求**：需要能访问服务端地址
3. **文件冲突**：同名文件会被覆盖，请注意备份
4. **增量同步**：基于时间戳，避免重复下载

## 故障排除

### 同步失败

1. 检查服务器地址是否正确
2. 检查用户 ID 是否有效
3. 查看 Obsidian 控制台错误信息（需勾选 Verbose 级别）

### 文件未创建

1. 检查保存文件夹是否有写入权限
2. 检查文件名是否包含非法字符

## 更新日志

### v1.0.0

- 初始版本
- 支持文本、URL、附件同步
- 支持自定义模板
- 增量同步机制

## 许可证

MIT License
