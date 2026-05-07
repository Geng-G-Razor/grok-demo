const STORAGE_KEY = 'grok-demo-settings-v2';
const SESSION_KEY = 'grok-demo-session-v1';
const CHARACTERS_KEY = 'grok-demo-characters-v1';
const CONVERSATIONS_KEY = 'grok-demo-conversations-v1';
const CONNECTION_PROFILES_KEY = 'grok-demo-connection-profiles-v1';
const DEFAULT_CHARACTERS_URL = '/default-characters.json';
const DEFAULT_CONNECTION_PROFILES_URL = '/default-connection-profiles.json';

const availableModels = [
  'grok-3',
  'grok-4.1',
  'grok-4',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'tencent/hy3-preview:free',
  'google/veo-3.1-fast',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'inclusionai/ling-2.6-1t:free',
];

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}`;
}

function readJsonStorage(storage, key, fallback) {
  try {
    return JSON.parse(storage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function cloneMessages(messages = []) {
  return messages.map((message) => ({
    ...message,
    pending: false,
    content:
      message.pending && !message.content ? '上次请求未完成，已停止继续等待。' : message.content || '',
  }));
}

function createCharacterRecord(seed = {}) {
  return {
    ...seed,
    id: seed.id || createId('character'),
    name: String(seed.name || '').trim(),
    prompt: String(seed.prompt || '').trim(),
  };
}

function normalizeDefaultCharactersPayload(payload) {
  if (Array.isArray(payload)) {
    const characters = payload.map((item) => createCharacterRecord(item));

    return {
      characters,
      disabledCharacterIds: [],
    };
  }

  const defaultCharacters = Array.isArray(payload?.default)
    ? payload.default.map((item) => createCharacterRecord(item))
    : [];
  const debugCharacters = Array.isArray(payload?.debug)
    ? payload.debug.map((item) => createCharacterRecord(item))
    : [];
  const debugEnabled = payload?.debugEnabled === true;

  return {
    characters: debugEnabled ? [...defaultCharacters, ...debugCharacters] : defaultCharacters,
    disabledCharacterIds: debugEnabled ? [] : debugCharacters.map((character) => character.id),
  };
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

function createConnectionProfileRecord(seed = {}) {
  const now = new Date().toISOString();
  const model = String(seed.model || 'grok-3').trim() || 'grok-3';

  return {
    id: seed.id || createId('connection-profile'),
    name: String(seed.name || seed.apiBaseUrl || model || '未命名配置').trim(),
    apiMode: seed.apiMode === 'responses' ? 'responses' : 'chat_completions',
    apiBaseUrl: String(seed.apiBaseUrl || '').trim(),
    apiKey: String(seed.apiKey || ''),
    hasApiKey: seed.hasApiKey === true || Boolean(seed.apiKey),
    model,
    systemPrompt: String(seed.systemPrompt || ''),
    createdAt: seed.createdAt || now,
    updatedAt: seed.updatedAt || now,
  };
}

function hasMeaningfulConversationMessages(messages = []) {
  return messages.some((message) => String(message?.content || '').trim());
}

function createConversationTitle(messages = []) {
  const firstUserMessage = messages.find(
    (message) => message.role === 'user' && String(message.content || '').trim(),
  );

  if (!firstUserMessage) {
    return '新对话';
  }

  return String(firstUserMessage.content).replace(/\s+/g, ' ').trim().slice(0, 24) || '新对话';
}

function mergeConversationRecords(left = [], right = []) {
  const recordsById = new Map();

  for (const record of [...left, ...right].map((item) => createConversationRecord(item))) {
    const existing = recordsById.get(record.id);

    if (!existing || new Date(record.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      recordsById.set(record.id, record);
    }
  }

  return [...recordsById.values()]
    .filter((record) => hasMeaningfulConversationMessages(record.messages || []))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const markdownRenderer = globalThis.markdownit?.({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false,
});

function setMarkdownTokenAttr(token, name, value) {
  const index = token.attrIndex(name);

  if (index < 0) {
    token.attrPush([name, value]);
  } else {
    token.attrs[index][1] = value;
  }
}

if (markdownRenderer) {
  const defaultLinkOpen =
    markdownRenderer.renderer.rules.link_open ||
    ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));

  markdownRenderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    setMarkdownTokenAttr(tokens[index], 'target', '_blank');
    setMarkdownTokenAttr(tokens[index], 'rel', 'noreferrer noopener');

    return defaultLinkOpen(tokens, index, options, env, self);
  };

  markdownRenderer.renderer.rules.table_open = () => '<div class="markdown-table-wrap"><table class="markdown-table">';
  markdownRenderer.renderer.rules.table_close = () => '</table></div>';
}

function repairCompactedMarkdownTables(value) {
  const text = String(value || '');
  const repairedHeader = text.replace(
    /([^\n|])(\|[^|\n]+(?:\|[^|\n]+)+\|)\|((?:\s*:?-{3,}:?\s*\|){2,})/g,
    '$1\n\n$2\n|$3',
  );

  if (repairedHeader === text) {
    return text;
  }

  return repairedHeader
    .replace(/\|\|(?=[^\n|]+(?:\||$))/g, '|\n|')
    .replace(/(\|)(?=(?:\*\*|__|#{1,6}\s|[-*+]\s|\d+\.\s))/g, '$1\n\n');
}

function renderMarkdown(value) {
  const markdown = repairCompactedMarkdownTables(value);

  if (markdownRenderer) {
    return markdownRenderer.render(markdown);
  }

  return escapeHtml(markdown).replaceAll('\n', '<br />');
}

const { createApp, nextTick } = Vue;

createApp({
  data() {
    return {
      availableModels,
      activePanel: '',
      authContext: { authRequired: false, authenticated: true, accountId: 'public' },
      status: { text: '未发送', type: 'idle' },
      userMessage: '',
      conversation: [],
      conversations: [],
      currentConversationId: '',
      characters: [],
      activeCharacterId: '',
      characterDraft: { name: '', prompt: '' },
      connectionProfiles: [],
      activeConnectionProfileId: '',
      settingsDraft: {
        name: '',
        apiMode: 'chat_completions',
        apiBaseUrl: '',
        apiKey: '',
        modelSelect: 'grok-3',
        modelCustom: '',
        systemPrompt: '',
      },
      debug: { meta: '', reasoning: '', raw: '' },
      buttonFeedback: { save: '', copy: '', characterCopy: '' },
      isRequestInFlight: false,
      viewportSyncFrame: 0,
      characterSyncTimer: 0,
      conversationSyncTimer: 0,
      profileSyncTimer: 0,
    };
  },

  computed: {
    activeCharacter() {
      return this.characters.find((character) => character.id === this.activeCharacterId) || null;
    },

    currentConnectionProfile() {
      return this.connectionProfiles.find((profile) => profile.id === this.activeConnectionProfileId) || null;
    },

    selectedModel() {
      return String(this.settingsDraft.modelCustom || '').trim() || this.settingsDraft.modelSelect;
    },

    characterPromptDraftLength() {
      return String(this.characterDraft.prompt || '').length;
    },

    lastUserMessageIndex() {
      for (let index = this.conversation.length - 1; index >= 0; index -= 1) {
        if (this.conversation[index]?.role === 'user' && String(this.conversation[index].content || '').trim()) {
          return index;
        }
      }

      return -1;
    },

    latestAssistantReasoningIndex() {
      for (let index = this.conversation.length - 1; index >= 0; index -= 1) {
        const message = this.conversation[index];

        if (message?.role === 'assistant' && String(message.reasoning || '').trim()) {
          return index;
        }
      }

      return -1;
    },

    visibleConversations() {
      return this.conversations.filter((record) => hasMeaningfulConversationMessages(record.messages || []));
    },

    sortedConversations() {
      return [...this.visibleConversations].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    },
  },

  async mounted() {
    await this.loadAuthContext();
    this.clearLegacyUserDataStorage();
    await this.loadCharacters();
    await this.loadRemoteCharacters();
    await this.loadConnectionProfiles();
    await this.loadRemoteConnectionProfiles();
    this.loadConversations();
    await this.loadRemoteConversations();
    this.loadSettings();
    this.ensureConversationState();
    this.syncCharacterEditor();
    this.loadConversationIntoView(this.getCurrentConversationRecord());
    this.setStatus(this.conversation.length ? '已恢复' : '未发送', this.conversation.length ? 'success' : 'idle');
    this.syncViewportHeight();
    this.saveSettings();

    window.addEventListener('resize', this.scheduleViewportHeightSync);
    window.visualViewport?.addEventListener('resize', this.scheduleViewportHeightSync);
    window.visualViewport?.addEventListener('scroll', this.scheduleViewportHeightSync);
    document.addEventListener('keydown', this.handleDocumentKeydown);
  },

  beforeUnmount() {
    window.removeEventListener('resize', this.scheduleViewportHeightSync);
    window.visualViewport?.removeEventListener('resize', this.scheduleViewportHeightSync);
    window.visualViewport?.removeEventListener('scroll', this.scheduleViewportHeightSync);
    document.removeEventListener('keydown', this.handleDocumentKeydown);

    if (this.conversationSyncTimer) {
      window.clearTimeout(this.conversationSyncTimer);
    }

    if (this.characterSyncTimer) {
      window.clearTimeout(this.characterSyncTimer);
    }

    if (this.profileSyncTimer) {
      window.clearTimeout(this.profileSyncTimer);
    }
  },

  methods: {
    clearLegacyUserDataStorage() {
      const dataPrefixes = [CONVERSATIONS_KEY, CHARACTERS_KEY, CONNECTION_PROFILES_KEY];
      const storageKeys = new Set();

      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);

        if (dataPrefixes.some((prefix) => key === prefix || key?.startsWith(`${prefix}:`))) {
          storageKeys.add(key);
        }
      }

      for (const key of storageKeys) {
        localStorage.removeItem(key);
      }

      sessionStorage.removeItem(SESSION_KEY);
    },

    conversationStorageKey() {
      const accountId = String(this.authContext.accountId || 'public');

      if (accountId === 'default' || accountId === 'public') {
        return CONVERSATIONS_KEY;
      }

      return `${CONVERSATIONS_KEY}:${accountId}`;
    },

    characterStorageKey() {
      const accountId = String(this.authContext.accountId || 'public');

      if (accountId === 'default' || accountId === 'public') {
        return CHARACTERS_KEY;
      }

      return `${CHARACTERS_KEY}:${accountId}`;
    },

    connectionProfileStorageKey() {
      const accountId = String(this.authContext.accountId || 'public');

      if (accountId === 'default' || accountId === 'public') {
        return CONNECTION_PROFILES_KEY;
      }

      return `${CONNECTION_PROFILES_KEY}:${accountId}`;
    },

    async loadAuthContext() {
      try {
        const response = await fetch('/api/auth');

        if (!response.ok) {
          return;
        }

        const data = await response.json();

        this.authContext = {
          authRequired: data.authRequired === true,
          authenticated: data.authenticated !== false,
          accountId: String(data.accountId || (data.authRequired ? 'default' : 'public')),
        };
      } catch (error) {
        console.warn('Failed to load auth context:', error);
      }
    },

    async logout() {
      try {
        await fetch('/api/auth', { method: 'DELETE' });
      } catch (error) {
        console.warn('Failed to logout:', error);
      } finally {
        localStorage.removeItem(STORAGE_KEY);
        this.clearLegacyUserDataStorage();
        window.location.href = '/login.html';
      }
    },

    togglePanel(panel) {
      this.activePanel = this.activePanel === panel ? '' : panel;
    },

    closeAllPanels() {
      this.activePanel = '';
    },

    handleDocumentKeydown(event) {
      if (event.key === 'Escape') {
        this.closeAllPanels();
      }
    },

    syncViewportHeight() {
      const nextHeight = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${Math.round(nextHeight)}px`);
    },

    scheduleViewportHeightSync() {
      if (this.viewportSyncFrame) {
        cancelAnimationFrame(this.viewportSyncFrame);
      }

      this.viewportSyncFrame = requestAnimationFrame(() => {
        this.viewportSyncFrame = 0;
        this.syncViewportHeight();
      });
    },

    setStatus(text, type = 'idle') {
      this.status = { text, type };
    },

    renderParagraphs(value) {
      return renderMarkdown(value);
    },

    async loadDefaultCharacters() {
      try {
        const response = await fetch(DEFAULT_CHARACTERS_URL);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        return normalizeDefaultCharactersPayload(payload);
      } catch (error) {
        console.warn('Failed to load default characters:', error);
        return { characters: [], disabledCharacterIds: [] };
      }
    },

    async loadCharacters() {
      const { characters: defaultCharacters, disabledCharacterIds } = await this.loadDefaultCharacters();
      const disabledCharacterIdsSet = new Set(disabledCharacterIds);

      this.characters = defaultCharacters.filter((character) => !disabledCharacterIdsSet.has(character.id));
    },

    persistCharacters({ sync = true } = {}) {
      if (sync) {
        this.scheduleCharacterSync();
      }
    },

    mergeCharacters(left = [], right = []) {
      const recordsById = new Map();

      [...left, ...right].map((item) => createCharacterRecord(item)).forEach((character) => {
        if (character.id && character.name && character.prompt) {
          recordsById.set(character.id, character);
        }
      });

      return [...recordsById.values()];
    },

    async loadRemoteCharacters() {
      try {
        const response = await fetch('/api/characters');

        if (!response.ok) {
          return;
        }

        const data = await response.json();

        if (!data.configured || !Array.isArray(data.characters)) {
          return;
        }

        const mergedCharacters = this.mergeCharacters(this.characters, data.characters);
        const hasChanges = JSON.stringify(mergedCharacters) !== JSON.stringify(this.characters);

        if (hasChanges) {
          this.characters = mergedCharacters;
          this.persistCharacters({ sync: false });
        }

        if (!data.characters.length && mergedCharacters.length) {
          this.scheduleCharacterSync({ immediate: true });
        }
      } catch (error) {
        console.warn('Failed to load remote characters:', error);
      }
    },

    async syncCharactersToRemote() {
      try {
        await fetch('/api/characters', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ characters: this.characters }),
        });
      } catch (error) {
        console.warn('Failed to sync characters:', error);
      }
    },

    scheduleCharacterSync({ immediate = false } = {}) {
      if (this.characterSyncTimer) {
        window.clearTimeout(this.characterSyncTimer);
      }

      this.characterSyncTimer = window.setTimeout(
        () => {
          this.characterSyncTimer = 0;
          this.syncCharactersToRemote();
        },
        immediate ? 0 : 600,
      );
    },

    async loadDefaultConnectionProfiles() {
      try {
        const response = await fetch(DEFAULT_CONNECTION_PROFILES_URL);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        return Array.isArray(payload) ? payload.map((item) => createConnectionProfileRecord(item)) : [];
      } catch (error) {
        console.warn('Failed to load default connection profiles:', error);
        return [];
      }
    },

    async loadConnectionProfiles() {
      const defaultProfiles = await this.loadDefaultConnectionProfiles();

      this.connectionProfiles = defaultProfiles;
    },

    persistConnectionProfiles({ sync = true } = {}) {
      if (sync) {
        this.scheduleProfileSync();
      }
    },

    loadConversations() {
      this.conversations = [];
    },

    persistConversations({ sync = true } = {}) {
      if (sync) {
        this.scheduleConversationSync();
      }
    },

    async loadRemoteConversations() {
      try {
        const response = await fetch('/api/conversations');

        if (!response.ok) {
          return;
        }

        const data = await response.json();

        if (!data.configured || !Array.isArray(data.conversations)) {
          return;
        }

        const mergedConversations = mergeConversationRecords(this.conversations, data.conversations);
        const hasRemoteChanges = JSON.stringify(mergedConversations) !== JSON.stringify(this.conversations);

        if (hasRemoteChanges) {
          this.conversations = mergedConversations;
          this.persistConversations({ sync: false });
        }

        if (!data.conversations.length && mergedConversations.length) {
          this.scheduleConversationSync({ immediate: true });
        }
      } catch (error) {
        console.warn('Failed to load remote conversations:', error);
      }
    },

    scheduleConversationSync({ immediate = false } = {}) {
      if (this.conversationSyncTimer) {
        window.clearTimeout(this.conversationSyncTimer);
      }

      this.conversationSyncTimer = window.setTimeout(
        () => {
          this.conversationSyncTimer = 0;
          this.syncConversationsToRemote();
        },
        immediate ? 0 : 600,
      );
    },

    async loadRemoteConnectionProfiles() {
      try {
        const response = await fetch('/api/connection-profiles');

        if (!response.ok) {
          return;
        }

        const data = await response.json();

        if (!data.configured || !Array.isArray(data.profiles)) {
          return;
        }

        const remoteMap = new Map(data.profiles.map((profile) => [profile.id, createConnectionProfileRecord(profile)]));
        const mergedProfiles = [...this.connectionProfiles];

        for (const [id, remoteProfile] of remoteMap) {
          const localIndex = mergedProfiles.findIndex((profile) => profile.id === id);

          if (localIndex >= 0) {
            mergedProfiles[localIndex] = createConnectionProfileRecord({
              ...mergedProfiles[localIndex],
              ...remoteProfile,
            });
          } else {
            mergedProfiles.push(remoteProfile);
          }
        }

        const hasChanges = JSON.stringify(mergedProfiles) !== JSON.stringify(this.connectionProfiles);

        if (hasChanges) {
          this.connectionProfiles = mergedProfiles;
          this.persistConnectionProfiles({ sync: false });
        }

        if (!data.profiles.length && mergedProfiles.length) {
          this.scheduleProfileSync({ immediate: true });
        }
      } catch (error) {
        console.warn('Failed to load remote connection profiles:', error);
      }
    },

    async syncConnectionProfilesToRemote(profiles = this.connectionProfiles) {
      try {
        const response = await fetch('/api/connection-profiles', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ profiles }),
        });
        const data = await response.json().catch(() => null);

        if (response.ok && Array.isArray(data?.profiles)) {
          this.connectionProfiles = data.profiles.map((profile) => createConnectionProfileRecord(profile));
        }
      } catch (error) {
        console.warn('Failed to sync connection profiles:', error);
      }
    },

    scheduleProfileSync({ immediate = false } = {}) {
      if (this.profileSyncTimer) {
        window.clearTimeout(this.profileSyncTimer);
      }

      this.profileSyncTimer = window.setTimeout(
        () => {
          this.profileSyncTimer = 0;
          this.syncConnectionProfilesToRemote();
        },
        immediate ? 0 : 600,
      );
    },

    async syncConversationsToRemote() {
      const conversations = this.conversations.filter((record) =>
        hasMeaningfulConversationMessages(record.messages || []),
      );

      try {
        await fetch('/api/conversations', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ conversations }),
        });
      } catch (error) {
        console.warn('Failed to sync conversations:', error);
      }
    },

    loadSettings() {
      const defaults = {
        activeCharacterId: '',
        activeConnectionProfileId: '',
        currentConversationId: '',
      };
      const stored = readJsonStorage(localStorage, STORAGE_KEY, {});
      const merged = { ...defaults, ...stored };

      this.activeCharacterId = merged.activeCharacterId || '';
      if (this.activeCharacterId && !this.characters.some((character) => character.id === this.activeCharacterId)) {
        this.activeCharacterId = '';
      }
      this.activeConnectionProfileId = merged.activeConnectionProfileId || '';
      this.currentConversationId = merged.currentConversationId || '';

      if (this.connectionProfiles.length && !this.currentConnectionProfile) {
        this.activeConnectionProfileId = this.connectionProfiles[0].id;
      }

      if (this.currentConnectionProfile) {
        this.applyConnectionProfile(this.currentConnectionProfile);
        return;
      }

      this.settingsDraft.apiMode = 'chat_completions';
      this.settingsDraft.apiBaseUrl = '';
      this.settingsDraft.apiKey = '';
      this.setModelControls('grok-3');
      this.settingsDraft.systemPrompt = '';
    },

    saveSettings() {
      const payload = {
        activeCharacterId: this.activeCharacterId,
        activeConnectionProfileId: this.activeConnectionProfileId,
        currentConversationId: this.currentConversationId,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      sessionStorage.removeItem(SESSION_KEY);
    },

    setModelControls(model) {
      const normalizedModel = String(model || '').trim();

      if (this.availableModels.includes(normalizedModel)) {
        this.settingsDraft.modelSelect = normalizedModel;
        this.settingsDraft.modelCustom = '';
        return;
      }

      this.settingsDraft.modelSelect = 'grok-3';
      this.settingsDraft.modelCustom = normalizedModel;
    },

    getCurrentSettingsValues() {
      return {
        name: this.settingsDraft.name.trim(),
        apiMode: this.settingsDraft.apiMode,
        apiBaseUrl: this.settingsDraft.apiBaseUrl,
        apiKey: this.settingsDraft.apiKey,
        model: this.selectedModel,
        systemPrompt: this.settingsDraft.systemPrompt,
      };
    },

    applyConnectionProfile(profile) {
      this.activeConnectionProfileId = profile?.id || '';
      this.settingsDraft.name = profile?.name || '';
      this.settingsDraft.apiMode = profile?.apiMode || 'chat_completions';
      this.settingsDraft.apiBaseUrl = profile?.apiBaseUrl || '';
      this.settingsDraft.apiKey = '';
      this.setModelControls(profile?.model || 'grok-3');
      this.settingsDraft.systemPrompt = profile?.systemPrompt || '';
    },

    resetConnectionProfileEditor() {
      this.activeConnectionProfileId = '';
      this.settingsDraft = {
        name: '',
        apiMode: 'chat_completions',
        apiBaseUrl: '',
        apiKey: '',
        modelSelect: 'grok-3',
        modelCustom: '',
        systemPrompt: '',
      };
      this.saveSettings();
    },

    selectConnectionProfile() {
      this.applyConnectionProfile(this.currentConnectionProfile);
      this.saveSettings();
    },

    async saveCurrentConnectionProfile() {
      const values = this.getCurrentSettingsValues();
      const name = values.name || values.apiBaseUrl || values.model || '未命名配置';
      const now = new Date().toISOString();
      let savedProfileId = this.activeConnectionProfileId;

      if (this.activeConnectionProfileId) {
        this.connectionProfiles = this.connectionProfiles.map((profile) =>
          profile.id === this.activeConnectionProfileId
            ? createConnectionProfileRecord({ ...profile, ...values, name, updatedAt: now })
            : profile,
        );
      } else {
        const profile = createConnectionProfileRecord({ ...values, name, updatedAt: now });
        this.activeConnectionProfileId = profile.id;
        savedProfileId = profile.id;
        this.connectionProfiles.push(profile);
      }

      await this.syncConnectionProfilesToRemote(this.connectionProfiles);
      this.activeConnectionProfileId = savedProfileId;
      this.applyConnectionProfile(this.currentConnectionProfile);
      this.saveSettings();
      this.showButtonFeedback('save', '已保存');
    },

    copyCurrentConnectionProfile() {
      const profile = this.currentConnectionProfile;

      if (!profile) {
        return;
      }

      const now = new Date().toISOString();
      const copiedProfile = createConnectionProfileRecord({
        ...profile,
        id: createId('connection-profile'),
        name: `${profile.name || '未命名配置'} copy`,
        apiKey: '',
        hasApiKey: false,
        createdAt: now,
        updatedAt: now,
      });

      this.connectionProfiles.push(copiedProfile);
      this.activeConnectionProfileId = copiedProfile.id;
      this.persistConnectionProfiles();
      this.applyConnectionProfile(copiedProfile);
      this.saveSettings();
      this.showButtonFeedback('copy', '已复制');
    },

    async deleteCurrentConnectionProfile() {
      const profile = this.currentConnectionProfile;

      if (!profile) {
        return;
      }

      const confirmed = window.confirm(`确定删除连接配置“${profile.name || '未命名配置'}”吗？`);

      if (!confirmed) {
        return;
      }

      this.connectionProfiles = this.connectionProfiles.filter((item) => item.id !== profile.id);
      this.activeConnectionProfileId = this.connectionProfiles[0]?.id || '';
      await this.syncConnectionProfilesToRemote();

      if (this.activeConnectionProfileId) {
        this.applyConnectionProfile(this.currentConnectionProfile);
      } else {
        this.resetConnectionProfileEditor();
      }

      this.saveSettings();
    },

    showButtonFeedback(key, message) {
      this.buttonFeedback[key] = message;

      window.setTimeout(() => {
        this.buttonFeedback[key] = '';
      }, 1200);
    },

    syncCharacterEditor() {
      this.characterDraft.name = this.activeCharacter?.name || '';
      this.characterDraft.prompt = this.activeCharacter?.prompt || '';
    },

    syncCharacterEditorAndSave() {
      this.syncCharacterEditor();
      this.saveSettings();
    },

    resetCharacterEditor() {
      this.activeCharacterId = '';
      this.syncCharacterEditor();
      this.saveSettings();
    },

    createOrUpdateCharacter() {
      const name = this.characterDraft.name.trim();
      const prompt = this.characterDraft.prompt.trim();

      if (!name || !prompt) {
        window.alert('请先填写角色名和角色设定。');
        return;
      }

      if (this.activeCharacterId) {
        this.characters = this.characters.map((character) =>
          character.id === this.activeCharacterId
            ? createCharacterRecord({ ...character, name, prompt })
            : character,
        );
      } else {
        const character = createCharacterRecord({ name, prompt });
        this.activeCharacterId = character.id;
        this.characters.push(character);
      }

      this.persistCharacters();
      this.syncCharacterEditor();
      this.saveSettings();
    },

    copyCurrentCharacter() {
      const character = this.activeCharacter;

      if (!character) {
        return;
      }

      const copiedCharacter = createCharacterRecord({
        ...character,
        id: createId('character'),
        name: `${character.name || '未命名角色'} copy`,
      });

      this.characters.push(copiedCharacter);
      this.activeCharacterId = copiedCharacter.id;
      this.persistCharacters();
      this.syncCharacterEditor();
      this.saveSettings();
      this.showButtonFeedback('characterCopy', '已复制');
    },

    deleteCurrentCharacter() {
      if (!this.activeCharacter) {
        return;
      }

      const confirmed = window.confirm(`确定删除角色“${this.activeCharacter.name}”吗？`);

      if (!confirmed) {
        return;
      }

      this.characters = this.characters.filter((character) => character.id !== this.activeCharacterId);
      this.activeCharacterId = '';
      this.persistCharacters();
      this.syncCharacterEditor();
      this.saveSettings();
    },

    ensureConversationState() {
      if (!this.conversations.length) {
        const record = createConversationRecord();
        this.conversations = [record];
        this.currentConversationId = record.id;
        this.persistConversations();
        return;
      }

      const existing = this.conversations.find((item) => item.id === this.currentConversationId);

      if (!existing) {
        const sorted = [...this.conversations].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        this.currentConversationId = sorted[0]?.id || this.conversations[0].id;
      }
    },

    getCurrentConversationRecord() {
      return this.conversations.find((item) => item.id === this.currentConversationId) || null;
    },

    loadConversationIntoView(record) {
      this.conversation = cloneMessages(record?.messages || []);
      this.scrollChatToBottom();
    },

    pruneEmptyConversations({ keepCurrent = true } = {}) {
      this.conversations = this.conversations.filter((record) => {
        if (keepCurrent && record.id === this.currentConversationId) {
          return true;
        }

        return hasMeaningfulConversationMessages(record.messages || []);
      });
    },

    saveCurrentConversationState() {
      const record = this.getCurrentConversationRecord();

      if (!record) {
        return;
      }

      const messages = cloneMessages(this.conversation);
      record.messages = messages;
      record.updatedAt = new Date().toISOString();
      record.title = createConversationTitle(messages);
      this.pruneEmptyConversations();
      this.persistConversations();
    },

    selectConversation(record) {
      if (record.id === this.currentConversationId) {
        this.closeAllPanels();
        return;
      }

      this.saveCurrentConversationState();
      this.currentConversationId = record.id;
      this.loadConversationIntoView(record);
      this.clearDebug();
      this.setStatus(record.messages.length ? '已恢复' : '未发送', record.messages.length ? 'success' : 'idle');
      this.saveSettings();
      this.closeAllPanels();
    },

    deleteConversation(record) {
      if (!record) {
        return;
      }

      const title = record.title || '新对话';
      const confirmed = window.confirm(`确定删除对话“${title}”吗？`);

      if (!confirmed) {
        return;
      }

      const isCurrentConversation = record.id === this.currentConversationId;
      this.conversations = this.conversations.filter((item) => item.id !== record.id);

      if (isCurrentConversation) {
        let nextRecord = [...this.conversations].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )[0];

        if (!nextRecord) {
          nextRecord = createConversationRecord();
          this.conversations = [nextRecord];
        }

        this.currentConversationId = nextRecord.id;
        this.loadConversationIntoView(nextRecord);
        this.clearDebug();
        this.setStatus(nextRecord.messages.length ? '已恢复' : '未发送', nextRecord.messages.length ? 'success' : 'idle');
      }

      this.persistConversations();
      this.saveSettings();
    },

    startNewConversation() {
      this.saveCurrentConversationState();
      this.pruneEmptyConversations({ keepCurrent: false });

      const record = createConversationRecord();
      this.conversations.push(record);
      this.currentConversationId = record.id;
      this.conversation = [];
      this.clearDebug();
      this.setStatus('未发送', 'idle');
      this.saveSettings();
    },

    clearConversation() {
      if (!this.conversation.length) {
        return;
      }

      const confirmed = window.confirm('确定清空当前对话吗？');

      if (!confirmed) {
        return;
      }

      this.conversation = [];
      this.clearDebug();
      this.setStatus('未发送', 'idle');
      this.saveCurrentConversationState();
    },

    formatConversationTime(value) {
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
    },

    getConversationPreview(record) {
      const previewSource = record.messages.find((message) => message.role === 'user')?.content || '';
      return String(previewSource).replace(/\s+/g, ' ').trim().slice(0, 40) || '空白对话';
    },

    buildEffectiveSystemPrompt({ includeCharacter = true } = {}) {
      const manualPrompt = String(this.settingsDraft.systemPrompt || '').trim();
      const parts = [];

      if (includeCharacter && this.activeCharacter?.prompt) {
        parts.push(
          [
            '请始终稳定扮演以下角色，不要跳出设定。',
            `角色名：${this.activeCharacter.name}`,
            '角色设定：',
            this.activeCharacter.prompt,
          ].join('\n'),
        );
      }

      if (manualPrompt) {
        parts.push(manualPrompt);
      }

      return parts.join('\n\n').trim();
    },

    buildRequestMessages() {
      return this.conversation
        .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content)
        .map((message) => ({
          role: message.role,
          content: message.content,
        }));
    },

    validateChatConfig() {
      if (!this.currentConnectionProfile) {
        this.showConfigError('请先保存并选择一个连接配置。');
        return false;
      }

      if (!String(this.currentConnectionProfile.apiBaseUrl || '').trim()) {
        this.showConfigError('当前连接配置缺少 API Base URL，请补全后保存。');
        return false;
      }

      if (!this.currentConnectionProfile.hasApiKey) {
        this.showConfigError('当前连接配置缺少已保存的 API Key，请填写并保存。');
        return false;
      }

      return true;
    },

    showConfigError(message) {
      this.setStatus('配置缺失', 'error');
      this.debug.meta = message;
      this.debug.reasoning = '';
      this.debug.raw = '';
      this.activePanel = 'settings';
    },

    clearDebug() {
      this.debug = { meta: '', reasoning: '', raw: '' };
    },

    getCharacterPromptStats() {
      if (!this.activeCharacter) {
        return '无角色';
      }

      return `每轮发送 · ${this.activeCharacter.prompt.length} 字`;
    },

    updateDebug(data, response) {
      this.debug.meta = [
        `API Mode: ${data.apiMode ?? 'chat_completions'}`,
        `Model: ${this.selectedModel || '-'}`,
        `HTTP Status: ${data.status ?? response.status}`,
        `Endpoint: ${data.endpoint ?? '-'}`,
        `Success: ${String(data.ok ?? response.ok)}`,
        `Character: ${this.activeCharacter?.name || '无角色'}`,
        `Character Prompt: ${this.getCharacterPromptStats()}`,
      ].join('\n');
      this.debug.reasoning = data.reasoning || '';
      this.debug.raw = JSON.stringify(data.data ?? data, null, 2);
    },

    extractErrorMessage(data, response) {
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
    },

    parseStreamEvents(buffer, onEvent) {
      buffer = buffer.replaceAll('\r\n', '\n');
      const blocks = buffer.split('\n\n');
      const rest = blocks.pop() || '';

      for (const block of blocks) {
        let event = 'message';
        const dataLines = [];

        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          }

          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }

        if (!dataLines.length) {
          continue;
        }

        try {
          onEvent({ event, data: JSON.parse(dataLines.join('\n')) });
        } catch {
          onEvent({ event, data: { raw_text: dataLines.join('\n') } });
        }
      }

      return rest;
    },

    updateStreamDebug(data, response) {
      this.debug.meta = [
        `API Mode: ${data.apiMode ?? this.settingsDraft.apiMode ?? 'chat_completions'}`,
        `Model: ${this.selectedModel || '-'}`,
        `HTTP Status: ${data.status ?? response?.status ?? '-'}`,
        `Endpoint: ${data.endpoint ?? '-'}`,
        `Success: ${String(data.ok ?? response?.ok ?? '-')}`,
        `Character: ${this.activeCharacter?.name || '无角色'}`,
        `Character Prompt: ${this.getCharacterPromptStats()}`,
      ].join('\n');

      if (typeof data.reasoning === 'string') {
        this.debug.reasoning = data.reasoning;
      }
    },

    async submitMessage() {
      const messageText = this.userMessage.trim();

      if (!messageText) {
        return;
      }

      if (!this.validateChatConfig()) {
        return;
      }

      this.saveSettings();
      this.userMessage = '';
      await this.requestAssistantResponse(messageText, { appendUserMessage: true });
    },

    async retryLastResponse() {
      if (this.isRequestInFlight) {
        return;
      }

      const index = this.lastUserMessageIndex;

      if (index === -1) {
        return;
      }

      const messageText = String(this.conversation[index].content || '').trim();

      if (!messageText || !this.validateChatConfig()) {
        return;
      }

      this.conversation = this.conversation.slice(0, index + 1);
      this.clearDebug();
      this.setStatus('未发送', 'idle');
      this.saveCurrentConversationState();
      await this.requestAssistantResponse(messageText, { appendUserMessage: false });
    },

    async requestAssistantResponse(messageText, { appendUserMessage = true } = {}) {
      if (this.isRequestInFlight) {
        return;
      }

      const assistantMessage = {
        role: 'assistant',
        characterName: this.activeCharacter?.name || '助手',
        content: '',
        reasoning: '',
        pending: true,
        error: false,
      };

      this.isRequestInFlight = true;

      if (appendUserMessage) {
        this.conversation.push({ role: 'user', content: messageText });
      }

      this.conversation.push(assistantMessage);
      this.setStatus('请求中', 'busy');
      this.clearDebug();
      this.saveCurrentConversationState();
      this.scrollChatToBottom();

      const payload = {
        profileId: this.activeConnectionProfileId,
        stream: true,
        systemPrompt: this.buildEffectiveSystemPrompt(),
        userMessage: messageText,
        messages: this.buildRequestMessages(),
      };

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const contentType = response.headers.get('Content-Type') || '';

        if (!contentType.includes('text/event-stream') || !response.body) {
          const data = await response.json();
          this.updateDebug(data, response);

          const errorMessage = this.extractErrorMessage(data, response);
          assistantMessage.pending = false;
          assistantMessage.content =
            data.answer ||
            (data.ok
              ? '模型已完成响应，但正文为空。你可以展开下方调试面板继续看原始返回。'
              : errorMessage || '请求失败');
          assistantMessage.reasoning = data.reasoning || '';
          assistantMessage.error = !response.ok || !data.ok;

          if (assistantMessage.error) {
            this.activePanel = 'debug';
          }

          this.setStatus(data.ok ? '已完成' : '请求失败', data.ok ? 'success' : 'error');
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalData = null;
        let streamError = null;
        const renderQueue = { content: '', reasoning: '' };
        let renderTimer = 0;

        const flushQueuedText = () =>
          new Promise((resolve) => {
            const flush = () => {
              renderTimer = 0;

              const contentStep = Math.min(renderQueue.content.length, renderQueue.content.length > 80 ? 8 : 4);
              const reasoningStep = Math.min(renderQueue.reasoning.length, renderQueue.reasoning.length > 80 ? 12 : 6);

              if (contentStep > 0) {
                assistantMessage.content += renderQueue.content.slice(0, contentStep);
                renderQueue.content = renderQueue.content.slice(contentStep);
              }

              if (reasoningStep > 0) {
                assistantMessage.reasoning += renderQueue.reasoning.slice(0, reasoningStep);
                renderQueue.reasoning = renderQueue.reasoning.slice(reasoningStep);
                this.debug.reasoning = assistantMessage.reasoning;
              }

              if (renderQueue.content || renderQueue.reasoning) {
                renderTimer = window.setTimeout(flush, 18);
                return;
              }

              resolve();
            };

            if (renderTimer) {
              resolve();
              return;
            }

            flush();
          });

        const drainQueuedText = () =>
          new Promise((resolve) => {
            const drain = () => {
              if (renderTimer) {
                window.clearTimeout(renderTimer);
                renderTimer = 0;
              }

              const contentStep = Math.min(renderQueue.content.length, renderQueue.content.length > 80 ? 8 : 4);
              const reasoningStep = Math.min(renderQueue.reasoning.length, renderQueue.reasoning.length > 80 ? 12 : 6);

              if (contentStep > 0) {
                assistantMessage.content += renderQueue.content.slice(0, contentStep);
                renderQueue.content = renderQueue.content.slice(contentStep);
              }

              if (reasoningStep > 0) {
                assistantMessage.reasoning += renderQueue.reasoning.slice(0, reasoningStep);
                renderQueue.reasoning = renderQueue.reasoning.slice(reasoningStep);
                this.debug.reasoning = assistantMessage.reasoning;
              }

              if (renderQueue.content || renderQueue.reasoning) {
                window.setTimeout(drain, 18);
                return;
              }

              resolve();
            };

            drain();
          });

        const enqueueStreamText = (data) => {
          renderQueue.content += data.content || '';
          renderQueue.reasoning += data.reasoning || '';
          flushQueuedText();
        };

        const applyStreamEvent = ({ event, data }) => {
          if (event === 'meta') {
            this.updateStreamDebug(data, response);
            this.debug.raw = JSON.stringify(data, null, 2);
            return;
          }

          if (event === 'delta') {
            enqueueStreamText(data);
            return;
          }

          if (event === 'error') {
            streamError = data;
            this.debug.raw = JSON.stringify(data, null, 2);
            return;
          }

          if (event === 'done') {
            finalData = data;
            this.updateStreamDebug(data, response);
            this.debug.raw = JSON.stringify(data, null, 2);
          }
        };

        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          buffer = this.parseStreamEvents(buffer, applyStreamEvent);
        }

        if (buffer.trim()) {
          this.parseStreamEvents(`${buffer}\n\n`, applyStreamEvent);
        }

        await drainQueuedText();

        assistantMessage.pending = false;

        if (streamError) {
          const errorMessage = this.extractErrorMessage(streamError, response);
          assistantMessage.error = true;
          assistantMessage.content = assistantMessage.content || errorMessage || streamError.error || '请求失败';
          this.setStatus('请求失败', 'error');
          this.activePanel = 'debug';
          return;
        }

        if (!assistantMessage.content) {
          assistantMessage.content = finalData?.ok
            ? '模型已完成响应，但正文为空。你可以展开下方调试面板继续看原始返回。'
            : '请求失败';
        }

        assistantMessage.error = false;
        this.setStatus('已完成', 'success');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        assistantMessage.pending = false;
        assistantMessage.error = true;
        assistantMessage.content = `请求失败：${message}`;
        this.debug.meta = `请求失败：${message}`;
        this.debug.reasoning = '';
        this.debug.raw = '';
        this.setStatus('请求失败', 'error');
        this.activePanel = 'debug';
      } finally {
        this.isRequestInFlight = false;
        this.saveCurrentConversationState();
      }
    },

    scrollChatToBottom() {
      nextTick(() => {
        const feed = this.$refs.chatFeed;

        if (feed) {
          feed.scrollTop = feed.scrollHeight;
        }
      });
    },
  },
}).mount('#app');
