const STORAGE_KEY = 'grok-demo-settings-v2';
const SESSION_KEY = 'grok-demo-session-v1';
const CHARACTERS_KEY = 'grok-demo-characters-v1';
const CONVERSATIONS_KEY = 'grok-demo-conversations-v1';
const DEFAULT_CHARACTERS_URL = '/default-characters.json';

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
const toggleHistoryButton = document.querySelector('#toggle-history-button');
const toggleCharacterButton = document.querySelector('#toggle-character-button');
const toggleSettingsButton = document.querySelector('#toggle-settings-button');
const toggleDebugButton = document.querySelector('#toggle-debug-button');

const panelOverlay = document.querySelector('#panel-overlay');
const historyPanel = document.querySelector('#history-panel');
const characterPanel = document.querySelector('#character-panel');
const settingsPanel = document.querySelector('#settings-panel');
const debugPanel = document.querySelector('#debug-panel');
const panelCloseButtons = document.querySelectorAll('[data-close-panel]');

const conversationList = document.querySelector('#conversation-list');

const characterSelect = document.querySelector('#characterSelect');
const characterNameInput = document.querySelector('#characterName');
const characterPromptInput = document.querySelector('#characterPrompt');
const newCharacterButton = document.querySelector('#new-character-button');
const saveCharacterButton = document.querySelector('#save-character-button');
const deleteCharacterButton = document.querySelector('#delete-character-button');

const settingsFields = ['apiMode', 'apiBaseUrl', 'model', 'systemPrompt'];
const conversation = [];
const availableModels = ['grok-3', 'grok-4.1', 'grok-4'];

let characters = [];
let activeCharacterId = '';
let conversations = [];
let currentConversationId = '';
let isRequestInFlight = false;
let viewportSyncFrame = 0;

function syncPanelToggleButton(button, panel, label) {
  const isOpen = !panel.hidden;
  button.setAttribute('aria-pressed', String(isOpen));
  button.title = isOpen ? `收起${label}` : label;
  button.setAttribute('aria-label', isOpen ? `收起${label}面板` : `切换${label}面板`);
}

function syncViewportHeight() {
  const nextHeight = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(nextHeight)}px`);
}

function scheduleViewportHeightSync() {
  if (viewportSyncFrame) {
    cancelAnimationFrame(viewportSyncFrame);
  }

  viewportSyncFrame = requestAnimationFrame(() => {
    viewportSyncFrame = 0;
    syncViewportHeight();
  });
}

function syncAllPanelToggleButtons() {
  syncPanelToggleButton(toggleHistoryButton, historyPanel, '记录');
  syncPanelToggleButton(toggleCharacterButton, characterPanel, '角色');
  syncPanelToggleButton(toggleSettingsButton, settingsPanel, '设置');
  syncPanelToggleButton(toggleDebugButton, debugPanel, '调试');
}

function isPanelOpen(panel) {
  return !panel.hidden;
}

function getPanels() {
  return [historyPanel, characterPanel, settingsPanel, debugPanel];
}

function syncPanelOverlay() {
  panelOverlay.hidden = !getPanels().some((panel) => isPanelOpen(panel));
}

function closePanel(panel) {
  panel.hidden = true;
  syncPanelOverlay();
  syncAllPanelToggleButtons();
}

function closeAllPanels({ except = null } = {}) {
  for (const panel of getPanels()) {
    if (panel !== except) {
      panel.hidden = true;
    }
  }

  syncPanelOverlay();
  syncAllPanelToggleButtons();
}

function openPanel(panel) {
  closeAllPanels({ except: panel });
  panel.hidden = false;
  syncPanelOverlay();
  syncAllPanelToggleButtons();
}

function togglePanel(panel) {
  if (isPanelOpen(panel)) {
    closePanel(panel);
    return;
  }

  openPanel(panel);
}

async function loadDefaultCharacters() {
  try {
    const response = await fetch(DEFAULT_CHARACTERS_URL);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    return Array.isArray(payload) ? payload.map((item) => createCharacterRecord(item)) : [];
  } catch (error) {
    console.warn('Failed to load default characters:', error);
    return [];
  }
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

function createCharacterRecord(seed = {}) {
  const name = String(seed.name || '').trim();
  const prompt = String(seed.prompt || '').trim();

  return {
    ...seed,
    name,
    prompt,
  };
}

function updateActiveCharacterChip() {
  const activeCharacter = getActiveCharacter();
  activeCharacterChip.textContent = activeCharacter ? activeCharacter.name : '无角色';
  activeCharacterChip.classList.toggle('has-character', Boolean(activeCharacter));
}

function buildEffectiveSystemPrompt({ includeCharacter = true } = {}) {
  const manualPrompt = String(form.elements.systemPrompt.value || '').trim();
  const activeCharacter = getActiveCharacter();
  const parts = [];

  if (includeCharacter && activeCharacter?.prompt) {
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

function getLastUserMessageIndex() {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index]?.role === 'user' && String(conversation[index].content || '').trim()) {
      return index;
    }
  }

  return -1;
}

function createMessageElement(message, options = {}) {
  const { showRetryButton = false, retryDisabled = false } = options;
  const article = document.createElement('article');
  article.className = `message message-${message.role}`;

  const content = message.content || (message.pending ? '正在等待响应...' : '空响应');
  const reasoningBlock =
    message.reasoning && message.role === 'assistant'
      ? `<details class="reasoning-toggle"><summary>查看思考内容</summary><div class="reasoning-copy">${renderParagraphs(message.reasoning)}</div></details>`
      : '';
  const errorBadge = message.error ? '<span class="message-badge error">失败</span>' : '';
  const pendingBadge = message.pending ? '<span class="message-badge">响应中</span>' : '';
  const badges =
    pendingBadge || errorBadge
      ? `<div class="message-badges">${pendingBadge}${errorBadge}</div>`
      : '';

  article.innerHTML = `
    ${badges}
    <div class="message-body">${renderParagraphs(content)}</div>
    ${reasoningBlock}
  `;

  if (showRetryButton) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'message-retry-button';
    retryButton.textContent = '重新回答';
    retryButton.disabled = retryDisabled;
    retryButton.addEventListener('click', () => {
      retryLastResponse();
    });

    actions.append(retryButton);
    article.append(actions);
  }

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

  const lastUserMessageIndex = getLastUserMessageIndex();

  for (const [index, message] of conversation.entries()) {
    chatFeed.append(
      createMessageElement(message, {
        showRetryButton: index === lastUserMessageIndex,
        retryDisabled: isRequestInFlight || message.pending,
      }),
    );
  }

  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function setStatus(text, type = 'idle') {
  statusPill.textContent = text;
  statusPill.className = `status-pill ${type}`;
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}`;
}

function createConversationTitle(messages) {
  const firstUserMessage = messages.find(
    (message) => message.role === 'user' && String(message.content || '').trim(),
  );

  if (!firstUserMessage) {
    return '新对话';
  }

  return String(firstUserMessage.content).replace(/\s+/g, ' ').trim().slice(0, 24) || '新对话';
}

function cloneMessages(messages) {
  return messages.map((message) => ({
    ...message,
    pending: false,
    content:
      message.pending && !message.content ? '上次请求未完成，已停止继续等待。' : message.content || '',
  }));
}

function hasMeaningfulConversationMessages(messages) {
  return messages.some((message) => String(message?.content || '').trim());
}

function createConversationRecord(seed = {}) {
  const now = new Date().toISOString();

  return {
    id: seed.id || createId('conversation'),
    title: seed.title || '新对话',
    messages: cloneMessages(seed.messages || []),
    createdAt: seed.createdAt || now,
    updatedAt: seed.updatedAt || now,
  };
}

function getCurrentConversationRecord() {
  return conversations.find((item) => item.id === currentConversationId) || null;
}

function persistConversations() {
  const persistedConversations = conversations.filter((record) =>
    hasMeaningfulConversationMessages(record.messages || []),
  );
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(persistedConversations));
}

function pruneEmptyConversations({ keepCurrent = true } = {}) {
  conversations = conversations.filter((record) => {
    if (keepCurrent && record.id === currentConversationId) {
      return true;
    }

    return hasMeaningfulConversationMessages(record.messages || []);
  });
}

function saveCurrentConversationState() {
  const record = getCurrentConversationRecord();

  if (!record) {
    return;
  }

  const messages = cloneMessages(conversation);
  record.messages = messages;
  record.updatedAt = new Date().toISOString();
  record.title = createConversationTitle(messages);
  pruneEmptyConversations();
  persistConversations();
  renderConversationList();
}

function loadConversationIntoView(record) {
  conversation.length = 0;
  conversation.push(...cloneMessages(record.messages || []));
  renderConversation();
}

function formatConversationTime(value) {
  try {
    return new Date(value).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function renderConversationList() {
  conversationList.innerHTML = '';

  const visibleConversations = conversations.filter((record) =>
    hasMeaningfulConversationMessages(record.messages || []),
  );

  if (!visibleConversations.length) {
    conversationList.innerHTML = '<p class="history-empty">暂无对话记录</p>';
    return;
  }

  const sorted = [...visibleConversations].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  for (const record of sorted) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    button.dataset.id = record.id;
    button.classList.toggle('active', record.id === currentConversationId);

    const previewSource = record.messages.find((message) => message.role === 'user')?.content || '';
    const preview = String(previewSource).replace(/\s+/g, ' ').trim().slice(0, 40) || '空白对话';

    button.innerHTML = `
      <span class="history-title">${escapeHtml(record.title || '新对话')}</span>
      <span class="history-meta">${escapeHtml(
        `${formatConversationTime(record.updatedAt)} · ${record.messages.length} 条消息`,
      )}</span>
      <span class="history-preview">${escapeHtml(preview)}</span>
    `;

    button.addEventListener('click', () => {
      if (record.id === currentConversationId) {
        closePanel(historyPanel);
        userMessageInput.focus();
        return;
      }

      saveCurrentConversationState();
      currentConversationId = record.id;
      loadConversationIntoView(record);
      clearDebug();
      setStatus(record.messages.length ? '已恢复' : '未发送', record.messages.length ? 'success' : 'idle');
      saveSettings();
      renderConversationList();
      closePanel(historyPanel);
      userMessageInput.focus();
    });

    conversationList.append(button);
  }
}

function ensureConversationState() {
  if (!conversations.length) {
    const record = createConversationRecord();
    conversations = [record];
    currentConversationId = record.id;
    persistConversations();
    return;
  }

  const existing = conversations.find((item) => item.id === currentConversationId);

  if (!existing) {
    const sorted = [...conversations].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    currentConversationId = sorted[0]?.id || conversations[0].id;
  }
}

function saveSettings() {
  const payload = { activeCharacterId, currentConversationId };

  for (const field of settingsFields) {
    payload[field] = form.elements[field]?.value ?? '';
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ apiKey: form.elements.apiKey.value ?? '' }));
}

async function loadCharacters() {
  const defaultCharacters = await loadDefaultCharacters();

  try {
    const stored = JSON.parse(localStorage.getItem(CHARACTERS_KEY) || 'null');

    if (Array.isArray(stored) && stored.length) {
      const normalizedStored = stored.map((character) => createCharacterRecord(character));
      const mergedCharacters = [...normalizedStored];

      for (const defaultCharacter of defaultCharacters) {
        if (!mergedCharacters.some((character) => character.id === defaultCharacter.id)) {
          mergedCharacters.push(defaultCharacter);
        }
      }

      characters = mergedCharacters;
      localStorage.setItem(CHARACTERS_KEY, JSON.stringify(characters));
      return;
    }
  } catch {
    // Ignore malformed local storage.
  }

  characters = defaultCharacters;
  localStorage.setItem(CHARACTERS_KEY, JSON.stringify(characters));
}

function loadConversations() {
  try {
    const stored = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) || 'null');

    if (Array.isArray(stored) && stored.length) {
      conversations = stored
        .map((item) => createConversationRecord(item))
        .filter((record) => hasMeaningfulConversationMessages(record.messages || []));
      return;
    }
  } catch {
    // Ignore malformed local storage.
  }

  conversations = [];
}

function loadSettings() {
  const defaults = {
    apiMode: 'chat_completions',
    apiBaseUrl: '',
    apiKey: '',
    model: 'grok-3',
    systemPrompt: '',
    activeCharacterId: '',
    currentConversationId: '',
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
  currentConversationId = merged.currentConversationId || '';

  for (const field of settingsFields) {
    if (form.elements[field]) {
      form.elements[field].value = merged[field] ?? '';
    }
  }

  if (form.elements.apiKey) {
    form.elements.apiKey.value = sessionStored.apiKey ?? '';
  }
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

function buildRequestMessages() {
  return conversation
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function getCharacterPromptStats() {
  const activeCharacter = getActiveCharacter();

  if (!activeCharacter) {
    return '无角色';
  }

  return `每轮发送 · ${activeCharacter.prompt.length} 字`;
}

function updateDebug(data, response, requestMeta = {}) {
  setBlock(
    metaEl,
    [
      `API Mode: ${data.apiMode ?? 'chat_completions'}`,
      `Model: ${form.elements.model?.value || '-'}`,
      `HTTP Status: ${data.status ?? response.status}`,
      `Endpoint: ${data.endpoint ?? '-'}`,
      `Success: ${String(data.ok ?? response.ok)}`,
      `Character: ${getActiveCharacter()?.name || '无角色'}`,
      `Character Prompt: ${getCharacterPromptStats()}`,
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

function showConfigError(message, field) {
  setStatus('配置缺失', 'error');
  setBlock(metaEl, message);
  setBlock(reasoningEl, '');
  setBlock(rawEl, '');
  openPanel(settingsPanel);
  field?.focus();
}

function validateChatConfig() {
  const apiBaseUrlInput = form.elements.apiBaseUrl;
  const apiKeyInput = form.elements.apiKey;

  if (!String(apiBaseUrlInput.value || '').trim()) {
    showConfigError('请先在设置中填写 API Base URL。', apiBaseUrlInput);
    return false;
  }

  if (!String(apiKeyInput.value || '').trim()) {
    showConfigError('请先在设置中填写 API Key。', apiKeyInput);
    return false;
  }

  return true;
}

function clearConversation() {
  conversation.length = 0;
  renderConversation();
  clearDebug();
  setStatus('未发送', 'idle');
  saveCurrentConversationState();
  userMessageInput.focus();
}

function startNewConversation() {
  saveCurrentConversationState();
  pruneEmptyConversations({ keepCurrent: false });

  const record = createConversationRecord();
  conversations.push(record);
  currentConversationId = record.id;

  conversation.length = 0;
  renderConversation();
  renderConversationList();
  clearDebug();
  setStatus('未发送', 'idle');
  saveSettings();
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
      character.id === activeCharacterId ? createCharacterRecord({ ...character, name, prompt }) : character,
    );
  } else {
    activeCharacterId = createId('character');
    characters.push(createCharacterRecord({ id: activeCharacterId, name, prompt }));
  }

  localStorage.setItem(CHARACTERS_KEY, JSON.stringify(characters));
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
  localStorage.setItem(CHARACTERS_KEY, JSON.stringify(characters));
  renderCharacterOptions();
  syncCharacterEditor();
  saveSettings();
}

async function sendMessage(messageText) {
  return requestAssistantResponse(messageText, { appendUserMessage: true });
}

async function requestAssistantResponse(messageText, { appendUserMessage = true } = {}) {
  if (isRequestInFlight) {
    return;
  }

  const currentCharacter = getActiveCharacter();
  const assistantMessage = {
    role: 'assistant',
    characterName: currentCharacter?.name || '助手',
    content: '',
    reasoning: '',
    pending: true,
    error: false,
  };

  isRequestInFlight = true;

  if (appendUserMessage) {
    conversation.push({ role: 'user', content: messageText });
  }

  conversation.push(assistantMessage);
  submitButton.disabled = true;
  submitButton.textContent = '发送中...';
  setStatus('请求中', 'busy');
  clearDebug();
  renderConversation();
  saveCurrentConversationState();

  const payload = {
    apiMode: form.elements.apiMode.value,
    apiBaseUrl: form.elements.apiBaseUrl.value,
    apiKey: form.elements.apiKey.value,
    model: form.elements.model.value,
    systemPrompt: buildEffectiveSystemPrompt(),
    userMessage: messageText,
    messages: buildRequestMessages(),
  };

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
      openPanel(debugPanel);
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
    openPanel(debugPanel);
  } finally {
    isRequestInFlight = false;
    renderConversation();
    saveCurrentConversationState();
    submitButton.disabled = false;
    submitButton.textContent = '发送';
  }
}

async function retryLastResponse() {
  if (isRequestInFlight) {
    return;
  }

  const lastUserMessageIndex = getLastUserMessageIndex();

  if (lastUserMessageIndex === -1) {
    return;
  }

  const messageText = String(conversation[lastUserMessageIndex].content || '').trim();

  if (!messageText) {
    return;
  }

  if (!validateChatConfig()) {
    return;
  }

  conversation.length = lastUserMessageIndex + 1;
  clearDebug();
  setStatus('未发送', 'idle');
  renderConversation();
  saveCurrentConversationState();
  await requestAssistantResponse(messageText, { appendUserMessage: false });
  userMessageInput.focus();
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

  if (!validateChatConfig()) {
    return;
  }

  saveSettings();
  userMessageInput.value = '';

  await sendMessage(messageText);
  userMessageInput.focus();
});

newChatButton.addEventListener('click', () => {
  startNewConversation();
});

clearChatButton.addEventListener('click', () => {
  clearConversation();
});

toggleHistoryButton.addEventListener('click', () => {
  togglePanel(historyPanel);
});

toggleCharacterButton.addEventListener('click', () => {
  togglePanel(characterPanel);
});

toggleSettingsButton.addEventListener('click', () => {
  togglePanel(settingsPanel);
});

toggleDebugButton.addEventListener('click', () => {
  togglePanel(debugPanel);
});

panelOverlay.addEventListener('click', () => {
  closeAllPanels();
});

for (const button of panelCloseButtons) {
  button.addEventListener('click', () => {
    const panel = document.querySelector(`#${button.dataset.closePanel}`);

    if (!panel) {
      return;
    }

    closePanel(panel);
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  closeAllPanels();
});

window.addEventListener('resize', scheduleViewportHeightSync);
window.visualViewport?.addEventListener('resize', scheduleViewportHeightSync);
window.visualViewport?.addEventListener('scroll', scheduleViewportHeightSync);

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

async function initializeApp() {
  await loadCharacters();
  loadSettings();
  loadConversations();
  ensureConversationState();
  renderCharacterOptions();
  syncCharacterEditor();
  loadConversationIntoView(getCurrentConversationRecord());
  renderConversationList();
  renderConversation();
  setStatus(conversation.length ? '已恢复' : '未发送', conversation.length ? 'success' : 'idle');
  syncAllPanelToggleButtons();
  syncPanelOverlay();
  syncViewportHeight();
  saveSettings();
}

initializeApp();
