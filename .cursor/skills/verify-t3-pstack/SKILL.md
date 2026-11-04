---
name: verify-t3-pstack
description: Drive the t3-pstack installer CLI (`node tools/install.mjs install|update|doctor`) against a throwaway HOME, validate the plugin's skills, and optionally run the bun test suite, capturing every command, stdout, stderr and exit code as evidence. Use after changing tools/, plugins/pstack/, or before claiming the installer or a skill change works.
---

# Verify t3-pstack

t3-pstack ships two things: the installer CLI (`tools/install.mjs`, exposed as `npx github:<owner>/t3-pstack <install|update|doctor>`) and the `plugins/pstack` plugin (skills, hooks, agents) it installs into Claude Code and Codex homes. The installer CLI is the surface an agent can drive. The plugin's runtime behaviour inside T3/Claude sessions is covered only indirectly (skill validation + `bun test`).

## Run it

```bash
.cursor/skills/verify-t3-pstack/scripts/verify.sh                 # default steps
.cursor/skills/verify-t3-pstack/scripts/verify.sh install doctor  # chosen steps, in order
.cursor/skills/verify-t3-pstack/scripts/verify.sh test            # full bun suite (slow)
```

Exit 0 = every step PASS, 1 = some FAIL, 2 = setup error. `VERIFY_LOG_DIR=<dir>` overrides the evidence dir.

## Launch

No server. Requirements: `node` >= 20 (box has v22) and `bun` (only for the `test` step). The script creates `/tmp/t3-pstack-verify.XXXXXX/home` and exports `HOME`, `XDG_CONFIG_HOME` to it, unsets `CLAUDE_CONFIG_DIR`/`CODEX_HOME`, and sets `GIT_CONFIG_GLOBAL=/dev/null`. The installer therefore never touches the real `~/.claude`, `~/.codex`, `~/.t3` or `~/.config/t3-pstack`. Every install uses `--source ./` (the checkout under test), never GitHub. Runs are isolated, so two can go side by side.

**Never run `node tools/install.mjs install` without overriding HOME** — it writes the real user's Claude/Codex homes.

## Doctor

`node tools/install.mjs doctor --source ./` (with the isolated HOME) is read-only and is the health check. Healthy = exit 0 and `ok    installed: <VERSION file contents>` under `Claude Code  ~/.claude`. Without `--source ./` it exits 1 with `marketplace: ... neither chhoumann/t3-pstack nor --source` — expected for a local install. Codex is reported as `warn CLI: codex not found` when `codex` is not on PATH (true on this box), so Codex homes are never driven here.

## Drive

| Step | Command | Pass condition |
|---|---|---|
| `doctor-fresh` | `install.mjs doctor` on empty HOME | exit 1, stdout has `installed: the home does not exist` |
| `install` | `install.mjs install --source ./ --claude-home $HOME/.claude` | exit 0, `Every check passes`; copies `installed_plugins.json` to evidence |
| `install-again` | same command again | exit 0 and no `  - ` change lines (idempotent) |
| `doctor` | `install.mjs doctor --source ./` and `--json` | exit 0, `ok    installed:` / JSON has `"command": "doctor"` |
| `validate-skills` | `node tools/validate-skills.mjs plugins/pstack/skills` | exit 0 |
| `test` (opt-in) | `bun test tests/ --timeout 30000` | exit 0 |

Per-feature recipes are in `features/README.md`.

## Evidence

`.verify/<sha12>-<utc-ts>-<rand>/` at the repo root (gitignored): `NN-<step>.cmd|.stdout|.stderr|.exit`, `steps.tsv`, `summary.txt` (HEAD SHA, dirty flag, step table), `installed_plugins.json`. Report the `summary.txt` table and the path. Proof standard: assert on the real CLI output and on the files it wrote (`installed_plugins.json`, `$HOME/.claude/settings.json`) — not on internal functions.

## Cleanup

The script's EXIT trap deletes only its `/tmp/t3-pstack-verify.*` scratch HOME. It starts no background processes. Evidence in `.verify/` is kept; delete old run dirs by hand, never the one you cite.

## Helpers

- `scripts/verify.sh [step...]` — the whole harness above, executable.

## Not covered

Codex homes (no `codex` CLI on box), T3 settings-instance discovery (no `~/.t3`), the session-start hook running inside a live agent session, `tools/sync.mjs` upstream sync (needs network + upstream SHAs), and `T3_PSTACK_E2E=1` e2e tests.
