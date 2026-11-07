import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';
import { normalizeAdminUsername, normalizeEmail, validAdminUsername, validEmail } from '../src/utils/credentials.js';

const email = normalizeEmail(process.argv[2]);
const username = normalizeAdminUsername(process.argv[3]);
if (!validEmail(email) || !validAdminUsername(username)) {
  console.error('Usage: npm run admin:promote -- existing-account@example.com admin-username');
  process.exitCode = 1;
} else {
  try {
    await mongoose.connect(env.mongoUri);
    await User.init();
    const existingUser = await User.findOne({ email }).select('_id role adminUsername');
    if (!existingUser) {
      throw new Error('No account exists for that email. Create the student account first, then run this command.');
    }
    if (existingUser.role !== 'student' && existingUser.role !== 'admin') {
      throw new Error('Only an existing student or administrator account can be configured.');
    }
    if (existingUser.role === 'admin' && existingUser.adminUsername === username) {
      console.log('That administrator account already uses this username.');
    } else if (existingUser.role === 'admin' && existingUser.adminUsername) {
      throw new Error('That administrator already has a username. Use a different administrative account.');
    } else {
      const result = await User.collection.updateOne(
        { _id: existingUser._id, role: existingUser.role, adminUsername: { $in: [null] } },
        { $set: { role: 'admin', adminUsername: username }, $currentDate: { updatedAt: true } },
      );
      if (result.modifiedCount !== 1) throw new Error('The account changed during administrator setup; inspect it before retrying.');
      console.log('Administrator access and username were configured for the existing account.');
    }
  } catch (error) {
    if (error?.code === 11000 && (error?.keyPattern?.adminUsername || error?.keyValue?.adminUsername)) {
      console.error('That admin username is already in use.');
    } else {
      console.error(error.message || 'Administrator setup failed.');
    }
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
