import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('Vite development server remains loopback-only by default and proxies only to local backend', async () => {
  const packageJson = JSON.parse(await readFile(resolve(frontendRoot, 'package.json'), 'utf8'));
  const viteConfig = await import(new URL('../vite.config.js', import.meta.url));
  const config = viteConfig.default({ mode: 'test' });
  assert.equal(packageJson.scripts.dev, 'vite');
  assert.equal(config.server.host, undefined, 'Vite default host is local loopback');
  assert.equal(config.server.proxy['/api'].target, 'http://127.0.0.1:5000');
  assert.equal(config.server.proxy['/api'].changeOrigin, false);
});
