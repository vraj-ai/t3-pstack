#!/usr/bin/env bash
# fork-sync.sh — merge upstream chhoumann/t3-pstack into this fork's checkout.
#
# Exit 0: already up to date, or merged and verified. The caller pushes.
# Exit 1: needs a person. The reason is in $SYNC_REPORT, and the checkout is
# back where it started. A dirty checkout is refused before anything runs.
#
# The fork's version is upstream's with a fork marker, so plugin auto-update
# sees each fork release as newer than the fork's last one: `X-rc.N` becomes
# `X-rc.N.vraj.1`, and a stable `X` becomes `X-vraj.1` (semver sorts `vraj`
# after `rc`). When upstream bumps VERSION, the merge conflicts on the version
# files only. Those take upstream's text, and this script restamps the fork's
# version. CHANGES.md merges as a union (.gitattributes), so both entries
# survive. Any other conflict, or a failed check, needs a person.
#
# Usage: bash tools/fork-sync.sh
#        UPSTREAM_URL=<git url> SYNC_REPORT=<file> SYNC_CHECKS=<command> bash tools/fork-sync.sh
# SYNC_CHECKS replaces the default checks; tests set it so the suite does not
# run itself.
set -euo pipefail

UPSTREAM="${UPSTREAM_URL:-https://github.com/chhoumann/t3-pstack.git}"
REPORT="${SYNC_REPORT:-${TMPDIR:-/tmp}/fork-sync-report.md}"
CHECKS="${SYNC_CHECKS:-bun tools/generate.mjs --check && bun test tests/ --timeout 30000}"
VERSION_FILES=" VERSION package.json .claude-plugin/marketplace.json plugins/pstack/.claude-plugin/plugin.json plugins/pstack/.codex-plugin/plugin.json "

report() {
	printf '%s\n' "$1" > "$REPORT"
	echo "FAIL: $1" >&2
	exit 1
}
[ -z "$(git status --porcelain)" ] || report "The checkout has uncommitted changes. Commit or remove them, then rerun."
start="$(git rev-parse HEAD)"
fail() {
	git merge --abort 2>/dev/null || true
	git reset -q --hard "$start"
	report "$1"
}

fork_version() {
	case "$1" in
		*-*) printf '%s.vraj.1\n' "$1" ;;
		*) printf '%s-vraj.1\n' "$1" ;;
	esac
}

git fetch -q "$UPSTREAM" main
up="$(git rev-parse FETCH_HEAD)"
if git merge-base --is-ancestor "$up" HEAD; then
	echo "PASS: already contains upstream $up"
	exit 0
fi
base="$(git merge-base HEAD "$up")"
up_version="$(git show "$up:VERSION")"

if ! git merge -q --no-ff --no-edit "$up"; then
	while IFS= read -r f; do
		case "$VERSION_FILES" in
			*" $f "*) git checkout -q --theirs -- "$f" ;;
			*) fail "Upstream \`$up\` conflicts in \`$f\`. Merge it by hand: \`git fetch $UPSTREAM main && git merge FETCH_HEAD\`." ;;
		esac
	done < <(git diff --name-only --diff-filter=U)
fi

if [ "$(git show "$base:VERSION")" != "$up_version" ]; then
	version="$(fork_version "$up_version")"
	printf '%s\n' "$version" > VERSION
	perl -0pi -e "s/\n## /\n## $version - upstream $up_version\n\nMerges upstream t3-pstack $up_version into the fork. The fork's own change is still the skill-chain hook.\n\n## /" CHANGES.md
	perl -pi -e "s{(npx -y github:vraj-ai/t3-pstack#v)\S+}{\${1}$version}" README.md
fi

bun install --frozen-lockfile > /dev/null 2>&1 || fail "\`bun install --frozen-lockfile\` failed after merging upstream \`$up\`."
out="$(bun tools/generate.mjs 2>&1)" || fail "$(printf '`bun tools/generate.mjs` failed after merging upstream `%s`.\n\n```\n%s\n```' "$up" "$out")"
git add -A
if git rev-parse -q --verify MERGE_HEAD > /dev/null; then
	git commit -q --no-edit
else
	git commit -q --amend --no-edit
fi

log="${TMPDIR:-/tmp}/fork-sync-checks.log"
if ! bash -c "$CHECKS" > "$log" 2>&1; then
	excerpt="$(grep -E '\(fail\)|FAIL|error' "$log" | sed -n 1,40p || true)"
	fail "$(printf 'Checks failed after merging upstream `%s`.\n\n```\n%s\n```' "$up" "${excerpt:-$(tail -n 40 "$log")}")"
fi
echo "PASS: merged upstream $up as $(cat VERSION)"
