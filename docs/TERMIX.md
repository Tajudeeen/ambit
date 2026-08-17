# TermiX Integration (M13)

## Goal

Produce a reproducible Agent Advantage Report from real paired task observations
while integrating only TermiX surfaces that are verified in official
documentation. M13 does not invent a report-submission API, broker jobs, sign
transactions, or claim AACP settlement.

## Verified official surface

Verified on 2026-08-17 from `docs.termix.ai`:

- TermiX documents the Agentic Agency Commerce Protocol (AACP) on BSC testnet.
- The public REST base is `https://termix-backend.dev.termix.click/api/v1`.
- `GET /config` exposes the current chain and contract configuration.
- `GET /stats` exposes public protocol statistics.
- Job creation, funding, delivery, evaluation, and settlement are separate AACP
  operations with wallet and role requirements.

The official docs do not expose a verified Agent Advantage Report submission
endpoint. M13 therefore keeps report generation local and exports evidence that
can be presented or submitted later when an official interface is identified.

## Supported M13 boundary

`@ambit/termix` provides two independent surfaces:

1. A read-only client for the documented public `config` and `stats` endpoints.
2. A deterministic, versioned Agent Advantage Report built from at least three
   paired task cases: one baseline attempt without the agent and one attempt with
   the agent.

The client validates response shape, BSC testnet chain identity, non-zero contract
addresses, counts, and timestamps. Network, HTTP, parsing, or validation failures
remain explicit and fail closed.

## Report evidence

Each task attempt records:

- outcome: `completed`, `failed`, or `blocked`
- duration in integer milliseconds
- cost in integer micro-US-dollars
- quality in basis points from 0 to 10,000
- one or more non-empty evidence references

The report stores the raw paired observations and derives signed integer deltas
for completion, quality, duration, and cost. Aggregates are deterministic integer
averages; no LLM chooses weights or changes results.

The report does not claim causality, independent verification, protocol payment,
or successful AACP settlement. It states only what the supplied evidence supports.

## Failure behavior

Report generation rejects fewer than three cases, duplicate case IDs, malformed
attempts, missing evidence references, unsafe integers, unsupported versions, and
attempt pairs whose task descriptions differ. Read-only API calls reject unknown
fields only when they violate the required security-relevant shape; extra public
fields may be preserved by TermiX without breaking the adapter.
