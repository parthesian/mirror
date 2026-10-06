import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { photos } from '../../server/schema.js';
import { openTestDb } from '../helpers/sqliteD1.js';

describe('photo table', () => {
    it('matches the drizzle columns to the applied SQL migrations', () => {
        const { sqlite } = openTestDb();
        const migrated = sqlite
            .prepare('PRAGMA table_info(photos)')
            .all()
            .map((column) => {
                if (typeof column.name !== 'string') {
                    throw new Error('PRAGMA table_info returned a column without a name.');
                }
                return column.name;
            })
            .sort();
        const declared = Object.values(getTableColumns(photos))
            .map((column) => column.name)
            .sort();
        expect(declared).toEqual(migrated);
    });
});
