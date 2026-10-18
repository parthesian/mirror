export type Bindings = {
    PHOTO_DB: D1Database;
    PHOTO_BUCKET: R2Bucket;
    ADMIN_EMAIL_ALLOWLIST?: string;
    ACCESS_AUD?: string;
};

export type AppEnv = {
    Bindings: Bindings;
};
