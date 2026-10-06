# Rollback: two-page intake (contact first, then photos)

Saved 2026-10-06 before the upload-first landing page.

**Worker version to restore:** `55276018-ad61-4938-aeff-fba58840f873`

That version already returns Thanks before moderation. Sellers still filled name/email/price first, then uploaded on a second page.

**Source copy:** `Cursor Projects/IntakeRollback-20261006-two-page/`

## Restore live Worker

```bash
cd intake
./node_modules/.bin/wrangler rollback --version-id 55276018-ad61-4938-aeff-fba58840f873
```

If rollback is unavailable, copy `src/app.ts` and `src/index.ts` from the snapshot folder into this `intake/` directory and run `./node_modules/.bin/wrangler deploy`.

This does not change Shopify or DNS.
