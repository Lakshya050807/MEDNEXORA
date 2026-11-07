import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'health-test-session-secret-with-at-least-32-bytes';

const [{ createApp }, session] = await Promise.all([
  import('../src/app.js'),
  import('express-session'),
]);

test('health endpoint reports unavailable when the database connection is not ready', async (context) => {
  const app = createApp({ sessionStore: new session.MemoryStore() });
  const server = app.listen(0, '127.0.0.1');
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, 'unavailable');
  assert.equal(body.service, 'nursing-learning-api');
  assert.ok(Number.isFinite(Date.parse(body.timestamp)));
});
