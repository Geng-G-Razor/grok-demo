import { Redis } from '@upstash/redis';
import { getDb, getStoredConversations as getDbConversations, setStoredConversations as setDbConversations } from './db.mjs';

const STORE_KEY = process.env.CONVERSATIONS_STORE_KEY || 'grok-demo:conversations:v1';
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

function normalizeMessage(message = {}) {
  return {
    role: String(message.role || ''),
    characterName: String(message.characterName || ''),
    content: String(message.content || ''),
    reasoning: String(message.reasoning || ''),
    pending: false,
    error: Boolean(message.error),
  };
}

function normalizeConversation(record = {}) {
  const now = new Date().toISOString();

  return {
    id: String(record.id || `conversation-${Date.now()}`),
    title: String(record.title || '新对话'),
    messages: Array.isArray(record.messages) ? record.messages.map((message) => normalizeMessage(message)) : [],
    createdAt: String(record.createdAt || now),
    updatedAt: String(record.updatedAt || now),
  };
}

export function normalizeConversations(value) {
  return Array.isArray(value) ? value.map((record) => normalizeConversation(record)) : [];
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

export async function getStoredConversations({ accountId } = {}) {
  const normalizedAccountId = normalizeAccountId(accountId || DEFAULT_ACCOUNT_ID);
  const redis = getRedisClient();

  if (redis) {
    const value = await redis.get(getStoreKey(normalizedAccountId));
    return {
      storage: 'upstash-redis',
      accountId: normalizedAccountId,
      configured: true,
      conversations: normalizeConversations(value),
    };
  }

  if (process.env.VERCEL) {
    return {
      storage: 'unconfigured',
      accountId: normalizedAccountId,
      configured: false,
      conversations: [],
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
    accountId: normalizedAccountId,
    configured: true,
    conversations: getDbConversations(normalizedAccountId),
  };
}

export async function setStoredConversations(value, { accountId } = {}) {
  const normalizedAccountId = normalizeAccountId(accountId || DEFAULT_ACCOUNT_ID);
  const conversations = normalizeConversations(value);
  const redis = getRedisClient();

  if (redis) {
    await redis.set(getStoreKey(normalizedAccountId), conversations);
    return {
      storage: 'upstash-redis',
      accountId: normalizedAccountId,
      configured: true,
      conversations,
    };
  }

  if (process.env.VERCEL) {
    const error = new Error(
      '聊天记录同步存储未配置：缺少 UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN 或 KV_REST_API_URL/KV_REST_API_TOKEN',
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

  setDbConversations(normalizedAccountId, conversations);

  return {
    storage: 'sqlite',
    accountId: normalizedAccountId,
    configured: true,
    conversations,
  };
}
