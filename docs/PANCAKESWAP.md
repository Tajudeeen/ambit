# PancakeSwap Integration (M12)

## Goal

Add a real PancakeSwap execution path without creating a second policy or
custody boundary. PancakeSwap prepares and decodes supported swap calls;
`@ambit/execution` remains authoritative for policy and simulation, Altana
remains authoritative for session execution, and M8 remains authoritative for
successful execution claims.

## Verified official surface

Verified on 2026-08-17:

- `@pancakeswap/smart-router@7.7.0` is the official route-quoting package.
- `@pancakeswap/universal-router-sdk@1.5.3` is the official Universal Router
  calldata package and resolves the deployed router for each supported chain.
- M12 pins those versions and obtains BSC router addresses through the official
  SDK instead of copying an address into application configuration.

SDK output is not automatically trusted. Ambit decodes and validates the final
calldata before it can become an M6 execution intent.

## Supported M12 boundary

M12 supports quote-bound, exact-input ERC-20 to ERC-20 swaps on BSC mainnet and
BSC testnet when the Universal Router plan contains exactly one of:

- `V2_SWAP_EXACT_IN`
- `V3_SWAP_EXACT_IN`

The command must pay from the caller, send output back to the Altana wallet that
submits the transaction, use a positive fixed input amount, include a positive
minimum output, and carry an explicit unexpired deadline.

M12 deliberately rejects native-token input or output, exact-output swaps,
split or mixed routes, stable and Infinity routes, Permit2 commands, sub-plans,
router-side transfers or fees, arbitrary router addresses, and calldata without
a deadline. These can be added only as separately decoded and tested surfaces.

## Quote-bound plan

The adapter accepts explicit quote evidence rather than a caller assertion:

- chain and official router
- input token and exact input amount
- output token and quoted output amount
- slippage tolerance in basis points
- output recipient
- quote block number and Unix timestamp
- execution deadline
- final Universal Router calldata and native value

The adapter decodes the final call and requires it to match that evidence. The
minimum output must equal the deterministic floor of:

`quotedOutput * (10_000 - slippageBps) / 10_000`

The decoder is bound to the exact validated calldata. It derives the token spend
and slippage value supplied to M5; request metadata cannot override them.

## Execution flow

1. Obtain a real exact-input quote through the pinned official Smart Router.
2. Build Universal Router calldata through the pinned official router SDK.
3. Validate and bind the calldata to explicit quote evidence.
4. Register the resulting PancakeSwap decoder with the M6 pipeline.
5. Run deterministic policy checks and explicit-block simulation.
6. Execute an approved decision through the registered Altana session.
7. Verify the exact receipt and persist the M8 execution passport.

No relay hash, quote, route, simulation, or successful SDK call is itself a
successful execution claim.

## Failure behavior

The adapter fails closed for malformed quote evidence, unsupported chains or
commands, mismatched paths or amounts, stale deadlines, unexpected recipients,
nonzero native value, decoder ambiguity, or any mismatch between the validated
plan and the execution request.
