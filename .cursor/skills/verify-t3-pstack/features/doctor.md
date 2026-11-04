# Doctor

`doctor` reports, without changing anything, each home's marketplace source, installed version, file completeness, enablement, Codex hook trust, stale records, plain skill copies and the model sheet; it exits 1 on any failed check.

## Sub-features

- `doctor-missing` empty home → `FAIL installed: the home does not exist`, exit 1.
- `doctor-healthy` after install with matching `--source` → exit 0.
- `doctor-source-mismatch` local install checked without `--source` → exit 1.
- `doctor-json` `--json` emits a machine-readable report.

## How to get to it (user POV)

- `npx -y github:chhoumann/t3-pstack doctor`
- Locally: `node tools/install.mjs doctor [--source <dir>] [--json]`

## Driving it with verify.sh

Preconditions: isolated HOME.

- **Missing.** `scripts/verify.sh doctor-fresh` → exit 1 and the missing-home line.
- **Healthy.** `scripts/verify.sh install doctor` → `doctor` and `doctor-json` PASS, `ok    installed: <VERSION>`.
- **Mismatch.** After install, `node tools/install.mjs doctor` → exit 1, `marketplace: ... which is neither chhoumann/t3-pstack nor --source`.

## Gotchas

- Model sheet missing is a `warn`, not a failure.
- `--help` is not supported (`Unknown option`).
