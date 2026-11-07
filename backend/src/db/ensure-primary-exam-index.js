const primaryKeyPattern = (index) => {
  const entries = Object.entries(index.key ?? {});
  return entries.length === 1 && entries[0][0] === 'isPrimary' && entries[0][1] === 1;
};

export async function ensurePrimaryExamIndex(ExamModel) {
  let indexes;
  try {
    indexes = await ExamModel.collection.indexes();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return [];
    throw error;
  }
  const correctIndex = indexes.some((index) => primaryKeyPattern(index)
    && index.unique === true
    && index.partialFilterExpression?.isPrimary === true);
  if (correctIndex) return [];

  const dropped = [];
  for (const index of indexes.filter((candidate) => candidate.name !== '_id_' && primaryKeyPattern(candidate))) {
    await ExamModel.collection.dropIndex(index.name);
    dropped.push(index.name);
  }
  return dropped;
}

export default ensurePrimaryExamIndex;
