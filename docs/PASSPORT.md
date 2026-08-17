# Execution Passport and Receipt Verification (M8)

M8 turns an Altana relay submission into independently verifiable execution
evidence. A relay transaction hash is only a tracking reference; Ambit may make
an execution claim only after it verifies the mined transaction and receipt.

## Required inputs

The passport verifier accepts:

- an approved M6 `ExecutionPipelineDecision`, including the exact raw request,
  normalized intent, policy decision, and block-pinned simulation evidence;
- an M7 Altana submission containing the `callsId`, transaction hash, and relay
  status; and
- an explicit verification timestamp, confirmation requirement, and chain
  reader.

The chain reader must provide the transaction, transaction receipt, current
block number, and the receipt's block. The timestamp and confirmation count are
caller-supplied so tests and replay jobs never depend on a hidden wall clock.

## Receipt checks

Receipt verification fails closed unless all of these checks pass:

1. The pipeline decision is approved and contains a valid exact request,
   intent, policy decision, and successful simulation.
2. The Altana relay status is `PENDING` or `CONFIRMED` and its transaction hash
   is a non-empty transaction hash.
3. The fetched transaction hash, chain ID, sender, target, calldata, and value
   match the M6 request exactly.
4. The receipt hash, sender, target, block number, and block hash match the
   fetched transaction and canonical receipt block.
5. The receipt is mined and has at least the requested number of confirmations.

The receipt status is recorded as `succeeded` or `reverted`. A reverted receipt
is valid execution evidence but never a successful execution claim.

## Passport contents

The immutable passport records the evidence needed to independently re-check
the execution without exposing the Altana session key:

- deterministic passport ID, chain, agent, sender, target, calldata, value, and
  protocol context;
- M5 policy version and M6 decoder/simulation evidence;
- Altana `callsId`, relay status, and transaction hash;
- receipt block number/hash, receipt status, gas used, effective gas price, and
  observed confirmation count; and
- explicit verification time plus the passport schema version.

The raw session object and every private signer field are excluded. Public
consumers can use the transaction hash and block evidence to reproduce the
verification against BNB RPC data.

## Persistence boundary

Passport persistence is an injected port. A store must support idempotent
writes: re-recording the same deterministic passport returns the existing
record, while a conflicting record for the same ID fails closed. The verifier
does not claim success when persistence is unavailable or returns a different
record. A database adapter can be added by M9 without weakening the M8
verification boundary.

## Failure behavior

Missing transactions or receipts, provider errors, pending receipts, mismatched
call fields, non-canonical blocks, insufficient confirmations, malformed relay
data, and persistence errors produce structured rejection results and no
passport. No inferred success, local timestamp, or relay status is treated as a
receipt.
