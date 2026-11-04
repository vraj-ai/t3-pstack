# t3-pstack verification map

Maintained source for verifying the user-facing behaviour of t3-pstack. Read this index, then use the feature file as the recipe.

## Baseline preconditions

- Run from the repo root of the checkout under test.
- Use `scripts/verify.sh` or, by hand, `export HOME=$(mktemp -d)/home XDG_CONFIG_HOME=$HOME/.config GIT_CONFIG_GLOBAL=/dev/null; mkdir -p $HOME; unset CLAUDE_CONFIG_DIR CODEX_HOME`.
- Never drive the installer against the real user HOME.

## Driving conventions

- Harness is `scripts/verify.sh <step>`; manual commands are literal.
- Always pass `--source ./` so the checkout, not GitHub, is installed.

## Proof and skip reporting

- CLI proof = command, stdout, stderr, exit code (the script writes all four).
- Mutation proof = a read-only second view (`doctor`, or `installed_plugins.json`).
- Report Codex paths as SKIPPED (no `codex` CLI), never as verified via Claude.

## Features

- [Install / update](./install.md) — install, idempotent re-run, `update` alias.
- [Doctor](./doctor.md) — health report, text and JSON, failure exits.
- [Skill validation](./validate-skills.md) — plugin skill lint.
- [Test suite](./test-suite.md) — bun unit/integration tests.
