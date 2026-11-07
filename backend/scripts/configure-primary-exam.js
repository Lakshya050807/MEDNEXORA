import 'dotenv/config';
import mongoose from 'mongoose';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Exam from '../src/models/Exam.js';
import { ensurePrimaryExamIndex } from '../src/db/ensure-primary-exam-index.js';

export const primaryExamDefaults = Object.freeze({
  name: 'B.Sc. Nursing Entrance Examination',
  slug: 'bsc-nursing-entrance-examination',
  region: '',
});

export async function configurePrimaryExam(ExamModel = Exam) {
  const { slug, name, region } = primaryExamDefaults;
  await ExamModel.updateMany({ slug: { $ne: slug }, isPrimary: true }, { $set: { isPrimary: false } });
  return ExamModel.updateOne(
    { slug },
    {
      $set: { region, isPrimary: true },
      $setOnInsert: { name, slug, publicationStatus: 'draft' },
    },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

async function main() {
  try {
    const { env } = await import('../src/config/env.js');
    await mongoose.connect(env.mongoUri);
    await ensurePrimaryExamIndex(Exam);
    await Exam.init();
    await configurePrimaryExam(Exam);
    console.log('The B.Sc. Nursing entrance exam configuration is set as the primary target. Existing exam details were preserved; a new configuration remains a draft until an administrator publishes it.');
  } catch (error) {
    const safeCode = Number.isInteger(error?.code) ? `, code ${error.code}` : '';
    console.error(error?.code === 11000
      ? 'The primary exam configuration conflicts with an existing database index. Inspect examination records before retrying.'
      : `The primary exam configuration could not be saved (${error?.name ?? 'database error'}${safeCode}). Check MongoDB connectivity and database permissions.`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
