// Optional password gate: set DASHBOARD_PASSWORD in Vercel to require it (any username).
export const config = { matcher: '/:path*' };
export default function middleware(request) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return;
  const h = request.headers.get('authorization') || '';
  if (h.startsWith('Basic ')) {
    try {
      const [, p] = atob(h.slice(6)).split(':');
      if (p === pw) return;
    } catch {}
  }
  return new Response('Authentication required', {
    status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Agent Dashboard"' },
  });
}
