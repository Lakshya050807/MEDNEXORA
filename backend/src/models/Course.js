import mongoose from 'mongoose';

const isOptionalSafeInteger = (value) => value === null || Number.isSafeInteger(value);

const lessonSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  durationMinutes: { type: Number, min: 0, max: 10000, default: null, validate: isOptionalSafeInteger },
  videoProvider: { type: String, enum: ['youtube', 'vimeo', 'private-hosted', 'other', 'none'], default: 'none' },
  videoAssetId: {
    type: String,
    trim: true,
    maxlength: 300,
    default: '',
    validate: (value) => !/^(?:[a-z][a-z\d+.-]*:|\/{1,2})/iu.test(value) && !/^[a-z\d.-]+\.[a-z]{2,}(?:\/|$)/iu.test(value),
  },
  // Optional for existing courses. A missing value keeps legacy lessons valid.
  topic: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
  // Intentionally has no schema default: pre-existing lessons remain visible
  // unless an administrator explicitly marks them as draft or archived.
  publicationStatus: { type: String, enum: ['draft', 'published', 'archived'] },
  isPreview: { type: Boolean, default: false },
  sortOrder: { type: Number, min: 0, max: 10000, default: 0, validate: Number.isSafeInteger },
}, { _id: true });

const moduleSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },
  chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', default: null },
  lessons: { type: [lessonSchema], default: [] },
  sortOrder: { type: Number, min: 0, max: 10000, default: 0, validate: Number.isSafeInteger },
}, { _id: true });

const courseSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyMaterial', required: true, unique: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
  category: { type: String, trim: true, maxlength: 160, default: '' },
  targetAudience: { type: String, trim: true, maxlength: 1000, default: '' },
  subjects: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }], default: [] },
  courseType: { type: String, enum: ['video-course', 'crash-course'], required: true },
  durationMinutes: { type: Number, min: 1, max: 100000, default: null, validate: isOptionalSafeInteger },
  lessonCount: { type: Number, min: 0, max: 10000, default: null, validate: isOptionalSafeInteger },
  outline: { type: [{ type: String, trim: true, maxlength: 300 }], default: [] },
  modules: { type: [moduleSchema], default: [] },
  publicationStatus: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
}, { timestamps: true });

courseSchema.index({ exam: 1, courseType: 1, publicationStatus: 1 });
courseSchema.pre('validate', function validateLessonCount() {
  if (!this.modules.length) return;
  const moduleLessonCount = this.modules.reduce((count, module) => count + module.lessons.length, 0);
  if (this.lessonCount === null || this.lessonCount === undefined) this.lessonCount = moduleLessonCount;
  else if (this.lessonCount !== moduleLessonCount) this.invalidate('lessonCount', 'Lesson count must match the configured course modules.');
});

export default mongoose.models.Course ?? mongoose.model('Course', courseSchema);
