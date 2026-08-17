# Supported Transaction Simulation (M6)

M6 converts a raw execution request into the normalized intent required by M5,
then requires a supported simulation before the request can proceed to M7 session
authorization. It does not sign, submit, retry, or claim that a simulated result
guarantees future execution.

## Pipeline

M6 processes five explicit inputs:

1. A raw execution request containing chain, identity, explicit sender,
   destination, calldata, native value, optional protocol/slippage metadata, and
   request timestamp.
2. A registry of deterministic supported-call decoders.
3. The M5 execution policy and current usage state.
4. An explicit evaluation timestamp and simulation block number.
5. An injected simulation adapter for the selected chain.

The ordered flow is:

1. Validate the raw request and explicit block context.
2. Match exactly one decoder by chain, target, selector, and optional protocol.
3. Decode supported token-transfer effects into an M5 `ExecutionIntent`.
4. Evaluate the normalized intent with the M5 policy engine.
5. Simulate the original transaction at the requested block only after policy
   approval.
6. Validate the returned simulation evidence and approve only a successful,
   non-reverting result.

## Decoder boundary

Decoders are allowlisted adapters for known call shapes. They must be pure and
deterministic: no network calls, wall clock, hidden mutable state, or LLM output.
Unknown, ambiguous, malformed, or throwing decoders fail closed. M6 never guesses
token amounts or protocol semantics from an unsupported selector.

The raw request remains the source for chain, agent, principal, target, selector,
native value, protocol, slippage, and timestamp. A decoder may only add the
normalized token-transfer effects that M5 needs.

## Simulation boundary

The simulation adapter is injected and may use a chain RPC or another verified
provider. Every simulation is pinned to an explicit block number and returns
structured evidence including success/revert status, gas used, return data, and
the observed block. Missing adapters, provider errors, malformed evidence,
reverts, or block mismatches reject the request.

Simulation is evidence, not execution authorization. M7 Altana session checks,
later risk checks, signing, submission, receipt verification, and execution
recording remain mandatory downstream stages.

## Failure behavior

M6 returns structured stage codes and never treats absence of evidence as success.
A policy rejection prevents simulation from running. A simulation success cannot
override a policy rejection, and a policy approval cannot override a failed or
unavailable simulation.
