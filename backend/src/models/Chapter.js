import mongoose from 'mongoose';

const chapterSchema = new mongoose.Schema({
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
  slug: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/u },
  description: { type: String, trim: true, maxlength: 3000, default: '' },
  sortOrder: { type: Number, min: 0, max: 10000, default: 0, validate: Number.isSafeInteger },
  publicationStatus: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
}, { timestamps: true });

chapterSchema.index({ subject: 1, slug: 1 }, { unique: true });
chapterSchema.index({ exam: 1, subject: 1, publicationStatus: 1, sortOrder: 1, name: 1 });

export default mongoose.models.Chapter ?? mongoose.model('Chapter', chapterSchema);
