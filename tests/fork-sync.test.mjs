// tools/fork-sync.sh against a fake upstream. Both sides start from this
// checkout's HEAD, so the test needs no history (CI clones with depth 1). The
// fork side adds its own release and a file, the upstream side adds one
// change. SYNC_CHECKS=true skips the suite, so this test does not run itself.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" };

const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const read = (dir, path) => readFileSync(join(dir, path), "utf8");
const edit = (dir, path, from, to) => writeFileSync(join(dir, path), read(dir, path).replace(from, to));

// The release the fixture's fork has already made: one marker above what this
// checkout ships, so its CHANGES.md heading cannot collide with a real one and
// the merge still has a fork version of its own to preserve.
const forkRelease = (() => {
  const shipped = read(repoRoot, "VERSION").trim();
  const dotted = shipped.match(/^(.*\.)vraj\.(\d+)$/);
  if (dotted) return `${dotted[1]}vraj.${Number(dotted[2]) + 1}`;
  const dashed = shipped.match(/^(.*)-vraj\.(\d+)$/);
  return dashed ? `${dashed[1]}-vraj.${Number(dashed[2]) + 1}` : `${shipped}.vraj.1`;
})();

// `release` edits the upstream clone and commits it. The fork clone gets its
// own release, so VERSION conflicts and CHANGES.md merges as a union.
function fixture(release, forkEdit = () => {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fork-sync-")));
  const fork = join(root, "fork");
  const up = join(root, "up");
  // The fork's origin, whose main is the shared start, as the fork's GitHub
  // main is before a sync. The generator compares the hooks files with it.
  const origin = join(root, "origin.git");
  git(root, "clone", "-q", "--bare", repoRoot, origin);
  git(origin, "update-ref", "refs/heads/main", git(repoRoot, "rev-parse", "HEAD"));
  for (const dir of [fork, up]) git(root, "clone", "-q", "-b", "main", origin, dir);
  writeFileSync(join(fork, "VERSION"), `${forkRelease}\n`);
  edit(fork, "CHANGES.md", "\n## ", `\n## ${forkRelease} - fork change\n\nFork entry.\n\n## `);
  writeFileSync(join(fork, "fork.txt"), "fork\n");
  forkEdit(fork);
  git(fork, "add", "-A");
  git(fork, "commit", "-qm", "fork change");
  if (release) {
    release(up);
    git(up, "commit", "-qam", "upstream change");
  }
  return { root, fork, up, report: join(root, "report.md") };
}

function sync(f, checks = "true") {
  const r = spawnSync("bash", ["tools/fork-sync.sh"], {
    cwd: f.fork,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV, UPSTREAM_URL: f.up, SYNC_REPORT: f.report, SYNC_CHECKS: checks },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

const bump = (version) => (up) => {
  writeFileSync(join(up, "VERSION"), `${version}\n`);
  edit(up, "CHANGES.md", "\n## ", `\n## ${version} - test release\n\nTest entry.\n\n## `);
};

describe("fork-sync.sh", () => {
  test("an upstream prerelease becomes <version>.vraj.1 everywhere", () => {
    const f = fixture(bump("2.0.0-rc.6"));
    const { status, out } = sync(f);
    expect(status, out).toBe(0);
    expect(read(f.fork, "VERSION").trim()).toBe("2.0.0-rc.6.vraj.1");
    expect(JSON.parse(read(f.fork, "package.json")).version).toBe("2.0.0-rc.6.vraj.1");
    expect(read(f.fork, "README.md")).toContain("npx -y github:vraj-ai/t3-pstack#v2.0.0-rc.6.vraj.1 install");
    const changes = read(f.fork, "CHANGES.md");
    for (const heading of ["## 2.0.0-rc.6.vraj.1 - ", "## 2.0.0-rc.6 - test release", `## ${forkRelease} - fork change`]) expect(changes).toContain(heading);
    expect(read(f.fork, "fork.txt")).toBe("fork\n");
    expect(git(f.fork, "rev-list", "--parents", "-n", "1", "HEAD").split(" ")).toHaveLength(3);
    expect(git(f.fork, "status", "--porcelain")).toBe("");
  }, 120_000);

  test("a stable upstream release becomes <version>-vraj.1", () => {
    const f = fixture(bump("2.0.0"));
    const { status, out } = sync(f);
    expect(status, out).toBe(0);
    expect(read(f.fork, "VERSION").trim()).toBe("2.0.0-vraj.1");
    expect(Bun.semver.order("2.0.0-vraj.1", "2.0.0-rc.6.vraj.1")).toBe(1);
    expect(Bun.semver.order("2.0.1-vraj.1", "2.0.0-vraj.1")).toBe(1);
  }, 120_000);

  test("a conflict outside the version files resets and reports", () => {
    const line = "t3-pstack works only inside T3.\n";
    const f = fixture(
      (up) => edit(up, "README.md", line, "t3-pstack works only inside T3, upstream says.\n"),
      (fork) => edit(fork, "README.md", line, "t3-pstack works only inside T3, the fork says.\n"),
    );
    const head = git(f.fork, "rev-parse", "HEAD");
    const { status } = sync(f);
    expect(status).toBe(1);
    expect(read(f.root, "report.md")).toContain("conflicts in `README.md`");
    expect(git(f.fork, "rev-parse", "HEAD")).toBe(head);
    expect(git(f.fork, "status", "--porcelain")).toBe("");
  }, 120_000);

  test("failed checks reset and report", () => {
    const f = fixture(bump("2.0.0-rc.6"));
    const head = git(f.fork, "rev-parse", "HEAD");
    const { status } = sync(f, "echo 'FAIL: broken'; exit 1");
    expect(status).toBe(1);
    expect(read(f.root, "report.md")).toContain("FAIL: broken");
    expect(git(f.fork, "rev-parse", "HEAD")).toBe(head);
  }, 120_000);

  test("a dirty checkout is refused and left alone", () => {
    const f = fixture(bump("2.0.0-rc.6"));
    writeFileSync(join(f.fork, "scratch.txt"), "mine");
    const { status } = sync(f);
    expect(status).toBe(1);
    expect(read(f.root, "report.md")).toContain("uncommitted changes");
    expect(existsSync(join(f.fork, "scratch.txt"))).toBe(true);
  }, 120_000);

  test("nothing new upstream changes nothing", () => {
    const f = fixture(null);
    const head = git(f.fork, "rev-parse", "HEAD");
    const { status, out } = sync(f);
    expect(status, out).toBe(0);
    expect(out).toContain("already contains upstream");
    expect(git(f.fork, "rev-parse", "HEAD")).toBe(head);
  }, 120_000);
});
