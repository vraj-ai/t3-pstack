# Skill validation

`tools/validate-skills.mjs` lints every skill under a directory (frontmatter, links, structure), the same check contributors and CI rely on before a plugin release.

## Sub-features

- `validate-plugin` all `plugins/pstack/skills` pass.
- `validate-usage` no argument prints usage and exits 2.

## How to get to it (user POV)

- `node tools/validate-skills.mjs plugins/pstack/skills`

## Driving it with verify.sh

Preconditions: none beyond node.

- **Plugin skills.** `scripts/verify.sh validate-skills` → exit 0.
- **Usage.** `node tools/validate-skills.mjs` → exit 2, `usage: node tools/validate-skills.mjs <skills-directory>`.
- **This skill.** `node tools/validate-skills.mjs .cursor/skills` to lint the verification skill itself.

## Gotchas

- Ignores `poteto-mode/scripts/node_modules`.
