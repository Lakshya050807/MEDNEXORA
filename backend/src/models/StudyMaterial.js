import mongoose from 'mongoose';

const isOptionalSafeInteger = (value) => value === null || Number.isSafeInteger(value);

export const resourceTypes = Object.freeze([
  'notes',
  'practice-paper',
  'previous-year-paper',
  'mock-test',
  'video-course',
  'crash-course',
  'bundle',
]);

export const materialCategories = Object.freeze([
  'chapter-notes',
  'revision-notes',
  'important-questions',
  'previous-year-papers',
  'formula-sheets',
  'practice-worksheets',
  'reference-materials',
]);

export const difficultyLevels = Object.freeze(['beginner', 'intermediate', 'advanced']);

const previousYearSourceSchema = new mongoose.Schema({
  title: { type: String, trim: true, maxlength: 200, default: '' },
  url: {
    type: String,
    trim: true,
    maxlength: 2048,
    default: '',
    validate: (value) => {
      if (!value) return true;
      try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
    },
  },
  legalAvailabilityConfirmed: { type: Boolean, default: false },
  verifiedAt: { type: Date, default: null },
  verificationNote: { type: String, trim: true, maxlength: 2000, default: '' },
}, { _id: false });

const previewSchema = new mongoose.Schema({
  title: { type: String, trim: true, maxlength: 200 },
  excerpt: { type: String, trim: true, maxlength: 3000 },
}, { _id: false });

const studyMaterialSchema = new mongoose.Schema({
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
  slug: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/u },
  description: { type: String, required: true, trim: true, minlength: 10, maxlength: 12000 },
  detailedDescription: { type: String, trim: true, maxlength: 30000, default: '' },
  category: { type: String, enum: [...materialCategories, null], default: null, index: true },
  difficultyLevel: { type: String, enum: [...difficultyLevels, null], default: null },
  // Educational metadata only; the text index uses the separate, absent
  // `textIndexLanguage` override field and never reads this value.
  language: { type: String, trim: true, maxlength: 80, default: '' },
  pricePaise: { type: Number, default: null, min: 0, max: 100000000, validate: isOptionalSafeInteger },
  discountPaise: { type: Number, default: 0, min: 0, max: 100000000, validate: Number.isSafeInteger },
  currentPricePaise: { type: Number, default: null, min: 0, max: 100000000, validate: isOptionalSafeInteger, index: true },
  thumbnailUrl: { type: String, trim: true, maxlength: 2048, default: '' },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null, index: true },
  chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', default: null, index: true },
  topic: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic', default: null, index: true },
  topics: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Topic' }], default: [] },
  resourceType: { type: String, required: true, enum: resourceTypes, index: true },
  publicationStatus: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
  paperClassification: { type: String, enum: ['original-practice', 'verified-previous-year', null], default: null },
  previousYearSource: { type: previousYearSourceSchema, default: () => ({}) },
  format: { type: String, trim: true, maxlength: 120, default: '' },
  fileSizeBytes: { type: Number, min: 0, max: 52428800, default: null, validate: isOptionalSafeInteger },
  durationMinutes: { type: Number, min: 1, max: 100000, default: null, validate: isOptionalSafeInteger },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
  bundleItems: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudyMaterial' }], default: [] },
  keywords: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] },
  learningOutcomes: { type: [{ type: String, trim: true, maxlength: 500 }], default: [] },
  preview: { type: previewSchema, default: null },
  // Private asset paths are never selected by public product queries.
  contentUrl: { type: String, trim: true, maxlength: 2048, select: false, default: '' },
}, { timestamps: true });

studyMaterialSchema.pre('validate', function setCurrentPrice() {
  const supportsNoSubject = ['video-course', 'crash-course'].includes(this.resourceType);
  if (!supportsNoSubject && !this.subject) this.invalidate('subject', 'Choose a subject for this resource.');
  if (this.pricePaise === null || this.pricePaise === undefined) {
    this.currentPricePaise = null;
    if (this.discountPaise !== 0) this.invalidate('discountPaise', 'Set a listed price before configuring a discount.');
    if (this.publicationStatus === 'published') this.invalidate('pricePaise', 'Set a listed price before publishing this resource.');
  } else if (Number.isSafeInteger(this.pricePaise) && Number.isSafeInteger(this.discountPaise)) {
    this.currentPricePaise = this.pricePaise - this.discountPaise;
    if (this.discountPaise > this.pricePaise) this.invalidate('discountPaise', 'Discount cannot exceed the listed price.');
  }
  if (this.thumbnailUrl) {
    try {
      const url = new URL(this.thumbnailUrl, 'https://catalog.invalid');
      if (!['http:', 'https:'].includes(url.protocol)) this.invalidate('thumbnailUrl', 'Thumbnail must use HTTP or HTTPS.');
    } catch {
      this.invalidate('thumbnailUrl', 'Enter a valid thumbnail URL.');
    }
  }
  if (this.publicationStatus === 'published' && this.resourceType === 'practice-paper' && this.paperClassification !== 'original-practice') {
    this.invalidate('paperClassification', 'Published practice papers must be labeled as original practice.');
  }
  if (this.publicationStatus === 'published' && this.resourceType === 'previous-year-paper') {
    if (this.paperClassification !== 'verified-previous-year') this.invalidate('paperClassification', 'A published previous-year paper must be verified.');
    if (!this.previousYearSource?.legalAvailabilityConfirmed || !this.previousYearSource?.title || !this.previousYearSource?.url || !this.previousYearSource?.verifiedAt) {
      this.invalidate('previousYearSource', 'A published previous-year paper requires verified source and legal-availability details.');
    }
  }
  if (this.publicationStatus === 'published' && this.resourceType === 'bundle' && this.bundleItems.length === 0) {
    this.invalidate('bundleItems', 'A published preparation bundle must include at least one resource.');
  }
  if (this.resourceType === 'bundle' && new Set(this.bundleItems.map(String)).size !== this.bundleItems.length) {
    this.invalidate('bundleItems', 'A bundle cannot include the same resource more than once.');
  }
  if (this._id && this.bundleItems.some((item) => String(item) === String(this._id))) {
    this.invalidate('bundleItems', 'A bundle cannot include itself.');
  }
});

studyMaterialSchema.index({ exam: 1, publicationStatus: 1, createdAt: -1 });
studyMaterialSchema.index({ exam: 1, subject: 1, resourceType: 1, publicationStatus: 1 });
studyMaterialSchema.index({ exam: 1, category: 1, publicationStatus: 1, createdAt: -1 });
studyMaterialSchema.index({ publicationStatus: 1, currentPricePaise: 1, createdAt: -1 });
studyMaterialSchema.index(
  { title: 'text', description: 'text', keywords: 'text' },
  { name: 'title_text_description_text_keywords_text', default_language: 'none', language_override: 'textIndexLanguage' },
);
studyMaterialSchema.index({ exam: 1, slug: 1 }, { unique: true });

export default mongoose.models.StudyMaterial ?? mongoose.model('StudyMaterial', studyMaterialSchema);
