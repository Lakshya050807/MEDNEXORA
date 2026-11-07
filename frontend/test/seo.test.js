import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSeoFiles } from '../scripts/generate-seo-files.js';
import { pageMetadataFor } from '../src/utils/pageMetadata.js';

test('SEO files use the confirmed HTTPS origin and list only public pages', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'mednexora-seo-'));
  try {
    const result = await generateSeoFiles({ publicSiteUrl: 'https://mednexora.example', outputDir });
    const sitemap = await readFile(join(outputDir, 'sitemap.xml'), 'utf8');
    const robots = await readFile(join(outputDir, 'robots.txt'), 'utf8');
    assert.equal(result.sitemapGenerated, true);
    assert.match(sitemap, /https:\/\/mednexora\.example\/study-material/u);
    assert.doesNotMatch(sitemap, /\/student\/dashboard|\/admin|\/orders/u);
    assert.doesNotMatch(sitemap, /\/about|\/faq|\/contact|\/privacy-policy|\/terms-and-conditions|\/refund-cancellation-policy/u);
    assert.match(robots, /Sitemap: https:\/\/mednexora\.example\/sitemap\.xml/u);
    assert.match(robots, /Disallow: \/admin/u);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('SEO build omits a sitemap until the production origin is supplied', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'mednexora-seo-'));
  try {
    const result = await generateSeoFiles({ publicSiteUrl: '', outputDir });
    assert.equal(result.sitemapGenerated, false);
    await assert.rejects(readFile(join(outputDir, 'sitemap.xml'), 'utf8'), { code: 'ENOENT' });
    assert.doesNotMatch(await readFile(join(outputDir, 'robots.txt'), 'utf8'), /Sitemap:/u);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('SEO generation rejects a non-HTTPS site origin', async () => {
  await assert.rejects(generateSeoFiles({ publicSiteUrl: 'http://mednexora.example', outputDir: tmpdir() }), /HTTPS site origin/u);
});

test('protected routes and owner-confirmation placeholders are marked noindex', () => {
  assert.equal(pageMetadataFor('/student/dashboard').robots, 'noindex, nofollow, noarchive');
  assert.equal(pageMetadataFor('/admin/orders').robots, 'noindex, nofollow, noarchive');
  assert.equal(pageMetadataFor('/courses/abc123/learn').robots, 'noindex, nofollow, noarchive');
  assert.equal(pageMetadataFor('/about').robots, 'noindex, nofollow, noarchive');
  assert.equal(pageMetadataFor('/contact').robots, 'noindex, nofollow, noarchive');
  assert.equal(pageMetadataFor('/faq').robots, 'noindex, nofollow, noarchive');
  assert.equal(pageMetadataFor('/privacy-policy').robots, 'noindex, nofollow, noarchive');
  assert.equal(pageMetadataFor('/terms-and-conditions').robots, 'noindex, nofollow, noarchive');
  assert.equal(pageMetadataFor('/refund-cancellation-policy').robots, 'noindex, nofollow, noarchive');
  assert.match(pageMetadataFor('/about').title, /About MEDNEXORA/u);
});
