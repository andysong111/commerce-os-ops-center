# Sourcing Engine server storage

This app keeps the existing MVP browser `localStorage` behavior and adds Supabase-ready API routes for recommendation cards and feedback.

## Environment variables

Set these values in the Next.js runtime environment:

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL. Safe for browser usage.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — publishable anon key used by browser/server session clients. Safe for browser usage.
- `SUPABASE_SECRET_KEY` — server-only service/secret key. Never import it into client components and never prefix it with `NEXT_PUBLIC_`.
- `SOURCING_ORGANIZATION_ID` — optional placeholder organization selector while the product auth/org switcher is not fully wired.

If any required Supabase value is missing, `/api/sourcing/cards` and `/api/sourcing/feedback` return `503` with `SUPABASE_NOT_CONFIGURED` instead of crashing the app. The quick-save and feedback pages can continue using browser local storage.

## Migration order

1. Create the Supabase project.
2. Apply `supabase/migrations/202607030001_sourcing_engine.sql`.
3. Create at least one organization row and an `organization_members` row for each signed-in user.
4. Configure the environment variables above.
5. Deploy/restart the Next.js app.

The migration enables RLS on sourcing tables. API routes use the Supabase SSR session client so reads and writes are checked by the existing organization membership policies.

## API routes

- `GET /api/sourcing/cards` returns up to 200 recommendation card payloads for the resolved organization.
- `POST /api/sourcing/cards` normalizes a card payload and upserts it into `recommendation_cards` with `organization_id`.
- `GET /api/sourcing/feedback` returns up to 500 feedback rows for the resolved organization.
- `POST /api/sourcing/feedback` normalizes feedback and inserts it into `sourcing_feedback` with `organization_id`.

## Local fallback

The MVP browser fallback remains in place. Quick-save still writes to `commerce-os:sourcing-engine-cards`, and feedback still writes to `commerce-os:sourcing-engine-feedback`. Do not remove this fallback until the app has production auth, an organization selector, and user-facing sync status.

## Next auth step

Wire Supabase Auth into the app shell, add onboarding that creates `organizations` and `organization_members`, and add an organization selector. Once that exists, replace the temporary `SOURCING_ORGANIZATION_ID` adapter with a request-scoped organization lookup from the selected organization.
