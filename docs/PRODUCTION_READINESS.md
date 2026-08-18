# Production Readiness (M17)

## Goal

Close repository-controlled production gaps without selecting a hosting vendor,
committing credentials, or treating CI output as proof of a public deployment.

M17 makes four boundaries explicit and testable:

1. outbound endpoint verification is bound to the address used by the network
   connection rather than a separate DNS preflight;
2. marketplace mutation routes require an explicit server-to-server credential
   while discovery and evidence reads remain public;
3. operational telemetry is structured, bounded, and redacts credentials and
   unrestricted upstream content; and
4. a read-only verifier checks operator-supplied production origins and expected
   release identity without creating agents, hires, executions, or transactions.

## Checkpoints

### M17a: transport boundary

Resolve all candidate A and AAAA records, reject the host if any candidate is
private, loopback, link-local, reserved, or otherwise disallowed, and bind the
approved address to the actual HTTP or HTTPS connection. Preserve the original
hostname for the HTTP `Host` header and TLS server-name verification. Redirects
remain manual and must never bypass the same address policy.

Tests must cover IPv4, IPv6, mixed allowed/blocked answers, connection pinning,
timeouts, certificate-preserving hostnames, and redirect refusal. A lookup-only
check is not sufficient evidence.

### M17b: authenticated mutation boundary

`GET` discovery, profiles, histories, health, readiness, and release identity
remain public. Marketplace hire creation requires a runtime-only credential
presented by the same-origin web server. The browser must never receive this
credential, and the API must use constant-time comparison and fail closed when
the credential or server configuration is absent or invalid.

Forwarded IP headers are not an authentication mechanism. Distributed rate
limiting remains an infrastructure responsibility until a trusted ingress and
shared enforcement store are selected.

The implementation uses `AMBIT_HIRE_TOKEN` only between the server-side web
proxy and the API. Public browser code never receives the value.

### M17c: operational evidence

The API exposes a non-secret release identity derived from the reviewed build,
and emits structured request outcomes with generated correlation identifiers.
Logs must not include authorization values, database URLs, RPC credentials,
request bodies, raw upstream responses, or private execution material.

Health proves only process liveness. Readiness proves only that the configured
repository dependency responds. Neither endpoint proves uptime, correctness of
external systems, successful execution, or alert coverage.

The implementation uses `AMBIT_RELEASE_ID` for `GET /version` and emits one
bounded JSON event per API request. Incoming correlation headers are not trusted;
the API generates its own `x-request-id` value for every response.

### M17d: production verification

A read-only verifier accepts explicit HTTPS API and web origins plus an expected
release identity. It checks TLS-validated reachability, health, readiness,
release identity, security headers, non-empty live discovery, profile identity,
history shape, and web availability. It exits non-zero when required evidence is
missing or inconsistent and returns a structured result suitable for review.

The verifier never substitutes fixtures, local defaults, cached screenshots, or
synthetic records for unavailable production evidence.

## External evidence checklist

Repository completion does not satisfy these operator-owned requirements:

- immutable image publication and digest provenance;
- public DNS ownership and certificate validity;
- managed database backups and restore rehearsal;
- secret storage, access policy, and rotation evidence;
- reverse-proxy or load-balancer configuration;
- distributed rate limiting and abuse controls;
- uptime monitors, alert delivery, and incident ownership; and
- rollback rehearsal against migration-compatible releases.

These facts must come from the selected platform. M17 may validate supplied
public endpoints but must not manufacture or infer missing infrastructure proof.

## Stop conditions

Stop release or rehearsal when any required credential is absent, an outbound
connection cannot be pinned to an approved address, release identity differs
from the reviewed build, readiness fails, live discovery is empty, or external
infrastructure evidence is unavailable for a claim being made.

## Explicit non-claims

M17 repository artifacts do not prove production deployment, uptime, user
adoption, successful on-chain execution, partner settlement, backup recovery,
monitoring delivery, or incident response. Each claim requires independent,
time-bounded evidence from the relevant deployed system.
