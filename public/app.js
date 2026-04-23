const STORAGE_KEY = 'grok-demo-settings-v2';
const SESSION_KEY = 'grok-demo-session-v1';
const CHARACTERS_KEY = 'grok-demo-characters-v1';

const form = document.querySelector('#chat-form');
const submitButton = document.querySelector('#submit-button');
const userMessageInput = document.querySelector('#userMessage');

const chatFeed = document.querySelector('#chat-feed');
const reasoningEl = document.querySelector('#reasoning');
const metaEl = document.querySelector('#meta');
const rawEl = document.querySelector('#raw');
const statusPill = document.querySelector('#status-pill');
const activeCharacterChip = document.querySelector('#active-character-chip');

const newChatButton = document.querySelector('#new-chat-button');
const clearChatButton = document.querySelector('#clear-chat-button');
const toggleCharacterButton = document.querySelector('#toggle-character-button');
const toggleSettingsButton = document.querySelector('#toggle-settings-button');
const toggleDebugButton = document.querySelector('#toggle-debug-button');

const characterPanel = document.querySelector('#character-panel');
const settingsPanel = document.querySelector('#settings-panel');
const debugPanel = document.querySelector('#debug-panel');

const characterSelect = document.querySelector('#characterSelect');
const characterNameInput = document.querySelector('#characterName');
const characterPromptInput = document.querySelector('#characterPrompt');
const newCharacterButton = document.querySelector('#new-character-button');
const saveCharacterButton = document.querySelector('#save-character-button');
const deleteCharacterButton = document.querySelector('#delete-character-button');

const settingsFields = ['apiMode', 'apiBaseUrl', 'model', 'systemPrompt'];
const conversation = [];
let characters = [];
let activeCharacterId = '';
const availableModels = ['grok-3', 'grok-4.1', 'grok-4'];

function getDefaultCharacters() {
  return [
    {
      id: 'sample-gentle-companion',
      name: '温柔陪聊',
      prompt:
        '你是一个自然、温柔、耐心的中文角色，擅长陪伴式对话。请保持口吻稳定、表达细腻，不要跳出角色，不要突然变成机械客服语气。',
    },
  ];
}

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

function getActiveCharacter() {
  return characters.find((character) => character.id === activeCharacterId) || null;
}

function buildEffectiveSystemPrompt() {
  const manualPrompt = String(form.elements.systemPrompt.value || '').trim();
  const activeCharacter = getActiveCharacter();
  const parts = [];

  if (activeCharacter?.prompt) {
    parts.push(
      [
        '请始终稳定扮演以下角色，不要跳出设定。',
        `角色名：${activeCharacter.name}`,
        '角色设定：',
        activeCharacter.prompt,
      ].join('\n'),
    );
  }

  if (manualPrompt) {
    parts.push(manualPrompt);
  }

  return parts.join('\n\n').trim();
}

function createMessageElement(message) {
  const article = document.createElement('article');
  article.className = `message message-${message.role}`;

  const label =
    message.role === 'user' ? '你' : message.characterName || getActiveCharacter()?.name || '助手';
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
        <p class="muted">开始聊天</p>
      </section>
    `;
    return;
  }

  for (const message of conversation) {
    chatFeed.append(createMessageElement(message));
  }

  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function setStatus(text, type = 'idle') {
  statusPill.textContent = text;
  statusPill.className = `status-pill ${type}`;
}

function createCharacterId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `character-${Date.now()}`;
}

function persistCharacters() {
  localStorage.setItem(CHARACTERS_KEY, JSON.stringify(characters));
}

function updateActiveCharacterChip() {
  const activeCharacter = getActiveCharacter();
  activeCharacterChip.textContent = activeCharacter ? activeCharacter.name : '无角色';
  activeCharacterChip.classList.toggle('has-character', Boolean(activeCharacter));
}

function renderCharacterOptions() {
  characterSelect.innerHTML = '<option value="">无角色</option>';

  for (const character of characters) {
    const option = document.createElement('option');
    option.value = character.id;
    option.textContent = character.name;
    characterSelect.append(option);
  }

  characterSelect.value = activeCharacterId || '';
  updateActiveCharacterChip();
}

function syncCharacterEditor() {
  const activeCharacter = getActiveCharacter();

  characterSelect.value = activeCharacterId || '';
  characterNameInput.value = activeCharacter?.name || '';
  characterPromptInput.value = activeCharacter?.prompt || '';
  deleteCharacterButton.disabled = !activeCharacter;
}

function saveSettings() {
  const payload = { activeCharacterId };

  for (const field of settingsFields) {
    payload[field] = form.elements[field]?.value ?? '';
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ apiKey: form.elements.apiKey.value ?? '' }));
}

function loadCharacters() {
  try {
    const stored = JSON.parse(localStorage.getItem(CHARACTERS_KEY) || 'null');

    if (Array.isArray(stored) && stored.length) {
      characters = stored;
      return;
    }
  } catch {
    // Ignore malformed local storage.
  }

  characters = getDefaultCharacters();
  persistCharacters();
}

function loadSettings() {
  const defaults = {
    apiMode: 'chat_completions',
    apiBaseUrl: '',
    apiKey: '',
    model: 'grok-3',
    systemPrompt: '',
    activeCharacterId: '',
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
  if (!availableModels.includes(merged.model)) {
    merged.model = defaults.model;
  }
  activeCharacterId = merged.activeCharacterId || '';

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
      `Character: ${getActiveCharacter()?.name || '无角色'}`,
    ].join('\n'),
  );
  setBlock(reasoningEl, data.reasoning);
  setBlock(rawEl, JSON.stringify(data.data ?? data, null, 2));
}

function extractErrorMessage(data, response) {
  const nestedMessage =
    data?.data?.error?.message ||
    data?.error?.message ||
    data?.data?.message ||
    data?.message;

  if (nestedMessage) {
    return String(nestedMessage);
  }

  if (response && !response.ok) {
    return `请求失败（HTTP ${data?.status ?? response.status}）`;
  }

  return '';
}

function clearDebug() {
  setBlock(metaEl, '');
  setBlock(reasoningEl, '');
  setBlock(rawEl, '');
}

function clearConversation() {
  conversation.length = 0;
  renderConversation();
  clearDebug();
  setStatus('未发送', 'idle');
  userMessageInput.focus();
}

function createOrUpdateCharacter() {
  const name = characterNameInput.value.trim();
  const prompt = characterPromptInput.value.trim();

  if (!name || !prompt) {
    window.alert('请先填写角色名和角色设定。');
    return;
  }

  if (activeCharacterId) {
    characters = characters.map((character) =>
      character.id === activeCharacterId ? { ...character, name, prompt } : character,
    );
  } else {
    activeCharacterId = createCharacterId();
    characters.push({ id: activeCharacterId, name, prompt });
  }

  persistCharacters();
  renderCharacterOptions();
  syncCharacterEditor();
  saveSettings();
}

function resetCharacterEditor() {
  activeCharacterId = '';
  syncCharacterEditor();
  updateActiveCharacterChip();
  saveSettings();
}

function deleteCurrentCharacter() {
  const activeCharacter = getActiveCharacter();

  if (!activeCharacter) {
    return;
  }

  const confirmed = window.confirm(`确定删除角色“${activeCharacter.name}”吗？`);

  if (!confirmed) {
    return;
  }

  characters = characters.filter((character) => character.id !== activeCharacterId);
  activeCharacterId = '';
  persistCharacters();
  renderCharacterOptions();
  syncCharacterEditor();
  saveSettings();
}

async function sendMessage(messageText) {
  const currentCharacter = getActiveCharacter();
  const assistantMessage = {
    role: 'assistant',
    characterName: currentCharacter?.name || '助手',
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
    systemPrompt: buildEffectiveSystemPrompt(),
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
    const errorMessage = extractErrorMessage(data, response);

    assistantMessage.pending = false;
    assistantMessage.content =
      data.answer ||
      (data.ok
        ? '模型已完成响应，但正文为空。你可以展开下方调试面板继续看原始返回。'
        : errorMessage || '请求失败');
    assistantMessage.reasoning = data.reasoning || '';
    assistantMessage.error = !response.ok || !data.ok;

    if (assistantMessage.reasoning || assistantMessage.error) {
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
  clearConversation();
});

clearChatButton.addEventListener('click', () => {
  clearConversation();
});

toggleCharacterButton.addEventListener('click', () => {
  characterPanel.open = !characterPanel.open;
});

toggleSettingsButton.addEventListener('click', () => {
  settingsPanel.open = !settingsPanel.open;
});

toggleDebugButton.addEventListener('click', () => {
  debugPanel.open = !debugPanel.open;
});

characterPanel.addEventListener('toggle', () => {
  toggleCharacterButton.textContent = characterPanel.open ? '收起角色' : '角色';
});

settingsPanel.addEventListener('toggle', () => {
  toggleSettingsButton.textContent = settingsPanel.open ? '收起设置' : '设置';
});

debugPanel.addEventListener('toggle', () => {
  toggleDebugButton.textContent = debugPanel.open ? '收起调试' : '调试';
});

characterSelect.addEventListener('change', () => {
  activeCharacterId = characterSelect.value;
  syncCharacterEditor();
  updateActiveCharacterChip();
  saveSettings();
});

newCharacterButton.addEventListener('click', () => {
  resetCharacterEditor();
  characterNameInput.focus();
});

saveCharacterButton.addEventListener('click', () => {
  createOrUpdateCharacter();
});

deleteCharacterButton.addEventListener('click', () => {
  deleteCurrentCharacter();
});

loadCharacters();
loadSettings();
renderCharacterOptions();
syncCharacterEditor();
renderConversation();
setStatus('未发送', 'idle');
