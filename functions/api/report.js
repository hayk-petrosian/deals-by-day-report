import { hasValidSession, jsonResponse } from '../_lib/auth.js';

const encoder = new TextEncoder();
const WEBHOOK_HOST = 'b24-ilhsgh.bitrix24.ru';

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function bitrixStartOfDay(day, timezoneOffset) {
  const [year, month, date] = day.split('-').map(Number);
  const instant = new Date(Date.UTC(year, month - 1, date) + timezoneOffset * 60_000);
  return instant.toISOString().replace('.000Z', 'Z');
}

function addCalendarDay(day) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function localDayKey(isoDate, timezoneOffset) {
  const date = new Date(isoDate);
  if (!Number.isFinite(date.getTime())) return null;
  const local = new Date(date.getTime() - timezoneOffset * 60_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
}

function makeWebhookEndpoint(value) {
  const base = new URL(value);
  if (base.protocol !== 'https:' || base.hostname !== WEBHOOK_HOST || !base.pathname.startsWith('/rest/') || base.search || base.hash) {
    throw new Error('invalid webhook configuration');
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL('crm.item.list', base);
}

async function fetchDealsPage(endpoint, filter, start) {
  const result = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ entityTypeId: 2, select: ['createdTime'], filter, start }),
    signal: AbortSignal.timeout(25_000)
  });
  const data = await result.json().catch(() => null);
  if (!result.ok || !data || data.error || !data.result) {
    const code = data && typeof data.error === 'string' ? data.error : '';
    if (code === 'QUERY_LIMIT_EXCEEDED' || result.status === 429) {
      return { retry: true };
    }
    return { error: true };
  }
  return { data };
}

export async function onRequestGet({ request, env }) {
  if (!(await hasValidSession(request, env))) return jsonResponse({ message: 'Требуется повторный вход.' }, 401);
  if (!env.BITRIX_WEBHOOK_URL) return jsonResponse({ message: 'Подключение к Bitrix24 ещё не настроено.' }, 503);

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const timezoneOffset = Number(url.searchParams.get('timezoneOffset'));
  const start = Number(url.searchParams.get('start') || 0);
  if (!validDate(from) || !validDate(to) || from > to || !Number.isInteger(timezoneOffset) || timezoneOffset < -840 || timezoneOffset > 720 || !Number.isSafeInteger(start) || start < 0 || start % 50 !== 0) {
    return jsonResponse({ message: 'Проверьте выбранный период.' }, 400);
  }

  let endpoint;
  try { endpoint = makeWebhookEndpoint(env.BITRIX_WEBHOOK_URL); }
  catch { return jsonResponse({ message: 'Серверное подключение к Bitrix24 настроено некорректно.' }, 503); }

  const filter = {
    '>=createdTime': bitrixStartOfDay(from, timezoneOffset),
    '<createdTime': bitrixStartOfDay(addCalendarDay(to), timezoneOffset)
  };
  let response;
  try { response = await fetchDealsPage(endpoint, filter, start); }
  catch { return jsonResponse({ message: 'Не удалось связаться с Bitrix24. Попробуйте ещё раз.' }, 502); }
  if (response.retry) return jsonResponse({ message: 'Bitrix24 временно ограничил частоту запросов. Попробуйте позже.' }, 429, { 'Retry-After': '2' });
  if (response.error) return jsonResponse({ message: 'Bitrix24 не принял запрос. Проверьте права вебхука на чтение CRM.' }, 502);

  const data = response.data;
  const items = data.result.items || [];
  const counts = Object.create(null);
  for (const item of items) {
    const key = localDayKey(item.createdTime, timezoneOffset);
    if (key && key >= from && key <= to) counts[key] = (counts[key] || 0) + 1;
  }

  return jsonResponse({ counts, pageCount: items.length, total: Number.isFinite(data.total) ? data.total : null, next: Number.isSafeInteger(data.next) ? data.next : null });
}

