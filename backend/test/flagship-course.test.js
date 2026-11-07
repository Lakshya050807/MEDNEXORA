import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureFlagshipCourse, flagshipCourseConfig } from '../scripts/create-flagship-course.js';

function createMemoryModel() {
  return class {
    static rows = [];
    static nextId = 1;
    static async findOne(filter) {
      return this.rows.find((row) => Object.entries(filter).every(([key, value]) => String(row[key]?._id ?? row[key]) === String(value?._id ?? value))) ?? null;
    }
    static async create(data) {
      const row = { ...data, _id: `${this.modelName}-${this.nextId++}`, async save() { return this; } };
      this.rows.push(row);
      return row;
    }
  };
}

test('flagship setup creates only a draft course with exactly Physics, Chemistry, Biology and no invented price or duration', async () => {
  const ExamModel = createMemoryModel(); ExamModel.modelName = 'exam';
  const SubjectModel = createMemoryModel(); SubjectModel.modelName = 'subject';
  const ProductModel = createMemoryModel(); ProductModel.modelName = 'product';
  const CourseModel = createMemoryModel(); CourseModel.modelName = 'course';

  const result = await ensureFlagshipCourse({ ExamModel, SubjectModel, ProductModel, CourseModel });
  const course = CourseModel.rows[0];
  const product = ProductModel.rows[0];

  assert.equal(course.publicationStatus, 'draft');
  assert.equal(course.category, 'Government Competitive Exam Preparation');
  assert.equal(course.targetAudience, 'Students preparing for B.Sc. Nursing entrance examinations.');
  assert.deepEqual(course.subjects.map((id) => SubjectModel.rows.find((subject) => subject._id === id)?.name), ['Physics', 'Chemistry', 'Biology']);
  assert.equal(course.subjects.length, 3);
  assert.equal(course.durationMinutes, null);
  assert.equal(course.lessonCount, null);
  assert.deepEqual(course.modules, []);
  assert.equal(product.title, 'B.Sc. Nursing Entrance Preparation');
  assert.equal(product.slug, 'bsc-nursing-entrance-preparation');
  assert.equal(product.description, 'A structured learning programme covering Physics, Chemistry and Biology to help students prepare for B.Sc. Nursing entrance examinations.');
  assert.equal(product.publicationStatus, 'draft');
  assert.equal(product.pricePaise, null);
  assert.deepEqual(result.subjects.map((entry) => entry.slug), flagshipCourseConfig.subjects.map((entry) => entry.slug));
});

test('flagship setup is idempotent and leaves existing course content, publication status, and price unchanged', async () => {
  const ExamModel = createMemoryModel(); ExamModel.modelName = 'exam';
  const SubjectModel = createMemoryModel(); SubjectModel.modelName = 'subject';
  const ProductModel = createMemoryModel(); ProductModel.modelName = 'product';
  const CourseModel = createMemoryModel(); CourseModel.modelName = 'course';

  await ensureFlagshipCourse({ ExamModel, SubjectModel, ProductModel, CourseModel });
  ProductModel.rows[0].pricePaise = 250000;
  ProductModel.rows[0].publicationStatus = 'published';
  CourseModel.rows[0].publicationStatus = 'published';
  CourseModel.rows[0].modules = [{ title: 'Admin authored module' }];

  const result = await ensureFlagshipCourse({ ExamModel, SubjectModel, ProductModel, CourseModel });
  assert.equal(ExamModel.rows.length, 1);
  assert.equal(SubjectModel.rows.length, 3);
  assert.equal(ProductModel.rows.length, 1);
  assert.equal(CourseModel.rows.length, 1);
  assert.equal(ProductModel.rows[0].pricePaise, 250000);
  assert.equal(ProductModel.rows[0].publicationStatus, 'published');
  assert.equal(CourseModel.rows[0].publicationStatus, 'published');
  assert.equal(CourseModel.rows[0].modules[0].title, 'Admin authored module');
  assert.equal(result.course.created, false);
  assert.equal(result.product.created, false);
});
