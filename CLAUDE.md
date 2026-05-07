# Project Agent Guide

## Collaboration

- Respond in Chinese unless the user asks for another language.
- Keep engineering guidance concise, practical, and tied to this repository.
- When changing code, briefly explain the key changes and run a relevant check when possible.
- Preserve user changes in the working tree. Do not revert unrelated edits.

## Project Overview

This is a lightweight razor-chat demo that runs locally with Node.js and can deploy directly to Vercel.

- `public/`: static frontend files.
- `public/index.html`: page structure.
- `public/styles.css`: UI styling.
- `public/app.js`: Vue 3 app state, settings, characters, conversations, and chat interactions.
- `public/vendor/vue.global.prod.js`: vendored Vue runtime used by the static page.
- `public/default-characters.json`: built-in character presets.
- `server.mjs`: local Node.js development server.
- `api/chat.js`: Vercel Serverless Function entry.
- `lib/chat-api.mjs`: shared API forwarding and response-normalization logic.
- `vercel.json`: Vercel function configuration.

## Runtime And Tooling

- Prefer `zsh` commands on macOS.
- Prefer `pnpm` for package scripts.
- This project uses Vue 3, vendored into `public/vendor/` for static deployment.
- The main local command is:

```zsh
pnpm dev
```

- Local development defaults to:

```text
http://127.0.0.1:3210
```

- `server.mjs` listens on `0.0.0.0` by default for LAN access. Use `HOST=127.0.0.1 pnpm dev` when only local access is wanted.

## Architecture Notes

- Keep provider/API forwarding behavior in `lib/chat-api.mjs` so local development and Vercel deployment stay consistent.
- `api/chat.js` should remain a thin Vercel adapter around `handleChatPayload`.
- `server.mjs` should remain a thin local server for static assets and `/api/chat`.
- The app is BYOK: API base URL, API key, model, mode, and prompts are entered client-side.
- Avoid logging or persisting API keys outside the browser's existing local configuration behavior.

## Frontend Conventions

- The frontend is Vue 3 without a build step. Keep stateful UI in Vue data/computed/methods instead of manual DOM rendering.
- Keep UI text in Chinese by default.
- Match the existing compact chat-app layout, dark theme, and panel/modal interaction patterns.
- Prefer small, focused Vue methods and computed properties over direct DOM mutation.
- Keep localStorage key migrations deliberate because users may already have saved settings, characters, and conversations.
- When adding controls, wire accessibility attributes consistently with existing toolbar and panel buttons.

## API Behavior

- Support both API modes:
  - `chat_completions`: forwards to `/v1/chat/completions`.
  - `responses`: forwards to `/v1/responses`.
- Normalize base URLs through `normalizeBaseUrl` before composing endpoints.
- Keep response extraction tolerant of provider shape differences, especially answer and reasoning fields.
- Return structured error payloads that are useful in the debug panel.

## Verification

- For server/API changes, run:

```zsh
pnpm dev
```

Then check the page and `/api/chat` behavior manually with valid BYOK settings when available.

- For syntax-level checks without starting the server, use:

```zsh
node --check server.mjs
node --check api/chat.js
node --check lib/chat-api.mjs
node --check public/app.js
```

- For UI changes, test at desktop and narrow mobile widths. Pay attention to panel overlays, composer height, scrolling, and text overflow.

## Deployment Notes

- Vercel can deploy this repo directly.
- There is no build command.
- Keep `api/chat.js` compatible with Vercel's function runtime.
- Keep static assets under `public/`.
