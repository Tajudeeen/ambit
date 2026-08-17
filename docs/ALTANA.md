# Altana Session Authorization and Execution (M7)

M7 integrates Ambit's execution control plane with the official Altana
TypeScript SDK. Altana provides EIP-7702 wallets whose admin grants scoped
session keys with on-chain call permissions, spend caps, expiry, and immediate
revocation.

## Verified integration surface

Verified on August 17, 2026:

- `@altananetwork/sdk` 0.5.1 exposes `createClient`, `BNB`, `BNB_TESTNET`,
  `grantSession`, `revokeSession`, and raw `execute({ session, calls, chainId })`.
- `@bnbagent/sdk` 0.5.0 declares the compatible Altana peer range
  `>=0.3.3 <0.6.0` and documents the same admin/session split.
- Altana 0.5.1 is intentionally pinned because the current
  `@altananetwork/sdk` latest release is outside that verified BNBAgent peer
  range.

Canonical sources:

- `https://github.com/bnb-chain/bnbagent-sdk`
- `https://www.npmjs.com/package/@altananetwork/sdk/v/0.5.1`
- `https://docs.altana.network`

## Trust boundary

Ambit does not give an agent process the admin EOA. A trusted admin environment
creates or loads the wallet, grants a registered session, and may revoke it.
The agent receives only the bounded session object.

Registered sessions are required for Ambit execution. Altana also supports
ephemeral sessions, but third parties cannot verify those through the public
KeyStore registry. Ambit therefore rejects `register: false` for execution
sessions that will support marketplace verification claims.

## Session grants

The grant adapter requires:

- explicit chain and wallet/signer context
- at least one call permission
- at least one non-negative spend permission
- explicit Unix-second `now` and future `expiry`
- registered-session creation

No wall clock, guessed address, or default unlimited permission is introduced by
Ambit. The official SDK remains responsible for signing, relay submission, and
on-chain account validation.

## Approved execution

The session executor accepts only an approved M6 pipeline decision containing:

- an approved M5 policy decision
- successful simulation evidence
- the exact raw transaction that was simulated

Before relay submission, M7 verifies that the transaction sender equals the
Altana session wallet, the chain matches the configured client, and the raw
target/calldata/value remain present. It then submits that exact call through
Altana's public session `execute` API.

Relay `FAILED`, malformed results, or missing transaction hashes fail closed.
`PENDING` or `CONFIRMED` with a transaction hash means only that submission can
be tracked. M8 must verify the on-chain receipt and record the execution
passport before Ambit claims a successful execution.

## Secrets and persistence

An Altana session contains a private session key. It must never be logged,
committed, returned through marketplace APIs, or mixed with public evidence.
Session persistence must use an official byte-exact serializer; Ambit does not
invent its own JSON representation because Altana hash-commits session fields
on-chain.

## License boundary

Altana 0.5.1 is GPL-3.0-or-later. Ambit loads it through the dedicated
`@ambit/altana` package and records the exact pinned dependency. Deployment and
distribution must preserve the applicable license obligations.
