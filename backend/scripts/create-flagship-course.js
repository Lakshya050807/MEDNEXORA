import 'dotenv/config';
import mongoose from 'mongoose';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Exam from '../src/models/Exam.js';
import Subject from '../src/models/Subject.js';
import StudyMaterial from '../src/models/StudyMaterial.js';
import Course from '../src/models/Course.js';

export const flagshipCourseConfig = Object.freeze({
  exam: { name: 'B.Sc. Nursing Entrance Examination', slug: 'bsc-nursing-entrance-examination' },
  product: {
    title: 'B.Sc. Nursing Entrance Preparation',
    slug: 'bsc-nursing-entrance-preparation',
    description: 'A structured learning programme covering Physics, Chemistry and Biology to help students prepare for B.Sc. Nursing entrance examinations.',
    resourceType: 'video-course',
  },
  category: 'Government Competitive Exam Preparation',
  targetAudience: 'Students preparing for B.Sc. Nursing entrance examinations.',
  subjects: [
    { name: 'Physics', slug: 'physics', sortOrder: 0 },
    { name: 'Chemistry', slug: 'chemistry', sortOrder: 1 },
    { name: 'Biology', slug: 'biology', sortOrder: 2 },
  ],
});

async function findOrCreate(Model, filter, data) {
  const existing = await Model.findOne(filter);
  if (existing) return { document: existing, created: false };
  return { document: await Model.create(data), created: true };
}

export async function ensureFlagshipCourse({ ExamModel = Exam, SubjectModel = Subject, ProductModel = StudyMaterial, CourseModel = Course } = {}) {
  const examResult = await findOrCreate(ExamModel, { slug: flagshipCourseConfig.exam.slug }, {
    ...flagshipCourseConfig.exam,
    region: '',
    publicationStatus: 'draft',
    isPrimary: false,
  });
  const exam = examResult.document;

  const subjects = [];
  const subjectResults = [];
  for (const subjectConfig of flagshipCourseConfig.subjects) {
    const result = await findOrCreate(SubjectModel, { exam: exam._id, slug: subjectConfig.slug }, {
      ...subjectConfig,
      exam: exam._id,
      description: '',
      publicationStatus: 'draft',
    });
    subjects.push(result.document);
    subjectResults.push({ slug: subjectConfig.slug, created: result.created });
  }

  const productResult = await findOrCreate(ProductModel, { exam: exam._id, slug: flagshipCourseConfig.product.slug }, {
    exam: exam._id,
    ...flagshipCourseConfig.product,
    subject: null,
    pricePaise: null,
    discountPaise: 0,
    thumbnailUrl: '',
    publicationStatus: 'draft',
  });
  const product = productResult.document;
  if (product.resourceType !== flagshipCourseConfig.product.resourceType) {
    throw new Error('An existing product with the flagship course slug uses a different resource type; no existing record was changed.');
  }

  const courseResult = await findOrCreate(CourseModel, { product: product._id }, {
    product: product._id,
    exam: exam._id,
    subjects: subjects.map((subject) => subject._id),
    courseType: flagshipCourseConfig.product.resourceType,
    category: flagshipCourseConfig.category,
    targetAudience: flagshipCourseConfig.targetAudience,
    durationMinutes: null,
    lessonCount: null,
    outline: [],
    modules: [],
    publicationStatus: 'draft',
  });

  if (productResult.created && !product.course) {
    product.course = courseResult.document._id;
    await product.save();
  }

  return {
    exam: { id: String(exam._id), created: examResult.created, publicationStatus: exam.publicationStatus },
    subjects: subjectResults,
    product: { id: String(product._id), created: productResult.created, publicationStatus: product.publicationStatus, pricePaise: product.pricePaise ?? null },
    course: { id: String(courseResult.document._id), created: courseResult.created, publicationStatus: courseResult.document.publicationStatus, subjectCount: courseResult.document.subjects?.length ?? subjects.length },
  };
}

async function main() {
  try {
    const { env } = await import('../src/config/env.js');
    await mongoose.connect(env.mongoUri);
    await Promise.all([Exam.init(), Subject.init(), StudyMaterial.init(), Course.init()]);
    const result = await ensureFlagshipCourse();
    console.log(JSON.stringify(result, null, 2));
    console.log('Flagship setup is idempotent. Existing course, exam, and subject records are not overwritten; review all draft content before publishing.');
  } catch (error) {
    console.error(error?.code === 11000
      ? 'The flagship course setup found an existing database index conflict. Inspect matching records before retrying.'
      : `The flagship course setup failed (${error?.name ?? 'database error'}). Check MongoDB connectivity and the matching record relationships.`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
