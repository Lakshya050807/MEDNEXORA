import mongoose from 'mongoose';

const courseProgressSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  completedLessonIds: { type: [{ type: mongoose.Schema.Types.ObjectId }], default: [] },
  lastLessonId: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { timestamps: true });

courseProgressSchema.index({ student: 1, course: 1 }, { unique: true });
courseProgressSchema.index({ student: 1, updatedAt: -1 });

export default mongoose.models.CourseProgress ?? mongoose.model('CourseProgress', courseProgressSchema);
