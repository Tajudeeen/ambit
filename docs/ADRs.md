# ADR-0001: Monorepo structure and package manager

**Status:** Accepted (M0)
**Context:** The project needs isolated, independently-testable layers (indexing,
trust, risk, execution, attestation, UI) per brief §25, with a single
repository that can survive beyond the hackathon.
**Decision:** pnpm workspace monorepo with `apps/` (web, api, indexer) and
`packages/` (domain libs). TypeScript strict mode everywhere. Vitest for unit
tests, ESLint+Prettier for lint/format, GitHub Actions for CI.
**Consequences:** Clean dependency graph via `workspace:*`; each package has its
own typecheck/lint/test script so `pnpm -r` gates run uniformly.

# ADR-0002: Trust engine must not gate marketplace visibility

**Status:** Accepted (M0, user-directed)
**Context:** A marketplace that hides low-trust agents would narrow BNB's agent
population and fight the adoption goal.
**Decision:** All indexed agents are discoverable. Trust Score + Confidence only
*rank and annotate*, never *hide*. See `docs/ARCHITECTURE.md` rule R-VIS.
**Consequences:** Search/filter default to "all agents"; a dedicated
"verified only" filter is opt-in, not the default.

# ADR-0003: Altana integration behind an adapter, verified before wiring

**Status:** Accepted (M0)
**Context:** The real Altana SDK/explorer was not resolvable at M0; `docs.altana.ai`
is an unrelated company.
**Decision:** Define `@ambit/altana` adapter interface + a clearly-labeled
in-memory test double for M0-M6. Real SDK slotted at M7 once identified. No fake
addresses, no fabricated onchain sessions.
**Consequences:** Execution-plane unit tests run against the double; M7 swaps in
the real adapter with live onchain verification.

# ADR-0004: M4 separates wallet activity from execution verification

**Status:** Accepted (M4)
**Context:** An ERC-8004 agent may register an `agentWallet`. Its account nonce is
a reproducible on-chain activity signal, but it cannot prove transaction recency,
success rate, protocol usage, capital processed, or that transactions were
authorized by the agent.
**Decision:** M4a records registered-wallet linkage and transaction-count evidence
at a specific chain head. It may set `verifiedActivity`, but it must not populate
execution statistics or claim recency. M4b separately anchors deterministic score
snapshots with a Merkle attestation contract. Tier-2 execution claims remain tied
to receipts, decoded transactions, supported simulation, and Altana sessions.
**Consequences:** The marketplace can distinguish basic on-chain footprint from
execution-verified behavior without fabricating stronger claims from weak data.
