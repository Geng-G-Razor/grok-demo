import { handleChatPayload, serializeError } from '../lib/chat-api.mjs';

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    }

    try {
      const body = await request.json();
      const result = await handleChatPayload(body);

      return Response.json(result.payload, { status: result.statusCode });
    } catch (error) {
      return Response.json(serializeError(error), { status: 500 });
    }
  },
};
