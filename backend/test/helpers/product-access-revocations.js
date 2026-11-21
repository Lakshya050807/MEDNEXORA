function idOf(value) {
  return String(value?._id ?? value?.id ?? value ?? '');
}

function matches(record, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = idOf(record[key]);
    if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
      return expected.$in.some((candidate) => idOf(candidate) === actual);
    }
    return actual === idOf(expected);
  });
}

class FakeQuery {
  constructor(value) { this.value = value; }
  sort() { return this; }
  lean() { return Promise.resolve(this.value); }
  then(resolve, reject) { return Promise.resolve(this.value).then(resolve, reject); }
}

export class FakeProductAccessRevocationModel {
  static rows = [];

  static reset() { this.rows = []; }

  static findOne(filter = {}) {
    return new FakeQuery(this.rows.find((row) => matches(row, filter)) ?? null);
  }

  static find(filter = {}) {
    return new FakeQuery(this.rows.filter((row) => matches(row, filter)));
  }

  static async updateOne(filter = {}, update = {}, options = {}) {
    let row = this.rows.find((candidate) => matches(candidate, filter));
    if (row) return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };
    if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    row = { ...(update.$setOnInsert ?? {}) };
    this.rows.push(row);
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: row._id };
  }
}

export function clearFakeProductAccessRevocations() {
  FakeProductAccessRevocationModel.reset();
}
