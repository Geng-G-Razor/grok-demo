import { getConnectionProfiles } from './connection-profile-store.mjs';

export function normalizeBaseUrl(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '')
    .replace(/\/v1\/chat\/completions$/, '')
    .replace(/\/v1\/responses$/, '');
}

export function normalizeApiKey(value) {
  return String(value || '').trim();
}

function extractTextParts(content, { trim = true } = {}) {
  const normalize = (value) => (trim ? String(value).trim() : String(value));

  if (typeof content === 'string') {
    return normalize(content);
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => extractTextParts(part, { trim: false }))
      .filter(Boolean)
      .join('\n');

    return normalize(text);
  }

  if (content && typeof content === 'object') {
    const candidates = [
      content.text,
      content.output_text,
      content.content,
      content.delta,
      content.value,
      content.summary,
      content.reasoning,
      content.part,
      content.item,
      content.content_part,
      content.output_item,
    ];

    for (const candidate of candidates) {
      const text = extractTextParts(candidate, { trim: false });

      if (text) {
        return normalize(text);
      }
    }
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

export function normalizeMessages(messages) {
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

async function parseJsonResponse(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw_text: text };
  }
}

function encodeSse(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function parseSseLines(buffer, onPayload) {
  buffer = buffer.replaceAll('\r\n', '\n');
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() || '';

  for (const block of blocks) {
    const dataLines = block
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) {
      continue;
    }

    const raw = dataLines.join('\n');

    if (raw === '[DONE]') {
      onPayload('[DONE]');
      continue;
    }

    try {
      onPayload(JSON.parse(raw));
    } catch {
      onPayload({ raw_text: raw });
    }
  }

  return rest;
}

function extractChatStreamDelta(payload) {
  const delta = payload?.choices?.[0]?.delta || {};

  return {
    content:
      extractTextParts(delta.content, { trim: false }) ||
      extractTextParts(delta.output_text, { trim: false }) ||
      extractTextParts(delta.text, { trim: false }),
    reasoning:
      extractTextParts(delta.reasoning_content, { trim: false }) ||
      extractTextParts(delta.reasoning, { trim: false }),
  };
}

function extractResponsesStreamDelta(payload) {
  const type = String(payload?.type || '');
  const contentTypes = new Set([
    'response.content_part.added',
    'response.content_part.done',
    'response.output_item.added',
    'response.output_item.done',
    'response.output_text.delta',
    'response.output_text.done',
    'response.text.delta',
    'response.text.done',
    'response.refusal.delta',
  ]);
  const reasoningTypes = new Set([
    'response.reasoning.delta',
    'response.reasoning_text.delta',
    'response.reasoning_summary.delta',
    'response.reasoning_summary_text.delta',
  ]);

  if (contentTypes.has(type)) {
    return {
      content: extractTextParts(
        payload.delta ||
          payload.text ||
          payload.output_text ||
          payload.part ||
          payload.item ||
          payload.content_part ||
          payload.output_item ||
          payload.content,
        { trim: false },
      ),
      reasoning: '',
    };
  }

  if (reasoningTypes.has(type)) {
    return {
      content: '',
      reasoning: extractTextParts(payload.delta || payload.text || payload.summary, { trim: false }),
    };
  }

  if (type.includes('reasoning')) {
    return {
      content: '',
      reasoning: extractTextParts(payload.delta || payload.text || payload.summary || payload.reasoning, { trim: false }),
    };
  }

  if (type.includes('output_text') || type.includes('text') || type.includes('content')) {
    return {
      content: extractTextParts(
        payload.delta ||
          payload.text ||
          payload.output_text ||
          payload.part ||
          payload.item ||
          payload.content_part ||
          payload.output_item ||
          payload.content,
        { trim: false },
      ),
      reasoning: '',
    };
  }

  return {
    content: extractTextParts(payload.output_text_delta || payload.content_delta || payload.output_text, { trim: false }),
    reasoning: extractTextParts(payload.reasoning_delta || payload.reasoning, { trim: false }),
  };
}

function createStreamingPayload({ apiBaseUrl, apiKey, model, systemPrompt, userMessage, messages, apiMode }) {
  const normalizedMessages = normalizeMessages(messages);

  if (apiMode === 'responses') {
    const input = normalizedMessages.length
      ? [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          ...normalizedMessages,
        ]
      : [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userMessage },
        ];

    return {
      endpoint: `${normalizeBaseUrl(apiBaseUrl)}/v1/responses`,
      body: {
        model,
        input,
        stream: true,
      },
    };
  }

  const requestMessages = normalizedMessages.length
    ? normalizedMessages
    : [{ role: 'user', content: userMessage }];

  return {
    endpoint: `${normalizeBaseUrl(apiBaseUrl)}/v1/chat/completions`,
    body: {
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...requestMessages,
      ],
      stream: true,
    },
  };
}

function isClientChatConfigAllowed() {
  return process.env.ALLOW_CLIENT_CHAT_CONFIG === 'true';
}

function getAllowedChatBaseUrls() {
  return String(process.env.CHAT_API_BASE_URL_ALLOWLIST || '')
    .split(',')
    .map((value) => normalizeBaseUrl(value))
    .filter(Boolean);
}

function validateApiBaseUrl(apiBaseUrl) {
  const normalized = normalizeBaseUrl(apiBaseUrl);

  try {
    const url = new URL(normalized);
    const allowedBaseUrls = getAllowedChatBaseUrls();

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, error: 'API Base URL 只支持 http/https。' };
    }

    if (allowedBaseUrls.length && !allowedBaseUrls.includes(normalized)) {
      return { ok: false, error: '当前 API Base URL 不在服务端允许列表中。' };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: 'API Base URL 格式不正确。' };
  }
}

export async function resolveChatPayload(body, { accountId } = {}) {
  const profileId = String(body?.profileId || '').trim();

  if (!profileId) {
    if (!isClientChatConfigAllowed()) {
      return {
        ok: false,
        statusCode: 400,
        payload: {
          error: '请先保存连接配置，再用已保存配置发起聊天。',
        },
      };
    }

    const validation = validateApiBaseUrl(body?.apiBaseUrl);

    if (!validation.ok) {
      return {
        ok: false,
        statusCode: 400,
        payload: { error: validation.error },
      };
    }

    return { ok: true, body };
  }

  const profilesResult = await getConnectionProfiles({ accountId });
  const profile = profilesResult.profiles.find((item) => item.id === profileId);

  if (!profile) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: '连接配置不存在，请重新选择或保存配置。',
      },
    };
  }

  if (!profile.apiBaseUrl || !profile.apiKey || !profile.model) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: '连接配置缺少 API Base URL / API Key / Model，请先补全并保存。',
      },
    };
  }

  const validation = validateApiBaseUrl(profile.apiBaseUrl);

  if (!validation.ok) {
    return {
      ok: false,
      statusCode: 400,
      payload: { error: validation.error },
    };
  }

  return {
    ok: true,
    body: {
      ...body,
      apiMode: profile.apiMode,
      apiBaseUrl: profile.apiBaseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      systemPrompt: String(body?.systemPrompt || profile.systemPrompt || ''),
    },
  };
}

export async function createChatStreamResponse(body, options = {}) {
  const resolved = await resolveChatPayload(body, options);

  if (!resolved.ok) {
    return Response.json(resolved.payload, { status: resolved.statusCode });
  }

  return createResolvedChatStreamResponse(resolved.body);
}

function createResolvedChatStreamResponse(body) {
  const { apiBaseUrl, apiKey, model, systemPrompt, userMessage, apiMode, messages } = body || {};
  const normalizedMessages = normalizeMessages(messages);

  if (!apiBaseUrl || !apiKey || !model || (!userMessage && !normalizedMessages.length)) {
    return Response.json(
      {
        error: '缺少必要字段：apiBaseUrl / apiKey / model / userMessage(messages)',
      },
      { status: 400 },
    );
  }

  const normalizedApiMode = apiMode === 'responses' ? 'responses' : 'chat_completions';
  const { endpoint, body: requestBody } = createStreamingPayload({
    apiBaseUrl,
    apiKey,
    model,
    systemPrompt,
    userMessage,
    messages: normalizedMessages,
    apiMode: normalizedApiMode,
  });
  const normalizedApiKey = normalizeApiKey(apiKey);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let answer = '';
      let reasoning = '';

      const send = (event, payload) => {
        controller.enqueue(encoder.encode(encodeSse(event, payload)));
      };

      try {
        send('meta', {
          ok: true,
          apiMode: normalizedApiMode,
          endpoint,
          model,
        });

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${normalizedApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok || !response.body) {
          const data = await parseJsonResponse(response);
          send('error', {
            ok: false,
            status: response.status,
            apiMode: normalizedApiMode,
            endpoint,
            data,
          });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;

        while (!done) {
          const chunk = await reader.read();
          done = chunk.done;

          if (chunk.value) {
            buffer += decoder.decode(chunk.value, { stream: true });
            buffer = parseSseLines(buffer, (payload) => {
              if (payload === '[DONE]') {
                return;
              }

              const delta =
                normalizedApiMode === 'responses'
                  ? extractResponsesStreamDelta(payload)
                  : extractChatStreamDelta(payload);

              if (!delta.content && !delta.reasoning) {
                return;
              }

              answer += delta.content || '';
              reasoning += delta.reasoning || '';
              send('delta', delta);
            });
          }
        }

        if (buffer.trim()) {
          parseSseLines(`${buffer}\n\n`, (payload) => {
            if (payload === '[DONE]') {
              return;
            }

            const delta =
              normalizedApiMode === 'responses'
                ? extractResponsesStreamDelta(payload)
                : extractChatStreamDelta(payload);

            if (!delta.content && !delta.reasoning) {
              return;
            }

            answer += delta.content || '';
            reasoning += delta.reasoning || '';
            send('delta', delta);
          });
        }

        send('done', {
          ok: true,
          status: response.status,
          apiMode: normalizedApiMode,
          endpoint,
          answer,
          reasoning,
        });
      } catch (error) {
        send('error', serializeError(error));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function callChatCompletion({
  apiBaseUrl,
  apiKey,
  model,
  systemPrompt,
  userMessage,
  messages,
}) {
  const endpoint = `${normalizeBaseUrl(apiBaseUrl)}/v1/chat/completions`;
  const normalizedMessages = normalizeMessages(messages);
  const requestMessages = normalizedMessages.length
    ? normalizedMessages
    : [{ role: 'user', content: userMessage }];
  const normalizedApiKey = normalizeApiKey(apiKey);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${normalizedApiKey}`,
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

  const data = await parseJsonResponse(response);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      apiMode: 'chat_completions',
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

export async function callResponsesApi({
  apiBaseUrl,
  apiKey,
  model,
  systemPrompt,
  userMessage,
  messages,
}) {
  const endpoint = `${normalizeBaseUrl(apiBaseUrl)}/v1/responses`;
  const normalizedMessages = normalizeMessages(messages);
  const normalizedApiKey = normalizeApiKey(apiKey);

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
      Authorization: `Bearer ${normalizedApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input,
    }),
  });

  const data = await parseJsonResponse(response);

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

export async function handleChatPayload(body, options = {}) {
  const resolved = await resolveChatPayload(body, options);

  if (!resolved.ok) {
    return {
      statusCode: resolved.statusCode,
      payload: resolved.payload,
    };
  }

  body = resolved.body;

  const { apiBaseUrl, apiKey, model, systemPrompt, userMessage, apiMode, messages } = body || {};
  const normalizedMessages = normalizeMessages(messages);

  if (!apiBaseUrl || !apiKey || !model || (!userMessage && !normalizedMessages.length)) {
    return {
      statusCode: 400,
      payload: {
        error: '缺少必要字段：apiBaseUrl / apiKey / model / userMessage(messages)',
      },
    };
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

  return {
    statusCode: result.ok ? 200 : 502,
    payload: result,
  };
}

export function serializeError(error) {
  return error instanceof Error
    ? {
        error: error.message,
        name: error.name,
        cause: error.cause instanceof Error ? error.cause.message : String(error.cause || ''),
      }
    : {
        error: String(error),
      };
}
