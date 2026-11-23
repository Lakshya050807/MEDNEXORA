export const PRODUCTION_API_ORIGIN = 'https://mednexora-production-f06e.up.railway.app';
export const PRODUCTION_SITE_ORIGIN = 'https://mednexora.site';
export const PRODUCTION_VERCEL_PROJECT_ORIGIN = 'https://mednexora-8ams.vercel.app';
export const STAGING_API_ORIGIN = 'https://mednexora-staging-api-staging.up.railway.app';
export const STAGING_TUNNEL_API_ORIGIN = 'https://staging-api.mednexora.site';
export const STAGING_SITE_ORIGIN = 'https://mednexora-shk6.vercel.app';
const APPROVED_STAGING_API_ORIGINS = new Set([STAGING_API_ORIGIN, STAGING_TUNNEL_API_ORIGIN]);

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://api.razorpay.com https://checkout.razorpay.com",
  "script-src 'self' https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com",
  "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "upgrade-insecure-requests",
].join('; ');

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
    const approvedProductionHost = new URL(PRODUCTION_VERCEL_PROJECT_ORIGIN).host;
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
  if (!APPROVED_STAGING_API_ORIGINS.has(stagingOrigin)) {
    throw new Error('Vercel staging deployment refused: MEDNEXORA_STAGING_API_ORIGIN must match an approved staging API origin.');
  }

  const siteOrigin = requireHttpsOrigin(publicSiteUrl, 'PUBLIC_SITE_URL');
  if (siteOrigin !== STAGING_SITE_ORIGIN) {
    throw new Error('Vercel staging deployment refused: PUBLIC_SITE_URL must match the approved staging site origin.');
  }

  if (typeof vercelProjectProductionUrl !== 'string'
    || vercelProjectProductionUrl.trim().toLowerCase() !== new URL(STAGING_SITE_ORIGIN).host) {
    throw new Error('Vercel staging deployment refused: VERCEL_PROJECT_PRODUCTION_URL must match the approved staging Vercel project domain.');
  }

  return stagingOrigin;
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
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'x-vercel-enable-rewrite-caching', value: '0' }],
      },
    ],
  };
}
