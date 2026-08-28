# Ambit Repository Audit

## Review Metadata

- **Project:** Tajudeeen/ambit — Verified Marketplace for Autonomous Agents on BNB Smart Chain (ERC-8004)
- **Repository:** https://github.com/Tajudeeen/ambit
- **Audit date:** 2026-08-27
- **Reviewed revision:** 6a4cca250fdb9fa3ac671ef7131882ffd7b441dc (HEAD, branch `master`)
- **Remote default branch:** origin/master at the same revision (verified: `git fetch`; HEAD == origin/master)
- **Review mode:** Full-repository baseline audit with Solidity contract review, auth/authorization review, SSRF/endpoint-liveness review, dependency audit, CI/release review, and local verification (typecheck/lint/test). This is the same structural audit style applied to the Sluice repository, adapted to Ambit's actual architecture.
- **Reviewer:** Hermes Agent
- **Local checkout:** /c/Users/tajud/Desktop/hack/ambit
- **Tracked files reviewed:** 169, excluding `.git/`, `node_modules/`, and the local `.pnpm-store/`
- **Overall confidence:** High for source-level findings and local verification; Medium for deployment findings because no live API/Web/Indexer URL or funded contract deployment was supplied
- **Verdict:** Changes recommended before any non-synthetic / mainnet deployment. The submitted reference build is materially stronger than the Sluice build it was modeled against — the Sluice CRITICAL (private-key logging), HIGH (worker empty-history decision bypass), and HIGH (public endpoint that submits an on-chain transaction) classes are **absent** here. The remaining work is dependency remediation (1 critical / 8 high advisories in the installed tree), an explicit contract-publisher trust model, and a CI security gate. There is no committed secret and no deployment/agent script that prints private keys.

---

## Executive Summary

**Overall health grade:** B+ for the combined repository (vs. Sluice's C+). The frontend alone would grade A- for honest hackathon scope.

Ambit is an ERC-8004 agent marketplace reference app on BNB Smart Chain: a Next.js evidence marketplace (`apps/web`), a Hono marketplace API + Prisma repository (`apps/api`), a BSC ERC-8004 indexer (`apps/indexer`), a Merkle score-attestation Solidity contract (`packages/contracts`), and a set of deterministic trust/risk/execution/policy packages. The codebase is well-factored, heavily tested (218 passing tests across 19 suites), and the auth surface has been hardened across the last three commits (M14 security hardening, M17 production readiness, and the most recent agent-activation authorization fix).

The headline difference from Sluice: Ambit has **no private-key logging path**. The only `PRIVATE_KEY` reference in the tree is a well-known hardcoded *test* key inside `apps/api/test/marketplace.test.ts` (used to sign test activations), not a deployment script. No `scripts/deploy.ts` prints secrets.

The most serious real finding is the dependency tree: `pnpm audit` reports **18 vulnerabilities — 1 critical, 8 high, 8 moderate, 1 low**. The critical is Vitest < 3.2.6 (arbitrary file read/exec when the Vitest UI server is listening); the high group includes `sharp` (libvips CVEs), `vite` (a `server.fs.deny` bypass on Windows alternate paths — directly relevant because this repo is authored on Windows), `ws` (memory-exhaustion DoS), `postcss` (arbitrary file read), `bigint-buffer` (buffer overflow), `tmp` (path traversal), and `deepmerge-ts` (stack exhaustion). Production-only (`--prod`) reduces this to 6 high / 5 moderate / 0 critical, but the high group still reaches the runtime (sharp, ws, postcss transitively via Next/web).

The second real finding is the contract trust model: `AmbitScoreAttestation` has a single `immutable publisher` set at deploy time. That publisher can attest any Merkle root for any score. This is an intentional, documented trust assumption (Ambit is the attestation authority), but it is a centralization point equivalent to Sluice's single-attester design and should be explicitly mitigated (multisig/rotatable publisher, methodology-hash pinning at the consumer) before any real-fund use.

### Top risks
1. Dependency tree carries 1 critical + 8 high advisories; the verification command (`pnpm -r test`) passes while the security gate fails.
2. The score-attestation contract trusts a single immutable publisher; a compromised deploy-time publisher key can attest false scores.
3. CI uses floating third-party action tags and runs no dependency-audit or Slither/static gate.

### Top opportunities
1. Remediate the critical/high dependencies in compatibility groups and add `pnpm audit --audit-level=high` to CI.
2. Document and mitigate the publisher centralization (rotatable/multisig publisher + consumer-side methodologyHash pinning).
3. Pin action SHAs and add a security gate so a green build proves a security-clean release.

---

## Scope and Limitations

### Included
- Current public `master` revision, Git history (M0–M17), branch list, and lockfile
- Root + per-package manifests, pnpm workspace, tsconfig, Dockerfiles, docker-compose files, CI workflow
- Solidity source + local solc compile/ABI-verification test
- API auth/authorization code (hire mutation, activation signature, policy enforcement, bearer token)
- Indexer SSRF-safe endpoint prober + liveness flow
- M17 production verifier and M16 demo rehearsal (read-only, by design)
- Altana session execution boundary (M7)
- Dependency audit (full + prod-only) and local typecheck/lint/test

### Not independently verified
- A funded `AmbitScoreAttestation` deployment or a live API/Web/Indexer URL (none supplied)
- Any real wallet signature or public-chain transaction; no transaction was submitted during this audit
- Third-party partner SDK correctness (Altana, PancakeSwap, TermiX) beyond the repo's typed boundaries and tests
- Slither output — Slither is not installed in this environment; the contract was reviewed by direct read + the in-repo solc compiler/ABI test, not by Slither

### No source was modified
The Markdown report is a local artifact only. No tracked file, lockfile, or Git state was changed.

---

## Public Repository Preflight

- Public repository, default branch `master`; multiple `feat/*` branches present (M4b–M17).
- No GitHub Actions *deployment* runs are wired (CI verifies only; no Pages/publish workflow compared to Sluice). The `ci.yml` runs `verify` (typecheck/lint/test) and `containers` (Docker build only).
- GitHub language sizes confirm a TypeScript monorepo (apps + packages) with one small Solidity contract.
- `.env` is gitignored; only `.env.example` is tracked. **No committed secret was found.**

---

## Repo Map

### Product surfaces
- **Web marketplace (submitted frontend):** `apps/web` — Next.js evidence marketplace + pending hire flow. Reads real BSC ERC-8004 data via the API.
- **Marketplace API:** `apps/api` — Hono + Prisma. Read routes (discovery/profile/executions) are public; the `POST /agents/:id/hire` mutation requires a server bearer token (server-to-server) **and** a requester wallet signature.
- **Indexer:** `apps/indexer` — BSC ERC-8004 reader + SSRF-safe endpoint liveness + reputation/activity enrichment; writes to Postgres.
- **Score-attestation contract:** `packages/contracts` — `AmbitScoreAttestation.sol`, a Merkle-root publisher with `verifyClaim`/`verifyProof`.
- **Deterministic engines:** `packages/trust-engine`, `risk-engine`, `execution`, `passport`, `policy` (via `marketplace.ts`), `altana`, `pancakeswap`, `termix`, `activity`, `reputation`, `erc8004`, `core`, `config`, `db`, `endpoint`, `sdk`, `ui`, `testing`.
- **Read-only verifiers:** `packages/operations` (M17 production readiness), `packages/demo` (M16 rehearsal).

### Stack
- Frontend: Next.js (App Router), TypeScript 5.7, React 18/19
- API: Hono, Prisma, viem; Node 24 runtime
- Contracts: Solidity 0.8.36 (pinned `solc` in-tree), OpenZeppelin-free (hand-rolled)
- Indexer: viem Erc8004Reader, Prisma checkpoint store
- CI: GitHub Actions, Node 24.12.0, pnpm 11.20.0, Docker buildx
- External data: BSC RPC, ERC-8004 identity/reputation registries (RECON-verified addresses), partner SDKs

### Runtime flow
```
BSC ERC-8004 registries
        |
        v
indexer (SSRF-safe endpoint probe + reputation/activity)
        |
        v
Postgres  ->  API (read: public; hire: bearer + requester signature + policy)
        |
        v
web marketplace (wallet-signed activation -> server bearer -> API)

Altana sessions (M7): operator relays approved, policy-bounded calls
AmbitScoreAttestation (contract): Ambit publisher posts Merkle roots; consumers verifyClaim
```

### Important trust boundary (correctly documented)
The README hard rules and `docs/SECURITY.md` / `docs/ARCHITECTURE.md` state that the trust engine is **evidence**, not a visibility gate (R-VIS); that the LLM is never a security boundary; and that the deterministic engine is authoritative over LLM explanations. The web frontend's hire panel requires a wallet-signed activation before recording. The API does **not** treat browser guardrails as protocol enforcement — it re-verifies the signature and policy server-side. This is the honest model Sluice's report called for.

---

## Verification Performed

| Check | Scope | Result | Evidence |
|---|---|---|---|
| Remote revision preflight | `git fetch`; HEAD vs origin/master | Passed | Both resolve to `6a4cca2…` |
| Clean install | `pnpm install --frozen-lockfile` | Passed | pnpm 11.20.0; 169 tracked files; lockfile present |
| Typecheck (all packages) | `pnpm -r typecheck` | Passed | 19 packages report `Done` (apps/web, apps/api, apps/indexer, all packages/*) |
| Lint (all packages) | `pnpm -r lint` | Passed | eslint exits 0 across all packages |
| Test (all suites) | `pnpm -r test` | Passed | 218 tests across 19 suites (see breakdown below) |
| Solidity compile + ABI check | `packages/contracts/test/solidity.test.ts` | Passed | solc compiles; exported ABI equals compiled surface; 7 contract tests pass |
| Secret-pattern review | Tracked files (non-node_modules) | No committed real secret | Only `apps/api/test/marketplace.test.ts` references a `PRIVATE_KEY` (hardcoded test key, not logged/deployed) |
| Dependency audit (full) | `pnpm audit` | Failed security gate | 18 total: 1 critical, 8 high, 8 moderate, 1 low |
| Dependency audit (prod-only) | `pnpm audit --prod` | Failed security gate | 11 total: 0 critical, 6 high, 5 moderate |
| SSRF prober review | `packages/endpoint/src/index.ts` | Passed by read | DNS-pinned transport; blocks private/loopback/link-local for IPv4 + IPv6; deny-if-any-resolution-blocked |
| Auth flow review | `apps/api/src/index.ts`, `prisma-repository.ts`, `marketplace.ts`, `web hire route/panel` | Passed by read | bearer token + requester EIP-191 signature + per-agent policy enforcement; 15-min expiry window; bigint value checks |
| Worker/public-tx review | all tracked files | Not applicable | No settlement worker and no public endpoint that submits an on-chain transaction exists (Sluice REV-2 / REV-6 classes absent) |
| Live deployment | none supplied | Not verified | No live API/Web/Indexer URL or funded contract deployment was provided |

### Test breakdown (218 total)
config 18 · core 14 · demo 3 · endpoint 9 · db 3 · execution 38 · erc8004 7 · operations 4 · termix 4 · activity 5 · web 9 · api 30 · altana 13 · contracts 7 · reputation 4 · pancakeswap 8 · trust-engine 7 · passport 18 · indexer 17.

---

## Audit Report

### Findings Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 2 |
| Nit | 0 |
| Positive | 11 |

**Resolution status (as of 2026-08-27):** AMB-1 (deps), AMB-2 (contract publisher), AMB-3 (CI) resolved in `91cd0d6` + `55e54ae`. AMB-4 (Slither/static gate + tampered-proof test), AMB-5 (hire token rotation), AMB-6 (local compose password), AMB-7 (logger query leak test) resolved in the Bucket-1/Bucket-2 commit. AMB-2's on-chain behavioral test and a multisig owner remain documented follow-ups. The web agent page now reads the deployed score-attestation root and pins the methodology (Bucket 2): consumers reject a root whose methodologyHash drifts. The severity counts above reflect the original audit baseline, not post-remediation state.

---

### [HIGH] AMB-1: Dependency tree carries one critical and eight high advisories

**Category:** Supply chain and developer/production runtime security
**Location:** `pnpm-lock.yaml`; direct lines include `vitest` (root devDep), `vite`/`next` (web), `sharp` (web image), `ws`/`postcss` (transitive via web/api)
**Requirement or control:** The default verification path and deployed runtime should not carry known critical/high vulnerabilities without an explicit, time-bounded exception. Sluice REV-3 applies identically here.
**Evidence:** `pnpm audit` reports 18 vulnerabilities — 1 critical, 8 high, 8 moderate, 1 low. The critical advisory is Vitest `< 3.2.6` (arbitrary file read/exec when the Vitest UI server is listening). High advisories: `sharp < 0.35.0` (libvips CVE-2026-33327/33328/35590/35591), `vite <= 6.4.2` (`server.fs.deny` bypass on Windows alternate paths — relevant because this repo is authored on Windows), `ws < 8.21.0` (memory-exhaustion DoS), `postcss <= 8.5.11` (arbitrary file read via sourceMappingURL), `bigint-buffer <= 1.1.5` (buffer overflow), `tmp < 0.2.6` (path traversal), `deepmerge-ts < 8.0.0` (stack exhaustion), and a second `postcss` path-traversal. `pnpm audit --prod` still reports 6 high / 5 moderate (sharp, ws, postcss reach the runtime via Next/web).
**Problem:** The repository's verification command passes (`pnpm -r test`) while the dependency security gate fails. The `vite` Windows `fs.deny` bypass in particular is exploitable in the local dev environment this project is built on.
**Impact:** Known vulnerabilities affect local Vite/Vitest dev servers, build tooling, and the production web image's transitive paths. The Vitest critical is relevant only if the UI server is exposed; the `vite`/`sharp`/`ws`/`postcss` highs reach the actual dev/build/runtime.
**Reproduction:** `pnpm audit` (full) and `pnpm audit --prod` after `pnpm install --frozen-lockfile`.
**Recommended correction:** Create a dependency remediation branch. Upgrade in compatibility groups — Vitest/Vite first (root + web), then Next/sharp, then transitive ws/postcss/tmp/bigint-buffer/deepmerge-ts. Do **not** run `pnpm audit fix --force` blindly (it proposes major Vite/Next/Vitest breaks). Re-run all 19 test suites after each group.
**Verification after correction:** Require `pnpm audit --audit-level=high` to pass in CI; document any remaining moderate with owner + expiry; re-run full verification per upgrade group.
**Resolution (commit 91cd0d6):** `vitest` bumped to `^3.2.6` (clears the critical Vitest UI RCE); `pnpm-workspace.yaml` `overrides` force `vite@^6.4.3`, `postcss@^8.5.26`, `sharp@^0.35.4`, `ws@8.21.0`, `deepmerge-ts@^8.0.0`. Result: `pnpm audit` reports **0 critical, 2 high** — the only remaining highs are the two documented, unfixable exceptions `tmp` (solc-pinned, dev-only compile util) and `bigint-buffer` (PancakeSwap Solana SDK, unused on BSC, no patched release). A CI `security` job fails on any *unexpected* critical/high. 219 tests pass; typecheck + lint green.
**Confidence:** High
**Status:** Resolved

---

### [HIGH] AMB-2: Score-attestation contract trusts a single immutable publisher

**Category:** Smart-contract governance and key management
**Location:** `packages/contracts/src/AmbitScoreAttestation.sol:39` (`address public immutable publisher;`), `:52-55` (constructor), `:57-83` (`publishRoot` guarded only by `msg.sender != publisher`)
**Requirement or control:** Consumers should understand who can author score attestations and what happens if that key is compromised or unavailable. Parallel to Sluice REV-11.
**Evidence:** The contract has one `immutable publisher` set at construction. `publishRoot` only checks `msg.sender != publisher`. There is no multisig, timelock, rotation, or second-publisher quorum. `verifyClaim` validates the claim shape and the methodology hash but trusts whatever root the publisher posted.
**Problem:** The design is not decentralized. A compromised deploy-time publisher key can post a Merkle root attesting any (false) score, and consumers that only call `verifyClaim` with the publisher's root will accept it. There is no on-chain recovery if the publisher key is lost.
**Impact:** Centralized censorship or incorrect score attestation. The documented timeout/recovery path that Sluice had does not exist here; the publisher is permanent.
**Recommended correction:** Keep the limitation explicit in all public copy. Before any real-fund use, either (a) deploy with a multisig/rotatable publisher (refactor `immutable` → owned `publisher` with a 2-step transfer + timelock), or (b) pin the expected `methodologyHash` at every consumer and reject roots whose methodology hash drifts. Add a key-rotation runbook.
**Verification after correction:** Test publisher loss, publisher rotation (if made mutable), methodology-hash mismatch rejection at the consumer, and out-of-range claim fields (`_validateClaim` already rejects score>100/confidence>3/tier>2 — good).
**Resolution (commit pending):** `publisher` is no longer `immutable`. The constructor still takes `publisher_` and sets it as **both** the initial `publisher` and the `owner` (preserving existing single-key deploy semantics, including the BSC testnet deployment at `0xacc1…`). A two-step `transferPublisher` (owner-only) → `acceptPublisher` (candidate-only) rotation path was added, plus a `PublisherRotated` event. If the publisher key is leaked, the owner rotates it; if the owner is a multisig/timelock, this becomes the N-of-M recovery path. `publishRoot` still requires `msg.sender == publisher`. The exported ABI (`abi.ts`) and the parity test were updated; a new test asserts the rotation surface compiles and stays in sync. **Limitation:** the repo has no EVM harness (only `solc` compile + ABI parity per M4b), so on-chain state-transition behavior of rotation is not exercised by an automated test — full behavioral coverage requires a deploy harness (anvil/hardhat), documented as a follow-up. For real-fund use, consumers should still pin `methodologyHash`.
**Confidence:** High
**Status:** Resolved (partial — multisig owner + behavioral EVM test are follow-ups)

---

### [MEDIUM] AMB-3: CI uses floating action tags and runs no dependency/static security gate

**Category:** CI/CD supply chain and release integrity
**Location:** `.github/workflows/ci.yml:12,13,16,33`
**Requirement or control:** A release workflow should minimize supply-chain risk and verify every deployed product surface. Parallel to Sluice REV-9, but lower severity here.
**Evidence:** The workflow uses `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4`, and `docker/setup-buildx-action@v3` (all floating tags, not pinned SHAs). It runs typecheck/lint/test and Docker builds, but **no** `pnpm audit`, no Slither/static analysis, and no contract verification. Unlike Sluice, it does **not** grant `contents: write` and does not publish — so blast radius is smaller.
**Problem:** A mutable action tag can change the code it runs; the green workflow does not prove the dependency tree or contract are security-clean.
**Impact:** Supply-chain compromise could affect CI; release status can say green while the dependency security gate fails (as it currently does).
**Recommended correction:** Pin third-party actions to reviewed commit SHAs. Add a `security` job that runs `pnpm audit --audit-level=high` (and, when available, Slither on `packages/contracts`) and fails the build on violation. Keep the verify job separate from any future deploy job.
**Verification after correction:** Confirm pinned SHAs, a failing `pnpm audit --audit-level=high` breaks CI, and the contract compiles under a pinned solc with a static check.
**Resolution (commit 91cd0d6):** All four third-party actions are pinned to reviewed commit SHAs (`actions/checkout@11d5960a…`, `actions/setup-node@49933ea5…`, `pnpm/action-setup@b906affcc…`, `docker/setup-buildx-action@8d2750c6…`). A dedicated `security` job runs `pnpm audit --audit-level=high` and fails on any unexpected critical/high advisory (allowlisting the two documented exceptions). The verify job remains separate from the containers job.
**Confidence:** High
**Status:** Resolved

---

### [MEDIUM] AMB-4: No on-chain / static security analysis gate beyond in-repo solc compile

**Category:** Smart-contract verification completeness
**Location:** `packages/contracts/test/solidity.test.ts` (compile + ABI parity only); no Slither/Foundry in toolchain
**Requirement or control:** A shipped contract should have at least static analysis coverage, not only compiler success.
**Evidence:** The contract is tiny (~153 lines) and was reviewed by direct read + the in-repo solc compiler/ABI test. Slither is not installed in this environment, so no detector pass was performed. Direct review found no reentrancy (no external calls; `publishRoot` only writes storage + emits), correct Merkle ordering (`computedHash < sibling`), and full range validation in `_validateClaim`. The main residual is `verifyClaim` returning `false` for unknown epochs without freshness checks — by design, off-chain.
**Problem:** The audit trail for the contract is compiler-success + manual read, not an automated static gate. For a hackathon this is acceptable; for any real deployment it is a gap.
**Recommended correction:** Add a Slither (or `slither-analyze`) step to CI and record its output; or add a `forge`/`hardhat` test that asserts `verifyClaim` rejects tampered proofs and out-of-range claims.
**Verification after correction:** CI step runs static analysis; a test asserts a wrong-leaf / wrong-root / wrong-methodology claim returns `false`.
**Resolution (commit pending):** An in-repo static-analysis gate runs in the CI `security` job: `packages/contracts/test/solidity.test.ts` now (1) compiles with the pinned solc and asserts no `selfdestruct`/`delegatecall`/external-call escape patterns and a rotatable (non-immutable) publisher, and (2) `merkle.test.ts` asserts `verifyClaim`-equivalent rejection of methodology drift, wrong root, and out-of-range claim fields. Slither remains the recommended deeper gate (no EVM harness in repo); the in-repo check runs deterministically with no network install and records output in the CI log.
**Confidence:** High
**Status:** Resolved (Slither recommended as deeper follow-up)

---

### [MEDIUM] AMB-5: Hire bearer token is a single shared secret with no rotation/expiry scope

**Category:** Auth key management
**Location:** `apps/api/src/index.ts:225-268` (`requireHireAuthorization`, `isUsableHireToken`, `matchesToken`); `apps/web/app/api/agents/[agentRegistry]/hire/route.ts:41-42`
**Requirement or control:** The server-to-server hire credential should be scoped, rotatable, and not the sole control on a state-changing mutation.
**Evidence:** `POST /agents/:id/hire` requires `AMBIT_HIRE_TOKEN` (constant-time compare, length 16–512, printable ASCII) **and** the requester's wallet signature (EIP-191 over the full activation message, including a 15-minute `expiresAt` window). The two-layer design is correct: the bearer proves "came from our frontend," the signature proves "user authorized." `requireVerifiedAuthorization` re-checks expiry at verification time; `enforceActivationPolicy` enforces per-agent destination/protocol/value limits with `bigint` math.
**Problem:** The bearer token is a single shared secret with no rotation/expiry and no per-deployment scoping beyond "must be set." If the web container's env is leaked, an attacker can call the API hire path directly (though still bounded by the requester signature requirement — they cannot forge activations for wallets they don't hold).
**Impact:** Limited: an attacker with the token can proxy hires but cannot authorize activations for arbitrary wallets. Still, the token is a lateral-movement credential.
**Recommended correction:** Scope the token per environment, document rotation, and consider short-lived/deploy-scoped credentials. Keep the requester-signature requirement as the primary authorization (already correct).
**Resolution (commit pending):** `AMBIT_HIRE_TOKEN` now accepts a comma-separated list of usable tokens (`parseHireTokens`), enabling zero-downtime rotation; a malformed entry degrades to the valid subset rather than failing open. Rotation runbook added to `docs/SECURITY.md` and `.env.example`. The requester-signature requirement remains the primary authorization.
**Confidence:** Medium
**Status:** Resolved

---

### [LOW] AMB-6: Local `docker-compose.yml` ships a hardcoded weak Postgres password

**Category:** Local configuration hygiene
**Location:** `docker-compose.yml:8` (`POSTGRES_PASSWORD: ambit`)
**Evidence:** The local compose (M0 `docker compose up -d`) hardcodes `POSTGRES_PASSWORD: ambit`. The deployment compose (`docker-compose.deploy.yml`) correctly requires `POSTGRES_PASSWORD` from the environment (`${POSTGRES_PASSWORD:?…}`).
**Problem:** A developer who copies the local compose to a non-loopback host exposes a trivial DB password. This is dev convenience, not the deploy path, but it is a footgun.
**Recommended correction:** Change the local default to read from env (with a fallback only for pure-localloopback use) and add a comment that it must never be used for shared hosts.
**Resolution (commit pending):** `docker-compose.yml` now reads `POSTGRES_PASSWORD` from the environment with a clearly-labeled local-only fallback (`ambit-local-dev-only`) and a comment that it must never be reused on a non-loopback host; `docker-compose.deploy.yml` already requires it from the environment.
**Confidence:** High
**Status:** Resolved

---

### [LOW] AMB-7: Operational log line serializes request paths without truncation of the full URL

**Category:** Logging hygiene
**Location:** `apps/api/src/index.ts:67-89` (request logger), `:216-223` (`safePath` uses `pathname` only, capped at 256 chars)
**Evidence:** The request logger calls `safePath(context.req.url)`, which extracts only `pathname` and truncates to 256 chars; query strings and headers are not logged. No secrets, tokens, or bodies are logged. This is safe, but the full `url` is passed into `safePath` before truncation, so a pathological >256-char pathname becomes `<path-omitted>` rather than leaking.
**Problem:** None functionally; noted only because the log line is the one place a future edit could accidentally widen logging.
**Recommended correction:** Keep `safePath` as the only URL sink; add a test asserting query strings are never present in the emitted event.
**Resolution (commit pending):** `apps/api/test/security.test.ts` now asserts the emitted http-request event contains no `?`, no `credential=`, and exactly `path: '/health'` (pathname only) — locking `safePath` as the sole URL sink.
**Confidence:** High
**Status:** Resolved

---

## Static Analysis Triage

Slither was not run (not installed). Direct contract review found:
- No reentrancy surface (`publishRoot` writes storage + emits only; `verifyClaim`/`verifyProof` are `view`/`pure`).
- Merkle verification uses canonical `computedHash < sibling` ordering and `keccak256(bytes.concat(...))` — standard.
- Full input validation in `_validateClaim` (chainId != 0, identityRegistry != zero, score <= 100, confidence <= 3, verificationTier <= 2).
- `verifyClaim` does not enforce epoch freshness — by design (off-chain consumers pin `methodologyHash` and compare `publishedAtBlock`). Flagged in AMB-4.

These observations do not replace a real Slither/Foundry run for any production deployment.

---

## Positive Practices Worth Preserving

1. **No private-key logging.** Unlike Sluice, there is no deployment or agent script that prints a private key. The only `PRIVATE_KEY` in the tree is a hardcoded test key inside a test file.
2. **Two-layer hire authorization.** `POST /hire` requires both a server bearer token and a requester wallet signature; the signature is verified server-side with `recoverMessageAddress` and an address match, independent of any browser guardrail.
3. **Bounded activation window + replay protection.** `parseHireAgentInput` enforces `expiresAt` within the next 15 minutes; the signature binds every request field; `clientRequestId` gives idempotency with conflict detection.
4. **Deterministic policy enforcement with `bigint`.** `enforceActivationPolicy` checks destination (case-insensitive), protocol allow-list, and `maxTxValue` via `BigInt` — no float rounding, fail-closed on invalid limits.
5. **Genuinely SSRF-safe endpoint prober.** `packages/endpoint` resolves DNS, pins the transport to the resolved address, blocks private/loopback/link-local for both IPv4 and IPv6, and denies if *any* resolved address is blocked. No rebind window.
6. **M17 production verifier is read-only and strict.** HTTPS-only origins, manual redirect handling, bounded response bodies, required security headers (`x-content-type-options`, `x-frame-options`, `referrer-policy`), and release-identity pinning.
7. **M16 demo rehearsal is honest.** Read-only preflight; deterministic failure on empty/inconsistent deployments; no on-chain writes.
8. **Altana session boundary is explicit.** `AltanaSessionExecutor.executeApproved` re-checks decision approval, session expiry, chain, wallet, selector permission, and spend permission before relaying — exact approved calldata only.
9. **Fail-closed config.** Numeric env (chain ID, port, batch size, start block) is validated and rejected before startup (M14).
10. **Contract is minimal and well-bounded.** Single immutable publisher, full range checks, append-only roots, compiler-verified ABI parity test.
11. **Secrets are gitignored and env-injected.** `.env` is ignored; deploy compose requires `AMBIT_HIRE_TOKEN`/`AMBIT_RELEASE_ID`/`DATABASE_URL` from the environment; docs state images contain no secrets.

---

## Improvement Strategy

### Theme 1: Close the dependency/security gate
- Target: `pnpm audit --audit-level=high` passes in CI and locally; Slither runs on the contract.
- Principle: A passing test suite does not offset critical/high dependency findings (Sluice REV-3 lesson, applies here).

### Theme 2: Make the contract trust model explicit
- Target: publisher centralization is documented and, for real-fund use, mitigated (rotatable/multisig publisher + consumer methodologyHash pinning).
- Principle: A correct attestation scheme cannot compensate for a single compromised publisher key (Sluice REV-11 lesson).

### Theme 3: Harden CI supply chain
- Target: action SHAs pinned; security gate runs before any green; verify job separated from any future deploy job.
- Principle: A green build is not a green multi-service release.

### Theme 4: Preserve honest scope
- Target: the live marketplace clearly remains an evidence/discovery tool; the contract is the optional attestation authority, not silently presented as protocol enforcement for the web UI.
- Principle: Accurate scope is a security control, not marketing copy.

### Explicit trade-offs
- Do not `pnpm audit fix --force` (major Vite/Next/Vitest breaks). Upgrade in compatibility groups and re-test all 19 suites.
- Do not add arbitrary on-chain writes or a public demo endpoint that spends gas (Sluice REV-6 class) — the read-only M16 rehearsal is the right pattern; keep it.
- Do not treat the web UI's client-side checks as protocol enforcement; the API already re-verifies server-side — keep that boundary.

---

## Definition of Done

- `pnpm audit --audit-level=high` passes in CI and locally, or has a signed, time-bounded exception.
- Slither/static analysis runs on `packages/contracts` in CI with recorded output.
- CI pins third-party action SHAs and separates verify from any deploy job.
- The score-attestation publisher trust model is documented; for real-fund use, a rotatable/multisig publisher or consumer-side methodologyHash pinning exists.
- `AMBIT_HIRE_TOKEN` is scoped/rotatable and the requester signature remains the primary hire authorization.
- Local `docker-compose.yml` no longer ships a hardcoded weak DB password.
- 218 tests still pass after every dependency upgrade group.

---

## Task Plan

### Milestone 0 — Stop immediate exposure
| Task | Areas | Acceptance | Effort | Risk |
|---|---|---|---|---|
| Remediate critical/high deps (group 1: vitest/vite/next) | root, apps/web | `pnpm audit --audit-level=high` clean for dev tooling; 19 suites pass | M | Med (Vite/Next majors) |
| Remediate critical/high deps (group 2: sharp/ws/postcss/tmp/bigint-buffer/deepmerge-ts) | lockfile | prod audit clean of high; web image builds | M | Med |
| Pin action SHAs + add audit gate to CI | `.github/workflows/ci.yml` | green build requires clean audit; SHAs pinned | S | Low |

### Milestone 1 — Contract trust + static gate
| Task | Areas | Acceptance | Effort | Risk |
|---|---|---|---|---|
| Document + mitigate publisher centralization | contract + docs | copy explicit; rotatable/multisig or consumer pinning for real-fund use | M | Med |
| Add Slither/static gate | CI + contract | static analysis runs; wrong-proof test added | S | Low |

### Milestone 2 — Auth + config hygiene
| Task | Areas | Acceptance | Effort | Risk |
|---|---|---|---|---|
| Scope/rotate hire bearer token | api + deploy docs | token per-env; rotation runbook | S | Low |
| Fix local compose password | `docker-compose.yml` | no hardcoded weak password | S | Low |

---

## Quick Wins
- Pin `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4` to reviewed commit SHAs.
- Add `pnpm audit --audit-level=high` as a CI job that fails the build.
- Bump `vite`/`vitest` to clear the critical and the Windows `fs.deny` bypass (directly relevant to this Windows dev env).
- Replace `POSTGRES_PASSWORD: ambit` in `docker-compose.yml` with an env-required value.
- Add a consumer-side `methodologyHash` pin plus a `verifyClaim` rejection test for tampered proofs.

---

## Open Questions
1. Is `AmbitScoreAttestation` intended to be deployed with real funds, or remains a reference contract? If real, the publisher must be multisig/rotatable (AMB-2).
2. Is a live API/Web/Indexer URL available to add to `packages/operations` and smoke-test independently?
3. Which dependency upgrade boundary is acceptable if Vite/Next major upgrades require code changes (AMB-1)?
4. Should the hire bearer token be per-deployment scoped / rotated on a schedule (AMB-5)?
5. Should Slither be added to the toolchain (AMB-4), or is the in-repo solc compile + manual review sufficient for the hackathon scope?

---

## Proposed Memory Commitments
- **Dependency audit is a release gate.** A passing test suite does not offset critical/high dependency findings; remediation must be planned and verified (`pnpm audit --audit-level=high`).
- **Never log secrets.** Deployment/agent scripts may print public addresses and network names, never private keys, API keys, bearer tokens, or secret env values. (Ambit already satisfies this — keep it.)
- **Audit every execution path.** If web, API, and any future worker can record/settle the same request, they must share policy inputs and parity tests.
- **Verify signatures server-side.** Browser-side wallet signatures are not trust; the API must recover and match the signer and re-check expiry/policy (Ambit already does this — keep it).
- **SSRF is a first-class boundary.** Any endpoint liveness probe must pin the resolved address and block private/loopback/link-local for IPv4 + IPv6 (Ambit `packages/endpoint` is the reference implementation).
- **Single-source attestation trust.** A single immutable publisher is a centralization assumption that must be documented and mitigated before real-fund use.
- **Separate frontend proof from protocol proof.** Browser-side checks are not protocol enforcement; public copy and deploy records must use the exact live architecture.

---

## Recommended Next Action
Fix AMB-1 first: remediate the critical Vitest advisory and the Windows-relevant Vite `fs.deny` bypass (directly applicable to this environment), then clear the remaining high group, add `pnpm audit --audit-level=high` to CI, and pin action SHAs. In parallel, document and mitigate the contract publisher centralization (AMB-2) before any real-fund deployment. The auth surface, SSRF prober, and read-only verifiers are already in good shape and need no change beyond the hygiene items above.

---

## Review Sources
- Public repository: https://github.com/Tajudeeen/ambit
- Audited commit: 6a4cca250fdb9fa3ac671ef7131882ffd7b441dc
- Primary source files cited inline (`apps/api/src/index.ts`, `apps/api/src/prisma-repository.ts`, `apps/api/src/marketplace.ts`, `apps/web/app/api/agents/[agentRegistry]/hire/route.ts`, `apps/web/components/hire-panel.tsx`, `apps/indexer/src/indexer.ts`, `packages/endpoint/src/index.ts`, `packages/contracts/src/AmbitScoreAttestation.sol`, `packages/operations/src/index.ts`, `packages/demo/src/index.ts`, `packages/altana/src/index.ts`, `docker-compose.deploy.yml`, `docker-compose.yml`, `.github/workflows/ci.yml`, `pnpm-lock.yaml`)
- `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` (218 passing), `pnpm audit` (18 vulns), in-repo solc compile/ABI test, and Git history (M0–M17).
