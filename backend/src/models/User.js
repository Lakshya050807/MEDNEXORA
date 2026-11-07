import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 80,
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 254,
    unique: true,
  },
  adminUsername: {
    type: String,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 32,
    match: /^[a-z0-9][a-z0-9._-]{2,31}$/u,
    unique: true,
    sparse: true,
  },
  adminSessionVersion: { type: Number, min: 0, default: 0, select: false },
  passwordHash: {
    type: String,
    required: true,
    select: false,
  },
  role: {
    type: String,
    enum: ['student', 'admin'],
    default: 'student',
    immutable: true,
  },
}, {
  timestamps: true,
  toJSON: {
    transform(_document, returned) {
      delete returned.passwordHash;
      delete returned.adminSessionVersion;
      delete returned.__v;
      return returned;
    },
  },
});

export default mongoose.models.User ?? mongoose.model('User', userSchema);
