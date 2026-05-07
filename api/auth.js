import {
  buildAuthCookie,
  buildClearAuthCookie,
  createAccessAuthToken,
  findAccessUserByCredentials,
  getAccessUsers,
  getAuthenticatedAccess,
} from '../lib/access-auth.mjs';

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
    const authEnabled = (await getAccessUsers()).length > 0;

    if (!authEnabled) {
      return json({ ok: true, authRequired: false, authenticated: true, accessId: 'public' });
    }

    if (request.method === 'GET') {
      const access = await getAuthenticatedAccess(request.headers.get('cookie'));

      return json({
        ok: true,
        authRequired: true,
        authenticated: Boolean(access),
        accessId: access?.id || '',
      });
    }

    if (request.method === 'DELETE') {
      return json(
        { ok: true, authenticated: false },
        {
          headers: {
            'Set-Cookie': buildClearAuthCookie(request.url),
          },
        },
      );
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method Not Allowed' }, { status: 405 });
    }

    const body = await readJson(request);
    const accessUser = await findAccessUserByCredentials(body.username, body.password);

    if (!accessUser) {
      return json({ ok: false, error: '账号或密码不正确' }, { status: 401 });
    }

    const token = await createAccessAuthToken(accessUser);

    return json(
      { ok: true, authenticated: true, accessId: accessUser.id },
      {
        headers: {
          'Set-Cookie': buildAuthCookie(token, request.url),
        },
      },
    );
  },
};
