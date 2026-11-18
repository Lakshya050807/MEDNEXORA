export const PRODUCTION_API_ORIGIN = 'https://mednexora-production-f06e.up.railway.app';
export const PRODUCTION_SITE_ORIGIN = 'https://mednexora-8ams.vercel.app';
export const STAGING_API_ORIGIN = 'https://mednexora-staging-api-staging.up.railway.app';
export const STAGING_SITE_ORIGIN = 'https://mednexora-shk6.vercel.app';

const knownVercelEnvironments = new Set(['production', 'preview', 'development']);

function requireHttpsOrigin(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required for this Vercel environment.`);
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${name} must be a valid HTTPS origin URL.`);
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${name} must be an HTTPS origin without credentials, path, query, or fragment.`);
  }
  return parsed.origin;
}

export function resolveVercelApiOrigin({
  deploymentEnv,
  deploymentTarget,
  stagingApiOrigin,
  publicSiteUrl,
  vercelProjectProductionUrl,
}) {
  if (!knownVercelEnvironments.has(deploymentEnv)) {
    throw new Error('Vercel deployment refused: VERCEL_ENV must identify production, preview, or development.');
  }

  if (!['production', 'staging'].includes(deploymentTarget)) {
    throw new Error('Vercel deployment refused: MEDNEXORA_DEPLOYMENT_TARGET must be explicitly set to production or staging.');
  }

  if (deploymentTarget === 'production') {
    if (deploymentEnv !== 'production') {
      throw new Error('Vercel deployment refused: production API access is allowed only for the production deployment target.');
    }
    const approvedProductionHost = new URL(PRODUCTION_SITE_ORIGIN).host;
    if (typeof vercelProjectProductionUrl !== 'string'
      || vercelProjectProductionUrl.trim().toLowerCase() !== approvedProductionHost) {
      throw new Error('Vercel production deployment refused: VERCEL_PROJECT_PRODUCTION_URL must match the approved production Vercel project domain.');
    }
    const siteOrigin = requireHttpsOrigin(publicSiteUrl, 'PUBLIC_SITE_URL');
    if (siteOrigin !== PRODUCTION_SITE_ORIGIN) {
      throw new Error('Vercel production deployment refused: PUBLIC_SITE_URL must match the approved production site origin.');
    }
    return PRODUCTION_API_ORIGIN;
  }

  const stagingOrigin = requireHttpsOrigin(stagingApiOrigin, 'MEDNEXORA_STAGING_API_ORIGIN');
  if (stagingOrigin !== STAGING_API_ORIGIN) {
    throw new Error('Vercel staging deployment refused: MEDNEXORA_STAGING_API_ORIGIN must match the approved staging Railway service.');
  }

  const siteOrigin = requireHttpsOrigin(publicSiteUrl, 'PUBLIC_SITE_URL');
  if (siteOrigin !== STAGING_SITE_ORIGIN) {
    throw new Error('Vercel staging deployment refused: PUBLIC_SITE_URL must match the approved staging site origin.');
  }

  if (typeof vercelProjectProductionUrl !== 'string'
    || vercelProjectProductionUrl.trim().toLowerCase() !== new URL(STAGING_SITE_ORIGIN).host) {
    throw new Error('Vercel staging deployment refused: VERCEL_PROJECT_PRODUCTION_URL must match the approved staging Vercel project domain.');
  }

  return STAGING_API_ORIGIN;
}

export function createVercelConfig({
  deploymentEnv,
  deploymentTarget,
  stagingApiOrigin,
  publicSiteUrl,
  vercelProjectProductionUrl,
} = {}) {
  const apiOrigin = resolveVercelApiOrigin({
    deploymentEnv,
    deploymentTarget,
    stagingApiOrigin,
    publicSiteUrl,
    vercelProjectProductionUrl,
  });

  return {
    installCommand: 'npm ci',
    buildCommand: 'npm run build',
    outputDirectory: 'dist',
    rewrites: [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/api/:path*`,
      },
      {
        source: '/((?!api|sitemap\\.xml$|robots\\.txt$).*)',
        destination: '/index.html',
      },
    ],
    headers: [
      {
        source: '/api/:path*',
        headers: [{ key: 'x-vercel-enable-rewrite-caching', value: '0' }],
      },
    ],
  };
}
