# Architecture

Ambit is production infrastructure with a marketplace reference application.

## Logical architecture

```
BNB SMART CHAIN
  |-- ERC-8004 Identity Registry
  |-- ERC-8004 Reputation Registry
  |-- x402 / payment evidence (where reliably queryable)
  |-- Altana execution infrastructure
  |-- PancakeSwap protocols
        |
        v
INDEXING + EVIDENCE LAYER  (apps/indexer, packages/erc8004)
  discovery, metadata ingestion, endpoint verification, reputation ingestion,
  registered-wallet linkage, transaction-count activity evidence, payment
  evidence, deterministic category classification, evidence normalization, freshness
        |
        v
TRUST ENGINE  (packages/trust-engine)         M3
  identity, liveness, activity, reputation quality, economic evidence, recency, confidence
        |
        v
EXECUTION CONTROL PLANE  (packages/execution) M5/M6
  policy -> tx decode -> validation -> risk -> supported simulation -> approve/reject -> execute
        |
        v
PANCAKESWAP ADAPTER  (packages/pancakeswap)   M12
  official quote/call SDK -> quote-bound calldata validation -> M6 decoder
        |
        v
EXECUTION PASSPORT  (packages/passport) M8
  receipt + canonical block verification -> idempotent passport persistence
        |
        v
ATTESTATION LAYER  (packages/contracts)       M4b
  score snapshots -> Merkle tree -> root -> BNB attestation contract
        |
        v
MARKETPLACE API  (apps/api)                   M9
  validated HTTP -> repository -> search/rank, profiles, pending hires, execution history
        |
        v
MARKETPLACE WEB APP  (apps/web)               M10
```

## Architectural rules

- **R-VIS (visibility, not gated by trust):** The trust engine is NEVER a
  visibility gate. Every indexed agent — regardless of evidence strength — is
  discoverable. Weak evidence simply yields a low Trust Score and low Confidence,
  and a `verificationTier` of `unverified`. This directly serves BNB's stated
  goal of making the existing agent population discoverable, while our
  infrastructure adds the missing layer of judgment and safety.
- **R-EVIDENCE:** Every derived value is traceable to a source with provenance
  (block, txHash, timestamp, methodologyVersion). See `Evidence` in
  `packages/core/src/agent.ts`.
- **R-ACTIVITY:** Tier-1 wallet activity means only that the ERC-8004 registered
  `agentWallet` has sent an observable number of transactions at a recorded
  chain head. Account nonce alone does not prove recency, successful execution,
  agent-directed execution, volume, or protocol interaction. Those claims need
  transaction receipts, decoded calls, or Tier-2 execution evidence.
- **R-DET:** Policy and risk enforcement are deterministic. LLMs may explain,
  never decide (custody, approval, limits, allowlists, simulation, settlement).
- **R-FAILCLOSED:** When policy/simulation/authorization/required evidence
  cannot be established, the operation is rejected.
- **R-SEP:** Identity, indexing, scoring, policy, execution, attestation, and UI
  are independently testable.
- **R-NOCUSTODY:** No custom custody unless architecture strictly requires it;
  use Altana for agent authority.
- **R-NOFAKE:** No hardcoded/fictional agents, reputations, or transactions.
- **R-PASSPORT:** A relay hash is not an execution claim. Successful execution
  requires a receipt matched to the exact approved request, a canonical block,
  explicit confirmations, and durable passport persistence.
- **R-API:** Marketplace routes validate and present persisted evidence; they do
  not recompute trust, bypass execution controls, accept session secrets, or hide
  agents unless the caller explicitly requests a filter.
- **R-WEB:** Marketplace pages render live M9 evidence, explicit empty/error
  states, and opt-in filters. They never use fictional fallback agents or present
  a pending hire as approved, executed, or passport verified.
- **R-CATEGORY:** Category is derived only from valid registration metadata by a
  versioned deterministic classifier. Unknown or conflicting signals remain
  uncategorized and discoverable; category never changes trust or authority.
- **R-SWAP:** PancakeSwap calls are approved only when the official router,
  exact-input calldata, token path, recipient, deadline, and minimum output match
  explicit quote evidence. Decoded effects drive policy; caller-provided swap
  labels or slippage never weaken the execution boundary.

## Why this wins the main BNB prize

The headline prize is _adoption as the official BNB Agent Studio marketplace_.
Adoption requires (a) coverage of the existing 256k+ BSC agents, (b) a first-time
user being able to discover and hire an agent without blockchain internals, and
(c) a product BNB could keep operating. Ambit delivers breadth (R-VIS) + judgment
(trust engine) + safety (execution control) without competing with Agent Studio.

See `docs/RECON.md` for the ecosystem verification that shaped this design.
