# CHANGELOG.md

Meaningful changes only — not every commit. Newest first (deeen_plans/CHANGELOG.md format).

## [Unreleased]

### Added
- `scripts/verify` (lint → typecheck → test → web build) and `scripts/{lint,typecheck,test}` shims so the deeen_plans AGENTS.md commands exist in-repo.
- Repo-level `AGENTS.md` pointing to `../deeen_plans/` as the standing operating manual; `TASKS.md` and this `CHANGELOG.md` seeded from the plan templates with Ambit's real state.
- README "Why Ambit (for judges)" + "Live demo" + "Key references" sections for submission readiness.

### Changed
- Adopted deeen_plans process conventions: `type/...` branch discipline, `type:` commit prefixes, permission tiers, definition-of-done (verify gate before "done").

### Security
- See `AUDIT.md` (AMB-1..AMB-7). Most recent closed items (2026-08-28): AMB-4..AMB-7 + Bucket 2 on-chain attestation; Slither deep static-analysis gate added to CI (ADR-0019).

## 2026-08-27

### Security
- `fix(contracts)`: score-attestation publisher made rotatable + recoverable (AMB-2) — 2-step `transferPublisher`/`acceptPublisher`, owner can recover. Deploy at `0xacc1...` stays valid (publisher = owner).

## 2026-08-26

### Security
- `fix(security)`: dependency critical/high remediation (pnpm overrides in `pnpm-workspace.yaml`) + CI audit gate with allowlist for documented exceptions (AMB-1).
- CI: pinned third-party action SHAs, added `security` job (AMB-3).
