function clone(value) {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function compare(left, right) {
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchesValue(document, key, condition) {
  const exists = Object.hasOwn(document, key);
  const value = document[key];
  if (condition && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition)) {
    return Object.entries(condition).every(([operator, expected]) => {
      if (operator === '$exists') return exists === expected;
      if (operator === '$lt') return exists && compare(value, expected) < 0;
      if (operator === '$lte') return exists && compare(value, expected) <= 0;
      if (operator === '$gt') return exists && compare(value, expected) > 0;
      if (operator === '$in') return expected.includes(value);
      return false;
    });
  }
  return value === condition || (value instanceof Date && condition instanceof Date && value.getTime() === condition.getTime());
}

function matches(document, filter) {
  return Object.entries(filter ?? {}).every(([key, condition]) => {
    if (key === '$or') return condition.some((item) => matches(document, item));
    if (key === '$and') return condition.every((item) => matches(document, item));
    return matchesValue(document, key, condition);
  });
}

function apply(document, update) {
  for (const [key, value] of Object.entries(update.$set ?? {})) document[key] = clone(value);
  for (const [key, amount] of Object.entries(update.$inc ?? {})) document[key] = (document[key] ?? 0) + amount;
  for (const key of Object.keys(update.$unset ?? {})) delete document[key];
}

export function createFakeEmailOutboxModel() {
  let rows = new Map();
  let id = 0;
  return class FakeEmailDeliveryOutboxModel {
    static async create(value) {
      const documents = Array.isArray(value) ? value : [value];
      const created = documents.map((document) => {
        const row = { ...clone(document), _id: document._id ?? `email-job-${++id}` };
        rows.set(String(row._id), row);
        return clone(row);
      });
      return Array.isArray(value) ? created : created[0];
    }

    static async findOneAndUpdate(filter, update, options = {}) {
      let candidates = [...rows.values()].filter((row) => matches(row, filter));
      if (options.sort) {
        const [[key, direction]] = Object.entries(options.sort);
        candidates.sort((left, right) => compare(left[key], right[key]) * direction);
      }
      const row = candidates[0];
      if (!row) return null;
      apply(row, update);
      return clone(row);
    }

    static async updateOne(filter, update) {
      const row = [...rows.values()].find((candidate) => matches(candidate, filter));
      if (!row) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      apply(row, update);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    }

    static async deleteMany(filter) {
      for (const [key, row] of rows) if (matches(row, filter)) rows.delete(key);
      return { acknowledged: true, deletedCount: 0 };
    }

    static documents() { return [...rows.values()].map(clone); }
  };
}
