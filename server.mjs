import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3210);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function normalizeBaseUrl(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '');
}

function extractTextParts(content) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (!part || typeof part !== 'object') {
          return '';
        }

        return part.text || part.output_text || part.content || '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  if (content && typeof content === 'object') {
    return String(content.text || content.output_text || content.content || '').trim();
  }

  return '';
}

function extractMessage(payload) {
  const choice = payload?.choices?.[0];
  const message = choice?.message || {};
  const output = payload?.output?.[0]?.content;

  const answer =
    extractTextParts(message.content) ||
    extractTextParts(choice?.delta?.content) ||
    extractTextParts(payload?.output_text) ||
    extractTextParts(output);

  const reasoning =
    extractTextParts(message.reasoning_content) ||
    extractTextParts(message.reasoning) ||
    extractTextParts(payload?.reasoning) ||
    extractTextParts(payload?.output?.[0]?.reasoning);

  return {
    answer,
    reasoning,
  };
}

function extractResponsesOutput(payload) {
  const answerParts = [];
  const reasoningParts = [];

  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    answerParts.push(payload.output_text.trim());
  }

  for (const item of payload?.output || []) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    if (item.type === 'reasoning') {
      const extractedReasoning =
        extractTextParts(item.summary) ||
        extractTextParts(item.content) ||
        extractTextParts(item.reasoning);

      if (extractedReasoning) {
        reasoningParts.push(extractedReasoning);
      }
    }

    if (item.type === 'message') {
      for (const contentItem of item.content || []) {
        if (!contentItem || typeof contentItem !== 'object') {
          continue;
        }

        if (contentItem.type === 'output_text') {
          const text = extractTextParts(contentItem.text);

          if (text) {
            answerParts.push(text);
          }
        }

        if (contentItem.type === 'reasoning') {
          const text =
            extractTextParts(contentItem.summary) ||
            extractTextParts(contentItem.text) ||
            extractTextParts(contentItem.content);

          if (text) {
            reasoningParts.push(text);
          }
        }
      }
    }
  }

  return {
    answer: answerParts.join('\n').trim(),
    reasoning: reasoningParts.join('\n').trim(),
  };
}

async function readRequestBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => message && typeof message === 'object')
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').trim(),
    }))
    .filter((message) => message.role && message.content);
}

async function callChatCompletion({ apiBaseUrl, apiKey, model, systemPrompt, userMessage, messages }) {
  const endpoint = `${normalizeBaseUrl(apiBaseUrl)}/v1/chat/completions`;
  const normalizedMessages = normalizeMessages(messages);
  const requestMessages = normalizedMessages.length
    ? normalizedMessages
    : [{ role: 'user', content: userMessage }];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...requestMessages,
      ],
      stream: false,
    }),
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw_text: text };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      endpoint,
      data,
    };
  }

  const { answer, reasoning } = extractMessage(data);

  return {
    ok: true,
    status: response.status,
    apiMode: 'chat_completions',
    endpoint,
    data,
    answer,
    reasoning,
  };
}

async function callResponsesApi({ apiBaseUrl, apiKey, model, systemPrompt, userMessage, messages }) {
  const endpoint = `${normalizeBaseUrl(apiBaseUrl)}/v1/responses`;
  const normalizedMessages = normalizeMessages(messages);

  const input = normalizedMessages.length
    ? [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...normalizedMessages,
      ]
    : [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userMessage },
      ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input,
    }),
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw_text: text };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      apiMode: 'responses',
      endpoint,
      data,
    };
  }

  const { answer, reasoning } = extractResponsesOutput(data);

  return {
    ok: true,
    status: response.status,
    apiMode: 'responses',
    endpoint,
    data,
    answer,
    reasoning,
  };
}

async function serveFile(res, filename, contentType) {
  const filePath = path.join(publicDir, filename);
  const content = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
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

    if (req.method === 'POST' && req.url === '/api/chat') {
      const body = await readRequestBody(req);
      const { apiBaseUrl, apiKey, model, systemPrompt, userMessage, apiMode, messages } = body;

      const normalizedMessages = normalizeMessages(messages);

      if (!apiBaseUrl || !apiKey || !model || (!userMessage && !normalizedMessages.length)) {
        sendJson(res, 400, {
          error: '缺少必要字段：apiBaseUrl / apiKey / model / userMessage(messages)',
        });
        return;
      }

      const result =
        apiMode === 'responses'
          ? await callResponsesApi({
              apiBaseUrl,
              apiKey,
              model,
              systemPrompt,
              userMessage,
              messages: normalizedMessages,
            })
          : await callChatCompletion({
              apiBaseUrl,
              apiKey,
              model,
              systemPrompt,
              userMessage,
              messages: normalizedMessages,
            });

      sendJson(res, result.ok ? 200 : 502, result);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Grok demo running at http://127.0.0.1:${port}`);
});
