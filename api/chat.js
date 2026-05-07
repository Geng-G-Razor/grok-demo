import { createChatStreamResponse, handleChatPayload, serializeError } from '../lib/chat-api.mjs';
import { getAuthenticatedAccess, isAccessAuthEnabled } from '../lib/access-auth.mjs';

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    }

    try {
      const access = await getAuthenticatedAccess(request.headers.get('cookie'));

      if ((await isAccessAuthEnabled()) && !access) {
        return Response.json({ ok: false, error: '需要先输入访问密码' }, { status: 401 });
      }

      const accountId = access?.id || 'public';
      const body = await request.json();
      const options = { accountId };

      if (body.stream !== false) {
        return createChatStreamResponse(body, options);
      }

      const result = await handleChatPayload(body, options);

      return Response.json(result.payload, { status: result.statusCode });
    } catch (error) {
      return Response.json(serializeError(error), { status: 500 });
    }
  },
};
