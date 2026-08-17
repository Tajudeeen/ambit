# Marketplace Web App (M10)

M10 turns the M9 marketplace API into a responsive reference application for
discovering, evaluating, and requesting authorization from autonomous agents on
BNB Smart Chain. The web app is a presentation layer: it does not recompute
trust, infer execution success, or create synthetic fallback agents.

## Routes

- `/` renders marketplace positioning, explicit search and filters, deterministic
  API-ranked agent cards, empty/error states, and cursor pagination.
- `/agents/:agentRegistry` renders one evidence-oriented profile with trust,
  endpoint health, verification state, capabilities, protocols, provenance,
  policy limits, activity, reputation, payments, and public execution history.
- `/api/agents/:agentRegistry/hire` is a same-origin Next.js route handler that
  validates the browser request shape by forwarding it to M9. It returns M9's
  structured response without converting a pending request into a success claim.

Unknown profiles use the framework not-found boundary. API failures remain
visible and actionable rather than being replaced with fictional content.

## Rendering and data flow

Marketplace reads happen in Next.js server components through a small typed API
client. Requests use `NEXT_PUBLIC_API_URL` on the server and opt out of persistent
caching so indexed evidence and execution state are not presented as indefinitely
fresh. Search state is encoded in URL query parameters, keeping results shareable
and preserving the M9 rule that filters are explicit.

The browser sends hire requests only to the same-origin proxy. The proxy does not
accept or add session keys, policy decisions, simulations, receipts, passports,
or administrator credentials. M5-M8 remain the only path from a pending request
to verified execution evidence.

## Trust and evidence presentation

- Every returned agent is displayable, including unverified and low-confidence
  agents. Verification controls are opt-in filters, never default gates.
- Trust score and confidence are shown separately. Missing trust is labeled as
  insufficient evidence rather than treated as zero or hidden.
- Execution-verified, data-verified, and unverified states use distinct labels
  with explanatory copy instead of color alone.
- Endpoint, indexing, provenance, policy, and history timestamps are displayed
  as evidence freshness signals.
- Successful execution language appears only when persisted history contains an
  M8 passport and verified receipt state. A created hire remains pending.

## Interaction and accessibility

The interface uses semantic landmarks, labeled controls, keyboard-visible focus
styles, sufficient contrast, responsive layouts, and text labels alongside status
colors. Forms keep native validation where useful and render structured API errors
in an announced status region.

The hire panel may read an injected browser wallet account to prefill the requester
address, but wallet access is optional and never authorizes execution by itself.
The user must review and submit the pending request explicitly.

## Failure behavior

- Search and profile fetch failures show a service-unavailable state with retry
  guidance; they never render fabricated agents or stale hardcoded scores.
- Invalid URL filters are returned by M9 as structured errors and shown without
  silently changing the user's query.
- Hire conflicts and validation failures preserve M9's public error codes.
- Unexpected proxy failures return a generic `503` without leaking internal URLs,
  credentials, stack traces, or upstream response bodies.
