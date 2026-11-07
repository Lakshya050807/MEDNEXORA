import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateStudyMaterialTextIndex } from '../src/db/study-material-text-index.js';

function legacyTextIndex() {
  return {
    v: 2,
    key: { _fts: 'text', _ftsx: 1 },
    name: 'title_text_description_text_keywords_text',
    weights: { title: 1, description: 1, keywords: 1 },
    default_language: 'english',
    language_override: 'language',
    textIndexVersion: 3,
  };
}

function mockCollection() {
  const rows = [];
  const indexList = [
    { name: '_id_', key: { _id: 1 } },
    { name: 'exam_1', key: { exam: 1 } },
    legacyTextIndex(),
  ];
  const dropped = [];
  return {
    collectionName: 'studymaterials',
    rows,
    indexList,
    dropped,
    async indexes() { return structuredClone(indexList); },
    async countDocuments(filter) {
      if (filter.language?.$exists === true) return rows.filter((row) => Object.hasOwn(row, 'language')).length;
      if (filter.language === '') return rows.filter((row) => row.language === '').length;
      if (filter.textIndexLanguage?.$exists === true) return rows.filter((row) => Object.hasOwn(row, 'textIndexLanguage')).length;
      return rows.length;
    },
    aggregate() {
      const groups = new Map();
      for (const row of rows) {
        const value = Object.hasOwn(row, 'language') ? row.language : null;
        groups.set(value, (groups.get(value) ?? 0) + 1);
      }
      return { toArray: async () => [...groups].map(([_id, count]) => ({ _id, count })).sort((a, b) => b.count - a.count).slice(0, 20) };
    },
    async dropIndex(name) {
      dropped.push(name);
      const at = indexList.findIndex((index) => index.name === name);
      if (at >= 0) indexList.splice(at, 1);
    },
    async createIndex(key, options) {
      const index = {
        name: options.name,
        key: { _fts: 'text', _ftsx: 1 },
        weights: { title: 1, description: 1, keywords: 1 },
        ...options,
      };
      indexList.push(index);
      return index.name;
    },
    async insertOne(document) {
      const textIndex = indexList.find((index) => index.weights);
      const overrideValue = document[textIndex.language_override];
      if (overrideValue === '') {
        const error = new Error('language override unsupported:');
        error.name = 'MongoServerError';
        error.code = 17262;
        throw error;
      }
      rows.push({ ...document });
      return { acknowledged: true, insertedId: rows.length };
    },
  };
}

test('inspection-only reports all indexes and language data without changing the collection', async () => {
  const collection = mockCollection();
  collection.rows.push({ language: '' }, { language: 'English' });
  const result = await migrateStudyMaterialTextIndex({ collection }, { apply: false });
  assert.equal(result.mode, 'inspect-only');
  assert.equal(result.changed, false);
  assert.equal(result.indexes.length, 3);
  assert.equal(result.textIndexes[0].language_override, 'language');
  assert.equal(result.languageMetadata.recordsWithLanguageField, 2);
  assert.equal(result.languageMetadata.emptyLanguageCount, 1);
  assert.deepEqual(collection.dropped, []);
  assert.equal(collection.indexList.length, 3);
  assert.equal(collection.rows.length, 2);
});

test('simulates MongoDB 17262 for empty language metadata and succeeds after the guarded text-index migration', async () => {
  const collection = mockCollection();
  const Model = { collection };
  await assert.rejects(collection.insertOne({ title: 'Draft note', language: '' }), (error) => {
    assert.equal(error.name, 'MongoServerError');
    assert.equal(error.code, 17262);
    assert.match(error.message, /language override unsupported/);
    return true;
  });

  const inspection = await migrateStudyMaterialTextIndex(Model, { apply: false });
  assert.equal(inspection.languageMetadata.textIndexLanguageFieldCount, 0);
  assert.deepEqual(collection.dropped, []);

  const migrated = await migrateStudyMaterialTextIndex(Model, { apply: true });
  assert.equal(migrated.changed, true);
  assert.deepEqual(collection.dropped, ['title_text_description_text_keywords_text']);
  const textIndex = collection.indexList.find((index) => index.weights);
  assert.equal(textIndex.language_override, 'textIndexLanguage');
  assert.equal(textIndex.default_language, 'none');

  await collection.insertOne({ title: 'Draft note', language: '' });
  await collection.insertOne({ title: 'Hindi notes', language: 'Hindi' });
  assert.equal(collection.rows.length, 2);
  assert.deepEqual(collection.dropped, ['title_text_description_text_keywords_text']);
});

test('migration refuses unexpected text indexes and pre-existing override metadata', async () => {
  const unexpected = mockCollection();
  unexpected.indexList[2].weights = { title: 5, description: 1, keywords: 1 };
  await assert.rejects(migrateStudyMaterialTextIndex({ collection: unexpected }, { apply: true }), /does not match the StudyMaterial search fields/);
  assert.deepEqual(unexpected.dropped, []);

  const hasOverrideData = mockCollection();
  hasOverrideData.rows.push({ textIndexLanguage: 'english' });
  await assert.rejects(migrateStudyMaterialTextIndex({ collection: hasOverrideData }, { apply: true }), /textIndexLanguage values/);
  assert.deepEqual(hasOverrideData.dropped, []);
});
