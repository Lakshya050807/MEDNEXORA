import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testDirectory = dirname(fileURLToPath(import.meta.url));

test('Vercel builds the frontend and rewrites SPA routes without swallowing relative API requests', async () => {
  const config = JSON.parse(await readFile(join(testDirectory, '../vercel.json'), 'utf8'));

  assert.equal(config.installCommand, 'npm ci');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.rewrites.length, 1);

  const spaRewrite = config.rewrites[0];
  const sourcePattern = new RegExp(`^${spaRewrite.source}$`);
  assert.equal(spaRewrite.destination, '/index.html');
  assert.equal(sourcePattern.test('/products/example-id'), true);
  assert.equal(sourcePattern.test('/student/dashboard'), true);
  assert.equal(sourcePattern.test('/api'), false);
  assert.equal(sourcePattern.test('/api/auth/me'), false);
});
