# Marketplace Backend (M9)

M9 exposes Ambit's indexed agent evidence and bounded-execution history through
a production-oriented Hono API. The backend is a presentation and persistence
boundary; it does not replace deterministic trust, policy, simulation, Altana,
or receipt verification.

## API surface

The M9 API provides:

- `GET /agents` for search, explicit filters, deterministic ranking, and cursor
  pagination;
- `GET /agents/:agentRegistry` for one complete marketplace profile with trust,
  endpoint, activity, reputation, payment, policy, and provenance evidence;
- `POST /agents/:agentRegistry/hire` to create a pending execution request; and
- `GET /agents/:agentRegistry/executions` for public execution history without
  private session material.

`GET /health` remains process liveness. `GET /ready` reports whether the
injected marketplace repository can answer queries, without requiring an RPC
call or execution credential.

## Visibility and ranking

Search never hides weak-evidence agents by default. Filters such as
`verificationTier`, `category`, `supportedExecution`, protocol, and minimum
trust score apply only when the caller explicitly supplies them.

Default ranking is deterministic:

1. trust score descending, with missing scores last;
2. confidence descending;
3. execution-verified agents first;
4. normalized name; and
5. canonical `agentRegistry` key.

Pagination uses an opaque cursor tied to the last returned canonical agent key.
Invalid filters, limits, and cursors return structured `400` responses rather
than silently changing query semantics.

## Hiring boundary

Hiring creates a durable request in `activation-confirmed` state after the requester signs the exact
message containing the agent, requester, destination, protocol, and requested native value.
It does not accept an Altana session, private key, fabricated policy result, or
client-asserted successful outcome.

M5-M8 remain mandatory before a request can become execution verified. M9 may
display persisted policy, simulation, relay, receipt, and passport results, but
it never infers those results from the hire request itself.

## Repository boundary

The Hono application receives an injected `MarketplaceRepository`. Production
wiring uses Prisma; tests use an explicit repository double. The repository owns
database queries and mapping while route handlers own HTTP validation and error
responses.

Agent metadata, endpoints, trust scores, and policies are historical collections
in Prisma. Profile reads select the latest deterministic record rather than
modeling those collections as invalid one-to-one relations.

## Security and failure behavior

- All addresses, decimal values, limits, cursors, and enums are validated.
- Unknown agents return `404`; conflicting duplicate hire requests return `409`.
- Repository failures return `503` and never fabricate empty success responses.
- Session signers, API keys, raw private metadata, and administrator credentials
  are excluded from marketplace responses.
- Public execution success is reported only from persisted M8 passport evidence.
