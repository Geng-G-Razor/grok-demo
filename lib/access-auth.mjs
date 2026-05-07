export const AUTH_COOKIE_NAME = 'razor_chat_auth';
export const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();
const DEFAULT_ACCESS_ID = 'default';
const PUBLIC_ACCESS_ID = 'public';

export function getAccessPassword() {
  return String(process.env.APP_PASSWORD || process.env.ACCESS_PASSWORD || '');
}

export function isAccessAuthEnabled() {
  return getAccessUsers().length > 0;
}

function normalizeAccessId(value, fallback = DEFAULT_ACCESS_ID) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || fallback;
}

function readConfiguredUsers() {
  const raw = process.env.APP_PASSWORDS_JSON || process.env.ACCESS_USERS_JSON || '';

  if (!raw.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([id, password]) => ({ id, password }));
    }
  } catch (error) {
    console.warn('APP_PASSWORDS_JSON/ACCESS_USERS_JSON is not valid JSON:', error);
  }

  return [];
}

export function getAccessUsers() {
  const usersById = new Map();
  const legacyPassword = getAccessPassword();

  if (legacyPassword) {
    usersById.set(DEFAULT_ACCESS_ID, {
      id: DEFAULT_ACCESS_ID,
      password: legacyPassword,
    });
  }

  readConfiguredUsers().forEach((item, index) => {
    const id = normalizeAccessId(item?.id || item?.name, `user-${index + 1}`);
    const password = String(item?.password || '');

    if (password) {
      usersById.set(id, { id, password });
    }
  });

  return [...usersById.values()];
}

export function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const separatorIndex = item.indexOf('=');

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = item.slice(0, separatorIndex).trim();
      const value = item.slice(separatorIndex + 1).trim();

      if (key) {
        cookies[key] = decodeURIComponent(value);
      }

      return cookies;
    }, {});
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isEqualString(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));

  return toHex(signature);
}

export async function createAuthToken(password, now = Date.now()) {
  const issuedAt = String(now);
  const signature = await hmacHex(password, issuedAt);

  return `${issuedAt}.${signature}`;
}

export async function createAccessAuthToken(accessUser, now = Date.now()) {
  const accessId = normalizeAccessId(accessUser?.id);
  const issuedAt = String(now);
  const signature = await hmacHex(accessUser.password, `${accessId}.${issuedAt}`);

  return `${accessId}.${issuedAt}.${signature}`;
}

export async function verifyAuthToken(token, password, now = Date.now()) {
  const [issuedAt, signature] = String(token || '').split('.');
  const issuedAtNumber = Number(issuedAt);

  if (!issuedAt || !signature || !Number.isFinite(issuedAtNumber)) {
    return false;
  }

  const ageMs = now - issuedAtNumber;

  if (ageMs < 0 || ageMs > AUTH_MAX_AGE_SECONDS * 1000) {
    return false;
  }

  const expectedSignature = await hmacHex(password, issuedAt);

  return isEqualString(signature, expectedSignature);
}

export async function verifyAccessAuthToken(token, now = Date.now()) {
  const users = getAccessUsers();

  if (!users.length) {
    return { id: PUBLIC_ACCESS_ID };
  }

  const parts = String(token || '').split('.');

  if (parts.length === 2) {
    const legacyUser = users.find((user) => user.id === DEFAULT_ACCESS_ID);
    const legacyValid = legacyUser ? await verifyAuthToken(token, legacyUser.password, now) : false;

    return legacyValid ? { id: DEFAULT_ACCESS_ID } : null;
  }

  if (parts.length !== 3) {
    return null;
  }

  const [rawAccessId, issuedAt, signature] = parts;
  const accessId = normalizeAccessId(rawAccessId);
  const issuedAtNumber = Number(issuedAt);
  const accessUser = users.find((user) => user.id === accessId);

  if (!accessUser || !issuedAt || !signature || !Number.isFinite(issuedAtNumber)) {
    return null;
  }

  const ageMs = now - issuedAtNumber;

  if (ageMs < 0 || ageMs > AUTH_MAX_AGE_SECONDS * 1000) {
    return null;
  }

  const expectedSignature = await hmacHex(accessUser.password, `${accessId}.${issuedAt}`);

  return isEqualString(signature, expectedSignature) ? { id: accessId } : null;
}

export function findAccessUserByPassword(password) {
  const candidate = String(password || '');

  return getAccessUsers().find((user) => isEqualString(user.password, candidate)) || null;
}

export async function getAuthenticatedAccess(cookieHeader) {
  if (!isAccessAuthEnabled()) {
    return { id: PUBLIC_ACCESS_ID };
  }

  const cookies = parseCookies(cookieHeader);

  return verifyAccessAuthToken(cookies[AUTH_COOKIE_NAME]);
}

export async function isCookieAuthenticated(cookieHeader, password) {
  if (password !== undefined) {
    const cookies = parseCookies(cookieHeader);

    return verifyAuthToken(cookies[AUTH_COOKIE_NAME], password);
  }

  return Boolean(await getAuthenticatedAccess(cookieHeader));
}

export function buildAuthCookie(token, requestUrl) {
  const url = new URL(requestUrl);
  const secure = url.protocol === 'https:' ? '; Secure' : '';

  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${AUTH_MAX_AGE_SECONDS}${secure}`;
}

export function buildClearAuthCookie(requestUrl) {
  const url = new URL(requestUrl);
  const secure = url.protocol === 'https:' ? '; Secure' : '';

  return `${AUTH_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}
