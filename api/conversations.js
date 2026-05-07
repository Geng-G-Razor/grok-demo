import {
  getStoredConversations,
  normalizeConversations,
  setStoredConversations,
} from '../lib/conversation-store.mjs';
import { getAuthenticatedAccess, isAccessAuthEnabled } from '../lib/access-auth.mjs';

function json(payload, init = {}) {
  return Response.json(payload, init);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export default {
  async fetch(request) {
    try {
      const access = await getAuthenticatedAccess(request.headers.get('cookie'));

      if (isAccessAuthEnabled() && !access) {
        return json({ ok: false, error: '需要先输入访问密码' }, { status: 401 });
      }

      const scope = access?.id || 'public';

      if (request.method === 'GET') {
        const result = await getStoredConversations({ scope });

        return json({ ok: true, ...result });
      }

      if (request.method !== 'PUT' && request.method !== 'POST') {
        return json({ error: 'Method Not Allowed' }, { status: 405 });
      }

      const body = await readJson(request);
      const result = await setStoredConversations(normalizeConversations(body.conversations), { scope });

      return json({ ok: true, ...result });
    } catch (error) {
      const status = error.statusCode || 500;

      return json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status },
      );
    }
  },
};
