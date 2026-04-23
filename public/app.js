const STORAGE_KEY = 'grok-demo-settings-v2';
const SESSION_KEY = 'grok-demo-session-v1';

const form = document.querySelector('#chat-form');
const submitButton = document.querySelector('#submit-button');
const userMessageInput = document.querySelector('#userMessage');

const chatFeed = document.querySelector('#chat-feed');
const reasoningEl = document.querySelector('#reasoning');
const metaEl = document.querySelector('#meta');
const rawEl = document.querySelector('#raw');
const statusPill = document.querySelector('#status-pill');
const conversationSubtitle = document.querySelector('#conversation-subtitle');

const newChatButton = document.querySelector('#new-chat-button');
const toggleSettingsButton = document.querySelector('#toggle-settings-button');
const settingsPanel = document.querySelector('#settings-panel');
const debugPanel = document.querySelector('#debug-panel');

const settingsFields = ['apiMode', 'apiBaseUrl', 'model', 'systemPrompt'];
const conversation = [];

function setBlock(element, value) {
  element.textContent = value || '暂无结果';
  element.classList.toggle('empty', !value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderParagraphs(value) {
  return escapeHtml(value).replaceAll('\n', '<br />');
}

function createMessageElement(message) {
  const article = document.createElement('article');
  article.className = `message message-${message.role}`;

  const label = message.role === 'user' ? '你' : '助手';
  const content = message.content || (message.pending ? '正在等待响应...' : '空响应');
  const reasoningBlock =
    message.reasoning && message.role === 'assistant'
      ? `<details class="reasoning-toggle"><summary>查看思考内容</summary><div class="reasoning-copy">${renderParagraphs(message.reasoning)}</div></details>`
      : '';
  const errorBadge = message.error ? '<span class="message-badge error">失败</span>' : '';
  const pendingBadge = message.pending ? '<span class="message-badge">响应中</span>' : '';

  article.innerHTML = `
    <div class="message-head">
      <span class="message-role">${label}</span>
      <div class="message-badges">
        ${pendingBadge}
        ${errorBadge}
      </div>
    </div>
    <div class="message-body">${renderParagraphs(content)}</div>
    ${reasoningBlock}
  `;

  return article;
}

function renderConversation() {
  chatFeed.innerHTML = '';

  if (!conversation.length) {
    chatFeed.innerHTML = `
      <section class="empty-state">
        <p class="empty-state-title">准备好了</p>
        <p class="muted">先在下方输入一句话试试。配置区和调试区都已经折叠起来了。</p>
      </section>
    `;
    conversationSubtitle.textContent = '发送一条消息开始测试';
    return;
  }

  conversationSubtitle.textContent = `当前共 ${conversation.length} 条消息`;

  for (const message of conversation) {
    chatFeed.append(createMessageElement(message));
  }

  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function setStatus(text, type = 'idle') {
  statusPill.textContent = text;
  statusPill.className = `status-pill ${type}`;
}

function saveSettings() {
  const payload = {};

  for (const field of settingsFields) {
    payload[field] = form.elements[field]?.value ?? '';
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ apiKey: form.elements.apiKey.value ?? '' }));
}

function loadSettings() {
  const defaults = {
    apiMode: 'chat_completions',
    apiBaseUrl: '',
    apiKey: '',
    model: 'grok-4.20-0309-reasoning',
    systemPrompt: '',
  };

  let stored = {};
  let sessionStored = {};

  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    stored = {};
  }

  try {
    sessionStored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
  } catch {
    sessionStored = {};
  }

  const merged = { ...defaults, ...stored };

  for (const field of settingsFields) {
    if (form.elements[field]) {
      form.elements[field].value = merged[field] ?? '';
    }
  }

  if (form.elements.apiKey) {
    form.elements.apiKey.value = sessionStored.apiKey ?? '';
  }
}

function buildRequestMessages() {
  return conversation
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function updateDebug(data, response) {
  setBlock(
    metaEl,
    [
      `API Mode: ${data.apiMode ?? 'chat_completions'}`,
      `HTTP Status: ${data.status ?? response.status}`,
      `Endpoint: ${data.endpoint ?? '-'}`,
      `Success: ${String(data.ok ?? response.ok)}`,
    ].join('\n'),
  );
  setBlock(reasoningEl, data.reasoning);
  setBlock(rawEl, JSON.stringify(data.data ?? data, null, 2));
}

function clearDebug() {
  setBlock(metaEl, '');
  setBlock(reasoningEl, '');
  setBlock(rawEl, '');
}

async function sendMessage(messageText) {
  const assistantMessage = {
    role: 'assistant',
    content: '',
    reasoning: '',
    pending: true,
    error: false,
  };

  conversation.push({ role: 'user', content: messageText });
  conversation.push(assistantMessage);
  renderConversation();

  const payload = {
    apiMode: form.elements.apiMode.value,
    apiBaseUrl: form.elements.apiBaseUrl.value,
    apiKey: form.elements.apiKey.value,
    model: form.elements.model.value,
    systemPrompt: form.elements.systemPrompt.value,
    userMessage: messageText,
    messages: buildRequestMessages(),
  };

  submitButton.disabled = true;
  submitButton.textContent = '发送中...';
  setStatus('请求中', 'busy');
  clearDebug();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    updateDebug(data, response);

    assistantMessage.pending = false;
    assistantMessage.content =
      data.answer ||
      (data.ok ? '模型已完成响应，但正文为空。你可以展开下方调试面板继续看原始返回。' : '请求失败');
    assistantMessage.reasoning = data.reasoning || '';
    assistantMessage.error = !response.ok || !data.ok;

    if (assistantMessage.reasoning) {
      debugPanel.open = true;
    }

    setStatus(data.ok ? '已完成' : '请求失败', data.ok ? 'success' : 'error');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    assistantMessage.pending = false;
    assistantMessage.error = true;
    assistantMessage.content = `请求失败：${message}`;

    setBlock(metaEl, `请求失败：${message}`);
    setBlock(reasoningEl, '');
    setBlock(rawEl, '');
    setStatus('请求失败', 'error');
    debugPanel.open = true;
  } finally {
    renderConversation();
    submitButton.disabled = false;
    submitButton.textContent = '发送';
  }
}

for (const field of settingsFields) {
  form.elements[field]?.addEventListener('input', saveSettings);
  form.elements[field]?.addEventListener('change', saveSettings);
}

userMessageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const messageText = userMessageInput.value.trim();

  if (!messageText) {
    userMessageInput.focus();
    return;
  }

  saveSettings();
  userMessageInput.value = '';

  await sendMessage(messageText);
  userMessageInput.focus();
});

newChatButton.addEventListener('click', () => {
  conversation.length = 0;
  renderConversation();
  clearDebug();
  setStatus('未发送', 'idle');
  userMessageInput.focus();
});

toggleSettingsButton.addEventListener('click', () => {
  settingsPanel.open = !settingsPanel.open;
});

settingsPanel.addEventListener('toggle', () => {
  toggleSettingsButton.textContent = settingsPanel.open ? '隐藏设置' : '显示设置';
});

loadSettings();
renderConversation();
setStatus('未发送', 'idle');
