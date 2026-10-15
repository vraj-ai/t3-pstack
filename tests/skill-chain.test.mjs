import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "../plugins/pstack/hooks/skill-chain.mjs");

function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "skill-chain-")));
  const skill = (dir) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: x\n---\n");
    return join(dir, "SKILL.md");
  };
  skill(join(home, ".claude/skills/pstack-recall"));
  skill(join(home, ".agents/skills/grill"));
  skill(join(home, ".agents/skills/issues"));
  const plugin = join(home, "plugin");
  const how = skill(join(plugin, "skills/how"));
  skill(join(plugin, "skills/poteto-mode"));
  const old = skill(join(home, ".claude/plugins/cache/other/thermos/1.0.0/skills/review"));
  utimesSync(old, 0, 0);
  const review = skill(join(home, ".claude/plugins/cache/other/thermos/1.1.0/skills/review"));
  return { home, plugin, how, review };
}

function run({ home, plugin }, prompt) {
  const out = Bun.spawnSync(["node", HOOK], {
    stdin: new TextEncoder().encode(JSON.stringify({ prompt, cwd: home })),
    env: { ...process.env, HOME: home, CLAUDE_PLUGIN_ROOT: plugin },
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
  });

  test("ignores paths, unknown names, and repeats", () => {
    const f = fixture();
    const context = run(f, "/grill me. read /tmp/x and ../grill/SKILL.md, $HOME, /nope, and /grill again. /issues.");
    expect(order(context)).toEqual(["/grill", "/issues"]);
  });

  test("prints nothing for one leading skill or none", () => {
    const f = fixture();
    expect(run(f, "/grill me on the export feature")).toBeNull();
    expect(run(f, "no skills here")).toBeNull();
    expect(run(f, "first think, then /grill me")).not.toBeNull();
  });

  test("a project skill cannot shadow a user skill or escape the project", () => {
    const f = fixture();
    const project = join(f.home, "repo");
    const userGrill = join(f.home, ".agents/skills/grill/SKILL.md");
    mkdirSync(join(project, ".claude/skills/grill"), { recursive: true });
    writeFileSync(join(project, ".claude/skills/grill/SKILL.md"), "shadow");
    mkdirSync(join(project, ".claude/skills/local"), { recursive: true });
    writeFileSync(join(project, ".claude/skills/local/SKILL.md"), "ok");
    mkdirSync(join(project, ".claude/skills/leak"), { recursive: true });
    writeFileSync(join(f.home, "secret"), "x");
    symlinkSync(join(f.home, "secret"), join(project, ".claude/skills/leak/SKILL.md"));
    const out = Bun.spawnSync(["node", HOOK], {
      stdin: new TextEncoder().encode(JSON.stringify({ prompt: "then /grill, /local, and /leak", cwd: project })),
      env: { ...process.env, HOME: f.home, CLAUDE_PLUGIN_ROOT: f.plugin },
    });
    const context = JSON.parse(out.stdout.toString()).hookSpecificOutput.additionalContext;
    expect(order(context)).toEqual(["/grill", "/local"]);
    expect(context).toContain(userGrill);
    expect(context).not.toContain(join(f.home, "secret"));
  });

  test("fails open on bad input", () => {
    const out = Bun.spawnSync(["node", HOOK], { stdin: new TextEncoder().encode("not json") });
    expect(out.exitCode).toBe(0);
    expect(out.stdout.toString()).toBe("");
  });
});
