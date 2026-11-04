# Test suite

The bun test suite in `tests/` covers installer, session hook, skill chain, sync and invariants; it is the contributor's gate in CONTRIBUTING.md.

## Sub-features

- `tests-default` `bun test tests/` passes.
- `tests-e2e` `T3_PSTACK_E2E=1` installer e2e (opt-in, slow).

## How to get to it (user POV)

- `GIT_CONFIG_GLOBAL=/dev/null bun test tests/ --timeout 30000`

## Driving it with verify.sh

Preconditions: `bun` on PATH; `bun install` done if `node_modules/` missing.

- **Default suite.** `scripts/verify.sh test` → exit 0; `NN-test.stdout`/`.stderr` hold pass/fail counts.
- **E2E.** By hand: `T3_PSTACK_E2E=1 GIT_CONFIG_GLOBAL=/dev/null bun test tests/install-e2e.test.mjs --timeout 300000`.

## Gotchas

- bun writes its report to stderr; read `.stderr` for counts.
- Some tests need git; global git config is neutralised on purpose.
