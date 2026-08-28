# AGENTS.md

**Standing operating manual:** `../deeen_plans/` (sibling folder on this machine).

Any AI coding agent (Claude, GPT, DeepSeek, a local model, or a subagent) working
in this repo MUST read `../deeen_plans/AGENTS.md` first, then follow its read order:
`PROJECT → ARCHITECTURE → DECISIONS → TASKS → SECURITY → TESTING`. Those files
define the process this project is built under (workflow stages, permission tiers,
definition of done, security off-limits). They are templates filled for this repo
below.

This repo is **Ambit** — an ERC-8004 agent marketplace (BSC). The authoritative
in-repo references are:

- `AUDIT.md` — full security audit (AMB-1..AMB-7), resolution status.
- `docs/` — ADRs (`docs/ADRs.md` = the DECISIONS record), architecture, security
  policy (`docs/SECURITY.md`), attestation, marketplace, deployment, production-readiness.
- `.env.example` — required environment variables (never commit real `.env`).

## Differences from the generic deeen_plans template

- **Verify command:** deeen_plans references `scripts/verify`. This repo now ships
  `scripts/verify` (lint → typecheck → test → web build), plus `scripts/lint`,
  `scripts/typecheck`, `scripts/test` shims. Run `bash scripts/verify` before reporting done.
- **Decisions:** recorded in `docs/ADRs.md` (not a repo-root `DECISIONS.md`). Same
  discipline — new dated entry for any architectural change, never a silent override.
- **Changelog:** `CHANGELOG.md` at repo root, seeded from the deeen_plans format.
- **Tasks/milestones:** `TASKS.md` at repo root, filled with Ambit's real state.
- **Security off-limits:** follow `../deeen_plans/SECURITY.md` (no `.env`/keys/prod
  creds) AND `docs/SECURITY.md` (project threat model). Both apply.
- **Permission tiers:** Restricted (ask first) = dependency changes, migrations, CI
  changes, signer/key logic, anything in `docs/SECURITY.md`. Forbidden = production
  deploys, secret access, disabling the gate.

## Verify gate (definition of done)

```
bash scripts/verify      # lint + typecheck + test + web build, all green
```

Do not report a task complete without having run `scripts/verify` (or its
equivalent) and seen it pass.
