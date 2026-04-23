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

export async function handleChatPayload(body) {
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
