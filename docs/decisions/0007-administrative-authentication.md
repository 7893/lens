# ADR-0007: Administrative authentication

更新日期：2026-09-25
状态：采纳
适用范围：Engine administrative HTTP endpoints

## Context

Presence-only headers and an implicit development mode do not authenticate callers.

## Decision

Require a random `INTERNAL_API_SECRET` of at least 32 characters for all internal
and administrative routes. Verify bearer tokens with constant-time digest comparison.
No environment bypass is permitted. Access may supply an additional perimeter;
its email header is not trusted as proof of identity or as the audit operator.
Apply a fail-closed administrative limiter and bounded compensation batches.

## Consequences

Operators must configure the secret before deploying and update automation to send
it. Shared-token actions are attributed to `internal-service`. The rate limiter is
per Cloudflare location and does not establish a global billing cap. No database
schema, production data, or deployed credentials are changed by this decision.
