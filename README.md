# Grok Chat Demo

一个可本地运行、也可直接部署到 Vercel 的聊天 demo。

## 本地启动

```zsh
cd /Users/razor/codex/news-data/grok-demo
node server.mjs
```

启动后打开：

```text
http://127.0.0.1:3210
```

## 项目结构

- `public/`
  前端静态页面
- `api/chat.js`
  Vercel Serverless Function
- `lib/chat-api.mjs`
  本地与 Vercel 共用的 API 转发逻辑
- `server.mjs`
  本地调试服务器

## 特点

- 不依赖第三方 npm 包
- 前端填写 `API Base URL`、`API Key`、`Model`
- 支持两种模式：
  - `/v1/chat/completions`
  - `/v1/responses`
- 支持角色、本地配置记忆、调试面板

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
4. 直接部署

## 注意

- 这是一个 BYOK 页面，用户会在前端输入自己的 API Key
- 如果要公开给别人用，建议加密码保护或访问控制
