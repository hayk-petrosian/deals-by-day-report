import { hasValidSession, jsonResponse } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  if (!(await hasValidSession(request, env))) return jsonResponse({ message: 'Требуется вход.' }, 401);
  return jsonResponse({ authenticated: true });
}

