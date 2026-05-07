import { next } from '@vercel/functions';
import { getAccessPassword, isCookieAuthenticated } from './lib/access-auth.mjs';

const PUBLIC_PATHS = new Set(['/login.html', '/api/auth']);

export const config = {
  matcher: ['/((?!favicon.ico).*)'],
};

function redirectToLogin(request, url) {
  const loginUrl = new URL('/login.html', request.url);

  if (url.pathname !== '/') {
    loginUrl.searchParams.set('next', `${url.pathname}${url.search}`);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: loginUrl.toString(),
    },
  });
}

export default async function middleware(request) {
  const password = getAccessPassword();

  if (!password) {
    return next();
  }

  const url = new URL(request.url);

  if (PUBLIC_PATHS.has(url.pathname)) {
    return next();
  }

  const authenticated = await isCookieAuthenticated(request.headers.get('cookie'), password);

  if (authenticated) {
    return next();
  }

  if (url.pathname.startsWith('/api/')) {
    return Response.json({ error: '需要先输入访问密码' }, { status: 401 });
  }

  return redirectToLogin(request, url);
}
