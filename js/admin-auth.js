// SHA-256 hash of the admin password. Safe to commit — it's a one-way hash,
// not the password itself. Deployed builds overwrite this value in CI from
// the ADMIN_PASSWORD_HASH secret (see .github/workflows/deploy.yml); the
// plaintext password never touches this repo or GitHub at all. Left as an
// empty string, the password gate is skipped (local dev only — never
// deploy with this unset).
export const ADMIN_PASSWORD_HASH = '';
