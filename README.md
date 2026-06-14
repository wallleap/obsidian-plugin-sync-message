# OB Sync Plugin

Obsidian 笔记同步插件，用于将服务端的消息同步到本地笔记库。

## 安装

### 手动安装

1. 下载最新版本：
   ```bash
   git clone https://github.com/your-repo/ob-sync.git
   cd obsidian-plugin
   npm install
   npm run build
   ```

2. 将以下文件复制到 Obsidian 笔记库的插件目录：
   ```
   <Vault>/.obsidian/plugins/ob-sync/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

3. 重启 Obsidian，在设置中启用插件

### 从社区市场安装

（待发布到社区市场后可用）

## 配置

在 Obsidian 设置中找到 "OB Sync" 选项：

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
# 2024-01-15

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
- npm

### 开发模式

```bash
npm install
npm run dev
```

监听文件变化自动编译。

### 构建

```bash
npm run build
```

### 代码检查

```bash
npm run lint
```

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
3. 查看 Obsidian 控制台错误信息

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
