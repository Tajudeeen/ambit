# TASKS.md

Execution state, structured by milestone (mirrors deeen_plans/TASKS.md). Filled
with Ambit's real state as of 2026-08-28.

## Deadline

Hackathon submission window — see README / partner track deadlines.

## M0 — Spec locked

- [x] Repo scaffolded (pnpm monorepo: apps/api, apps/web, apps/indexer, packages/*)
- [x] Contracts skeleton (`@ambit/contracts`: AmbitScoreAttestation)
- [x] Deterministic risk engine skeleton (`@ambit/core` policy/trust engine)
- [x] Registry lookup wired read-only (ERC-8004 identity/reputation read path)
- [x] ARCHITECTURE documented in `docs/ARCHITECTURE.md`

## M1 — Foundation

- [x] Merkle score-attestation tooling (`feat/m4b-merkle-attestation`)
- [x] Policy engine (`feat/m5-policy-engine`)
- [x] Simulation harness (`feat/m6-simulation`)
- [x] Execution passport / session keys (`feat/m8-execution-passport`)

## M2 — Core gate logic

- [x] Risk engine rules + LLM classification wired as advisory (no sign authority)
- [x] Attestation write path (publisher + `publishRoot`)
- [x] Escape hatch / timeout path reviewed as its own surface (`docs/SECURITY.md`)

## M3 — Integration

- [x] End-to-end: request → gate → verdict → attestation → execution
- [x] Marketplace backend (`feat/m9-marketplace-backend`) + frontend (`feat/m10-marketplace-frontend`)
- [x] Four agent categories (`feat/m11-four-agent-categories`)
- [x] PancakeSwap integration (`feat/m12-pancakeswap-integration`)
- [x] TermiX integration (`feat/m13-termix-integration`)

## M4 — Hardening

- [x] Self-review + security audit (`AUDIT.md`, AMB-1..AMB-7)
- [x] Dependency remediation + CI audit gate (AMB-1, `91cd0d6`)
- [x] Contract publisher rotatable + recoverable (AMB-2, `55e54ae`)
- [x] CI action pinning + security job (AMB-3)
- [x] Contract static-gate test + tampered-proof/methodology-drift test (AMB-4)
- [x] Hire token rotation (multi-token) + runbook (AMB-5)
- [x] Local compose hardcoded password removed (AMB-6)
- [x] Logger query-leak test (AMB-7)
- [x] Consumer-side on-chain score attestation pin wired into agent page (Bucket 2)
- [x] Slither deep static-analysis gate added to CI security job (ADR-0019)

## M5 — Submission

- [x] Demo rehearsal (`feat/m16-demo-rehearsal`)
- [ ] README polished for judges
- [ ] Submitted

## Blocked

- None currently.

## Known bugs / technical debt

- `@ambit/db` migration test is flaky under parallel `pnpm -r test` (Prisma
  `migrate diff` contends for CPU/IO); stabilized with a 60s per-test timeout.
  Root cause is test parallelism, not logic — passes in isolation.
- `bigint-buffer` (unused PancakeSwap Solana SDK) + `tmp` (solc dev-only) remain
  audit exceptions with no patched version; documented + allowlisted in CI.

## Completed (most recent first)

- [x] AMB-4..AMB-7 + Bucket 2 on-chain attestation (2026-08-28)
- [x] AMB-2 publisher rotatable + recoverable (2026-08-27)
- [x] AMB-1 dependency remediation + CI audit gate (2026-08-26)
