# Cloudflare Migration Guide

## Goal

Migrate the gallery backend from:

- AWS Lambda
- S3
- DynamoDB

to:

- Cloudflare Pages + Pages Functions
- R2
- D1
- Cloudflare Access

while keeping the existing repo connected to `Cloudflare Pages` auto deploys.

## Recommended Cutover Order

1. Create the D1 database and apply `migrations/0001_create_photos.sql`.
2. Create the R2 bucket and bind it as `PHOTO_BUCKET`.
3. Set `ADMIN_EMAIL_ALLOWLIST` in the Cloudflare project.
4. Protect `/admin/*` and `/api/admin/*` with Cloudflare Access.
5. Deploy the repo so `functions/` becomes active in Pages.
6. Validate public reads at `/api/photos`.
7. Validate admin auth at `/api/admin/session`.
8. Validate uploads from `/admin/`.
9. Import historical metadata into D1.
10. Copy historical image assets from S3 to R2.
11. Re-verify the gallery once imported data is live.

## Historical Data Migration

### Metadata

Export the existing metadata records from DynamoDB as JSON, then run:

```bash
npm run generate:d1-import -- path/to/photo-metadata.json
```

That generates:

- `migration-output/photo-metadata-import.sql`
- `migration-output/r2-copy-manifest.json`

Apply the SQL after the base schema migration:

```bash
wrangler d1 execute mirror-photo-metadata --file migrations/0001_create_photos.sql
wrangler d1 execute mirror-photo-metadata --file migration-output/photo-metadata-import.sql
```

### Images

Use the generated `r2-copy-manifest.json` to copy images from S3 into matching R2 keys.

The exact copy command depends on how you prefer to access AWS and Cloudflare. Common options:

- AWS CLI plus a short Node or shell script
- `rclone`
- a one-off internal script run from a trusted machine

Keep the destination keys unchanged so the imported D1 metadata stays valid.

## Access Policy Notes

Cloudflare Access should be applied to:

- `/admin/*`
- `/api/admin/*`

The public gallery and `GET /api/photos` remain public.

The Pages Functions code trusts the `CF-Access-Authenticated-User-Email` header only on routes that are expected to sit behind Access. Do not expose the admin API routes publicly without Access enforcement.

## Rollback

If you need to back out temporarily:

1. Point `API_BASE_URL` back to the old backend.
2. Disable or ignore the new `/admin/` path.
3. Keep the Pages deployment in place while reads/uploads continue on AWS.

That lets you preserve the static Pages deployment even if the backend cutover needs another pass.
