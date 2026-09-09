---
status: accepted
---

# Node 24 and Elysia with separate runtime adapters

Keep the existing TypeScript pnpm monorepo and select Node 24 LTS for the backend and intended
Vercel runtime. Elysia application behavior lives in `apps/api`, separate from a standalone local
Node entry using `@elysia/node` and a minimal root Vercel Function adapter using standard
Request/Response handling. The API shares the existing Vercel project and origin at `/api/*`,
ahead of the SPA fallback. Importing the application does not start a listener.

Later persistence uses Neon managed PostgreSQL with Drizzle, `pg`, and reviewed SQL migrations.
Later Google authorization-code OIDC uses Google's maintained `google-auth-library`; KendoMenu
owns opaque application sessions stored as token hashes in PostgreSQL. Pool lifecycle tooling
(`@vercel/functions` and `attachDatabasePool`) remains provisional pending database-job validation.

## Considered alternatives

Separate services or projects add deployment and cross-origin coordination to a personal project;
the existing monorepo can keep a small HTTP application and thin runtime adapters together.
Express or Fastify would also work, but Elysia provides the selected typed Request interface without
requiring a frontend framework migration. Bun would change runtime families; Node 24 retains the
existing Node toolchain and supported LTS deployment direction.

Supabase adds unneeded Auth/Realtime platform capabilities. Prisma adds generated-client machinery;
raw SQL alone increases manual typing and migration coordination. A broader authentication
framework or multiple identity libraries adds policy and integration work beyond Google-only
identity. JWT sessions complicate immediate revocation, while Redis introduces another store.

## Consequences

Job 3 implements only a local health scaffold; combined Vercel discovery/routing remains a Preview
verification gate, and no deployment is authorized. Database and identity dependencies, resources,
credentials, and behavior belong to later jobs. The remaining product and operational choices in
[ACCOUNT_SYNC.md](../ACCOUNT_SYNC.md) remain unapproved; accepting this stack does not accept them.
