# Ambit — Verified Marketplace for Autonomous Agents on BNB Smart Chain

> The verified marketplace for autonomous agents on BNB Smart Chain.

Ambit turns ERC-8004 agent identity into **evidence**, evidence into **trust**,
and trust into **bounded execution**. It is a trust and controlled-execution
infrastructure layer for autonomous agents, with a marketplace as its reference
application — built for the BNB Chain _Build the Era_ hackathon.

## Positioning

BNB Agent Studio makes agents easy to **create**. Ambit makes those agents easy
to **discover, evaluate, hire, and safely operate**. Ambit is the nervous system
of BNB's agent economy — it does not replace Agent Studio.

## Product thesis (non-negotiable)

- **Tier 1 — Data-verified agents:** independently evaluate agents registered
  through ERC-8004 on BSC (identity, metadata, capabilities, endpoint liveness,
  activity, reputation, payment evidence, category, freshness). We do **not**
  blindly trust ERC-8004 reputation; methodology is transparent.
- **Tier 2 — Execution-verified agents:** agents that opt into execution receive
  a stronger layer — deterministic policy + risk + supported simulation, with
  onchain enforcement (Altana sessions). The deterministic engine is authoritative;
  LLMs may _explain_, never _decide_.

## Hard rules

1. **Recon before build.** Verify the real ecosystem (Agent Studio, ERC-8004,
   Altana, PancakeSwap, TermiX) before integrating. See `docs/RECON.md`.
2. **The trust engine is NEVER a visibility gate.** A weak-evidence agent stays
   discoverable — it simply has a low score and low confidence. (See
   `docs/ARCHITECTURE.md`, rule R-VIS.)
3. **No fake data.** No hardcoded agents, no fabricated reputation, no invented
   addresses/SDKs. Real BSC data only.
4. **LLM is never a security boundary.** Policy, risk, custody, settlement are
   deterministic.
5. **Fail closed.** When policy/simulation/authorization/evidence cannot be
   established, reject.

## Repository architecture

```
apps/
  web/        Next.js evidence marketplace + pending hire flow (M10)
  api/        Hono marketplace API + Prisma repository (M9)
  indexer/    BSC ERC-8004 indexer + category evidence worker (M1/M11)
packages/
  core/       canonical agent model + category/methodology versioning
  config/     env config loader
  erc8004/    ERC-8004 ABIs (from spec) + registration-file types
  activity/   registered-wallet activity evidence (M4a)
  db/         Prisma schema + client (brief §24 entities)
  altana/     official Altana registered-session authorization (M7)
  passport/   receipt verification + immutable execution passports (M8)
  trust-engine/   deterministic scoring (M3)
  risk-engine/    deterministic risk modules (M5)
  execution/      policy + simulation pipeline (M5/M6)
  contracts/      Merkle attestation contract (M4b)
  pancakeswap/    quote-bound official PancakeSwap Universal Router adapter (M12)
  sdk/        shared client SDK
  ui/         shared UI components
  testing/    shared test fixtures/utilities
docs/         architecture, security, methodology, recon, runbooks
```

## Milestone plan

M0 repository baseline → M1 BSC+ERC-8004 → M2 discovery pipeline → M3 trust
engine → M4 on-chain activity evidence + Merkle attestation → M5 policy engine → M6 simulation → M7 Altana →
M8 execution passport → M9 marketplace backend → M10 frontend → M11 four
categories → M12 PancakeSwap → M13 TermiX → M14 security hardening → M15 deploy →
M16 demo rehearsal.

Each milestone is implemented, tested, reviewed, committed, then **STOP** until
verification passes. See `docs/ARCHITECTURE.md`.

## Getting started (M0)

```bash
pnpm install
cp .env.example .env        # fill DATABASE_URL etc.
pnpm typecheck && pnpm lint && pnpm test
docker compose up -d        # Postgres for M1+
```

## Verification status

- [x] M0 Repository + architecture baseline
- [x] M1 BNB Chain + ERC-8004 foundation (live registry addresses, viem reader, checkpointed indexer)
- [x] M2 Agent discovery + data pipeline (metadata validation, SSRF-safe endpoint liveness, reputation normalization, provenance)
- [x] M3 Trust engine (deterministic, versioned, transparent score+confidence; R-VIS preserved; Sybil concentration penalty; per-signal breakdown)
- [x] M4a Registered-wallet activity evidence (transaction count only; no execution claims)
- [x] M4b Merkle score attestation contract (append-only roots, deterministic proofs, compiler-verified ABI)
- [x] M5 Deterministic execution policy engine (fail-closed validation, identity/call/value/token/slippage limits, explicit usage state)
- [x] M6 Supported transaction simulation (registered deterministic decoders, M5 short-circuit, explicit-block evidence, fail-closed provider/revert handling)
- [x] M7 Altana registered-session execution (official SDK boundary, exact approved calldata relay, bounded permissions, fail-closed validation)
- [x] M8 Execution passport (exact transaction/receipt binding, canonical block checks, explicit confirmations, idempotent persistence)
- [x] M9 Marketplace backend (search/profile/history routes, pending-only hires, deterministic ranking, injected Prisma repository)
- [x] M10 Marketplace frontend (live URL-driven discovery, evidence profiles, same-origin pending-hire proxy, explicit empty/error states)
- [x] M11 Four agent categories (versioned deterministic metadata classifier, ambiguity evidence, explicit marketplace category entry points)
- [x] M12 PancakeSwap integration (pinned official SDKs, quote-bound exact-input V2/V3 calldata, decoded spend/slippage, fail-closed simulation path)
