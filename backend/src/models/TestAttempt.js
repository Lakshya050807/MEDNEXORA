import mongoose from 'mongoose';
import questionImageSchema from './questionImage.js';

const attemptQuestionSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  bankId: { type: mongoose.Schema.Types.ObjectId, ref: 'QuestionBank', default: null },
  order: { type: Number, min: 0, validate: Number.isSafeInteger },
  prompt: { type: String, required: true, maxlength: 5000 },
  options: { type: [{ type: String, maxlength: 1000 }], required: true, validate: (items) => items.length >= 2 && items.length <= 8 },
  topic: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic', default: null },
  topicName: { type: String, trim: true, maxlength: 160, default: '' },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },
  subjectName: { type: String, trim: true, maxlength: 160, default: '' },
  chapterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', default: null },
  chapterName: { type: String, trim: true, maxlength: 160, default: '' },
  image: { type: questionImageSchema, default: null },
}, { _id: false });

const answerSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  selectedOptionIndex: { type: Number, min: 0, default: null, validate: (value) => value === null || Number.isSafeInteger(value) },
  markedForReview: { type: Boolean, default: false },
}, { _id: false });

const answerKeySchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  correctAnswerIndex: { type: Number, required: true, min: 0 },
  explanation: { type: String, maxlength: 5000, default: '' },
}, { _id: false });

const resultSchema = new mongoose.Schema({
  score: { type: Number, required: true },
  maximumMarks: { type: Number, required: true },
  correctAnswers: { type: Number, required: true },
  incorrectAnswers: { type: Number, required: true },
  unansweredQuestions: { type: Number, required: true },
  accuracyPercent: { type: Number, required: true },
  timeSpentSeconds: { type: Number, min: 0, validate: Number.isSafeInteger, default: null },
}, { _id: false });

const testAttemptSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  mode: { type: String, enum: ['practice', 'mock'], required: true },
  mockTest: { type: mongoose.Schema.Types.ObjectId, ref: 'MockTest', default: null },
  questionBank: { type: mongoose.Schema.Types.ObjectId, ref: 'QuestionBank', default: null },
  titleSnapshot: { type: String, required: true, maxlength: 200 },
  descriptionSnapshot: { type: String, trim: true, maxlength: 5000, default: '' },
  instructionsSnapshot: { type: String, trim: true, maxlength: 10000, default: '' },
  questions: { type: [attemptQuestionSchema], required: true, validate: (items) => items.length > 0 },
  answers: { type: [answerSchema], required: true },
  // Excluded from normal queries and never included by the API serializer.
  answerKey: { type: [answerKeySchema], required: true, select: false },
  status: { type: String, enum: ['in-progress', 'submitted', 'timed-out'], default: 'in-progress', index: true },
  submissionLocked: { type: Boolean, default: false },
  submissionTimedOut: { type: Boolean, default: false },
  startedAt: { type: Date, required: true },
  expiresAt: { type: Date, default: null },
  submittedAt: { type: Date, default: null },
  durationMinutes: { type: Number, default: null },
  marksPerQuestion: { type: Number, required: true, min: 0 },
  negativeMarkingEnabled: { type: Boolean, default: false },
  negativeMarksPerQuestion: { type: Number, default: 0, min: 0 },
  maximumMarks: { type: Number, required: true, min: 0 },
  allowAnswerReview: { type: Boolean, default: true },
  revealExplanations: { type: Boolean, default: true },
  result: { type: resultSchema, default: null },
}, {
  timestamps: true,
  toJSON: { transform(_document, returned) { delete returned.answerKey; delete returned.__v; return returned; } },
  toObject: { transform(_document, returned) { delete returned.answerKey; delete returned.__v; return returned; } },
});

testAttemptSchema.index({ student: 1, createdAt: -1 });
testAttemptSchema.index({ student: 1, mockTest: 1, status: 1 }, {
  unique: true,
  partialFilterExpression: { mode: 'mock', status: 'in-progress' },
});
testAttemptSchema.pre('validate', function validateSnapshotConsistency() {
  if (this.questions.length !== this.answers.length || this.questions.length !== this.answerKey.length) {
    this.invalidate('answers', 'Every attempt question must have one saved answer and one private answer key.');
    return;
  }
  const questionIds = this.questions.map((question) => String(question.questionId));
  if (new Set(questionIds).size !== questionIds.length) {
    this.invalidate('questions', 'An attempt cannot contain the same question more than once.');
  }
  const orderedIndexes = this.questions.map((question) => question.order).filter((value) => value !== undefined && value !== null);
  if (orderedIndexes.length && (orderedIndexes.length !== this.questions.length || new Set(orderedIndexes).size !== orderedIndexes.length)) {
    this.invalidate('questions', 'Question order values must be present and unique when configured.');
  }
  const answers = new Map(this.answers.map((answer) => [String(answer.questionId), answer]));
  const keys = new Map(this.answerKey.map((answer) => [String(answer.questionId), answer]));
  for (const question of this.questions) {
    const answer = answers.get(String(question.questionId));
    const key = keys.get(String(question.questionId));
    if (!answer || !key || key.correctAnswerIndex >= question.options.length) {
      this.invalidate('answerKey', 'Every answer key must match an available question option.');
      break;
    }
    if (answer.selectedOptionIndex !== null && answer.selectedOptionIndex >= question.options.length) {
      this.invalidate('answers', 'A selected answer must match an available question option.');
      break;
    }
  }
});

export default mongoose.models.TestAttempt ?? mongoose.model('TestAttempt', testAttemptSchema);
