#!/usr/bin/env node
// UserPromptSubmit hook: load every skill a prompt names, in prompt order.
//
// Claude Code expands only a leading `/skill`, and Codex only a leading
// `$skill`. Any later name is plain text. This hook finds every `/name`,
// `/plugin:name`, and `$name` that resolves to an installed SKILL.md and adds
// the list, in prompt order, to the turn's context. A token that resolves to
// nothing (`/tmp`, `$HOME`) is ignored, and so is text inside fenced code
// blocks. One leading skill in the host's own syntax is already expanded, so
// the hook prints nothing then. Any failure prints nothing, and the prompt
// goes through unchanged.
//
// Usage (hooks file): node "${CLAUDE_PLUGIN_ROOT}/hooks/skill-chain.mjs" <claude|codex>

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = /(?<![^\s(`"'])([/$])([a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?)(?![\w/:-])/g;
const FENCE = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\S\n]*$/gm;

const file = (path) => {
  try {
    return statSync(path).isFile() ? realpathSync(path) : null;
  } catch {
    return null;
  }
};
const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};
const dirs = (path) => {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name);
  } catch {
    return [];
  }
};
const json = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
};
const inside = (dir, path) => {
  const rel = relative(dir, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

// The active host's config home first, the other host's second.
export function hosts(runtime, env = process.env) {
  const claude = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const codex = env.CODEX_HOME || join(homedir(), ".codex");
  return runtime === "codex" ? { runtime, sigil: "$", homes: [codex, claude] } : { runtime: "claude", sigil: "/", homes: [claude, codex] };
}

// The start directory and each parent up to the repository root, nearest first,
// as Claude Code reads project skills. Without a repository, the start directory only.
export function projectDirs(cwd) {
  const start = cwd ? real(cwd) : null;
  if (!start) return [];
  const chain = [];
  for (let dir = start; ; dir = dirname(dir)) {
    chain.push(dir);
    if (existsSync(join(dir, ".git"))) return chain;
    if (dirname(dir) === dir) return [start];
  }
}

// Skills turned off with `skillOverrides` in Claude Code's user, project, and
// local settings, later files winning. Plugin skills ignore this setting.
function disabled(host, projects) {
  if (host.runtime !== "claude") return new Set();
  const root = projects.at(-1);
  const files = [join(host.homes[0], "settings.json"), ...(root ? [join(root, ".claude/settings.json"), join(root, ".claude/settings.local.json")] : [])];
  const merged = Object.assign({}, ...files.map((f) => json(f).skillOverrides ?? {}));
  return new Set(Object.entries(merged).filter(([, v]) => v === "off").map(([k]) => k));
}

// An installed plugin's skill, under `<home>/plugins/cache/<marketplace>/<plugin>/<version>/skills/`.
// The active host's cache wins, then the copy marked in use, then the newest.
function cachedSkill(host, plugin, skill) {
  for (const home of host.homes) {
    const cache = join(home, "plugins/cache");
    const hits = [];
    for (const market of dirs(cache)) {
      for (const name of plugin ? [plugin] : dirs(join(cache, market))) {
        for (const version of dirs(join(cache, market, name))) {
          const root = join(cache, market, name, version);
          const path = file(join(root, "skills", skill, "SKILL.md"));
          if (path) hits.push({ path, inUse: existsSync(join(root, ".in_use")), mtime: statSync(path).mtimeMs });
        }
      }
    }
    hits.sort((a, b) => b.inUse - a.inUse || b.mtime - a.mtime);
    if (hits.length) return hits[0].path;
  }
  return null;
}

// Personal skills, then project skills, then this plugin, then other plugins:
// Claude Code's order, so a cloned repo cannot shadow a personal skill. A
// project skill counts only when its real path stays inside the directory that
// holds it, so a symlink cannot pull an outside file into context.
export function resolve(name, { cwd, pluginRoot, pluginName = "t3-pstack", host = hosts("claude") }) {
  const own = (skill) => (pluginRoot ? file(join(pluginRoot, "skills", skill, "SKILL.md")) : null);
  if (name.includes(":")) {
    const [plugin, skill] = name.split(":");
    return (plugin === pluginName && own(skill)) || cachedSkill(host, plugin, skill);
  }
  const projects = projectDirs(cwd);
  if (disabled(host, projects).has(name)) return null;
  for (const root of [join(host.homes[0], "skills"), join(homedir(), ".agents/skills"), join(host.homes[1], "skills")]) {
    const path = file(join(root, name, "SKILL.md"));
    if (path) return path;
  }
  for (const dir of projects) {
    for (const sub of [".claude/skills", ".agents/skills"]) {
      const path = file(join(dir, sub, name, "SKILL.md"));
      if (path && inside(dir, path)) return path;
    }
  }
  return own(name) || cachedSkill(host, null, name);
}

export function chain(prompt, options) {
  const host = options.host ?? hosts("claude");
  const text = prompt.replace(FENCE, (block) => " ".repeat(block.length));
  const seen = new Set();
  const steps = [];
  for (const m of text.matchAll(TOKEN)) {
    if (seen.has(m[2])) continue;
    const path = resolve(m[2], { ...options, host });
    if (!path) continue;
    seen.add(m[2]);
    steps.push({ token: m[0], sigil: m[1], path, at: m.index });
  }
  const leadingNative = steps.length === 1 && steps[0].sigil === host.sigil && !text.slice(0, steps[0].at).trim();
  if (!steps.length || leadingNative) return null;
  const load =
    host.runtime === "claude"
      ? "Invoke each with the Skill tool, in this order, passing the words after its name as its arguments. If the Skill tool refuses one because only the user may invoke it, the user just did by naming it, so Read its SKILL.md in full instead. A skill already expanded in this message counts as invoked."
      : "Read each SKILL.md above in full, in this order, before you act. A skill already expanded in this message counts as read.";
  return [
    "Skill chain. The user's prompt names these skills, in this order:",
    ...steps.map((s, i) => `${i + 1}. \`${s.token}\`: ${s.path}`),
    load,
    "Run the user's steps in the same order. The words after each name are that step's instructions. A name that appears only inside quoted or pasted material is not a request, so skip it.",
    "Each skill's directory is its base directory for relative paths. A skill that pauses for the user still pauses. Continue the chain after the user answers.",
  ].join("\n");
}

const isMain = import.meta.main ?? (process.argv[1] !== undefined && file(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)));
if (isMain) {
  try {
    const data = JSON.parse(readFileSync(0, "utf8"));
    const host = hosts(process.argv[2]);
    const context = chain(data.prompt ?? "", { cwd: data.cwd ?? process.cwd(), pluginRoot: process.env.CLAUDE_PLUGIN_ROOT, host });
    if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } }));
  } catch {
    // Fail open.
  }
}
