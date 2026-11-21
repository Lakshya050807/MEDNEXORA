import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMongoRateLimiter } from '../src/middleware/mongoRateLimit.js';

const secret = 'test-only-rate-limit-hmac-secret-at-least-32-bytes';

function fakeModel({ fail = false } = {}) {
  const rows = new Map();
  return {
    rows,
    async findOneAndUpdate(filter, update, options = {}) {
      if (fail) throw new Error('database unavailable');
      const key = `${filter.scope}|${filter.ipHash}|${filter.windowStart.getTime()}`;
      let row = rows.get(key);
      if (!row && !options.upsert) return null;
      if (!row) {
        row = { ...filter, count: 0, expiresAt: update.$setOnInsert?.expiresAt };
        rows.set(key, row);
      }
      row.count += update.$inc.count;
      return { ...row };
    },
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

async function invoke(limiter, request) {
  const response = responseRecorder();
  let calledNext = false;
  await limiter(request, response, () => { calledNext = true; });
  return { response, calledNext };
}

test('Mongo-backed login limits share atomic IP and normalized account buckets across limiter instances', async () => {
  const model = fakeModel();
  let time = new Date('2026-11-20T00:00:00.000Z');
  const makeLimit = (scope, max, keyResolver) => createMongoRateLimiter({
    RateLimitModel: model, secret, scope, keyResolver, windowMs: 60_000, max, now: () => time,
  });
  const firstIp = makeLimit('student-login-ip', 2);
  const secondIp = makeLimit('student-login-ip', 2);
  const accountOne = makeLimit('student-login-account', 2, (request) => String(request.body.email).trim().toLowerCase());
  const accountTwo = makeLimit('student-login-account', 2, (request) => String(request.body.email).trim().toLowerCase());
  const req = { ip: '192.0.2.4', socket: { remoteAddress: '192.0.2.4' }, body: { email: ' Student@Example.Test ' } };

  assert.equal((await invoke(firstIp, req)).response.statusCode, 200);
  assert.equal((await invoke(accountOne, req)).response.statusCode, 200);
  assert.equal((await invoke(secondIp, req)).response.statusCode, 200);
  assert.equal((await invoke(accountTwo, req)).response.statusCode, 200);
  assert.equal((await invoke(firstIp, req)).response.statusCode, 429);
  assert.equal((await invoke(accountTwo, req)).response.statusCode, 429);
  assert.equal(model.rows.size, 2);
  assert.equal([...model.rows.values()].some((row) => JSON.stringify(row).includes('student@example.test')), false);

  time = new Date(time.getTime() + 60_001);
  assert.equal((await invoke(secondIp, req)).response.statusCode, 200, 'a new fixed window permits fresh requests');
});

test('account keys and student/admin scopes are isolated while IP keys can vary', async () => {
  const model = fakeModel();
  const make = (scope, keyResolver = undefined) => createMongoRateLimiter({
    RateLimitModel: model, secret, scope, keyResolver, windowMs: 60_000, max: 1,
  });
  const ipLimit = make('admin-login-ip');
  const adminKey = make('admin-login-account', (request) => request.body.username.toLowerCase());
  const studentKey = make('student-login-account', (request) => request.body.email.toLowerCase());
  const base = { ip: '192.0.2.9', socket: { remoteAddress: '192.0.2.9' }, body: { username: 'Root.Admin', email: 'student@example.test' } };
  assert.equal((await invoke(ipLimit, base)).response.statusCode, 200);
  assert.equal((await invoke(adminKey, base)).response.statusCode, 200);
  assert.equal((await invoke(studentKey, base)).response.statusCode, 200);
  assert.equal((await invoke(make('admin-login-account', (request) => request.body.username.toLowerCase()), { ...base, body: { ...base.body, username: 'different-admin' } })).response.statusCode, 200);
  assert.equal(model.rows.size, 4);
});

test('MongoDB failures fail closed before authentication runs', async () => {
  const limiter = createMongoRateLimiter({ RateLimitModel: fakeModel({ fail: true }), secret, scope: 'student-login-ip', windowMs: 60_000, max: 2 });
  const { response, calledNext } = await invoke(limiter, { ip: '192.0.2.10', socket: { remoteAddress: '192.0.2.10' } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['Retry-After'], '60');
  assert.equal(calledNext, false);
});

test('untrusted X-Forwarded-For values cannot create new login IP buckets', async (t) => {
  const model = fakeModel();
  const limiter = createMongoRateLimiter({ RateLimitModel: model, secret, scope: 'student-login-ip', windowMs: 60_000, max: 10 });
  const app = express();
  app.set('trust proxy', false);
  app.post('/', limiter, (request, response) => response.json({ ip: request.ip }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const spoofed of ['198.51.100.10', '203.0.113.11', '1.2.3.4, 5.6.7.8']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'X-Forwarded-For': spoofed } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.ip, /127\.0\.0\.1/u);
  }
  assert.equal(model.rows.size, 1);
  assert.equal([...model.rows.values()][0].count, 3);
});
