# Photo Gallery API Documentation

## Architecture

The gallery now targets a Cloudflare-native backend:

- Static site: `Cloudflare Pages`
- Public photo API: `Pages Functions`
- Admin upload API: `Pages Functions` protected by `Cloudflare Access`
- Image storage: `R2`
- Metadata storage: `D1`

Use relative API paths in production so the frontend and API deploy together on the same Pages project.

## API Endpoints

### 1. List Photos

**Endpoint:** `GET /api/photos`

**Description:** Returns the public gallery feed ordered by `takenAt` descending with cursor pagination.

**Query params:**

- `limit` optional, defaults to `24`
- `cursor` optional opaque pagination cursor from the previous response

**Response:**

```json
{
  "photos": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "location": "California",
      "description": "Sunset at the beach",
      "takenAt": "2025-08-29T12:00:00.000Z",
      "uploadedAt": "2026-04-05T16:30:00.000Z",
      "storageKey": "photos/550e8400-e29b-41d4-a716-446655440000.jpg",
      "image": {
        "url": "/api/photos/550e8400-e29b-41d4-a716-446655440000/image?variant=full"
      },
      "thumbnail": {
        "url": "/api/photos/550e8400-e29b-41d4-a716-446655440000/image?variant=thumb"
      }
    }
  ],
  "hasMore": true,
  "nextCursor": "opaque-cursor"
}
```

### 2. Resolve Admin Session

**Endpoint:** `GET /api/admin/session`

**Description:** Returns the authenticated Cloudflare Access identity for the admin page.

**Auth:** Cloudflare Access policy should protect both `/admin/*` and `/api/admin/*`.

**Response:**

```json
{
  "authenticated": true,
  "email": "you@example.com"
}
```

### 3. Upload Photo

**Endpoint:** `POST /api/admin/photos`

**Description:** Uploads a new image to `R2` and inserts metadata into `D1`.

**Auth:** Cloudflare Access required.

**Request body:** `multipart/form-data`

- `photo`: required file
- `location`: required string
- `description`: optional string
- `takenAt`: optional ISO timestamp

**Response:**

```json
{
  "success": true,
  "photoId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Photo uploaded successfully.",
  "photo": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "location": "California",
    "description": "Sunset at the beach",
    "takenAt": "2025-08-29T12:00:00.000Z",
    "uploadedAt": "2026-04-05T16:30:00.000Z",
    "image": {
      "url": "/api/photos/550e8400-e29b-41d4-a716-446655440000/image?variant=full"
    },
    "thumbnail": {
      "url": "/api/photos/550e8400-e29b-41d4-a716-446655440000/image?variant=thumb"
    }
  }
}
```

## D1 Schema

The canonical metadata schema lives in `migrations/0001_create_photos.sql`.

```sql
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    storage_key TEXT NOT NULL UNIQUE,
    location TEXT NOT NULL,
    description TEXT DEFAULT '',
    taken_at TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    width INTEGER,
    height INTEGER
);
```

## Deployment Configuration

The repo is set up to keep `Cloudflare Pages` as the auto-deploy target.

- `build.js` generates `js/config.js`
- `wrangler.toml` defines the `Pages Functions`, `D1`, and `R2` bindings
- `functions/` contains the server-side API

Required Cloudflare configuration:

1. Bind `PHOTO_DB` to your D1 database.
2. Bind `PHOTO_BUCKET` to your R2 bucket.
3. Set `ADMIN_EMAIL_ALLOWLIST` to your email or comma-separated email allowlist.
4. Protect `/admin/*` and `/api/admin/*` with Cloudflare Access.

## Migration Notes

To migrate existing AWS metadata exports into D1:

1. Export your photo metadata records from DynamoDB into JSON.
2. Run `npm run generate:d1-import -- <metadata.json>`.
3. Apply `migrations/0001_create_photos.sql`.
4. Import the generated SQL into D1.
5. Copy the matching image objects from S3 to R2 using the generated manifest.

This repository does not force a single S3-to-R2 copy mechanism because teams often prefer AWS CLI, `rclone`, or bespoke scripts depending on account access and object counts.