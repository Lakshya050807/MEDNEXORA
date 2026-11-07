import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePrimaryExamIndex } from '../src/db/ensure-primary-exam-index.js';

test('primary exam index migration replaces an older non-unique index and keeps the intended partial unique index', async () => {
  const dropped = [];
  const model = { collection: {
    async indexes() { return [
      { name: '_id_', key: { _id: 1 } },
      { name: 'isPrimary_1', key: { isPrimary: 1 } },
      { name: 'exam_name', key: { name: 1 } },
    ]; },
    async dropIndex(name) { dropped.push(name); },
  } };
  assert.deepEqual(await ensurePrimaryExamIndex(model), ['isPrimary_1']);
  assert.deepEqual(dropped, ['isPrimary_1']);
});

test('primary exam index migration leaves the correct index and tolerates a new collection', async () => {
  const dropped = [];
  const correctModel = { collection: {
    async indexes() { return [{ name: 'isPrimary_1', key: { isPrimary: 1 }, unique: true, partialFilterExpression: { isPrimary: true } }]; },
    async dropIndex(name) { dropped.push(name); },
  } };
  assert.deepEqual(await ensurePrimaryExamIndex(correctModel), []);
  assert.deepEqual(dropped, []);
  const newModel = { collection: { async indexes() { const error = new Error('missing collection'); error.code = 26; throw error; } } };
  assert.deepEqual(await ensurePrimaryExamIndex(newModel), []);
});
