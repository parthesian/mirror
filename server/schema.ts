import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const photos = sqliteTable('photos', {
    id: text('id').primaryKey(),
    storageKey: text('storage_key').notNull().unique(),
    location: text('location').notNull(),
    description: text('description').default(''),
    takenAt: text('taken_at').notNull(),
    uploadedAt: text('uploaded_at').notNull(),
    width: integer('width'),
    height: integer('height'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    country: text('country').default(''),
    state: text('state').default(''),
    camera: text('camera').default(''),
    colors: text('colors').default(''),
});

export type PhotoRow = typeof photos.$inferSelect;
