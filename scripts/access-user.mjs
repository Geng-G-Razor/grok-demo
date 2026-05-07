#!/usr/bin/env node

import { hashAccessPassword } from '../lib/access-auth.mjs';
import { getStoredAccessUsers, upsertAccessUser } from '../lib/db.mjs';

function usage() {
  console.log(`Usage:
  pnpm access-user add <username> <password> [id]
  pnpm access-user list
  pnpm access-user hash <password>`);
}

function normalizeAccessId(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'default';
}

const [command, ...args] = process.argv.slice(2);

if (command === 'list') {
  const users = getStoredAccessUsers({ includeDisabled: true });

  if (!users.length) {
    console.log('No access users found.');
    process.exit(0);
  }

  for (const user of users) {
    const state = user.disabled ? 'disabled' : 'active';
    console.log(`${user.id}\t${user.username}\t${state}`);
  }

  process.exit(0);
}

if (command === 'hash') {
  const [password] = args;

  if (!password) {
    usage();
    process.exit(1);
  }

  console.log(await hashAccessPassword(password));
  process.exit(0);
}

if (command === 'add') {
  const [username, password, rawId] = args;

  if (!username || !password) {
    usage();
    process.exit(1);
  }

  const id = normalizeAccessId(rawId || username);
  const passwordHash = await hashAccessPassword(password);
  const ok = upsertAccessUser({ id, username, passwordHash });

  if (!ok) {
    console.error('Failed to write access user.');
    process.exit(1);
  }

  console.log(`Access user saved: ${username} (${id})`);
  process.exit(0);
}

usage();
process.exit(1);
