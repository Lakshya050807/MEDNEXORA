import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { normalizeEmail, validEmail } from '../utils/credentials.js';
import {
  registrationDigestsMatch,
  registrationInvitationDigest,
  registrationOtpDigest,
  registrationInvitationRetentionMs,
  reserveRegistrationChallenge,
} from './registrationVerification.js';
import { registrationVerificationEmail } from './registrationVerificationEmail.js';

export const passwordResetOtpLifetimeMs = 10 * 60 * 1000;
export const emailOutboxMaxAttempts = 8;
export const emailOutboxLeaseMs = 60 * 1000;
export const emailOutboxBaseBackoffMs = 5 * 1000;
export const emailOutboxMaxBackoffMs = 5 * 60 * 1000;
export const emailOutboxLocalConcurrency = 4;
const terminalRetentionMs = 30 * 24 * 60 * 60 * 1000;
const resetResendCooldownMs = 60 * 1000;
const resetResendWindowMs = 60 * 60 * 1000;
const resetMaxSendsPerHour = 5;
const resetMaxAttempts = 5;

function matched(result) {
  return (result?.matchedCount ?? result?.n ?? 0) > 0;
}

function validPepper(value) {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 32;
}

function resetDigest(email, otp, pepper) {
  return createHmac('sha256', pepper).update(`${email}\0${otp}`, 'utf8').digest('hex');
}

function deriveEncryptionKey(pepper, type) {
  if (!validPepper(pepper)) throw new Error('Email outbox encryption is unavailable.');
  return Buffer.from(hkdfSync(
    'sha256',
    Buffer.from(pepper, 'utf8'),
    Buffer.from('MEDNEXORA durable email outbox v1', 'utf8'),
    Buffer.from(`email-outbox:${type}:aes-256-gcm`, 'utf8'),
    32,
  ));
}

function associatedData(id, type, version) {
  return Buffer.from(`${String(id)}\0${type}\0${version}`, 'utf8');
}

function encryptPayload({ id, type, payload, pepper }) {
  const version = 1;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(pepper, type), nonce);
  cipher.setAAD(associatedData(id, type, version));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return {
    payloadVersion: version,
    payloadNonce: nonce.toString('base64url'),
    payloadCiphertext: ciphertext.toString('base64url'),
    payloadTag: cipher.getAuthTag().toString('base64url'),
  };
}

function decryptPayload(job, pepper) {
  if (job.payloadVersion !== 1) throw new Error('Unsupported email outbox payload.');
  const nonce = Buffer.from(job.payloadNonce, 'base64url');
  const tag = Buffer.from(job.payloadTag, 'base64url');
  const ciphertext = Buffer.from(job.payloadCiphertext, 'base64url');
  if (nonce.length !== 12 || tag.length !== 16 || !ciphertext.length) {
    throw new Error('Invalid email outbox payload.');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveEncryptionKey(pepper, job.type), nonce);
  decipher.setAAD(associatedData(job._id, job.type, job.payloadVersion));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

function findSelected(model, filter, select) {
  let query = model.findOne(filter);
  if (typeof query?.select === 'function') query = query.select(select);
  if (typeof query?.readConcern === 'function') query = query.readConcern('majority');
  else if (typeof query?.setOptions === 'function') query = query.setOptions({ readConcern: { level: 'majority' } });
  return query;
}

function resetChallengeFields() {
  return {
    passwordResetOtpHash: 1,
    passwordResetOtpExpiresAt: 1,
    passwordResetOtpStatus: 1,
    passwordResetOtpActivationConfirmed: 1,
    passwordResetOtpAttempts: 1,
    passwordResetOtpDeliveryJobId: 1,
    passwordResetOtpDeliveryJobCreatedAt: 1,
  };
}

async function reserveResetOtp({ UserModel, email, digest, now, expiresAt, jobId, jobCreatedAt }) {
  const cooldownBefore = new Date(now.getTime() - resetResendCooldownMs);
  const windowBefore = new Date(now.getTime() - resetResendWindowMs);
  const accountFilter = { email, role: 'student' };
  const canSendNow = { $or: [
    { passwordResetOtpLastSentAt: { $exists: false } },
    { passwordResetOtpLastSentAt: null },
    { passwordResetOtpLastSentAt: { $lte: cooldownBefore } },
  ] };
  const resetFields = {
    passwordResetOtpHash: digest,
    passwordResetOtpExpiresAt: expiresAt,
    passwordResetOtpStatus: 'pending',
    passwordResetOtpActivationConfirmed: false,
    passwordResetOtpAttempts: 0,
    passwordResetOtpLastSentAt: now,
    passwordResetOtpDeliveryJobId: jobId,
    passwordResetOtpDeliveryJobCreatedAt: jobCreatedAt,
  };
  const notSuperseded = { $or: [
    { passwordResetOtpDeliveryJobCreatedAt: { $exists: false } },
    { passwordResetOtpDeliveryJobCreatedAt: null },
    { passwordResetOtpDeliveryJobCreatedAt: { $lte: jobCreatedAt } },
  ] };
  const notSameJob = { passwordResetOtpDeliveryJobId: { $ne: jobId } };
  const options = { runValidators: true, writeConcern: { w: 'majority' } };

  const prior = await findSelected(UserModel, {
    ...accountFilter,
    passwordResetOtpDeliveryJobId: jobId,
    passwordResetOtpHash: digest,
    passwordResetOtpExpiresAt: { $gt: now },
  }, '+passwordResetOtpHash +passwordResetOtpStatus +passwordResetOtpActivationConfirmed +passwordResetOtpExpiresAt +passwordResetOtpDeliveryJobId +passwordResetOtpDeliveryJobCreatedAt');
  if (prior) return true;

  const freshWindow = await UserModel.updateOne({
    ...accountFilter,
    ...notSuperseded,
    ...notSameJob,
    $and: [canSendNow, { $or: [
      { passwordResetOtpResendWindowStartedAt: { $exists: false } },
      { passwordResetOtpResendWindowStartedAt: null },
      { passwordResetOtpResendWindowStartedAt: { $lte: windowBefore } },
    ] }],
  }, { $set: {
    ...resetFields,
    passwordResetOtpResendWindowStartedAt: now,
    passwordResetOtpResendCount: 1,
  } }, options);
  if (matched(freshWindow)) return true;

  const currentWindow = await UserModel.updateOne({
    ...accountFilter,
    ...notSuperseded,
    ...notSameJob,
    $and: [canSendNow, {
      passwordResetOtpResendWindowStartedAt: { $gt: windowBefore },
      $or: [
        { passwordResetOtpResendCount: { $lt: resetMaxSendsPerHour } },
        { passwordResetOtpResendCount: { $exists: false } },
      ],
    }],
  }, { $set: resetFields, $inc: { passwordResetOtpResendCount: 1 } }, options);
  return matched(currentWindow);
}

function registrationChallengeSelect(query) {
  let selected = query;
  if (typeof selected?.select === 'function') {
    selected = selected.select('+otpDigest +invitationId +activationConfirmed +deliveryJobId +invitations.tokenDigest');
  }
  if (typeof selected?.readConcern === 'function') selected = selected.readConcern('majority');
  else if (typeof selected?.setOptions === 'function') selected = selected.setOptions({ readConcern: { level: 'majority' } });
  return selected;
}

export function createEmailDeliveryOutbox({
  OutboxModel,
  UserModel,
  ChallengeModel,
  emailProvider,
  passwordResetEmailProvider = emailProvider,
  registrationEmailProvider = emailProvider,
  passwordResetOtpPepper = '',
  registrationOtpPepper = '',
  passwordResetEmailEnabled = false,
  registrationEmailVerificationEnabled = false,
  registrationEnabled = false,
  stagingRestrictedRegistrationEnabled = false,
  now = () => new Date(),
  scheduler = (task) => setImmediate(task),
  logger = console,
} = {}) {
  if (!OutboxModel || !UserModel || !ChallengeModel) throw new TypeError('Email outbox models are required.');
  let stopped = true;
  let timer;
  const workers = new Set();

  const pepperFor = (type) => (type === 'password-reset' ? passwordResetOtpPepper : registrationOtpPepper);

  async function enqueue({ type, payload, expiresAt }) {
    if (!['password-reset', 'registration-verification'].includes(type)) throw new TypeError('Unsupported email outbox message type.');
    const pepper = pepperFor(type);
    const id = randomUUID();
    const sealed = encryptPayload({ id, type, payload, pepper });
    const createdAt = now();
    const [job] = await OutboxModel.create([{
      _id: id,
      type,
      ...sealed,
      status: 'queued',
      attempts: 0,
      availableAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(expiresAt),
    }], { writeConcern: { w: 'majority' } });
    return { id: String(job?._id ?? id) };
  }

  async function claimOne() {
    const at = now();
    const lockToken = randomBytes(24).toString('base64url');
    let query = OutboxModel.findOneAndUpdate({
      $or: [
        { status: 'queued', availableAt: { $lte: at } },
        { status: 'processing', lockUntil: { $lte: at } },
      ],
    }, {
      $set: { status: 'processing', lockToken, lockUntil: new Date(at.getTime() + emailOutboxLeaseMs) },
      $inc: { attempts: 1 },
      $unset: { cleanupAt: 1 },
    }, {
      new: true,
      sort: { availableAt: 1, createdAt: 1 },
      writeConcern: { w: 'majority' },
    });
    if (typeof query?.select === 'function') {
      query = query.select('+payloadNonce +payloadCiphertext +payloadTag +lockToken +providerAcceptedAt');
    }
    return query;
  }

  async function outboxUpdate(job, update) {
    const result = await OutboxModel.updateOne({ _id: job._id, status: 'processing', lockToken: job.lockToken }, update, {
      runValidators: true,
      writeConcern: { w: 'majority' },
    });
    return matched(result);
  }

  async function invalidateMatchingChallenge(job) {
    const jobId = String(job._id);
    if (job.type === 'password-reset') {
      await UserModel.updateOne({
        role: 'student',
        passwordResetOtpDeliveryJobId: jobId,
        $or: [
          { passwordResetOtpStatus: 'pending' },
          { passwordResetOtpStatus: 'active', passwordResetOtpActivationConfirmed: false },
        ],
      }, { $unset: resetChallengeFields() }, { writeConcern: { w: 'majority' } });
    } else {
      await ChallengeModel.updateOne({
        deliveryJobId: jobId,
        $or: [
          { status: 'pending' },
          { status: 'active', activationConfirmed: false },
        ],
      }, {
        $set: { status: 'locked', activationConfirmed: false },
        $unset: { otpDigest: 1, verificationProofDigest: 1, invitationId: 1, deliveryJobId: 1, deliveryJobCreatedAt: 1 },
      }, { writeConcern: { w: 'majority' } });
    }
  }

  async function finish(job, status, { invalidate = false } = {}) {
    if (invalidate) await invalidateMatchingChallenge(job);
    const at = now();
    const updated = await outboxUpdate(job, {
      $set: { status, cleanupAt: new Date(at.getTime() + terminalRetentionMs) },
      $unset: {
        payloadNonce: 1,
        payloadCiphertext: 1,
        payloadTag: 1,
        lockToken: 1,
        lockUntil: 1,
      },
    });
    return updated;
  }

  async function retry(job) {
    const at = now();
    if (job.attempts >= emailOutboxMaxAttempts || at >= new Date(job.expiresAt)) {
      await finish(job, at >= new Date(job.expiresAt) ? 'expired' : 'failed', { invalidate: true });
      return;
    }
    const delay = Math.min(emailOutboxBaseBackoffMs * (2 ** Math.max(0, job.attempts - 1)), emailOutboxMaxBackoffMs);
    await outboxUpdate(job, {
      $set: { status: 'queued', availableAt: new Date(at.getTime() + delay) },
      $unset: { lockToken: 1, lockUntil: 1 },
    });
  }

  async function resetChallengeFor(job, payload, digest, at) {
    const email = normalizeEmail(payload.email);
    const jobId = String(job._id);
    const query = await findSelected(UserModel, {
      email,
      role: 'student',
      passwordResetOtpDeliveryJobId: jobId,
      passwordResetOtpHash: digest,
      passwordResetOtpExpiresAt: { $gt: at },
    }, '+passwordResetOtpHash +passwordResetOtpStatus +passwordResetOtpActivationConfirmed +passwordResetOtpExpiresAt +passwordResetOtpDeliveryJobId +passwordResetOtpDeliveryJobCreatedAt');
    return query ?? null;
  }

  async function deliverReset(job, payload, pepper) {
    const email = normalizeEmail(payload?.email);
    if (!validEmail(email) || !/^\d{6}$/u.test(payload?.otp ?? '')) return 'suppressed';
    const digest = resetDigest(email, payload.otp, pepper);
    const jobId = String(job._id);
    let at = now();
    if (new Date(job.expiresAt) <= at) return 'expired';
    let challenge = await resetChallengeFor(job, payload, digest, at);

    if (challenge?.passwordResetOtpStatus === 'active' && challenge.passwordResetOtpActivationConfirmed === true) {
      return 'delivered';
    }
    if (challenge?.passwordResetOtpStatus === 'active' && challenge.passwordResetOtpActivationConfirmed !== true) {
      const rearmed = await UserModel.updateOne({
        email,
        role: 'student',
        passwordResetOtpDeliveryJobId: jobId,
        passwordResetOtpHash: digest,
        passwordResetOtpStatus: 'active',
        passwordResetOtpActivationConfirmed: false,
        passwordResetOtpExpiresAt: { $gt: now() },
      }, { $set: { passwordResetOtpStatus: 'pending', passwordResetOtpActivationConfirmed: false } }, {
        runValidators: true,
        writeConcern: { w: 'majority' },
      });
      if (!matched(rearmed)) {
        challenge = await resetChallengeFor(job, payload, digest, now());
        if (challenge?.passwordResetOtpStatus === 'active' && challenge.passwordResetOtpActivationConfirmed === true) return 'delivered';
        throw new Error('Reset challenge re-arm was not acknowledged.');
      }
      challenge = { ...challenge, passwordResetOtpStatus: 'pending', passwordResetOtpActivationConfirmed: false };
    }

    if (!challenge) {
      const reservedAt = now();
      if (new Date(job.expiresAt) <= reservedAt) return 'expired';
      const reserved = await reserveResetOtp({
        UserModel,
        email,
        digest,
        now: reservedAt,
        expiresAt: new Date(job.expiresAt),
        jobId,
        jobCreatedAt: new Date(job.createdAt),
      });
      if (!reserved) return 'suppressed';
      challenge = await resetChallengeFor(job, payload, digest, now());
      if (!challenge) return 'suppressed';
    }

    if (!job.providerAcceptedAt) {
      const delivery = await passwordResetEmailProvider.send({
        to: email,
        subject: 'Your MEDNEXORA password reset code',
        text: `Your password reset code is ${payload.otp}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
      });
      if (delivery?.sent !== true) throw new Error('Email provider did not confirm acceptance.');
      const accepted = await outboxUpdate(job, { $set: { providerAcceptedAt: now() } });
      if (!accepted) throw new Error('Email provider acceptance was not durably recorded.');
      job.providerAcceptedAt = now();
    }

    at = now();
    const pending = await resetChallengeFor(job, payload, digest, at);
    if (!pending || pending.passwordResetOtpStatus !== 'pending') {
      const current = await resetChallengeFor(job, payload, digest, at);
      if (current?.passwordResetOtpStatus === 'active' && current.passwordResetOtpActivationConfirmed === true) return 'delivered';
      return 'suppressed';
    }
    const activated = await UserModel.updateOne({
      email,
      role: 'student',
      passwordResetOtpDeliveryJobId: jobId,
      passwordResetOtpHash: digest,
      passwordResetOtpStatus: 'pending',
      passwordResetOtpActivationConfirmed: false,
      passwordResetOtpExpiresAt: { $gt: at },
    }, { $set: { passwordResetOtpStatus: 'active', passwordResetOtpActivationConfirmed: false } }, {
      runValidators: true,
      writeConcern: { w: 'majority' },
    });
    if (!matched(activated)) {
      const current = await resetChallengeFor(job, payload, digest, now());
      if (current?.passwordResetOtpStatus === 'active' && current.passwordResetOtpActivationConfirmed === true) return 'delivered';
      return 'suppressed';
    }
    const confirmedAt = now();
    const confirmed = await UserModel.updateOne({
      email,
      role: 'student',
      passwordResetOtpDeliveryJobId: jobId,
      passwordResetOtpHash: digest,
      passwordResetOtpStatus: 'active',
      passwordResetOtpActivationConfirmed: false,
      passwordResetOtpExpiresAt: { $gt: confirmedAt },
    }, { $set: { passwordResetOtpActivationConfirmed: true } }, {
      runValidators: true,
      writeConcern: { w: 'majority' },
    });
    if (matched(confirmed)) return 'delivered';
    const current = await resetChallengeFor(job, payload, digest, now());
    if (current?.passwordResetOtpStatus === 'active' && current.passwordResetOtpActivationConfirmed === true) return 'delivered';
    throw new Error('Reset challenge activation was not confirmed.');
  }

  async function registrationChallengeFor(job, payload, digest, at, restricted, invitationDigest) {
    const filter = {
      email: normalizeEmail(payload.email),
      deliveryJobId: String(job._id),
      deliveryJobCreatedAt: { $lte: new Date(job.createdAt) },
      otpDigest: digest,
      expiresAt: { $gt: at },
      ...(restricted ? {
        invitationId: payload.invitationId,
        invitations: { $elemMatch: {
          _id: payload.invitationId,
          tokenDigest: invitationDigest,
          status: 'active',
          expiresAt: { $gt: at },
        } },
      } : {}),
    };
    const query = registrationChallengeSelect(ChallengeModel.findOne(filter));
    return query;
  }

  async function deliverRegistration(job, payload, pepper) {
    const email = normalizeEmail(payload?.email);
    if (!validEmail(email) || !/^\d{6}$/u.test(payload?.otp ?? '')) return 'suppressed';
    const restricted = stagingRestrictedRegistrationEnabled === true;
    if (!(registrationEnabled === true || restricted)
      || registrationEmailVerificationEnabled !== true) return 'suppressed';
    const invitationToken = typeof payload.invitationToken === 'string' ? payload.invitationToken : '';
    const invitationValidFormat = /^[A-Za-z0-9_-]{43}$/u.test(invitationToken);
    const invitationDigest = restricted ? registrationInvitationDigest(invitationToken || 'invalid-token') : '';
    const jobId = String(job._id);
    let at = now();
    if (new Date(job.expiresAt) <= at) return 'expired';
    if (await UserModel.exists({ email })) return 'suppressed';

    let invitation = null;
    if (restricted) {
      if (!invitationValidFormat) return 'suppressed';
      let lookup = ChallengeModel.findOne({
        email,
        invitations: { $elemMatch: {
          tokenDigest: invitationDigest,
          status: 'active',
          expiresAt: { $gt: at },
        } },
      });
      if (typeof lookup?.select === 'function') lookup = lookup.select('+invitations.tokenDigest');
      if (typeof lookup?.readConcern === 'function') lookup = lookup.readConcern('majority');
      invitation = (await lookup)?.invitations?.find((entry) => entry.status === 'active'
        && entry.expiresAt > at
        && registrationDigestsMatch(entry.tokenDigest, invitationDigest));
      if (!invitation) return 'suppressed';
    }

    const digest = registrationOtpDigest(email, payload.otp, pepper);
    let challenge = await registrationChallengeFor(job, { ...payload, invitationId: invitation?._id }, digest, at, restricted, invitationDigest);
    if (challenge?.status === 'active' && challenge.activationConfirmed === true) return 'delivered';
    if (challenge?.status === 'active' && challenge.activationConfirmed !== true) {
      const rearmed = await ChallengeModel.updateOne({
        email,
        otpDigest: digest,
        deliveryJobId: jobId,
        status: 'active',
        activationConfirmed: false,
        expiresAt: { $gt: now() },
      }, { $set: { status: 'pending', activationConfirmed: false } }, { writeConcern: { w: 'majority' } });
      if (!matched(rearmed)) {
        challenge = await registrationChallengeFor(job, { ...payload, invitationId: invitation?._id }, digest, now(), restricted, invitationDigest);
        if (challenge?.status === 'active' && challenge.activationConfirmed === true) return 'delivered';
        throw new Error('Registration challenge re-arm was not acknowledged.');
      }
      challenge = { ...challenge, status: 'pending', activationConfirmed: false };
    }

    if (!challenge) {
      at = now();
      if (new Date(job.expiresAt) <= at) return 'expired';
      const reserved = await reserveRegistrationChallenge({
        ChallengeModel,
        email,
        digest,
        now: at,
        expiresAt: new Date(job.expiresAt),
        deliveryJobId: jobId,
        deliveryJobCreatedAt: new Date(job.createdAt),
        ...(restricted ? {
          matchFilter: {
            invitationId: invitation._id,
            invitations: { $elemMatch: {
              _id: invitation._id,
              tokenDigest: invitationDigest,
              status: 'active',
              expiresAt: { $gt: at },
            } },
          },
          allowCreate: false,
          invitationId: invitation._id,
          cleanupAt: new Date(invitation.expiresAt.getTime() + registrationInvitationRetentionMs),
        } : {}),
      });
      if (!reserved) return 'suppressed';
      const currentAt = now();
      challenge = await registrationChallengeFor(job, { ...payload, invitationId: invitation?._id }, digest, currentAt, restricted, invitationDigest);
      if (!challenge) return 'suppressed';
    }

    if (!job.providerAcceptedAt) {
      const message = registrationVerificationEmail(payload.otp);
      const delivery = await registrationEmailProvider.send({ to: email, ...message });
      if (delivery?.sent !== true) throw new Error('Email provider did not confirm acceptance.');
      const accepted = await outboxUpdate(job, { $set: { providerAcceptedAt: now() } });
      if (!accepted) throw new Error('Email provider acceptance was not durably recorded.');
      job.providerAcceptedAt = now();
    }

    at = now();
    const activationIdentity = {
      email,
      otpDigest: digest,
      deliveryJobId: jobId,
      expiresAt: { $gt: at },
      ...(restricted ? {
        invitationId: invitation._id,
        invitations: { $elemMatch: {
          _id: invitation._id,
          tokenDigest: invitationDigest,
          status: 'active',
          expiresAt: { $gt: at },
        } },
      } : {}),
    };
    const activated = await ChallengeModel.updateOne({ ...activationIdentity, status: 'pending' }, {
      $set: { status: 'active', activationConfirmed: false },
    }, { runValidators: true, writeConcern: { w: 'majority' } });
    if (!matched(activated)) {
      const current = await registrationChallengeFor(job, { ...payload, invitationId: invitation?._id }, digest, now(), restricted, invitationDigest);
      if (current?.status === 'active' && current.activationConfirmed === true) return 'delivered';
      return 'suppressed';
    }
    const confirmed = await ChallengeModel.updateOne({
      ...activationIdentity,
      status: 'active',
      activationConfirmed: false,
    }, { $set: { activationConfirmed: true } }, { runValidators: true, writeConcern: { w: 'majority' } });
    if (matched(confirmed)) return 'delivered';
    const current = await registrationChallengeFor(job, { ...payload, invitationId: invitation?._id }, digest, now(), restricted, invitationDigest);
    if (current?.status === 'active' && current.activationConfirmed === true) return 'delivered';
    throw new Error('Registration challenge activation was not confirmed.');
  }

  async function processClaim(job) {
    const at = now();
    if (new Date(job.expiresAt) <= at) {
      await finish(job, 'expired', { invalidate: true });
      return;
    }
    if (job.attempts > emailOutboxMaxAttempts) {
      await finish(job, 'failed', { invalidate: true });
      return;
    }
    const pepper = pepperFor(job.type);
    let payload;
    try {
      payload = decryptPayload(job, pepper);
    } catch {
      await finish(job, 'failed', { invalidate: true });
      return;
    }

    try {
      const result = job.type === 'password-reset'
        ? (!passwordResetEmailEnabled ? 'suppressed' : await deliverReset(job, payload, pepper))
        : await deliverRegistration(job, payload, pepper);
      if (result === 'delivered') await finish(job, 'delivered');
      else await finish(job, result, { invalidate: result === 'expired' });
    } catch {
      // Store no provider response or exception details. A job remains durable
      // and retryable; OTP challenges remain pending/unconfirmed meanwhile.
      logger.error('Durable email outbox delivery attempt failed; retry scheduled if eligible.');
      try { await retry(job); } catch { logger.error('Durable email outbox retry state could not be saved.'); }
    }
  }

  async function cleanupExpiredResetChallenges(at = now()) {
    if (typeof UserModel.updateMany !== 'function') return;
    await UserModel.updateMany({
      passwordResetOtpExpiresAt: { $lte: at },
      passwordResetOtpStatus: { $in: ['pending', 'active'] },
    }, { $unset: resetChallengeFields() }, { writeConcern: { w: 'majority' } });
  }

  async function workerLoop({ allowStopped = false } = {}) {
    while (allowStopped || !stopped) {
      let job;
      try { job = await claimOne(); } catch { logger.error('Durable email outbox claim failed.'); return; }
      if (!job) return;
      try { await processClaim(job); } catch { logger.error('Durable email outbox job processing failed.'); }
    }
  }

  async function processDue({ allowStopped = stopped } = {}) {
    try { await cleanupExpiredResetChallenges(); } catch { logger.error('Expired password reset metadata cleanup failed.'); }
    const started = [];
    while ((allowStopped || !stopped) && workers.size < emailOutboxLocalConcurrency) {
      let worker;
      worker = workerLoop({ allowStopped }).finally(() => workers.delete(worker));
      workers.add(worker);
      started.push(worker);
    }
    await Promise.all(started);
  }

  function scheduleTick(delay = 1000) {
    if (stopped || timer) return;
    timer = setTimeout(async () => {
      timer = undefined;
      await processDue();
      scheduleTick(1000);
    }, delay);
    timer.unref?.();
  }

  return Object.freeze({
    enqueue,
    processDue,
    wake() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      try {
        const allowStopped = stopped;
        scheduler(() => processDue({ allowStopped }).catch(() => logger.error('Durable email outbox processing failed.')));
      } catch {
        logger.error('Durable email outbox wake-up failed.');
      }
      if (!stopped) scheduleTick(1000);
    },
    start() {
      stopped = false;
      scheduleTick(0);
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (workers.size) await Promise.all([...workers]);
    },
  });
}

export default createEmailDeliveryOutbox;
