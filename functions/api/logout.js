import { clearSessionCookie, isSameOriginPost, jsonResponse } from '../_lib/auth.js';

export async function onRequestPost({ request }) {
  if (!isSameOriginPost(request)) return jsonResponse({ message: 'Запрос отклонён.' }, 403);
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}

