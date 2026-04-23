import http from 'node:http';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleChatPayload, serializeError } from './lib/chat-api.mjs';

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
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function serveFile(res, filename, contentType) {
  const filePath = path.join(publicDir, filename);
  const content = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
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

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      await serveFile(res, 'index.html', 'text/html; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && req.url === '/app.js') {
      await serveFile(res, 'app.js', 'application/javascript; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && req.url === '/styles.css') {
      await serveFile(res, 'styles.css', 'text/css; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && req.url === '/default-characters.json') {
      await serveFile(res, 'default-characters.json', 'application/json; charset=utf-8');
      return;
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      const body = await readRequestBody(req);
      const result = await handleChatPayload(body);

      sendJson(res, result.statusCode, result.payload);
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

  console.log(`Grok demo running at ${localUrl}`);

  if (lanUrls.length > 0) {
    console.log('LAN access:');
    for (const url of lanUrls) {
      console.log(`  ${url}`);
    }
  }
});
