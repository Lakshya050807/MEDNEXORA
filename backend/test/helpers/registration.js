import { registrationProofDigest } from '../../src/services/registrationVerification.js';

// Deliberately test-only proof material. These fixtures never call email and
// are used only by legacy integration suites that need an already-verified
// student so they can focus on their own route behavior.
export const testRegistrationPepper = 'local-test-only-registration-pepper-32-bytes-minimum';
export const testRegistrationToken = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export function withVerifiedRegistration(body) {
  return { ...body, verificationToken: testRegistrationToken };
}

export class FakeRegistrationVerificationChallengeModel {
  static async updateOne(filter) {
    const expected = registrationProofDigest(filter.email, testRegistrationToken, testRegistrationPepper);
    return {
      matchedCount: filter.status === 'verified' && filter.verificationProofDigest === expected ? 1 : 0,
    };
  }
}

const rateBuckets = new Map();

export class FakeRegistrationRateLimitModel {
  static async findOneAndUpdate(filter, update, options = {}) {
    const key = [filter.scope, filter.ipHash, filter.windowStart.toISOString()].join(':');
    let bucket = rateBuckets.get(key);
    if (!bucket && !options.upsert) return null;
    if (!bucket) {
      bucket = {
        ...filter,
        count: 0,
        expiresAt: update.$setOnInsert?.expiresAt,
      };
      rateBuckets.set(key, bucket);
    }
    bucket.count += update.$inc?.count ?? 0;
    return { ...bucket };
  }
}

export function registrationTestAppOptions() {
  return {
    PasswordResetRateLimitModel: FakeRegistrationRateLimitModel,
    RegistrationVerificationChallengeModel: FakeRegistrationVerificationChallengeModel,
    registrationEmailVerificationEnabled: true,
    registrationOtpPepper: testRegistrationPepper,
    registrationEmailProvider: { send: async () => ({ sent: true }) },
    passwordResetEmailProvider: { send: async () => ({ sent: true }) },
  };
}

export function resetRegistrationTestModels() {
  rateBuckets.clear();
}
