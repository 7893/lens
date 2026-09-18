# Lens Engineering & Agent Directives

Updated: 2026-09-19
Scope: All human engineers and AI coding agents operating within `/home/ubuntu/lens`

---

## 1. Core Constraints & Safety Rules

1. **Commit Integrity**:
   - Commits MUST be signed with GPG/SSH (`git commit -S`).
   - Commit messages MUST use lowercase conventional commit types in English with at most 7 words (e.g. `feat: implement custom agent tracing harness`).
2. **Database Protection**:
   - Remote Cloudflare D1 database (`lens-d1`) holds production image indices.
   - Strictly forbidden: `DROP TABLE`, `VACUUM`, batch record deletion, or non-backward-compatible schema drops.
3. **Workspace Boundary**:
   - Never modify or delete any file outside `/home/ubuntu/lens`.

---

## 2. Navigation & Context Strategy

This repository is equipped with **CodeGraph**, **Graphify**, and **Local Harness** to prevent context pollution and token waste.

### A. CodeGraph (Micro-level Symbol & Call Graph)

Indexed in `.codegraph/`. Reach for it BEFORE grep/find when exploring code structures:

- **CLI**: `codegraph explore "<symbol or question>"`
- **MCP**: `codegraph_explore`
- Answers code questions in a single shot: verbatim source with line numbers, callers, callees, and dynamic dispatch hops.

### B. Graphify (Macro-level Architectural Knowledge Graph)

Knowledge graph located at `graphify-out/`.

- For architectural questions or cross-file data flows:
  - `graphify query "<question>"` (e.g. `graphify query "SearchService"`)
  - `graphify path "<A>" "<B>"` for dependency paths between modules
  - `graphify explain "<concept>"` for focused module context
- View interactive topology: open `graphify-out/graph.html` in browser.
- After modifying code files, keep the graph fresh: `graphify update .` (local AST, zero API cost).

### C. Local Harness (Domain Scoping & Verification)

Managed via `.pi/harness.json`.

- Query domain index before loading full files:
  ```bash
  node /home/ubuntu/local-harness/cli.mjs context --project /home/ubuntu/lens --scope engine
  ```
- Available domains:
  - `engine`: Cloudflare Workers backend (`apps/engine/`), Hono routes, services, queues, workflows.
  - `client`: React frontend (`apps/client/`), Vite, Tailwind UI components.
  - `shared`: Shared TypeScript types, schemas, logger (`packages/shared/`).
  - `infra`: Terraform (`terraform/`) and Cloudflare configuration (`wrangler.toml`).
  - `docs`: Documentation (`docs/`, `README.md`, `CHANGELOG.md`).
  - `tooling`: Project configuration and scripts (`.pi/`, `scripts/`, `.github/`).

---

## 3. Standard Verification Commands

Always verify changes before committing:

```bash
# 1. Typecheck all packages
pnpm -r run typecheck

# 2. Run unit tests with coverage
pnpm test

# 3. Linter & Prettier formatting
pnpm run lint

# 4. Cloudflare Worker dry-run validation
pnpm --filter engine exec wrangler deploy --dry-run
```

---

## 4. Documentation Governance

1. **Current State as Source of Truth**:
   - Always check [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md) for active bindings, database size, and baseline facts.
   - All active documentation is indexed in [`docs/INDEX.md`](docs/INDEX.md).
2. **ADR (Architecture Decision Records)**:
   - Significant architectural, security, or tooling decisions must be recorded in `docs/decisions/` following `0000-ADR-TEMPLATE.md`.
   - ADR documents are frozen once adopted; do not delete or overwrite them, supersede them with new ADRs.
3. **Doc Verification**:
   - Run `pnpm run check:docs` to ensure zero broken links, metadata validity, and full INDEX coverage.
