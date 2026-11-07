export const studyMaterialTextIndexKey = Object.freeze({
  title: 'text',
  description: 'text',
  keywords: 'text',
});

export const studyMaterialTextIndexOptions = Object.freeze({
  name: 'title_text_description_text_keywords_text',
  default_language: 'none',
  language_override: 'textIndexLanguage',
});

const textFields = Object.keys(studyMaterialTextIndexKey).sort();

function isTextIndex(index) {
  return index?.key?._fts === 'text' || Boolean(index?.weights);
}

function weightsMatch(index) {
  const weights = index?.weights;
  if (!weights) return false;
  const fields = Object.keys(weights).sort();
  return fields.length === textFields.length
    && fields.every((field, indexPosition) => field === textFields[indexPosition] && weights[field] === 1);
}

function isSupportedLegacyIndex(index) {
  return weightsMatch(index)
    && (index.language_override == null || index.language_override === 'language')
    && (index.default_language == null || index.default_language === 'english')
    && !index.unique
    && !index.sparse
    && !index.partialFilterExpression
    && !index.expireAfterSeconds;
}

function legacyOptions(index) {
  return {
    name: index.name,
    weights: index.weights,
    default_language: index.default_language ?? 'english',
    language_override: index.language_override ?? 'language',
    ...(index.textIndexVersion == null ? {} : { textIndexVersion: index.textIndexVersion }),
    ...(index.collation == null ? {} : { collation: index.collation }),
  };
}

async function listIndexes(collection) {
  try {
    return await collection.indexes();
  } catch (error) {
    // A new MongoDB collection has no index catalog yet.
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return [];
    throw error;
  }
}

export async function inspectStudyMaterialTextIndex(collection) {
  const indexes = await listIndexes(collection);
  const [recordsWithLanguageField, emptyLanguageCount, textIndexLanguageFieldCount, languageValueCounts] = await Promise.all([
    collection.countDocuments({ language: { $exists: true } }),
    collection.countDocuments({ language: '' }),
    collection.countDocuments({ textIndexLanguage: { $exists: true } }),
    collection.aggregate([
      { $group: { _id: '$language', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]).toArray(),
  ]);

  return {
    collection: collection.collectionName ?? 'studymaterials',
    indexes,
    textIndexes: indexes.filter(isTextIndex),
    languageMetadata: {
      recordsWithLanguageField,
      emptyLanguageCount,
      textIndexLanguageFieldCount,
      languageValueCounts,
    },
  };
}

export async function migrateStudyMaterialTextIndex(Model, { apply = false } = {}) {
  const collection = Model.collection;
  const inspection = await inspectStudyMaterialTextIndex(collection);
  const result = { ...inspection, changed: false, mode: apply ? 'apply' : 'inspect-only' };
  if (!apply) return result;

  const textIndexes = inspection.textIndexes;
  if (textIndexes.length > 1) throw new Error('More than one text index was found; inspect the collection and resolve this manually.');
  const current = textIndexes[0] ?? null;
  if (current && !weightsMatch(current)) {
    throw new Error('The existing text index does not match the StudyMaterial search fields; no index was changed.');
  }

  if (current?.language_override === studyMaterialTextIndexOptions.language_override
    && current?.default_language === studyMaterialTextIndexOptions.default_language) {
    return { ...result, changed: false, message: 'The StudyMaterial text index already has the expected configuration.' };
  }

  if (inspection.languageMetadata.textIndexLanguageFieldCount > 0) {
    throw new Error('Documents already contain textIndexLanguage values; inspect them before migrating. No index was changed.');
  }
  if (current && !isSupportedLegacyIndex(current)) {
    throw new Error('The existing text index has non-default options; inspect it and plan a manual migration. No index was changed.');
  }

  if (current) await collection.dropIndex(current.name);
  try {
    await collection.createIndex(studyMaterialTextIndexKey, studyMaterialTextIndexOptions);
  } catch (error) {
    if (current) {
      try {
        await collection.createIndex(studyMaterialTextIndexKey, legacyOptions(current));
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], 'The new StudyMaterial text index failed and the previous index could not be restored.');
      }
    }
    throw error;
  }
  const verified = await inspectStudyMaterialTextIndex(collection);
  return {
    ...verified,
    mode: 'apply',
    changed: true,
    replacedIndex: current?.name ?? null,
    message: 'The StudyMaterial text index now uses textIndexLanguage with the language-neutral default.',
  };
}
