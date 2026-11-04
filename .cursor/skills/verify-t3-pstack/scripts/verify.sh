#!/usr/bin/env bash
# Drive the t3-pstack installer CLI against a throwaway HOME and record evidence.
# Usage: verify.sh [step...]   steps: doctor-fresh install install-again doctor validate-skills test
# Default runs every step except `test`. Exit 0 = all PASS, 1 = a FAIL, 2 = setup error.
set -uo pipefail
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel) || exit 2
cd "$REPO"
command -v node >/dev/null || { echo "node not found" >&2; exit 2; }
STEPS=("$@"); [ ${#STEPS[@]} -eq 0 ] && STEPS=(doctor-fresh install install-again doctor validate-skills)
SHA=$(git rev-parse --short=12 HEAD)
EVID=${VERIFY_LOG_DIR:-$REPO/.verify/$SHA-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM}
mkdir -p "$EVID" || exit 2
SCRATCH=$(mktemp -d /tmp/t3-pstack-verify.XXXXXX) || exit 2
trap 'rm -rf "$SCRATCH"' EXIT   # cleanup: scratch HOME only; evidence stays
export HOME="$SCRATCH/home" XDG_CONFIG_HOME="$SCRATCH/home/.config" GIT_CONFIG_GLOBAL=/dev/null
unset CLAUDE_CONFIG_DIR CODEX_HOME
mkdir -p "$HOME"
{ echo "HEAD $(git rev-parse HEAD)"; git status --porcelain | grep -q . && echo "worktree: dirty" || echo "worktree: clean"; echo "HOME $HOME (deleted on exit)"; } > "$EVID/summary.txt"
printf 'step\tstatus\texit\tnote\n' > "$EVID/steps.tsv"
n=0; fail=0
run() { # name expect_exit grep_regex cmd...
  local name=$1 want=$2 re=$3; shift 3; n=$((n+1)); local p; p=$(printf '%s/%02d-%s' "$EVID" $n "$name")
  printf '%q ' "$@" > "$p.cmd"; "$@" >"$p.stdout" 2>"$p.stderr"; local rc=$?; echo $rc > "$p.exit"
  local st=PASS note="exit $rc"
  [ "$rc" = "$want" ] || { st=FAIL; note="exit $rc, wanted $want"; }
  [ -n "$re" ] && ! grep -Eq "$re" "$p.stdout" && { st=FAIL; note="$note; stdout lacks /$re/"; }
  [ $st = FAIL ] && fail=1
  printf '%s\t%s\t%s\t%s\n' "$name" "$st" "$rc" "$note" >> "$EVID/steps.tsv"
}
I=(node tools/install.mjs)
for s in "${STEPS[@]}"; do case $s in
  doctor-fresh)  run doctor-fresh 1 'installed: the home does not exist' "${I[@]}" doctor ;;
  install)       run install 0 'Every check passes' "${I[@]}" install --source ./ --claude-home "$HOME/.claude"
                 cp "$HOME/.claude/plugins/installed_plugins.json" "$EVID/installed_plugins.json" 2>/dev/null ;;
  install-again) run install-again 0 '^No changes|0 changes|Every check passes' "${I[@]}" install --source ./ --claude-home "$HOME/.claude"
                 grep -q '^  - ' "$EVID/$(printf %02d $n)-install-again.stdout" && { fail=1; sed -i '$ s/\tPASS\t/\tFAIL\t/; $ s/$/; reran with changes (not idempotent)/' "$EVID/steps.tsv"; } ;;
  doctor)        run doctor 0 'ok +installed: ' "${I[@]}" doctor --source ./
                 run doctor-json 0 '"command": "doctor"' "${I[@]}" doctor --source ./ --json ;;
  validate-skills) run validate-skills 0 '' node tools/validate-skills.mjs plugins/pstack/skills ;;
  test)          run test 0 '' bun test tests/ --timeout 30000 ;;
  *) echo "unknown step $s" >&2; exit 2 ;;
esac; done
cat "$EVID/steps.tsv" >> "$EVID/summary.txt"; cat "$EVID/summary.txt"; echo "evidence: $EVID"
exit $fail
