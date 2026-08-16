# Deterministic Execution Policy (M5)

M5 defines the fail-closed authorization layer for already-normalized execution
intents. It does not decode calldata, simulate transactions, authorize Altana
sessions, sign requests, or submit transactions.

## Inputs

The policy engine receives three explicit values:

1. A validated, versioned execution policy.
2. A normalized execution intent produced by a trusted decoder in M6.
3. Current usage state plus an explicit Unix timestamp.

No wall clock, network call, LLM, or mutable global state participates in the
decision. Identical inputs always produce the same result.

## Policy boundaries

A policy binds:

- chain, agent, and principal identities
- validity start and expiry
- allowed target contracts and function selectors
- optional protocol labels attached to specific calls
- per-transaction and daily native-value limits
- per-token transaction and daily transfer limits
- optional slippage limits for calls that require slippage metadata
- optional daily transaction-count limits

Allowlist fields are deny-by-default. Empty call rules never mean unrestricted
access. Missing intent fields required by a configured rule cause rejection.

## Decision contract

The evaluator returns a structured decision with:

- `approved`: policy-layer approval only
- ordered checks with stable reason codes
- deterministic policy version

An approved policy decision is not permission to execute. M6 simulation, M7
session authorization, risk checks, and final approval must all succeed before
submission.

## Failure behavior

Invalid policies, malformed intents, unknown targets or selectors, expired
policies, identity mismatches, missing slippage, and exceeded limits are rejected.
The evaluator does not throw for untrusted policy or intent data; it returns an
auditable rejection decision.
