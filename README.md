# razor-chat

一个可本地运行、也可直接部署到 Vercel 的聊天 demo。

## 本地启动

```zsh
cd /Users/razor/codex/grok-demo
pnpm dev
```

启动后打开：

```text
http://127.0.0.1:3210
```

默认会监听 `0.0.0.0`，因此同一局域网内的手机也可以访问终端里打印出来的地址，例如：

```text
http://192.168.1.23:3210
```

如果你只想本机访问，可以显式指定：

```zsh
HOST=127.0.0.1 pnpm dev
```

## 项目结构

- `public/`
  Vue 3 前端静态页面
- `public/vendor/vue.global.prod.js`
  本地 vendored Vue runtime
- `public/default-connection-profiles.json`
  项目自带连接配置数据
- `api/chat.js`
  Vercel Serverless Function
- `lib/chat-api.mjs`
  本地与 Vercel 共用的 API 转发逻辑
- `server.mjs`
  本地调试服务器

## 特点

- 使用 Vue 3 管理聊天、角色、连接配置和调试面板状态
- 前端填写 `API Base URL`、`API Key`、`Model`
- 首次打开时会加载项目自带连接配置；已有浏览器本地配置时会合并新增项
- 支持两种模式：
  - `/v1/chat/completions`
  - `/v1/responses`
- 支持角色、多连接配置、本地配置记忆、调试面板

### 默认角色与调试角色

`public/default-characters.json` 分为 `default` 和 `debug` 两组：

- `default`：默认角色，始终合并到用户本地角色列表。
- `debug`：调试角色，只在 `debugEnabled` 为 `true` 时合并；设为 `false` 后，同 ID 的内置调试角色会从本地列表隐藏。

发版前按需修改：

```json
{
  "debugEnabled": false
}
```

## Vercel 部署

Vercel 官方当前文档说明：

- Node.js 函数放在 `/api` 目录即可自动部署
- `vercel.json` 可在项目根目录补充配置

参考：

- [Using the Node.js Runtime with Vercel Functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Static Configuration with vercel.json](https://vercel.com/docs/project-configuration/vercel-json)

部署方式：

1. 把整个 `grok-demo` 目录导入 Vercel
2. Build Command 留空
3. Output Directory 留默认
4. 如果需要访问密码，在 Vercel Project Settings 的 Environment Variables 里添加 `APP_PASSWORD`
5. 直接部署

### 账号访问

本地或 VPS 使用 SQLite 时，可以把账号写入 `.data/razor-chat.db` 的 `access_users` 表。站点会先显示登录页；验证成功后浏览器会收到一个 HttpOnly Cookie，后续页面与 `/api/chat` 请求才会放行。

添加或更新账号：

```zsh
pnpm access-user add admin 'your-password'
```

查看当前账号：

```zsh
pnpm access-user list
```

`access_users.id` 会作为数据归属账号，对应 `conversations.account_id`、`characters.account_id` 和 `connection_profiles.account_id`。例如 `admin` 账号的数据会写入 `account_id = 'admin'`。账号密码默认保存为 PBKDF2 哈希；如果确实要手动 SQL 插入，可以先生成哈希：

```zsh
pnpm access-user hash 'your-password'
```

然后写入 `id`、`username`、`password_hash`。不建议使用明文 `password` 字段，它只用于兼容或临时导入。

```sql
INSERT INTO access_users (id, username, password_hash)
VALUES ('admin', 'admin', '上一步生成的哈希');
```

仍然兼容旧的环境变量方式，适合 Vercel 这种没有本地 SQLite 的部署。每个 `id` 同样会对应独立的聊天记录存储：

```zsh
APP_PASSWORD='main-password' \
APP_PASSWORDS_JSON='[{"id":"guest","username":"guest","password":"guest-password"}]' \
pnpm dev
```

其中 `APP_PASSWORD` 对应默认身份 `default`，登录时账号填写 `default`。如果使用 Upstash Redis，则会使用不同的 Redis key 后缀隔离。

Vercel CLI 设置：

```zsh
vercel env add APP_PASSWORD preview --sensitive
vercel env add APP_PASSWORD production --sensitive
```

如果未设置 `APP_PASSWORD`，站点保持无密码访问，方便本地快速调试。

### 聊天记录同步

聊天记录、角色列表和连接配置会同步到服务端。VPS 部署时，如果没有配置 Upstash Redis，会自动写入 `.data/razor-chat.db`：

```text
.data/razor-chat.db
```

多账号会按账号 ID 隔离，例如 `admin` 身份会写入 SQLite 中的 `account_id = 'admin'`。

旧版 `.data/conversations*.json`、`.data/characters*.json`、`.data/profiles.json` 在首次访问时会自动迁移到 SQLite，迁移后本地存储统一走数据库。

如果配置了 Upstash Redis，会优先同步到 Redis。线上启用同步需要在 Vercel 项目里配置：

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

如果通过 Vercel Marketplace 安装 Upstash for Redis，也兼容它注入的变量：

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

可选自定义存储 key：

```text
CONVERSATIONS_STORE_KEY=grok-demo:conversations:v1
```

本地开发如果没有配置 Upstash，会自动写入 `.data/razor-chat.db`，该目录不会提交到 Git。

### 下载 VPS 数据库

如果想把 VPS 上的 SQLite 快照下载到本机，用：

```zsh
scripts/vps-db.zsh pull
```

默认会从 `my-vps-2:/home/ubuntu/apps/grok-demo/.data/razor-chat.db` 生成一致性备份，并下载到本地 `.remote-db/` 目录。每次会保留两份：

```text
.remote-db/razor-chat-backup-YYYYMMDD-HHMMSS.db
.remote-db/razor-chat.db
```

其中带时间戳的是备份，固定名 `razor-chat.db` 是后续编辑和上传用的工作库。

如果希望下载后直接在 Finder 里定位文件：

```zsh
OPEN_AFTER_PULL=1 scripts/vps-db.zsh pull
```

如果已经在本地修改完数据库，想安全回传到 VPS：

```zsh
scripts/vps-db.zsh push /absolute/path/to/edited.db
```

这个命令会先校验本地数据库完整性，然后上传到 VPS，停止 `grok-demo.service`，备份当前线上库，替换 `razor-chat.db`，清理旧的 `-wal/-shm`，最后重启服务。

首次使用如果 VPS 上还没有 `sqlite3`，先安装：

```zsh
ssh my-vps-2 "sudo apt-get update && sudo apt-get install -y sqlite3"
```

## 注意

- 这是一个 BYOK 页面，用户会在前端输入自己的 API Key
- 访问密码能阻止未授权访客打开页面或调用 `/api/chat`
- 如果部署在 Vercel 且未配置 Upstash Redis，聊天记录、角色和连接配置同步接口会提示存储未配置
- 如果把自己的 API Key 写进前端代码、静态 JSON 或浏览器存储，仍然会暴露；真正隐藏 Key 需要改为服务端环境变量读取
