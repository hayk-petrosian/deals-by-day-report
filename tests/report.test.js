import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as login } from '../functions/api/login.js';
import { onRequestGet as session } from '../functions/api/session.js';
import { onRequestGet as report } from '../functions/api/report.js';

test('login protects report, accepts periods over seven days, and aggregates paginated Bitrix results', async () => {
  const env = {
    REPORT_PASSWORD: 'test-report-password-2026',
    SESSION_SECRET: 'test-session-signing-secret-at-least-32-characters',
    BITRIX_WEBHOOK_URL: 'https://b24-ilhsgh.bitrix24.ru/rest/1/test-secret/'
  };
  const origin = 'https://report.example';
  const baseHeaders = { Origin: origin, 'CF-Connecting-IP': '203.0.113.12' };

  const locked = await report({ request: new Request(`${origin}/api/report?from=2026-09-01&to=2026-09-30&timezoneOffset=0&start=0`), env });
  assert.equal(locked.status, 401, 'report data requires an authenticated session');

  const invalidLogin = await login({
    request: new Request(`${origin}/api/login`, { method: 'POST', headers: { ...baseHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) }),
    env
  });
  assert.equal(invalidLogin.status, 403);

  const validLogin = await login({
    request: new Request(`${origin}/api/login`, { method: 'POST', headers: { ...baseHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: env.REPORT_PASSWORD }) }),
    env
  });
  assert.equal(validLogin.status, 200);
  const cookie = validLogin.headers.get('Set-Cookie').split(';')[0];
  assert.match(validLogin.headers.get('Set-Cookie'), /HttpOnly; SameSite=Strict/);

  const sessionResult = await session({ request: new Request(`${origin}/api/session`, { headers: { Cookie: cookie } }), env });
  assert.equal(sessionResult.status, 200);
  assert.deepEqual(await sessionResult.json(), { authenticated: true });

  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    seen.push({ url: String(url), body });
    assert.equal(body.entityTypeId, 2);
    assert.deepEqual(body.select, ['createdTime']);
    if (body.start === 0) {
      assert.equal(body.filter['>=createdTime'], '2026-09-01T00:00:00Z');
      assert.equal(body.filter['<createdTime'], '2026-10-01T00:00:00Z');
      return Response.json({
        result: { items: [
          ...Array.from({ length: 40 }, () => ({ createdTime: '2026-09-01T12:00:00Z' })),
          ...Array.from({ length: 10 }, () => ({ createdTime: '2026-09-02T12:00:00Z' }))
        ] },
        total: 51,
        next: 50
      });
    }
    assert.equal(body.start, 50);
    return Response.json({ result: { items: [{ createdTime: '2026-09-30T12:00:00Z' }] }, total: 51 });
  };

  try {
    const firstPage = await report({
      request: new Request(`${origin}/api/report?from=2026-09-01&to=2026-09-30&timezoneOffset=0&start=0`, { headers: { Cookie: cookie } }),
      env
    });
    assert.equal(firstPage.status, 200);
    assert.deepEqual(await firstPage.json(), {
      counts: { '2026-09-01': 40, '2026-09-02': 10 }, pageCount: 50, total: 51, next: 50
    });

    const secondPage = await report({
      request: new Request(`${origin}/api/report?from=2026-09-01&to=2026-09-30&timezoneOffset=0&start=50`, { headers: { Cookie: cookie } }),
      env
    });
    assert.equal(secondPage.status, 200);
    assert.deepEqual(await secondPage.json(), {
      counts: { '2026-09-30': 1 }, pageCount: 1, total: 51, next: null
    });
    assert.equal(seen.length, 2);
    assert.ok(seen.every(request => request.url === 'https://b24-ilhsgh.bitrix24.ru/rest/1/test-secret/crm.item.list'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

