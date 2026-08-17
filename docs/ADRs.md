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
_rank and annotate_, never _hide_. See `docs/ARCHITECTURE.md` rule R-VIS.
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

# ADR-0005: Score attestations are append-only Merkle roots

**Status:** Accepted (M4b)
**Context:** Trust scores are deterministic offchain outputs over large evidence
sets. Storing every score and evidence record onchain would be expensive, while
a mutable root would weaken auditability.
**Decision:** Publish append-only Merkle roots from one immutable deployment
publisher. Leaves use typed ABI encoding, double hashing, sorted pairs, and bind
agent identity, score, confidence, verification tier, methodology, evidence, and
observation block. The contract verifies claims but never computes or changes
scores.
**Consequences:** Anyone can independently rebuild and verify a snapshot. Publisher
rotation requires a new deployment, making authority changes explicit rather than
silently mutable. Marketplace visibility remains independent of attestation state.

# ADR-0006: M5 authorizes normalized intents only

**Status:** Accepted (M5)
**Context:** Policy decisions must be deterministic and fail closed, but calldata
decoding, simulation, Altana sessions, and transaction submission arrive in later
milestones.
**Decision:** M5 evaluates versioned policies against normalized execution intents,
explicit usage state, and a caller-supplied timestamp. Target/selector allowlists,
identity bindings, expiries, value limits, token limits, slippage limits, and daily
transaction counts are enforced without network calls or hidden state. An approval
means only that the request satisfies policy.
**Consequences:** M5 can be tested as a pure security boundary. M6 must reject when
it cannot produce the normalized intent fields M5 requires, and later stages must
still pass simulation, risk, session authorization, and final approval.

# ADR-0007: M6 uses registered decoders and block-pinned simulation

**Status:** Accepted (M6)
**Context:** M5 deliberately accepts normalized intents and cannot safely infer
token effects from arbitrary calldata. Simulation also depends on external chain
state and must not silently become an authorization or execution mechanism.
**Decision:** M6 validates raw requests, resolves exactly one deterministic decoder
registered for the chain/target/selector/protocol tuple, evaluates the resulting M5
intent, and only then invokes an injected simulator at an explicit block number.
Unsupported or ambiguous decoding, policy rejection, provider failure, malformed
evidence, block mismatch, and reverts all fail closed.
**Consequences:** Supported integrations can add audited decoders without making
generic calldata guesses. Simulation evidence is reproducible and independently
testable, while M7 authorization, signing, submission, and receipt verification
remain separate mandatory stages.

# ADR-0008: M7 submits exact approved calls through registered Altana sessions

**Status:** Accepted (M7)
**Context:** The official Altana SDK is now publicly verifiable and exposes
EIP-7702 admin/session APIs plus raw relay calls. Ambit must not reconstruct or
mutate calldata after M6 simulation, give admin authority to agents, or treat an
unregistered session as publicly verifiable execution authority.
**Decision:** Pin the verified Altana 0.5.1 SDK in `@ambit/altana`. A trusted
admin adapter grants only registered sessions using explicit timestamps and
bounded permissions. A separate session executor accepts only approved M6
decisions and relays the exact simulated target, calldata, and value after
checking the configured chain and session wallet.
**Consequences:** Altana's on-chain validator remains the final session authority,
while Ambit's deterministic policy and simulation remain mandatory upstream
checks. Relay submission with a transaction hash is not a success claim; M8 must
verify the receipt and persist execution evidence. GPL license obligations for
the pinned Altana dependency must be preserved by deployments and distributions.
