import 'dotenv/config';
import mongoose from 'mongoose';
import StudyMaterial from '../src/models/StudyMaterial.js';
import { env } from '../src/config/env.js';
import { migrateStudyMaterialTextIndex } from '../src/db/study-material-text-index.js';

async function main() {
  if (!env.mongoUri) throw new Error('Set MONGODB_URI before inspecting the StudyMaterial indexes.');
  const apply = process.argv.includes('--apply');
  await mongoose.connect(env.mongoUri);
  try {
    const result = await migrateStudyMaterialTextIndex(StudyMaterial, { apply });
    console.log(JSON.stringify(result, null, 2));
    if (!apply) {
      console.log('Inspection only: no indexes or documents were changed. Review this report before running with --apply.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(`StudyMaterial text-index migration stopped without continuing: ${error?.message ?? error}`);
  process.exitCode = 1;
});
