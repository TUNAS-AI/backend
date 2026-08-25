# Hijau AI Backend

Authenticated farm and onboarding API for TUNAS. This contains the
Express foundation, Supabase bearer authentication, PostgreSQL/Prisma access,
atomic onboarding, and farm-domain CRUD only.

## Local setup

```powershell
npm ci
Copy-Item .env.example .env
npm run prisma:generate
npm run prisma:validate
npm run dev
```

Set `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` in `.env` for data
and authenticated requests. `FRONTEND_URL` controls the Google OAuth callback,
and `CORS_ORIGIN` accepts a comma-separated list of local browser origins.

## API

- `GET /` and `GET /health` provide service liveness.
- `GET /health/ready` checks the database only.
- `GET /api/auth/google` starts frontend Google sign-in.
- `GET /api/auth/google/swagger` starts the Swagger token handoff.
- `GET /api/session` verifies a Supabase bearer token.
- `POST /api/onboarding` atomically creates one farm, fields, and shallot batches.
- `/api/farm`, `/api/field-blocks`, `/api/crop-batches`, and
  `/api/buyer-commitments` expose ownership-scoped data operations.
- `GET /api/openapi.json` and `/api-docs` expose the API document.

All session, onboarding, and farm-domain data routes require
`Authorization: Bearer <supabase-access-token>`.

## Database

The included migrations run from `20260715120000` through `20260715210000`.
The reset migration removes only named legacy application objects in `public`;
it does not drop the schema or Supabase Auth identities.

The optional seed adds sample farm-domain records to the oldest existing farm,
so complete onboarding before running it:

```powershell
npm run prisma:seed
```

## Verify

```powershell
npm run prisma:generate
npm run prisma:validate
npm run typecheck
npm test
npm run build
```
