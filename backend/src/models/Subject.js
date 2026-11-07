import mongoose from 'mongoose';

const subjectSchema = new mongoose.Schema({
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  slug: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/u },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  sortOrder: { type: Number, min: 0, max: 10000, default: 0, validate: Number.isSafeInteger },
  publicationStatus: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
}, { timestamps: true });

subjectSchema.index({ exam: 1, slug: 1 }, { unique: true });
subjectSchema.index({ exam: 1, publicationStatus: 1, sortOrder: 1, name: 1 });

export default mongoose.models.Subject ?? mongoose.model('Subject', subjectSchema);
