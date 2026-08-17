# Deployment (M15)

## Goal

Provide reproducible, provider-neutral deployment artifacts for the Ambit API,
web marketplace, indexer, and PostgreSQL schema without embedding credentials or
claiming an unverified public hosting environment.

M15 produces container build targets, a database migration baseline, deployment
verification, and an operator runbook. DNS, TLS, load balancing, secret storage,
and public infrastructure remain the deployer's responsibility.

## Release boundary

Every application image is built from the repository root with Node.js 20,
pnpm 11, and the committed lockfile. Dependency installation uses
`--frozen-lockfile`, and the Prisma client is generated during the image build.

The release exposes three independent targets:

- `api` runs the Hono marketplace service on the validated `API_PORT`
- `web` builds and runs the Next.js marketplace on port 3000
- `indexer` runs one explicit ERC-8004 indexing pass and exits

The indexer remains a batch process rather than a fabricated always-on scheduler.
A deployment platform may invoke it on a reviewed schedule or as an explicit job.

## Database migration gate

Production startup must use committed Prisma migrations. It must never substitute
`prisma db push`, `prisma migrate dev`, or manual schema edits.

M15 records an initial PostgreSQL migration generated from the reviewed Prisma
schema. Operators run `pnpm --filter @ambit/db db:deploy` before starting API or
indexer processes. Migration failure stops the release; applications do not
continue against an unknown schema.

## Configuration and secrets

Images contain no `.env` files, RPC credentials, database passwords, signing
keys, or provider-specific tokens. Runtime environments supply the variables
documented in `.env.example`.

`NEXT_PUBLIC_API_URL` is a web build input because Next.js exposes it to browser
code. It must be the public API origin reachable by both browsers and server-side
rendering. It is not a secret.

`DATABASE_URL` and any future credentials are runtime-only values. They must be
injected by the deployment platform and must not appear in image layers, Compose
files, logs, or source control.

## Health and release checks

The API exposes separate process and dependency checks:

- `GET /health` proves the API process can serve HTTP
- `GET /ready` proves the configured marketplace repository is reachable

A deployment must not route production traffic until readiness succeeds. The
web service is considered ready only after its HTTP root responds successfully.
The indexer reports success through its process exit code.

CI verifies typecheck, lint, tests, migration/schema synchronization, and all
container build targets. Image publication or provider rollout requires explicit
registry and infrastructure credentials and is therefore outside the repository's
automatic trust boundary.

## Operator sequence

1. Build immutable image targets from a reviewed commit.
2. Inject runtime configuration and secrets through the platform.
3. Run the committed Prisma migrations against the target database.
4. Start the API and wait for `/ready` to succeed.
5. Start the web service with the reviewed public API origin.
6. Run the indexer as an explicit job and inspect its exit status.
7. Route traffic only after health and readiness checks pass.

Rollback uses a previously built image and a migration-compatible database.
M15 does not automate destructive migration rollback.

## Explicit non-claims

Repository artifacts do not prove that a public deployment, domain, certificate,
container registry, managed database, or monitoring system exists. Those claims
require evidence from the selected infrastructure and remain outside M15.
