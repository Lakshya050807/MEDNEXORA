import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDirectory, '..');
const sourceRobotsPath = resolve(scriptDirectory, '../public/robots.txt');
const publicRoutes = [
  '/',
  '/target-exams',
  '/study-material',
  '/courses',
];

export async function generateSeoFiles({ publicSiteUrl, outputDir = resolve(scriptDirectory, '../dist') } = {}) {
  const siteOrigin = publicSiteUrl ?? process.env.PUBLIC_SITE_URL ?? loadEnv('production', frontendRoot, '').PUBLIC_SITE_URL;
  const robotsBase = (await readFile(sourceRobotsPath, 'utf8')).trim();
  let origin = '';
  if (siteOrigin) {
    let parsed;
    try { parsed = new URL(siteOrigin); } catch { throw new Error('PUBLIC_SITE_URL must be an HTTPS site origin.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('PUBLIC_SITE_URL must be an HTTPS site origin without a path, query or credentials.');
    }
    origin = parsed.origin;
  }

  const sitemapPath = resolve(outputDir, 'sitemap.xml');
  const robotsPath = resolve(outputDir, 'robots.txt');
  if (!origin) {
    await writeFile(robotsPath, `${robotsBase}\n`, 'utf8');
    return { sitemapGenerated: false, reason: 'PUBLIC_SITE_URL is not configured.' };
  }

  const urls = publicRoutes.map((route) => `  <url><loc>${origin}${route}</loc></url>`).join('\n');
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  await writeFile(sitemapPath, sitemap, 'utf8');
  await writeFile(robotsPath, `${robotsBase}\nSitemap: ${origin}/sitemap.xml\n`, 'utf8');
  return { sitemapGenerated: true, sitemapPath, robotsPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await generateSeoFiles();
    if (!result.sitemapGenerated) console.warn(`${result.reason} Configure PUBLIC_SITE_URL for the production build to generate sitemap.xml.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
