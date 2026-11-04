# Install / update

`install` (alias `update`) adds the `t3-pstack` marketplace and installs/enables the `t3-pstack@t3-pstack` plugin in every Claude Code and Codex home; a second run changes nothing.

## Sub-features

- `install-fresh` installs into an empty home and reports `2 changes`.
- `install-idempotent` second run reports no change lines.
- `install-update-alias` `update` behaves exactly like `install`.
- `install-foreign-source` a home whose marketplace has another source is left alone.

## How to get to it (user POV)

- `npx -y github:vraj-ai/t3-pstack install --source vraj-ai/t3-pstack`
- Locally: `node tools/install.mjs install|update [--source <dir>] [--claude-home <dir>] [--codex-home <dir>]`

## Driving it with verify.sh

Preconditions: isolated HOME (see README).

- **Fresh install.** Run `scripts/verify.sh install`. Exit 0; stdout has `- added the t3-pstack marketplace from <repo>`, `- installed <VERSION>`, `Every check passes`.
- **Idempotent.** Run `scripts/verify.sh install install-again`. Step `install-again` PASS: no `  - ` lines.
- **Update alias.** Manually `node tools/install.mjs update --source ./ --claude-home $HOME/.claude` after an install. Exit 0, no change lines.
- **Foreign source.** Install, then `node tools/install.mjs install --claude-home $HOME/.claude` (no `--source`). The home is left as is and a marketplace check fails with a fix line.
- **Proof.** `installed_plugins.json` in the evidence dir lists `t3-pstack@t3-pstack`.

## Gotchas

- Without HOME override this writes the real `~/.claude`.
- Uses the `claude` CLI on PATH (`/home/box/.local/bin/claude`) to add the marketplace; missing CLI changes output.
- Codex home is skipped with a warning when `codex` is not on PATH.
