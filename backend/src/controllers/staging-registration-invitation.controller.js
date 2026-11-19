import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { normalizeEmail, validEmail } from '../utils/credentials.js';
import {
  registrationInvitationDigest,
  registrationInvitationMaxCount,
  registrationInvitationRetentionMs,
} from '../services/registrationVerification.js';

function updateMatched(result) {
  return (result?.matchedCount ?? result?.n ?? 0) > 0;
}

function safeInvitation(invitation, email, now, currentInvitationId) {
  const expiresAt = new Date(invitation.expiresAt);
  let status = invitation.status;
  if (status === 'active' && String(invitation._id) !== String(currentInvitationId)) status = 'revoked';
  else if (status === 'active' && expiresAt <= now) status = 'expired';
  return {
    id: String(invitation._id),
    email,
    status,
    issuedBy: invitation.issuedBy ? String(invitation.issuedBy) : null,
    createdAt: invitation.createdAt,
    expiresAt,
    ...(invitation.consumedAt ? { consumedAt: invitation.consumedAt } : {}),
    ...(invitation.revokedAt ? { revokedAt: invitation.revokedAt } : {}),
  };
}

function invitationReplacementPipeline({ invitation, expiresAt, cleanupAt, issuedAt }) {
  return [{ $set: {
    status: 'invited',
    expiresAt: { $literal: expiresAt },
    cleanupAt: { $literal: cleanupAt },
    attempts: 0,
    resendCount: 0,
    invitationId: { $literal: invitation._id },
    invitations: { $slice: [{
      $concatArrays: [
        { $map: {
          input: { $ifNull: ['$invitations', []] },
          as: 'previous',
          in: { $cond: [
            { $eq: ['$$previous.status', 'active'] },
            { $mergeObjects: ['$$previous', { status: 'revoked', revokedAt: { $literal: issuedAt } }] },
            '$$previous',
          ] },
        } },
        [{ $literal: invitation }],
      ],
    }, -registrationInvitationMaxCount] },
    otpDigest: '$$REMOVE',
    verificationProofDigest: '$$REMOVE',
    activationConfirmed: false,
    lastSentAt: '$$REMOVE',
    resendWindowStartedAt: '$$REMOVE',
    updatedAt: { $literal: issuedAt },
  } }];
}

export function createStagingRegistrationInvitationController({
  UserModel,
  ChallengeModel,
  enabled = false,
  ttlMinutes = 120,
  now = () => new Date(),
}) {
  if (!Number.isSafeInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 1440) {
    throw new TypeError('Invitation lifetime must be between five minutes and 24 hours.');
  }
  const unavailable = (response) => enabled
    ? null
    : response.status(404).json({ message: 'The requested admin resource was not found.' });
  return {
    list: async (_request, response, next) => {
      const unavailableResponse = unavailable(response);
      if (unavailableResponse) return unavailableResponse;
      try {
        const query = ChallengeModel.find({ invitations: { $exists: true, $ne: [] } })
          .select('+invitationId email invitations._id invitations.status invitations.issuedBy invitations.createdAt invitations.expiresAt invitations.consumedAt invitations.revokedAt')
          .sort({ updatedAt: -1 })
          .limit(50);
        const records = await (typeof query?.lean === 'function' ? query.lean() : query);
        const listedAt = now();
        const invitations = (records ?? [])
          .flatMap((record) => (record.invitations ?? []).map((invitation) => safeInvitation(invitation, record.email, listedAt, record.invitationId)))
          .slice(0, 200);
        return response.status(200).json({ invitations });
      } catch (error) {
        return next(error);
      }
    },

    issue: async (request, response, next) => {
      const unavailableResponse = unavailable(response);
      if (unavailableResponse) return unavailableResponse;
      const email = normalizeEmail(request.body?.email);
      if (!validEmail(email)) return response.status(400).json({ message: 'Enter a valid email address.' });
      const issuedBy = request.admin?._id ?? request.admin?.id;
      if (!issuedBy || !mongoose.isValidObjectId(issuedBy)) {
        return response.status(401).json({ message: 'Please log in to continue.' });
      }

      try {
        if (await UserModel.exists({ email })) {
          return response.status(409).json({ message: 'A student or admin account already uses this email address.' });
        }
        const issuedAt = now();
        const expiresAt = new Date(issuedAt.getTime() + ttlMinutes * 60 * 1000);
        const invitationId = new mongoose.Types.ObjectId();
        const invitationToken = randomBytes(32).toString('base64url');
        const invitation = {
          _id: invitationId,
          tokenDigest: registrationInvitationDigest(invitationToken),
          status: 'active',
          issuedBy,
          createdAt: issuedAt,
          expiresAt,
        };
        const cleanupAt = new Date(expiresAt.getTime() + registrationInvitationRetentionMs);
        if (typeof ChallengeModel.prototype?.validate === 'function') {
          await new ChallengeModel({
            email,
            invitations: [invitation],
            invitationId,
            status: 'invited',
            activationConfirmed: false,
            expiresAt,
            attempts: 0,
            resendCount: 0,
            cleanupAt,
          }).validate();
        }
        const pipeline = invitationReplacementPipeline({ invitation, expiresAt, cleanupAt, issuedAt });
        // Mongoose 9 requires this option to pass aggregation-pipeline updates
        // through to MongoDB instead of treating the array as a malformed
        // classic update document.
        let updated = await ChallengeModel.updateOne({ email }, pipeline, { updatePipeline: true });
        if (!updateMatched(updated)) {
          try {
            await ChallengeModel.create({
              email,
              invitations: [invitation],
              invitationId,
              status: 'invited',
            activationConfirmed: false,
              expiresAt,
              attempts: 0,
              resendCount: 0,
              cleanupAt,
            });
            updated = { matchedCount: 1 };
          } catch (error) {
            if (error?.code !== 11000) throw error;
            // A simultaneous first invitation inserted the unique email row.
            // The pipeline atomically replaces it and invalidates its OTP.
            updated = await ChallengeModel.updateOne({ email }, pipeline, { updatePipeline: true });
          }
        }
        if (!updateMatched(updated)) return response.status(409).json({ message: 'A newer invitation was issued. Refresh the list and use the active code.' });
        return response.status(201).json({
          invitation: safeInvitation(invitation, email, issuedAt, invitationId),
          token: invitationToken,
        });
      } catch (error) {
        return next(error);
      }
    },

    revoke: async (request, response, next) => {
      const unavailableResponse = unavailable(response);
      if (unavailableResponse) return unavailableResponse;
      const { invitationId } = request.params;
      if (!mongoose.isValidObjectId(invitationId)) return response.status(404).json({ message: 'Invitation was not found or is no longer active.' });
      const id = new mongoose.Types.ObjectId(invitationId);
      const revokedAt = now();
      try {
        const revoked = await ChallengeModel.updateOne({
          invitationId: id,
          invitations: { $elemMatch: { _id: id, status: 'active', expiresAt: { $gt: revokedAt } } },
        }, {
          $set: {
            status: 'locked',
            'invitations.$.status': 'revoked',
            'invitations.$.revokedAt': revokedAt,
          },
          $unset: { invitationId: 1, otpDigest: 1, verificationProofDigest: 1, activationConfirmed: 1 },
        }, { runValidators: true, writeConcern: { w: 'majority' } });
        if (!updateMatched(revoked)) return response.status(404).json({ message: 'Invitation was not found or is no longer active.' });
        return response.status(200).json({ message: 'Unused invitation revoked.' });
      } catch (error) {
        return next(error);
      }
    },
  };
}

export default createStagingRegistrationInvitationController;
