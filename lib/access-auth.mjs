export const AUTH_COOKIE_NAME = 'razor_chat_auth';
export const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();
const PASSWORD_HASH_ALGORITHM = 'pbkdf2-sha256';
const PASSWORD_HASH_ITERATIONS = 120000;
const DEFAULT_ACCESS_ID = 'default';
const PUBLIC_ACCESS_ID = 'public';

export function getAccessPassword() {
  return String(process.env.APP_PASSWORD || process.env.ACCESS_PASSWORD || '');
}

export async function isAccessAuthEnabled() {
  return (await getAccessUsers()).length > 0;
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

function getConfiguredAccessUsers() {
  const usersById = new Map();
  const legacyPassword = getAccessPassword();

  if (legacyPassword) {
    usersById.set(DEFAULT_ACCESS_ID, {
      id: DEFAULT_ACCESS_ID,
      username: DEFAULT_ACCESS_ID,
      password: legacyPassword,
    });
  }

  readConfiguredUsers().forEach((item, index) => {
    const id = normalizeAccessId(item?.id || item?.name, `user-${index + 1}`);
    const username = String(item?.username || item?.name || id).trim() || id;
    const password = String(item?.password || '');

    if (password) {
      usersById.set(id, { id, username, password });
    }
  });

  return [...usersById.values()];
}

async function getDatabaseAccessUsers() {
  if (process.env.VERCEL) {
    return [];
  }

  try {
    const { getStoredAccessUsers } = await import('./db.mjs');

    return getStoredAccessUsers().map((user) => ({
      id: normalizeAccessId(user.id),
      username: String(user.username || user.id || '').trim(),
      passwordHash: String(user.passwordHash || ''),
      password: String(user.password || ''),
      displayName: String(user.displayName || ''),
    }));
  } catch (error) {
    console.warn('Failed to read access_users from SQLite:', error);
    return [];
  }
}

function hasUsableCredential(user) {
  return Boolean(user?.passwordHash || user?.password);
}

export async function getAccessUsers() {
  const usersById = new Map();

  for (const user of getConfiguredAccessUsers()) {
    if (hasUsableCredential(user)) {
      usersById.set(user.id, user);
    }
  }

  for (const user of await getDatabaseAccessUsers()) {
    if (hasUsableCredential(user)) {
      usersById.set(user.id, user);
    }
  }

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

function bytesToBase64Url(bytes) {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function derivePasswordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    key,
    256,
  );

  return new Uint8Array(bits);
}

export async function hashAccessPassword(password, { iterations = PASSWORD_HASH_ITERATIONS } = {}) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await derivePasswordHash(String(password || ''), salt, iterations);

  return `${PASSWORD_HASH_ALGORITHM}$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

async function verifyPasswordHash(passwordHash, password) {
  try {
    const [algorithm, rawIterations, rawSalt, expectedHash] = String(passwordHash || '').split('$');
    const iterations = Number(rawIterations);

    if (
      algorithm !== PASSWORD_HASH_ALGORITHM ||
      !Number.isInteger(iterations) ||
      iterations < 1 ||
      !rawSalt ||
      !expectedHash
    ) {
      return false;
    }

    const salt = base64UrlToBytes(rawSalt);
    const actualHash = await derivePasswordHash(String(password || ''), salt, iterations);

    return isEqualString(bytesToBase64Url(actualHash), expectedHash);
  } catch {
    return false;
  }
}

function getAccessUserSecret(accessUser) {
  return String(accessUser?.passwordHash || accessUser?.password || '');
}

async function verifyAccessUserPassword(accessUser, password) {
  const candidate = String(password || '');

  if (accessUser?.passwordHash) {
    return verifyPasswordHash(accessUser.passwordHash, candidate);
  }

  return accessUser?.password ? isEqualString(accessUser.password, candidate) : false;
}

export async function createAuthToken(password, now = Date.now()) {
  const issuedAt = String(now);
  const signature = await hmacHex(password, issuedAt);

  return `${issuedAt}.${signature}`;
}

export async function createAccessAuthToken(accessUser, now = Date.now()) {
  const accountId = normalizeAccessId(accessUser?.id);
  const issuedAt = String(now);
  const signature = await hmacHex(getAccessUserSecret(accessUser), `${accountId}.${issuedAt}`);

  return `${accountId}.${issuedAt}.${signature}`;
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
  const users = await getAccessUsers();

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

  const [rawAccountId, issuedAt, signature] = parts;
  const accountId = normalizeAccessId(rawAccountId);
  const issuedAtNumber = Number(issuedAt);
  const accessUser = users.find((user) => user.id === accountId);

  if (!accessUser || !issuedAt || !signature || !Number.isFinite(issuedAtNumber)) {
    return null;
  }

  const ageMs = now - issuedAtNumber;

  if (ageMs < 0 || ageMs > AUTH_MAX_AGE_SECONDS * 1000) {
    return null;
  }

  const expectedSignature = await hmacHex(getAccessUserSecret(accessUser), `${accountId}.${issuedAt}`);

  return isEqualString(signature, expectedSignature) ? { id: accountId } : null;
}

export async function findAccessUserByCredentials(username, password) {
  const login = String(username || '').trim().toLowerCase();
  const users = await getAccessUsers();

  for (const user of users) {
    const identifiers = [user.id, user.username]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);

    if (login && !identifiers.includes(login)) {
      continue;
    }

    if (await verifyAccessUserPassword(user, password)) {
      return user;
    }
  }

  return null;
}

export async function findAccessUserByPassword(password) {
  return findAccessUserByCredentials('', password);
}

export async function getAuthenticatedAccess(cookieHeader) {
  if (!(await isAccessAuthEnabled())) {
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
