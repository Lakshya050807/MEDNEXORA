import { createVercelConfig } from './vercel-config.mjs';

// Vercel evaluates this configuration at deployment time. Requiring an explicit
// target prevents staging from inheriting the production API destination.
export const config = createVercelConfig({
  deploymentEnv: process.env.VERCEL_ENV,
  deploymentTarget: process.env.MEDNEXORA_DEPLOYMENT_TARGET,
  stagingApiOrigin: process.env.MEDNEXORA_STAGING_API_ORIGIN,
  publicSiteUrl: process.env.PUBLIC_SITE_URL,
  vercelProjectProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
});
