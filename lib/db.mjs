import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', '.data');
const DB_PATH = path.join(DATA_DIR, 'razor-chat.db');
const DEFAULT_SCOPE = 'default';

let db = undefined;

function loadBetterSqlite3() {
  const require = createRequire(import.meta.url);
  return require('better-sqlite3');
}

export function getDb() {
  if (process.env.VERCEL) {
    return null;
  }

  if (db !== undefined) {
    return db;
  }

  try {
    const Database = loadBetterSqlite3();
    mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    ensureSchema(db);
    migrateLegacyStorage(db);
    return db;
  } catch {
    db = null;
    return null;
  }
}

function ensureSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS connection_profiles (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL DEFAULT '',
      api_mode     TEXT NOT NULL DEFAULT 'chat_completions',
      api_base_url TEXT NOT NULL DEFAULT '',
      api_key      TEXT NOT NULL DEFAULT '',
      model        TEXT NOT NULL DEFAULT 'grok-3',
      system_prompt TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      scope        TEXT NOT NULL,
      id           TEXT NOT NULL,
      title        TEXT NOT NULL DEFAULT '',
      messages_json TEXT NOT NULL DEFAULT '[]',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      PRIMARY KEY (scope, id)
    );

    CREATE TABLE IF NOT EXISTS characters (
      scope        TEXT NOT NULL,
      id           TEXT NOT NULL,
      name         TEXT NOT NULL DEFAULT '',
      prompt       TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (scope, id)
    );

    CREATE TABLE IF NOT EXISTS access_users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      password      TEXT NOT NULL DEFAULT '',
      display_name  TEXT NOT NULL DEFAULT '',
      disabled      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS access_users_username_idx
      ON access_users(username);
  `);
}

function migrateLegacyStorage(database) {
  migrateLegacyProfiles(database);
  migrateLegacyScopedFiles(database, {
    prefix: 'conversations',
    readCount: (scope) =>
      database.prepare('SELECT COUNT(*) AS count FROM conversations WHERE scope = ?').get(scope).count,
    writeRows: (scope, rows) => setStoredConversations(scope, rows),
  });
  migrateLegacyScopedFiles(database, {
    prefix: 'characters',
    readCount: (scope) =>
      database.prepare('SELECT COUNT(*) AS count FROM characters WHERE scope = ?').get(scope).count,
    writeRows: (scope, rows) => setStoredCharacters(scope, rows),
  });
}

function migrateLegacyProfiles(database) {
  const hasRows = database.prepare('SELECT 1 FROM connection_profiles LIMIT 1').get();
  const legacyPath = path.join(DATA_DIR, 'profiles.json');

  if (hasRows || !existsSync(legacyPath)) {
    return;
  }

  const rows = readLegacyArrayFile(legacyPath);
  if (rows.length) {
    setConnectionProfiles(rows);
  }
}

function migrateLegacyScopedFiles(database, { prefix, readCount, writeRows }) {
  const filenames = readdirSync(DATA_DIR, { encoding: 'utf8' }).filter((name) => {
    return name === `${prefix}.json` || new RegExp(`^${prefix}-.+\\.json$`).test(name);
  });

  for (const filename of filenames) {
    const scope = normalizeScopeFromFilename(filename, prefix);

    if (readCount(scope) > 0) {
      continue;
    }

    const rows = readLegacyArrayFile(path.join(DATA_DIR, filename));
    if (rows.length) {
      writeRows(scope, rows);
    }
  }
}

function normalizeScopeFromFilename(filename, prefix) {
  if (filename === `${prefix}.json`) {
    return DEFAULT_SCOPE;
  }

  return normalizeScope(filename.slice(prefix.length + 1, -'.json'.length));
}

function normalizeScope(value) {
  const normalized = String(value || DEFAULT_SCOPE)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || DEFAULT_SCOPE;
}

function readLegacyArrayFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getConnectionProfiles() {
  const database = getDb();
  if (!database) return [];

  const rows = database
    .prepare('SELECT * FROM connection_profiles ORDER BY updated_at DESC')
    .all();

  return rows.map(mapRowToProfile);
}

export function setConnectionProfiles(profiles) {
  const database = getDb();
  if (!database) return;

  const insert = database.prepare(`
    INSERT INTO connection_profiles
      (id, name, api_mode, api_base_url, api_key, model, system_prompt, created_at, updated_at)
    VALUES
      (@id, @name, @api_mode, @api_base_url, @api_key, @model, @system_prompt, @created_at, @updated_at)
  `);

  const transaction = database.transaction((rows) => {
    database.exec('DELETE FROM connection_profiles');
    for (const row of rows) {
      insert.run(mapProfileToRow(row));
    }
  });

  transaction(profiles);
  return true;
}

function mapRowToProfile(row) {
  return {
    id: row.id,
    name: row.name,
    apiMode: row.api_mode,
    apiBaseUrl: row.api_base_url,
    apiKey: row.api_key,
    model: row.model,
    systemPrompt: row.system_prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProfileToRow(profile) {
  return {
    id: profile.id,
    name: profile.name,
    api_mode: profile.apiMode,
    api_base_url: profile.apiBaseUrl,
    api_key: profile.apiKey,
    model: profile.model,
    system_prompt: profile.systemPrompt,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };
}

export function getStoredConversations(scope = DEFAULT_SCOPE) {
  const database = getDb();
  if (!database) return [];

  const rows = database
    .prepare('SELECT * FROM conversations WHERE scope = ? ORDER BY updated_at DESC')
    .all(normalizeScope(scope));

  return rows.map(mapRowToConversation);
}

export function setStoredConversations(scope, conversations) {
  const database = getDb();
  if (!database) return;

  const normalizedScope = normalizeScope(scope);
  const insert = database.prepare(`
    INSERT INTO conversations
      (scope, id, title, messages_json, created_at, updated_at)
    VALUES
      (@scope, @id, @title, @messages_json, @created_at, @updated_at)
  `);

  const transaction = database.transaction((rows) => {
    database.prepare('DELETE FROM conversations WHERE scope = ?').run(normalizedScope);
    for (const row of rows) {
      insert.run(mapConversationToRow(normalizedScope, row));
    }
  });

  transaction(conversations);
  return true;
}

function mapRowToConversation(row) {
  return {
    id: row.id,
    title: row.title,
    messages: parseMessagesJson(row.messages_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConversationToRow(scope, conversation) {
  return {
    scope,
    id: conversation.id,
    title: conversation.title,
    messages_json: JSON.stringify(Array.isArray(conversation.messages) ? conversation.messages : []),
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
  };
}

function parseMessagesJson(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getStoredCharacters(scope = DEFAULT_SCOPE) {
  const database = getDb();
  if (!database) return [];

  const rows = database
    .prepare('SELECT * FROM characters WHERE scope = ? ORDER BY name COLLATE NOCASE ASC, id ASC')
    .all(normalizeScope(scope));

  return rows.map(mapRowToCharacter);
}

export function setStoredCharacters(scope, characters) {
  const database = getDb();
  if (!database) return;

  const normalizedScope = normalizeScope(scope);
  const insert = database.prepare(`
    INSERT INTO characters
      (scope, id, name, prompt)
    VALUES
      (@scope, @id, @name, @prompt)
  `);

  const transaction = database.transaction((rows) => {
    database.prepare('DELETE FROM characters WHERE scope = ?').run(normalizedScope);
    for (const row of rows) {
      insert.run(mapCharacterToRow(normalizedScope, row));
    }
  });

  transaction(characters);
  return true;
}

function mapRowToCharacter(row) {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
  };
}

function mapCharacterToRow(scope, character) {
  return {
    scope,
    id: character.id,
    name: character.name,
    prompt: character.prompt,
  };
}

export function getStoredAccessUsers({ includeDisabled = false } = {}) {
  const database = getDb();
  if (!database) return [];

  const whereClause = includeDisabled ? '' : 'WHERE disabled = 0';
  const rows = database
    .prepare(
      `SELECT id, username, password_hash, password, display_name, disabled, created_at, updated_at
       FROM access_users
       ${whereClause}
       ORDER BY username COLLATE NOCASE ASC, id ASC`,
    )
    .all();

  return rows.map(mapRowToAccessUser);
}

export function upsertAccessUser(user) {
  const database = getDb();
  if (!database) return false;

  const now = new Date().toISOString();
  const row = {
    id: String(user.id || user.username || '').trim(),
    username: String(user.username || user.id || '').trim(),
    password_hash: String(user.passwordHash || ''),
    password: String(user.password || ''),
    display_name: String(user.displayName || ''),
    disabled: user.disabled ? 1 : 0,
    created_at: String(user.createdAt || now),
    updated_at: String(user.updatedAt || now),
  };

  if (!row.id || !row.username || (!row.password_hash && !row.password)) {
    return false;
  }

  database
    .prepare(
      `
      INSERT INTO access_users
        (id, username, password_hash, password, display_name, disabled, created_at, updated_at)
      VALUES
        (@id, @username, @password_hash, @password, @display_name, @disabled, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        password_hash = excluded.password_hash,
        password = excluded.password,
        display_name = excluded.display_name,
        disabled = excluded.disabled,
        updated_at = excluded.updated_at
    `,
    )
    .run(row);

  return true;
}

function mapRowToAccessUser(row) {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    password: row.password,
    displayName: row.display_name,
    disabled: Boolean(row.disabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
