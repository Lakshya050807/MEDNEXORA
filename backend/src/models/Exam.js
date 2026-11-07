import mongoose from 'mongoose';

const examSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
  slug: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/u },
  region: { type: String, trim: true, maxlength: 100, default: '' },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  eligibility: { type: String, trim: true, maxlength: 4000, default: null },
  syllabus: { type: String, trim: true, maxlength: 12000, default: null },
  pattern: { type: String, trim: true, maxlength: 8000, default: null },
  // Legacy fields are retained as hidden, unvalidated metadata so existing
  // documents remain untouched. They no longer affect examination behavior.
  officialSources: { type: mongoose.Schema.Types.Mixed, select: false },
  publishedWithoutVerifiedSource: { type: mongoose.Schema.Types.Mixed, select: false },
  isPrimary: { type: Boolean, default: false },
  publicationStatus: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
}, { timestamps: true });

examSchema.index({ slug: 1 }, { unique: true });
examSchema.index({ publicationStatus: 1, region: 1, name: 1 });
examSchema.index({ isPrimary: 1 }, { unique: true, partialFilterExpression: { isPrimary: true } });

export default mongoose.models.Exam ?? mongoose.model('Exam', examSchema);
