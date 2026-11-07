import test from 'node:test';
import assert from 'node:assert/strict';
import { configurePrimaryExam, primaryExamDefaults } from '../scripts/configure-primary-exam.js';

test('primary exam setup changes only the target priority and inserts an unverified draft when absent', async () => {
  const calls = [];
  const model = {
    async updateMany(...args) { calls.push(['updateMany', ...args]); },
    async updateOne(...args) { calls.push(['updateOne', ...args]); return { acknowledged: true, upsertedCount: 1 }; },
  };
  const result = await configurePrimaryExam(model);
  assert.deepEqual(result, { acknowledged: true, upsertedCount: 1 });
  assert.deepEqual(calls[0], ['updateMany', { slug: { $ne: primaryExamDefaults.slug }, isPrimary: true }, { $set: { isPrimary: false } }]);
  assert.deepEqual(calls[1], ['updateOne', { slug: primaryExamDefaults.slug }, {
    $set: { region: '', isPrimary: true },
    $setOnInsert: { name: primaryExamDefaults.name, slug: primaryExamDefaults.slug, publicationStatus: 'draft' },
  }, { upsert: true, runValidators: true, setDefaultsOnInsert: true }]);
  assert.equal(JSON.stringify(calls).includes('syllabus'), false);
  assert.equal(JSON.stringify(calls).includes('officialSources'), false);
});
