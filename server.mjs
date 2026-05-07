import http from 'node:http';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authEndpoint from './api/auth.js';
import chatEndpoint from './api/chat.js';
import charactersEndpoint from './api/characters.js';
import connectionProfilesEndpoint from './api/connection-profiles.js';
import conversationsEndpoint from './api/conversations.js';
import { isAccessAuthEnabled, isCookieAuthenticated } from './lib/access-auth.mjs';
import { serializeError } from './lib/chat-api.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3210);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

async function readRequestBody(req) {
  const raw = await readRawRequestBody(req);

  return raw ? JSON.parse(raw) : {};
}

async function readRawRequestBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function serveFile(res, filename, contentType) {
  const filePath = path.join(publicDir, filename);
  const content = await readFile(filePath);
  res.writeHead(200, { 'Cache-Control': 'no-cache', 'Content-Type': contentType });
  res.end(content);
}

function getLanUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        urls.push(`http://${address.address}:${port}`);
      }
    }
  }

  return urls;
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function sendWebResponse(res, response) {
  const headers = {};

  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  res.writeHead(response.status, headers);
  res.flushHeaders?.();

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

function toWebHeaders(headers) {
  const webHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      webHeaders.set(key, value.join(', '));
    } else if (value !== undefined) {
      webHeaders.set(key, value);
    }
  }

  return webHeaders;
}

async function handleAuthRoute(req, res) {
  await handleWebEndpoint(req, res, authEndpoint);
}

async function handleConversationsRoute(req, res) {
  await handleWebEndpoint(req, res, conversationsEndpoint);
}

async function handleCharactersRoute(req, res) {
  await handleWebEndpoint(req, res, charactersEndpoint);
}

async function handleConnectionProfilesRoute(req, res) {
  await handleWebEndpoint(req, res, connectionProfilesEndpoint);
}

async function handleChatRoute(req, res) {
  await handleWebEndpoint(req, res, chatEndpoint);
}

async function handleWebEndpoint(req, res, endpoint) {
  const rawBody = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readRawRequestBody(req);
  const request = new Request(`http://${req.headers.host || '127.0.0.1'}${req.url}`, {
    method: req.method,
    headers: toWebHeaders(req.headers),
    body: rawBody,
  });
  const response = await endpoint.fetch(request);

  await sendWebResponse(res, response);
}

async function ensureAccessAllowed(req, res, pathname, search) {
  if (!isAccessAuthEnabled()) {
    return true;
  }

  if (pathname === '/api/auth' || pathname === '/login.html') {
    return true;
  }

  const authenticated = await isCookieAuthenticated(req.headers.cookie);

  if (authenticated) {
    return true;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 401, { error: '需要先输入访问密码' });
    return false;
  }

  const loginUrl = new URL('/login.html', `http://${req.headers.host || '127.0.0.1'}`);

  if (pathname !== '/') {
    loginUrl.searchParams.set('next', `${pathname}${search}`);
  }

  sendRedirect(res, `${loginUrl.pathname}${loginUrl.search}`);
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (requestUrl.pathname === '/api/auth') {
      await handleAuthRoute(req, res);
      return;
    }

    if (!(await ensureAccessAllowed(req, res, requestUrl.pathname, requestUrl.search))) {
      return;
    }

    if (requestUrl.pathname === '/api/conversations') {
      await handleConversationsRoute(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/characters') {
      await handleCharactersRoute(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/connection-profiles') {
      await handleConnectionProfilesRoute(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/chat') {
      await handleChatRoute(req, res);
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/') {
      await serveFile(res, 'index.html', 'text/html; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/login.html') {
      await serveFile(res, 'login.html', 'text/html; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/app.js') {
      await serveFile(res, 'app.js', 'application/javascript; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/styles.css') {
      await serveFile(res, 'styles.css', 'text/css; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/default-characters.json') {
      await serveFile(res, 'default-characters.json', 'application/json; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/default-connection-profiles.json') {
      await serveFile(res, 'default-connection-profiles.json', 'application/json; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/vendor/vue.global.prod.js') {
      await serveFile(res, 'vendor/vue.global.prod.js', 'application/javascript; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/vendor/markdown-it.min.js') {
      await serveFile(res, 'vendor/markdown-it.min.js', 'application/javascript; charset=utf-8');
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, serializeError(error));
  }
});

server.listen(port, host, () => {
  const localUrl = host === '0.0.0.0' ? `http://127.0.0.1:${port}` : `http://${host}:${port}`;
  const lanUrls = host === '0.0.0.0' ? getLanUrls(port) : [];

  console.log(`razor-chat running at ${localUrl}`);

  if (lanUrls.length > 0) {
    console.log('LAN access:');
    for (const url of lanUrls) {
      console.log(`  ${url}`);
    }
  }
});
