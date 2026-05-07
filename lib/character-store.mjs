import { Redis } from '@upstash/redis';
import { getDb, getStoredCharacters as getDbCharacters, setStoredCharacters as setDbCharacters } from './db.mjs';

const STORE_KEY = process.env.CHARACTERS_STORE_KEY || 'grok-demo:characters:v1';
const DEFAULT_SCOPE = 'default';

let redisClient;

function getRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  if (!redisClient) {
    redisClient = new Redis({ url, token });
  }

  return redisClient;
}

function normalizeScope(value) {
  const normalized = String(value || DEFAULT_SCOPE)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || DEFAULT_SCOPE;
}

function getStoreKey(scope) {
  const normalizedScope = normalizeScope(scope);

  return normalizedScope === DEFAULT_SCOPE ? STORE_KEY : `${STORE_KEY}:${normalizedScope}`;
}

function normalizeCharacter(seed = {}) {
  return {
    id: String(seed.id || ''),
    name: String(seed.name || '').trim(),
    prompt: String(seed.prompt || '').trim(),
  };
}

export function normalizeCharacters(value) {
  return Array.isArray(value)
    ? value.map((item) => normalizeCharacter(item)).filter((item) => item.id && item.name && item.prompt)
    : [];
}

export async function getStoredCharacters({ scope = DEFAULT_SCOPE } = {}) {
  const normalizedScope = normalizeScope(scope);
  const redis = getRedisClient();

  if (redis) {
    const value = await redis.get(getStoreKey(normalizedScope));
    return {
      storage: 'upstash-redis',
      scope: normalizedScope,
      configured: true,
      characters: normalizeCharacters(value),
    };
  }

  if (process.env.VERCEL) {
    return {
      storage: 'unconfigured',
      scope: normalizedScope,
      configured: false,
      characters: [],
    };
  }

  const database = getDb();

  if (!database) {
    const error = new Error('本地 SQLite 存储不可用：请确认 better-sqlite3 已正确安装');
    error.statusCode = 503;
    throw error;
  }

  return {
    storage: 'sqlite',
    scope: normalizedScope,
    configured: true,
    characters: getDbCharacters(normalizedScope),
  };
}

export async function setStoredCharacters(value, { scope = DEFAULT_SCOPE } = {}) {
  const normalizedScope = normalizeScope(scope);
  const characters = normalizeCharacters(value);
  const redis = getRedisClient();

  if (redis) {
    await redis.set(getStoreKey(normalizedScope), characters);
    return {
      storage: 'upstash-redis',
      scope: normalizedScope,
      configured: true,
      characters,
    };
  }

  if (process.env.VERCEL) {
    const error = new Error(
      '角色同步存储未配置：缺少 UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN 或 KV_REST_API_URL/KV_REST_API_TOKEN',
    );
    error.statusCode = 503;
    throw error;
  }

  const database = getDb();

  if (!database) {
    const error = new Error('本地 SQLite 存储不可用：请确认 better-sqlite3 已正确安装');
    error.statusCode = 503;
    throw error;
  }

  setDbCharacters(normalizedScope, characters);

  return {
    storage: 'sqlite',
    scope: normalizedScope,
    configured: true,
    characters,
  };
}
