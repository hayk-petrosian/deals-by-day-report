import { createSessionCookie, isSameOriginPost, jsonResponse } from '../_lib/auth.js';

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function rateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.startedAt >= WINDOW_MS) {
    attempts.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

export async function onRequestPost({ request, env }) {
  if (!isSameOriginPost(request)) return jsonResponse({ message: 'Запрос отклонён.' }, 403);
  if (!env.REPORT_PASSWORD || env.REPORT_PASSWORD.length < 16 || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    return jsonResponse({ message: 'Сервер отчёта ещё не настроен.' }, 503);
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (rateLimited(ip)) return jsonResponse({ message: 'Слишком много попыток. Подождите несколько минут.' }, 429);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ message: 'Некорректный запрос.' }, 400); }
  const password = typeof body.password === 'string' ? body.password.slice(0, 1024) : '';
  const [candidateHash, expectedHash] = await Promise.all([digest(password), digest(env.REPORT_PASSWORD)]);
  if (!constantTimeEqual(candidateHash, expectedHash)) return jsonResponse({ message: 'Неверный пароль.' }, 403);

  attempts.delete(ip);
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': await createSessionCookie(env) });
}

