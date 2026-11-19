import 'dotenv/config';
import { isIP } from 'node:net';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? '5000');
const sessionSecret = process.env.SESSION_SECRET ?? '';
const sessionMaxAgeDays = Number(process.env.SESSION_MAX_AGE_DAYS ?? '7');
const appOriginValue = process.env.APP_ORIGIN ?? 'http://localhost:5173';
const trustProxyValue = process.env.TRUST_PROXY ?? '0';
const nodeEnv = process.env.NODE_ENV ?? 'development';
const configuredAppEnv = process.env.APP_ENV;
const appEnv = configuredAppEnv ?? (nodeEnv === 'production' ? '' : nodeEnv);
const productionRuntime = nodeEnv === 'production';
const launchApprovalNames = [
  'PUBLIC_ABOUT_PAGE_APPROVED',
  'PUBLIC_CONTACT_PAGE_APPROVED',
  'PUBLIC_FAQ_PAGE_APPROVED',
  'PUBLIC_PRIVACY_POLICY_APPROVED',
  'PUBLIC_TERMS_PAGE_APPROVED',
  'PUBLIC_REFUND_POLICY_APPROVED',
];
function readBooleanSetting(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  if (value.trim().toLowerCase() === 'true') return true;
  if (value.trim().toLowerCase() === 'false') return false;
  throw new Error(`${name} must be either true or false.`);
}
const launchApprovals = Object.fromEntries(launchApprovalNames.map((name) => [
  name,
  readBooleanSetting(name, !productionRuntime),
]));
const launchApprovalsComplete = Object.values(launchApprovals).every(Boolean);
const registrationRequested = readBooleanSetting('PUBLIC_BETA_REGISTRATION_ENABLED', !productionRuntime);
const paidPurchasesRequested = readBooleanSetting('PUBLIC_BETA_PAID_PURCHASES_ENABLED', !productionRuntime);
const passwordResetEmailEnabled = readBooleanSetting('PASSWORD_RESET_EMAIL_ENABLED', false);
const registrationEmailVerificationEnabled = readBooleanSetting('REGISTRATION_EMAIL_VERIFICATION_ENABLED', false);
const stagingRestrictedRegistrationEnabled = readBooleanSetting('STAGING_RESTRICTED_REGISTRATION_ENABLED', false);
const stagingRegistrationInvitationTtlMinutes = Number(process.env.STAGING_REGISTRATION_INVITATION_TTL_MINUTES ?? '120');
const resendApiKey = process.env.RESEND_API_KEY?.trim() ?? '';
const passwordResetFromEmail = process.env.PASSWORD_RESET_FROM_EMAIL?.trim() ?? '';
const passwordResetOtpPepper = process.env.PASSWORD_RESET_OTP_PEPPER?.trim() ?? '';
const registrationOtpPepper = process.env.REGISTRATION_OTP_PEPPER?.trim() ?? '';
const configuredRazorpayMode = process.env.RAZORPAY_MODE;
const razorpayMode = configuredRazorpayMode ?? 'test';
const razorpayKeyId = process.env.RAZORPAY_KEY_ID ?? '';
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET ?? '';
const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
const privateStorageOriginValue = process.env.PRIVATE_STORAGE_ORIGIN ?? '';
const privateStorageDirValue = process.env.PRIVATE_STORAGE_DIR?.trim() ?? '';
const configuredMongoUri = process.env.MONGODB_URI?.trim() ?? '';
const privateStorageDir = resolve(privateStorageDirValue || resolve(dirname(fileURLToPath(import.meta.url)), '../../private-files'));
const frontendStaticDirectories = [
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../frontend/public'),
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../frontend/dist'),
];
const isWithinDirectory = (directory, candidate) => {
  const path = relative(directory, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};
if (frontendStaticDirectories.some((directory) => isWithinDirectory(directory, privateStorageDir))) {
  throw new Error('PRIVATE_STORAGE_DIR must be outside the frontend public and build directories.');
}

if (!['development', 'test', 'production'].includes(nodeEnv)) {
  throw new Error('NODE_ENV must be development, test, or production.');
}
if (nodeEnv === 'production' && configuredAppEnv === undefined) {
  throw new Error('APP_ENV must be explicitly set to staging or production when NODE_ENV=production.');
}
if (!['development', 'test', 'staging', 'production'].includes(appEnv)) {
  throw new Error('APP_ENV must be development, test, staging, or production.');
}
if (nodeEnv === 'production' && !['staging', 'production'].includes(appEnv)) {
  throw new Error('APP_ENV must be staging or production when NODE_ENV=production.');
}
if (['staging', 'production'].includes(appEnv) && nodeEnv !== 'production') {
  throw new Error('NODE_ENV=production is required when APP_ENV=staging or production.');
}
if (appEnv === 'staging' && (registrationRequested || paidPurchasesRequested)) {
  throw new Error('Public registration and paid purchases must remain disabled in staging.');
}
if (stagingRestrictedRegistrationEnabled && appEnv !== 'staging') {
  throw new Error('STAGING_RESTRICTED_REGISTRATION_ENABLED may only be enabled when APP_ENV=staging.');
}
if (stagingRestrictedRegistrationEnabled && !registrationEmailVerificationEnabled) {
  throw new Error('REGISTRATION_EMAIL_VERIFICATION_ENABLED must be true when restricted staging registration is enabled.');
}
if (!Number.isSafeInteger(stagingRegistrationInvitationTtlMinutes)
  || stagingRegistrationInvitationTtlMinutes < 5 || stagingRegistrationInvitationTtlMinutes > 1440) {
  throw new Error('STAGING_REGISTRATION_INVITATION_TTL_MINUTES must be an integer from 5 to 1440.');
}
if (nodeEnv === 'production' && !privateStorageDirValue) {
  throw new Error('Set PRIVATE_STORAGE_DIR to an explicit mounted storage path in production.');
}
if (nodeEnv === 'production' && !isAbsolute(privateStorageDirValue)) {
  throw new Error('PRIVATE_STORAGE_DIR must be an absolute path in production.');
}
if (nodeEnv === 'production' && !configuredMongoUri) {
  throw new Error('MONGODB_URI must be configured in production.');
}
if (configuredMongoUri && !/^mongodb(?:\+srv)?:\/\//u.test(configuredMongoUri)) {
  throw new Error('MONGODB_URI must use the mongodb:// or mongodb+srv:// scheme.');
}
if (productionRuntime && (registrationRequested || paidPurchasesRequested) && !launchApprovalsComplete) {
  throw new Error('Public registration and paid purchases require all six owner-approved public information and policy pages.');
}
if (productionRuntime && paidPurchasesRequested && appEnv !== 'production') {
  throw new Error('Paid purchases may only be enabled when APP_ENV=production; staging remains test-only.');
}
if (passwordResetEmailEnabled || registrationEmailVerificationEnabled) {
  if (!/^re_[A-Za-z0-9_-]{16,}$/u.test(resendApiKey)) {
    throw new Error('RESEND_API_KEY must be a valid Resend API key when an email verification feature is enabled.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(passwordResetFromEmail)) {
    throw new Error('PASSWORD_RESET_FROM_EMAIL must be a valid sender address when an email verification feature is enabled.');
  }
}
if (passwordResetEmailEnabled) {
  if (Buffer.byteLength(passwordResetOtpPepper, 'utf8') < 32 || passwordResetOtpPepper.startsWith('replace-')) {
    throw new Error('PASSWORD_RESET_OTP_PEPPER must be a unique secret of at least 32 bytes when password reset email is enabled.');
  }
}
if (registrationEmailVerificationEnabled
  && (Buffer.byteLength(registrationOtpPepper, 'utf8') < 32 || registrationOtpPepper.startsWith('replace-'))) {
  throw new Error('REGISTRATION_OTP_PEPPER must be a unique secret of at least 32 bytes when registration email verification is enabled.');
}
if (registrationEmailVerificationEnabled && passwordResetOtpPepper
  && registrationOtpPepper === passwordResetOtpPepper) {
  throw new Error('REGISTRATION_OTP_PEPPER must be different from PASSWORD_RESET_OTP_PEPPER.');
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid port number between 1 and 65535.');
}

if (!['test', 'live'].includes(razorpayMode)) {
  throw new Error('RAZORPAY_MODE must be either test or live.');
}
if (appEnv === 'production' && configuredRazorpayMode !== 'live') {
  throw new Error('Set RAZORPAY_MODE=live explicitly in production.');
}
if (appEnv === 'staging' && configuredRazorpayMode !== 'test') {
  throw new Error('Set RAZORPAY_MODE=test explicitly in staging.');
}
if (!['production'].includes(appEnv) && razorpayMode !== 'test') {
  throw new Error('Razorpay live mode is only allowed when APP_ENV is production.');
}
if (appEnv === 'production' && !razorpayKeyId.trim()) {
  throw new Error('RAZORPAY_KEY_ID must be configured in production.');
}
if (appEnv === 'production' && !razorpayKeySecret.trim()) {
  throw new Error('RAZORPAY_KEY_SECRET must be configured in production.');
}
if (appEnv === 'production' && !razorpayWebhookSecret.trim()) {
  throw new Error('RAZORPAY_WEBHOOK_SECRET must be configured in production.');
}
if (razorpayKeyId && razorpayMode === 'test' && !razorpayKeyId.startsWith('rzp_test_')) {
  throw new Error('RAZORPAY_KEY_ID must be a Razorpay Test Mode key when RAZORPAY_MODE=test.');
}
if (razorpayKeyId && razorpayMode === 'live' && !razorpayKeyId.startsWith('rzp_live_')) {
  throw new Error('RAZORPAY_KEY_ID must be a Razorpay Live Mode key when RAZORPAY_MODE=live.');
}

if (Buffer.byteLength(sessionSecret, 'utf8') < 32 || sessionSecret.startsWith('replace-')) {
  throw new Error('Set SESSION_SECRET to a unique random value of at least 32 bytes.');
}

if (!Number.isInteger(sessionMaxAgeDays) || sessionMaxAgeDays < 1 || sessionMaxAgeDays > 30) {
  throw new Error('SESSION_MAX_AGE_DAYS must be between 1 and 30.');
}

let appOrigin;
try {
  const parsed = new URL(appOriginValue);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('APP_ORIGIN must contain only an HTTP(S) origin.');
  }
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
    throw new Error('APP_ORIGIN must use HTTPS in production.');
  }
  appOrigin = parsed.origin;
} catch {
  throw new Error('APP_ORIGIN must be a valid origin URL.');
}

let privateStorageOrigin = '';
if (privateStorageOriginValue) {
  try {
    const parsed = new URL(privateStorageOriginValue);
    const isLocalHttp = nodeEnv !== 'production' && parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if ((!['https:', 'http:'].includes(parsed.protocol)) || (parsed.protocol !== 'https:' && !isLocalHttp)
      || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error('PRIVATE_STORAGE_ORIGIN must be an HTTPS origin (HTTP is allowed for localhost development).');
    }
    privateStorageOrigin = parsed.origin;
  } catch (error) {
    if (error.message.startsWith('PRIVATE_STORAGE_ORIGIN')) throw error;
    throw new Error('PRIVATE_STORAGE_ORIGIN must be a valid storage origin URL.');
  }
}

let trustProxy = false;
if (trustProxyValue === '1') {
  // Railway terminates HTTPS before forwarding a request to the Node process.
  // Trust exactly the single ingress hop so express-session can honor
  // X-Forwarded-Proto without trusting arbitrary client-supplied proxy headers.
  trustProxy = 1;
} else if (trustProxyValue !== 'false' && trustProxyValue !== '0' && trustProxyValue !== '') {
  const proxyRanges = trustProxyValue.split(',').map((entry) => entry.trim()).filter(Boolean);
  const namedRanges = new Set(['loopback', 'linklocal', 'uniquelocal']);
  const isValidRange = (range) => {
    if (namedRanges.has(range)) return true;
    const [address, prefix, ...rest] = range.split('/');
    const version = isIP(address);
    if (!version || rest.length) return false;
    if (prefix === undefined) return true;
    if (!/^\d{1,3}$/u.test(prefix)) return false;
    const prefixLength = Number(prefix);
    return prefixLength <= (version === 4 ? 32 : 128);
  };
  if (!proxyRanges.length || proxyRanges.some((range) => range.toLowerCase() === 'true' || range === '*' || !isValidRange(range))) {
    throw new Error('TRUST_PROXY must be false, 1 for a single trusted proxy, or a comma-separated list of trusted IP addresses, CIDRs, or loopback/linklocal/uniquelocal ranges.');
  }
  trustProxy = proxyRanges;
}

export const env = Object.freeze({
  port,
  nodeEnv,
  appEnv,
  publicRegistrationEnabled: registrationRequested && (!productionRuntime || launchApprovalsComplete),
  paidPurchasesEnabled: paidPurchasesRequested && (!productionRuntime || launchApprovalsComplete),
  passwordResetEmailEnabled,
  registrationEmailVerificationEnabled,
  stagingRestrictedRegistrationEnabled,
  stagingRegistrationInvitationTtlMinutes,
  registrationOtpPepper,
  resendApiKey,
  passwordResetFromEmail,
  passwordResetOtpPepper,
  mongoUri: configuredMongoUri || 'mongodb://127.0.0.1:27017/nursing_education',
  sessionSecret,
  sessionMaxAgeMs: sessionMaxAgeDays * 24 * 60 * 60 * 1000,
  sessionCookieName: process.env.NODE_ENV === 'production' ? '__Host-nursing.sid' : 'nursing.sid',
  adminSessionCookieName: process.env.NODE_ENV === 'production' ? '__Host-mednexora-admin.sid' : 'mednexora.admin.sid',
  secureCookies: process.env.NODE_ENV === 'production',
  appOrigin,
  trustProxy,
  razorpayMode,
  razorpayKeyId,
  razorpayKeySecret,
  razorpayWebhookSecret,
  privateStorageOrigin,
  privateStorageDir,
});

