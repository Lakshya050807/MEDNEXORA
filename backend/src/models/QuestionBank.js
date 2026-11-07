import mongoose from 'mongoose';
import questionImageSchema from './questionImage.js';

const questionSchema = new mongoose.Schema({
  prompt: { type: String, required: true, trim: true, maxlength: 5000 },
  options: { type: [{ type: String, trim: true, maxlength: 1000 }], required: true, validate: (options) => options.length >= 2 && options.length <= 8 },
  correctAnswerIndex: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  explanation: { type: String, trim: true, maxlength: 5000, default: '' },
  topic: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic', default: null },
  image: { type: questionImageSchema, default: null },
}, { _id: true });

const questionBankSchema = new mongoose.Schema({
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyMaterial', default: null, index: true },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
  questions: { type: [questionSchema], default: [] },
  publicationStatus: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
}, { timestamps: true });

questionBankSchema.index({ exam: 1, subject: 1, publicationStatus: 1, createdAt: -1 });
questionBankSchema.path('questions').validate((questions) => questions.every((question) => question.correctAnswerIndex < question.options.length), 'Each answer index must match an available option.');
questionBankSchema.pre('validate', function requireQuestionsForPublication() {
  if (this.publicationStatus === 'published' && this.questions.length === 0) {
    this.invalidate('questions', 'A published question bank must contain at least one question.');
  }
});

export default mongoose.models.QuestionBank ?? mongoose.model('QuestionBank', questionBankSchema);
