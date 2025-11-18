import * as schema from '~/lib/db/schema';

/**
 * In-memory test database state
 * Simulates D1 database behavior for testing
 */
export class TestDatabase {
  private tables: Map<string, Map<string, any>> = new Map();

  constructor() {
    this.reset();
  }

  reset() {
    this.tables.clear();
    this.tables.set('users', new Map());
    this.tables.set('comments', new Map());
    this.tables.set('suggestions', new Map());
    this.tables.set('discussions', new Map());
    this.tables.set('discussionMessages', new Map());
    this.tables.set('reviewSessions', new Map());
    this.tables.set('documentMetadata', new Map());
    this.tables.set('activityLog', new Map());
  }

  getTable(tableName: string): Map<string, any> {
    if (!this.tables.has(tableName)) {
      this.tables.set(tableName, new Map());
    }
    return this.tables.get(tableName)!;
  }

  insert(tableName: string, record: any): void {
    const table = this.getTable(tableName);
    table.set(record.id, { ...record });
  }

  update(tableName: string, id: string, updates: any): void {
    const table = this.getTable(tableName);
    const existing = table.get(id);
    if (existing) {
      table.set(id, { ...existing, ...updates });
    }
  }

  delete(tableName: string, id: string): void {
    const table = this.getTable(tableName);
    table.delete(id);
  }

  get(tableName: string, id: string): any | null {
    const table = this.getTable(tableName);
    return table.get(id) || null;
  }

  getAll(tableName: string): any[] {
    const table = this.getTable(tableName);
    return Array.from(table.values());
  }

  query(tableName: string, filters: Record<string, any>): any[] {
    const records = this.getAll(tableName);
    return records.filter(record => {
      return Object.entries(filters).every(([key, value]) => {
        if (value === null) {
          return record[key] === null || record[key] === undefined;
        }
        return record[key] === value;
      });
    });
  }

  count(tableName: string, filters: Record<string, any> = {}): number {
    return this.query(tableName, filters).length;
  }
}

// Global test database instance
let testDb: TestDatabase | null = null;

export function getTestDatabase(): TestDatabase {
  if (!testDb) {
    testDb = new TestDatabase();
  }
  return testDb;
}

export function cleanupTestDatabase(): void {
  if (testDb) {
    testDb.reset();
  }
}

/**
 * Create a mock Drizzle database instance
 * This is a simplified mock that handles basic CRUD operations
 */
export function createMockDb(): any {
  const db = getTestDatabase();

  // Mock query builder that implements Drizzle-like chainable API
  class QueryBuilder {
    private _table: string | null = null;
    private _selection: any = null;
    private _whereConditions: any[] = [];
    private _orderByFields: any[] = [];
    private _limitValue: number | null = null;
    private _offsetValue: number = 0;
    private _joins: any[] = [];

    select(selection?: any) {
      this._selection = selection;
      return this;
    }

    from(table: any) {
      // Extract table name from table object
      if (table && table[Symbol.for('drizzle:Name')]) {
        this._table = table[Symbol.for('drizzle:Name')];
      } else if (typeof table === 'string') {
        this._table = table;
      }
      return this;
    }

    where(condition: any) {
      this._whereConditions.push(condition);
      return this;
    }

    leftJoin(table: any, condition: any) {
      this._joins.push({ type: 'left', table, condition });
      return this;
    }

    orderBy(...fields: any[]) {
      this._orderByFields = fields;
      return this;
    }

    limit(value: number) {
      this._limitValue = value;
      return this;
    }

    offset(value: number) {
      this._offsetValue = value;
      return this;
    }

    $dynamic() {
      return this;
    }

    async get(): Promise<any> {
      const results = await this.all();
      return results[0] || null;
    }

    async all(): Promise<any[]> {
      if (!this._table) {
        return [];
      }

      let results = db.getAll(this._table);

      // Apply filters (simplified - real implementation would parse conditions)
      // For now, just return all results
      // Note: _selection, _whereConditions, _orderByFields, _joins are stored for future enhancement
      void this._selection;
      void this._orderByFields;

      // Apply limit and offset
      if (this._limitValue !== null) {
        results = results.slice(this._offsetValue, this._offsetValue + this._limitValue);
      }

      return results;
    }

    async execute(): Promise<any> {
      return this.all();
    }
  }

  return {
    select: (selection?: any) => {
      const qb = new QueryBuilder();
      return qb.select(selection);
    },
    insert: (table: any) => {
      return {
        values: async (values: any) => {
          const tableName = getTableName(table);
          db.insert(tableName, values);
          return values;
        },
      };
    },
    update: (table: any) => {
      const tableName = getTableName(table);
      return {
        set: (updates: any) => {
          return {
            where: async (condition: any) => {
              // Simplified: assumes condition contains ID
              const id = extractIdFromCondition(condition);
              if (id) {
                db.update(tableName, id, updates);
              }
            },
          };
        },
      };
    },
    delete: (table: any) => {
      const tableName = getTableName(table);
      return {
        where: async (condition: any) => {
          const id = extractIdFromCondition(condition);
          if (id) {
            db.delete(tableName, id);
          }
        },
      };
    },
  };
}

function getTableName(table: any): string {
  // Simplified table name extraction
  if (table === schema.users) return 'users';
  if (table === schema.comments) return 'comments';
  if (table === schema.suggestions) return 'suggestions';
  if (table === schema.discussions) return 'discussions';
  if (table === schema.discussionMessages) return 'discussionMessages';
  if (table === schema.reviewSessions) return 'reviewSessions';
  if (table === schema.documentMetadata) return 'documentMetadata';
  if (table === schema.activityLog) return 'activityLog';
  return 'unknown';
}

function extractIdFromCondition(_condition: any): string | null {
  // Simplified ID extraction from where condition
  // In real implementation, would parse Drizzle condition objects
  return null;
}

/**
 * Seed test database with initial data
 */
export async function seedTestData(data: {
  users?: any[];
  comments?: any[];
  suggestions?: any[];
  discussions?: any[];
  reviewSessions?: any[];
}) {
  const db = getTestDatabase();

  if (data.users) {
    data.users.forEach(user => db.insert('users', user));
  }

  if (data.comments) {
    data.comments.forEach(comment => db.insert('comments', comment));
  }

  if (data.suggestions) {
    data.suggestions.forEach(suggestion => db.insert('suggestions', suggestion));
  }

  if (data.discussions) {
    data.discussions.forEach(discussion => db.insert('discussions', discussion));
  }

  if (data.reviewSessions) {
    data.reviewSessions.forEach(session => db.insert('reviewSessions', session));
  }
}

/**
 * Get records from test database
 */
export function getTestRecords(tableName: string, filters?: Record<string, any>): any[] {
  const db = getTestDatabase();
  if (filters) {
    return db.query(tableName, filters);
  }
  return db.getAll(tableName);
}

/**
 * Assert record exists in test database
 */
export function assertRecordExists(tableName: string, id: string): any {
  const db = getTestDatabase();
  const record = db.get(tableName, id);
  if (!record) {
    throw new Error(`Record with id ${id} not found in ${tableName}`);
  }
  return record;
}

/**
 * Assert record count in test database
 */
export function assertRecordCount(tableName: string, expected: number, filters?: Record<string, any>): void {
  const db = getTestDatabase();
  const actual = filters ? db.query(tableName, filters).length : db.count(tableName);
  if (actual !== expected) {
    throw new Error(`Expected ${expected} records in ${tableName}, but found ${actual}`);
  }
}
