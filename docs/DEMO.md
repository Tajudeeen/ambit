# Demo Rehearsal (M16)

## Goal

Give the operator a repeatable, evidence-first rehearsal for the deployed
marketplace without creating synthetic agents, fake trust scores, fabricated
execution history, or unreviewed transactions.

M16's rehearsal is read-only. The UI hire flow may be demonstrated separately,
but a successful rehearsal never implies that an activation was executed,
executed, settled, or passport verified.

## Preflight

Run the live smoke report against the deployed origins:

```bash
DEMO_API_URL=https://api.example \
DEMO_WEB_URL=https://app.example \
pnpm demo:rehearse
```

The command emits deterministic JSON with the rehearsal version, check names,
HTTP status codes, durations, the discovered real agent registry, and an overall
pass/fail result. It checks:

1. API process liveness at `/health`.
2. API repository readiness at `/ready`.
3. A non-empty real discovery response from `/agents?limit=1`.
4. The discovered agent profile and its registry identity.
5. Public execution-history shape for the discovered agent.
6. Web root availability and HTML content type.

The command exits non-zero when a required check fails. It never substitutes a
fixture agent or treats an empty index as a successful demo state.

## Six-minute rehearsal

1. Run the preflight and save the JSON output as the release evidence artifact.
2. Open the marketplace home and show URL-driven discovery and explicit filters.
3. Open the discovered profile and explain provenance, endpoint state, trust,
   category, and verification tier as separate evidence fields.
4. Point out that low or missing trust does not hide an indexed agent.
5. Submit an activation only when the operator intentionally wants a signed request;
   show the `202` activation-confirmed result and do not call it execution.
6. Show public history if persisted evidence exists; an explicit empty history is
   acceptable and must remain visibly empty.

## Stop conditions

Stop the rehearsal when:

- `/ready` fails or the repository is unavailable;
- discovery returns no real indexed agents;
- profile identity does not match the discovered registry;
- the web page renders a fallback agent or stale fabricated score;
- an activation request is described as executed, paid, or passport verified;
- a partner integration is presented without its documented evidence boundary.

The correct fallback is to show the failed preflight and explain the missing
evidence—not to edit data, invent a response, or bypass a deterministic gate.

## Evidence checklist

- rehearsal JSON from the deployed API and web origins
- commit SHA and container image digest used for the run
- database migration completion result
- API `/health` and `/ready` results
- the discovered agent registry and profile URL
- any explicitly labeled activation response

Do not include secrets, wallet keys, private session material, or unrestricted
upstream responses in screenshots or submitted demo artifacts.

## Explicit non-claims

M16 does not prove uptime, user adoption, successful on-chain execution, partner
settlement, or production monitoring. Those claims require separate evidence from
the selected deployment and protocol systems.
