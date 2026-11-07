import mongoose from 'mongoose';

const isOptionalSafeInteger = (value) => value === null || Number.isSafeInteger(value);

const mockTestSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyMaterial', required: true, unique: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 5000, default: '' },
  instructions: { type: String, trim: true, maxlength: 10000, default: '' },
  questionBanks: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'QuestionBank' }], default: [], validate: (items) => new Set(items.map(String)).size === items.length },
  durationMinutes: { type: Number, min: 1, max: 10000, default: null, validate: isOptionalSafeInteger },
  questionCount: { type: Number, min: 1, max: 10000, default: null, validate: isOptionalSafeInteger },
  marksPerQuestion: { type: Number, min: 0, max: 1000, default: 1, validate: Number.isFinite },
  totalMarks: { type: Number, min: 0, max: 1000000, default: null, validate: (value) => value === null || Number.isFinite(value) },
  negativeMarkingEnabled: { type: Boolean, default: false },
  negativeMarksPerQuestion: { type: Number, min: 0, max: 1000, default: 0, validate: Number.isFinite },
  patternVerified: { type: Boolean, default: false },
  allowAnswerReview: { type: Boolean, default: true },
  revealExplanations: { type: Boolean, default: true },
  publicationStatus: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
}, { timestamps: true });

mockTestSchema.index({ exam: 1, publicationStatus: 1, createdAt: -1 });
mockTestSchema.pre('validate', function validateNegativeMarking() {
  if (this.publicationStatus === 'published') {
    if (!this.durationMinutes) this.invalidate('durationMinutes', 'A published mock test requires a duration.');
    if (!this.questionCount) this.invalidate('questionCount', 'A published mock test requires a question count.');
    if (this.questionBanks.length === 0) this.invalidate('questionBanks', 'A published mock test requires at least one question bank.');
    if (this.totalMarks !== null && this.questionCount && this.totalMarks < this.questionCount * this.marksPerQuestion) {
      this.invalidate('totalMarks', 'Maximum marks cannot be less than the possible score.');
    }
  }
  if (this.negativeMarkingEnabled && this.negativeMarksPerQuestion <= 0) {
    this.invalidate('negativeMarksPerQuestion', 'Set a positive penalty when negative marking is enabled.');
  }
  if (this.negativeMarksPerQuestion > this.marksPerQuestion) {
    this.invalidate('negativeMarksPerQuestion', 'Negative marks cannot exceed marks per question.');
  }
});

export default mongoose.models.MockTest ?? mongoose.model('MockTest', mockTestSchema);
