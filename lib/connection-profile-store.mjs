import { Redis } from '@upstash/redis';
import {
  getDb,
  getConnectionProfilesForAccount as getDbProfiles,
  setConnectionProfilesForAccount as setDbProfiles,
} from './db.mjs';

const STORE_KEY = process.env.CONNECTION_PROFILES_STORE_KEY || 'grok-demo:connection-profiles:v1';
const DEFAULT_ACCOUNT_ID = 'default';

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

export function normalizeProfile(seed = {}) {
  const now = new Date().toISOString();

  return {
    id: String(seed.id || ''),
    name: String(seed.name || ''),
    apiMode: seed.apiMode === 'responses' ? 'responses' : 'chat_completions',
    apiBaseUrl: String(seed.apiBaseUrl || ''),
    apiKey: String(seed.apiKey || ''),
    model: String(seed.model || 'grok-3'),
    systemPrompt: String(seed.systemPrompt || ''),
    createdAt: String(seed.createdAt || now),
    updatedAt: String(seed.updatedAt || now),
  };
}

export function normalizeProfiles(value) {
  return Array.isArray(value) ? value.map((item) => normalizeProfile(item)) : [];
}

function normalizeAccountId(value) {
  const normalized = String(value || DEFAULT_ACCOUNT_ID)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || DEFAULT_ACCOUNT_ID;
}

function getStoreKey(accountId) {
  const normalizedAccountId = normalizeAccountId(accountId);

  return normalizedAccountId === DEFAULT_ACCOUNT_ID ? STORE_KEY : `${STORE_KEY}:${normalizedAccountId}`;
}

export async function getConnectionProfiles({ accountId } = {}) {
  const normalizedAccountId = normalizeAccountId(accountId || DEFAULT_ACCOUNT_ID);
  const redis = getRedisClient();

  if (redis) {
    const value = await redis.get(getStoreKey(normalizedAccountId));
    return {
      storage: 'upstash-redis',
      accountId: normalizedAccountId,
      configured: true,
      profiles: normalizeProfiles(value),
    };
  }

  if (process.env.VERCEL) {
    return {
      storage: 'unconfigured',
      accountId: normalizedAccountId,
      configured: false,
      profiles: [],
    };
  }

  const database = getDb();

  if (!database) {
    const error = new Error('本地 SQLite 存储不可用：请确认 better-sqlite3 已正确安装');
    error.statusCode = 503;
    throw error;
  }

  const dbProfiles = getDbProfiles(normalizedAccountId);
  return {
    storage: 'sqlite',
    accountId: normalizedAccountId,
    configured: true,
    profiles: dbProfiles,
  };
}

export async function setConnectionProfiles(value, { accountId } = {}) {
  const normalizedAccountId = normalizeAccountId(accountId || DEFAULT_ACCOUNT_ID);
  const profiles = normalizeProfiles(value);
  const redis = getRedisClient();

  if (redis) {
    await redis.set(getStoreKey(normalizedAccountId), profiles);
    return {
      storage: 'upstash-redis',
      accountId: normalizedAccountId,
      configured: true,
      profiles,
    };
  }

  if (process.env.VERCEL) {
    const error = new Error(
      '连接配置存储未配置：缺少 UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN 或 KV_REST_API_URL/KV_REST_API_TOKEN',
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

  setDbProfiles(normalizedAccountId, profiles);

  return {
    storage: 'sqlite',
    accountId: normalizedAccountId,
    configured: true,
    profiles,
  };
}
