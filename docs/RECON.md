# Recon Report — verifying the ecosystem before building

Generated 2026-08-16 during the M0 reconnaissance pass (per build rule §38: verify
against authoritative sources before implementing). This report corrects several
assumptions in the raw hackathon brief.

## 1. "x402/B402" resolves to Binance **x402**

The official hackathon blog names **"Binance x402"** as the payment facilitator.
`github.com/BNBChain402/B402` is an UNRELATED squatted memecoin (bonding-curve
BUSL-1.1 token, EIP-3009). Building "B402" payments would integrate the wrong
thing. Decision: use **Binance x402** for payment-evidence only where reliably
queryable (it is orthogonal to ERC-8004; x402 `proofOfPayment` is optional
evidence inside off-chain ERC-8004 feedback files).

## 2. BNB Agent Studio is already live

`bnbchain.org/en/bnb-agent-studio` ("Prompt in. Agent out.";
`npm i -g @bnbagent/studio-cli`). It is the CREATE layer: registers ERC-8004
identity + ERC-8183 task interface, configures x402 payments, deploys to AWS
AgentCore. **Ambit must complement, not replace it.** Our marketplace reads the
same on-chain identities Studio produces.

## 3. Real scale — no need to fake agents

8004scan (AltLayer) live: **256,776 agents on BSC** under ERC-8004 (blog: 200k+,
~60% of all agents across 26 networks), 11,705 BSC feedbacks. The
discoverability problem is real; there is genuine data to index.

## 4. Partner tracks (confirmed from the official blog)

- **TermiX** ($10k): Agent Advantage Report with ≥3 with/without tasks; depth in
  trading/equities/security weighted highest.
- **Altana** (50k XP): agents on their own Altana wallets, onchain sessions with
  spend caps + expiries, revocation visible, judged via the Altana explorer
  (testnet counts, mainnet stronger).
- **PancakeSwap** (1000 CAKE): real trader/LP benefit, safe automated swaps, no
  user-fund risk.
- Main judging: functionality, data quality, agent diversity.

## 5. ERC-8004 mechanics (from eips.ethereum.org/EIPS/eip-8004, Draft 2025-08-13)

- Identity Registry = ERC-721 (tokenId = agentId, tokenURI = agentURI) with
  `getMetadata`/`setMetadata`/`setAgentURI`/`setAgentWallet` (EIP-712/1271).
- Reputation Registry = `giveFeedback(agentId, int128 value, uint8 valueDecimals,
tag1, tag2, endpoint, feedbackURI, feedbackHash)`; `NewFeedback` event.
- Three registries: Identity, Reputation, Validation (TEE/zkML/staking — out of
  scope M0-M3).
- Payments are orthogonal; x402 is an optional example to enrich feedback.

## 6. Open gaps (not fabricated)

- **Altana SDK/explorer identity:** `docs.altana.ai` is the WRONG company
  (supply-chain/trade-compliance). The hackathon Altana is a separate entity not
  yet pinned. → M7 built behind the `@ambit/altana` adapter interface with a
  documented "verify-before-integrate" stance; real SDK slotted once identified.
  No fake addresses.
- **M7 update (supersedes the preceding Altana open-gap note):** the official BNB
  Agent SDK at `github.com/bnb-chain/bnbagent-sdk` ships `AltanaWalletProvider`,
  and the canonical package is `@altananetwork/sdk` with docs at
  `docs.altana.network`. M7 pins the verified 0.5.1 API because BNBAgent SDK
  0.5.0 supports Altana `>=0.3.3 <0.6.0`; newer Altana releases are outside that
  verified peer range. No addresses are copied or guessed—network presets come
  from the official SDK.
- **Exact BSC ERC-8004 contract addresses:** the 8004scan `/contracts` page is
  dead, but `/networks` lists per-chain registry addresses. → resolved at M1
  start from that live page (authoritative), not guessed.

## 7. Tooling available on this machine

Node v24.19.0, pnpm 11.20.0, git 2.55.0. Stack chosen: pnpm workspaces,
TypeScript (strict), Next.js (web), Hono (api), Prisma + Postgres (db), Foundry
(attestation contract M4), viem (BSC).
