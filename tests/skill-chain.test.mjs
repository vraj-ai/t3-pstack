import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const HOOK = join(import.meta.dir, "../plugins/pstack/hooks/skill-chain.mjs");

const write = (path, text = "---\nname: x\n---\n") => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
};

function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "skill-chain-")));
  write(join(home, ".claude/skills/pstack-recall/SKILL.md"));
  const grill = write(join(home, ".agents/skills/grill/SKILL.md"));
  write(join(home, ".agents/skills/issues/SKILL.md"));
  const plugin = join(home, "plugin");
  const how = write(join(plugin, "skills/how/SKILL.md"));
  write(join(plugin, "skills/poteto-mode/SKILL.md"));
  const old = write(join(home, ".claude/plugins/cache/other/thermos/1.0.0/skills/review/SKILL.md"));
  utimesSync(old, 0, 0);
  const review = write(join(home, ".claude/plugins/cache/other/thermos/1.1.0/skills/review/SKILL.md"));
  const codexReview = write(join(home, ".codex/plugins/cache/other/thermos/9.0.0/skills/review/SKILL.md"));
  const repo = join(home, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  return { home, plugin, how, grill, review, codexReview, repo };
}

function run(f, prompt, { runtime = "claude", cwd = f.home, env = {} } = {}) {
  const out = Bun.spawnSync(["node", HOOK, runtime], {
    stdin: new TextEncoder().encode(JSON.stringify({ prompt, cwd })),
    env: { ...process.env, CLAUDE_CONFIG_DIR: "", CODEX_HOME: "", HOME: f.home, CLAUDE_PLUGIN_ROOT: f.plugin, ...env },
  });
  expect(out.exitCode).toBe(0);
  const text = out.stdout.toString();
  return text ? JSON.parse(text).hookSpecificOutput.additionalContext : null;
}

const order = (context) => context.split("\n").filter((l) => /^\d+\. /.test(l)).map((l) => l.split("`")[1]);

describe("skill-chain hook", () => {
  test("lists every named skill in prompt order", () => {
    const f = fixture();
    const context = run(f, "/pstack-recall past work. then /grill me with /t3-pstack:how, /thermos:review, /issues, and $poteto-mode.");
    expect(order(context)).toEqual(["/pstack-recall", "/grill", "/t3-pstack:how", "/thermos:review", "/issues", "$poteto-mode"]);
    expect(context).toContain(f.how);
    expect(context).toContain(f.review);
    expect(context).toContain("Skill tool");
  });

  test("ignores paths, unknown names, repeats, and fenced code", () => {
    const f = fixture();
    const context = run(f, "/grill me. read /tmp/x and ../grill/SKILL.md, $HOME, /nope, and /grill again.\n```\nrun /pstack-recall\n```\n/issues.");
    expect(order(context)).toEqual(["/grill", "/issues"]);
  });

  test("stays silent only for one leading skill in the host's own syntax", () => {
    const f = fixture();
    expect(run(f, "/grill me on the export feature")).toBeNull();
    expect(run(f, "no skills here")).toBeNull();
    expect(run(f, "first think, then /grill me")).not.toBeNull();
    expect(run(f, "$grill me")).not.toBeNull();
    expect(run(f, "$grill me", { runtime: "codex" })).toBeNull();
    expect(run(f, "/grill me", { runtime: "codex" })).not.toBeNull();
  });

  test("Codex reads files and prefers its own plugin cache", () => {
    const f = fixture();
    const context = run(f, "then /thermos:review", { runtime: "codex" });
    expect(context).toContain(f.codexReview);
    expect(context).toContain("Read each SKILL.md");
  });

  test("reads skills from a custom config home", () => {
    const f = fixture();
    const custom = join(f.home, "custom-claude");
    const skill = write(join(custom, "skills/deploy/SKILL.md"));
    expect(run(f, "then /deploy", { env: { CLAUDE_CONFIG_DIR: custom } })).toContain(skill);
  });

  test("finds project skills from a subdirectory, below personal skills", () => {
    const f = fixture();
    write(join(f.repo, ".claude/skills/grill/SKILL.md"), "shadow");
    const local = write(join(f.repo, ".claude/skills/local/SKILL.md"));
    const sub = join(f.repo, "packages/web");
    mkdirSync(sub, { recursive: true });
    const context = run(f, "then /grill and /local", { cwd: sub });
    expect(order(context)).toEqual(["/grill", "/local"]);
    expect(context).toContain(f.grill);
    expect(context).toContain(local);
  });

  test("a project skill cannot escape the project by symlink", () => {
    const f = fixture();
    write(join(f.home, "secret"), "x");
    mkdirSync(join(f.repo, ".claude/skills/leak"), { recursive: true });
    symlinkSync(join(f.home, "secret"), join(f.repo, ".claude/skills/leak/SKILL.md"));
    expect(run(f, "then /grill and /leak", { cwd: f.repo })).not.toContain(join(f.home, "secret"));
  });

  test("skips skills turned off in Claude Code settings", () => {
    const f = fixture();
    write(join(f.home, ".claude/settings.json"), JSON.stringify({ skillOverrides: { issues: "off" } }));
    write(join(f.repo, ".claude/settings.local.json"), JSON.stringify({ skillOverrides: { grill: "off", issues: "on" } }));
    const context = run(f, "then /grill, /issues, and /pstack-recall", { cwd: f.repo });
    expect(order(context)).toEqual(["/issues", "/pstack-recall"]);
  });

  test("prices are not names, and many unknown names stay fast", () => {
    const f = fixture();
    expect(order(run(f, "it costs $5, maybe $1,000. then /grill and /issues"))).toEqual(["/grill", "/issues"]);
    const unknown = Array.from({ length: 500 }, (_, i) => `/nope${"abcdefghij"[i % 10]}${i}`).join(" ");
    const start = performance.now();
    expect(order(run(f, `${unknown} then /grill`))).toEqual(["/grill"]);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  test("fails open on bad input", () => {
    const out = Bun.spawnSync(["node", HOOK, "claude"], { stdin: new TextEncoder().encode("not json") });
    expect(out.exitCode).toBe(0);
    expect(out.stdout.toString()).toBe("");
  });
});
