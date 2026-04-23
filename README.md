# Grok Reasoning Demo

一个最小可用的本地调试 demo，用来验证 `grok-4.20-0309-reasoning` 这类模型是否真的返回了正文。

## 启动

```zsh
cd /Users/razor/codex/news-data/grok-demo
node server.mjs
```

启动后打开：

```text
http://127.0.0.1:3210
```

## 特点

- 不依赖第三方 npm 包
- 前端填写 `API Base URL`、`API Key`、`Model`
- 支持两种模式：
  - `/v1/chat/completions`
  - `/v1/responses`
- 同时显示：
  - 最终回答
  - 思考内容
  - 调试信息
  - 原始响应 JSON

## 适用场景

当某个客户端显示“有思考但没正文”时，可以用这个 demo 直接验证：

1. 上游接口到底有没有返回最终答案
2. 返回 JSON 的具体结构是什么
3. 是模型问题、供应商兼容问题，还是客户端显示问题
