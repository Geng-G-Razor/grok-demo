import {
  getConnectionProfiles,
  normalizeProfiles,
  setConnectionProfiles,
} from '../lib/connection-profile-store.mjs';

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
      if (request.method === 'GET') {
        const result = await getConnectionProfiles();

        return json({ ok: true, ...result });
      }

      if (request.method !== 'PUT' && request.method !== 'POST') {
        return json({ error: 'Method Not Allowed' }, { status: 405 });
      }

      const body = await readJson(request);
      const result = await setConnectionProfiles(normalizeProfiles(body.profiles));

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
