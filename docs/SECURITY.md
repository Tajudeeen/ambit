# Security Hardening (M14)

## Goal

Reduce Ambit's exposed attack surface at deterministic trust boundaries without
inventing identity, authentication, authorization, proxy, or infrastructure
assumptions that the repository cannot verify.

M14 focuses on public HTTP request handling and fail-closed runtime
configuration. Existing execution, evidence, and visibility rules remain in
force.

## Threat model

The public marketplace API may receive malformed, oversized, mislabeled, or
adversarial requests from unauthenticated network clients. Environment variables
may be missing, malformed, out of range, or accidentally configured with values
that JavaScript cannot represent safely.

M14 protects these boundaries:

- request metadata and bodies accepted by `apps/api`
- numeric environment values parsed by `@ambit/config`
- error responses returned before marketplace or execution logic runs

The hardening controls must be deterministic, testable, and independent of
caller-controlled forwarding headers.

## Public API controls

The API applies standard defensive response headers to all routes. Hire mutation
requests have a 16 KiB body limit and require a JSON media type before parsing.
Oversized bodies and unsupported media types return structured errors without
reflecting request contents.

These controls limit parser and accidental payload abuse; they do not replace
authentication, authorization, rate limiting, or upstream denial-of-service
protection. Health, discovery, profile, and execution-history reads remain public
by design.

M14 does not use `X-Forwarded-For` or similar caller-provided headers for a
security decision. A future deployment may use trusted proxy metadata only after
the proxy boundary and hop behavior are explicitly configured and tested.

## Configuration controls

Security-relevant numeric configuration fails closed before an application
starts:

- chain IDs are positive safe integers
- API ports are integers from 1 through 65,535
- indexer batch sizes are positive bounded integers
- indexer start blocks are non-negative safe integers

Malformed, fractional, unsafe, zero, negative, or out-of-range values are
rejected with configuration errors. Defaults pass through the same validation as
explicit environment values.

## Explicit non-goals

M14 does not add or imply:

- user identity, sessions, API keys, wallet authentication, or authorization
- per-user or per-IP rate limiting without a verified identity or proxy boundary
- a web application firewall, reverse proxy, TLS termination, or deployment
  topology
- secret rotation, key custody, or infrastructure access controls
- expanded transaction, endpoint, or external protocol support

## Deferred endpoint rebinding risk

The endpoint verifier currently resolves a hostname before making an HTTP
request, while the HTTP client may resolve the hostname again when connecting.
An attacker controlling DNS could change the answer between those operations and
redirect the connection to a disallowed address.

M14 records this DNS rebinding/time-of-check-time-of-use risk but does not apply
a superficial hostname recheck. A complete fix requires the verified address to
be pinned to the actual connection, with redirect targets and address families
validated under the same policy. Until that transport boundary exists, endpoint
verification must not be represented as connection-level SSRF protection.

## Verification

Adversarial tests cover request size, media type, security headers, and invalid
numeric configuration. Full workspace typecheck, lint, and tests remain the merge
gate for M14.
