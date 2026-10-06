import { z } from 'zod';
import { COLOR_IDS, type ColorId } from './colors.js';

export const colorIdSchema = z.enum(COLOR_IDS);

export const photoQuerySchema = z.object({
    limit: z.string().optional(),
    cursor: z.string().optional(),
    country: z.string().optional(),
    state: z.string().optional(),
    location: z.string().optional(),
    color: z.string().optional(),
    takenFrom: z.string().optional(),
    takenTo: z.string().optional(),
});

export type PhotoFilters = {
    country: string;
    state: string;
    location: string;
    color: ColorId | '';
    takenFrom: string;
    takenTo: string;
};

export const photoPatchSchema = z.object({
    location: z.string().optional(),
    description: z.string().optional(),
    country: z.string().optional(),
    state: z.string().optional(),
    camera: z.string().optional(),
    takenAt: z.string().optional(),
    latitude: z.union([z.number(), z.string(), z.null()]).optional(),
    longitude: z.union([z.number(), z.string(), z.null()]).optional(),
    colors: z.union([z.array(z.string()), z.string()]).optional(),
});

export type PhotoPatchInput = z.infer<typeof photoPatchSchema>;

export const photoListItemSchema = z.object({
    id: z.string(),
    takenAt: z.string(),
    uploadedAt: z.string(),
    width: z.number().nullable(),
    height: z.number().nullable(),
});

export type PhotoListItem = z.infer<typeof photoListItemSchema>;

const imageAssetSchema = z.object({
    url: z.string(),
    width: z.number().nullable(),
    height: z.number().nullable(),
});

export const photoDetailSchema = photoListItemSchema.extend({
    location: z.string(),
    description: z.string(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    country: z.string(),
    state: z.string(),
    camera: z.string(),
    colors: z.array(colorIdSchema),
    storageKey: z.string(),
    image: imageAssetSchema,
    thumbnail: imageAssetSchema,
});

export type PhotoDetail = z.infer<typeof photoDetailSchema>;
