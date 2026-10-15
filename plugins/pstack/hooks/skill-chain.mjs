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
//
// Devin reads Claude Code's hooks file, so it cannot pass its own name. It
// exports DEVIN_PLUGIN_ROOT and DEVIN_PROJECT_DIR instead, and its prompt hook
// input has no `cwd`; this hook reads both when they are set.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// A skill name starts with a letter, so `$5` and `$1,000` are not names.
const TOKEN = /(?<![^\s(`"'])([/$])([a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)?)(?![\w/:-])/g;
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
// Claude Code and Codex name a cache directory after the plugin it holds, in
// a marketplace/plugin/version nest. Devin nests source/version instead, so
// only its manifest holds the plugin's name.
const cache = (root, layout) => ({ root, layout });
const manifest = (root) => json(join(root, "plugin.json")).name ?? json(join(root, ".claude-plugin/plugin.json")).name ?? null;

// The active host's config homes, skill roots, project skill directories, and
// plugin caches. Devin runs this hook through Claude Code's hooks file, but
// reads `/name` too and keeps its skills and cache elsewhere, so it needs its
// own roots. Its cache wins there, then Claude Code's copy of a plugin, then
// Codex's.
export function hosts(runtime, env = process.env) {
  const home = homedir();
  const claudeHome = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const codexHome = env.CODEX_HOME || join(home, ".codex");
  const devinHome = env.DEVIN_CONFIG_DIR || join(home, ".config/devin");
  const cognitionHome = env.COGNITION_CONFIG_DIR || join(home, ".config/cognition");
  const agents = join(home, ".agents/skills");
  const claudeCache = cache(join(claudeHome, "plugins/cache"), "market");
  const codexCache = cache(join(codexHome, "plugins/cache"), "market");
  const devinCache = cache(env.DEVIN_PLUGIN_CACHE || join(home, ".local/share/devin/cli/plugins/cache"), "source");
  if (env.DEVIN_PLUGIN_ROOT || env.DEVIN_PROJECT_DIR) {
    return {
      runtime: "claude",
      sigil: "/",
      skillRoots: [join(devinHome, "skills"), join(cognitionHome, "skills"), agents, join(claudeHome, "skills"), join(codexHome, "skills")],
      projectSubdirs: [".devin/skills", ".cognition/skills", ".agents/skills", ".claude/skills"],
      caches: [devinCache, claudeCache, codexCache],
      settings: [],
    };
  }
  if (runtime === "codex") {
    return {
      runtime: "codex",
      sigil: "$",
      skillRoots: [join(codexHome, "skills"), agents, join(claudeHome, "skills")],
      projectSubdirs: [".codex/skills", ".agents/skills", ".claude/skills"],
      caches: [codexCache, claudeCache],
      settings: [],
    };
  }
  return {
    runtime: "claude",
    sigil: "/",
    skillRoots: [join(claudeHome, "skills"), agents, join(codexHome, "skills")],
    projectSubdirs: [".claude/skills", ".agents/skills"],
    caches: [claudeCache, codexCache],
    settings: [join(claudeHome, "settings.json")],
  };
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
  if (!host.settings.length) return new Set();
  const root = projects.at(-1);
  const files = [...host.settings, ...(root ? [join(root, ".claude/settings.json"), join(root, ".claude/settings.local.json")] : [])];
  const merged = Object.assign({}, ...files.map((f) => json(f).skillOverrides ?? {}));
  return new Set(Object.entries(merged).filter(([, v]) => v === "off").map(([k]) => k));
}

// Every plugin the caches hold, as `{ root, name }`, name being the plugin.
function cachePlugins({ root, layout }) {
  const found = [];
  if (layout === "source") {
    for (const source of dirs(root)) {
      for (const version of dirs(join(root, source))) {
        const at = join(root, source, version);
        found.push({ root: at, name: manifest(at) });
      }
    }
    return found;
  }
  for (const market of dirs(root)) {
    for (const plugin of dirs(join(root, market))) {
      for (const version of dirs(join(root, market, plugin))) {
        found.push({ root: join(root, market, plugin, version), name: plugin });
      }
    }
  }
  return found;
}

// Every installed plugin skill, walked once per prompt, under
// `<cache root>/<version root>/skills/<skill>/`. Keys are `<plugin>:<skill>` and
// `:<skill>`. The active host's cache wins, then the copy marked in use, then
// the newest.
function pluginIndex(host) {
  const index = new Map();
  for (const cache of host.caches) {
    const hits = new Map();
    for (const { root, name } of cachePlugins(cache)) {
      if (!name) continue;
      const inUse = existsSync(join(root, ".in_use"));
      for (const skill of dirs(join(root, "skills"))) {
        const path = file(join(root, "skills", skill, "SKILL.md"));
        if (!path) continue;
        const hit = { path, inUse, mtime: statSync(path).mtimeMs };
        for (const key of [`${name}:${skill}`, `:${skill}`]) hits.set(key, [...(hits.get(key) ?? []), hit]);
      }
    }
    for (const [key, list] of hits) {
      list.sort((a, b) => b.inUse - a.inUse || b.mtime - a.mtime);
      if (!index.has(key)) index.set(key, list[0].path);
    }
  }
  return index;
}

// Personal skills, then project skills, then this plugin, then other plugins:
// Claude Code's order, so a cloned repo cannot shadow a personal skill. A
// project skill counts only when its real path stays inside the directory that
// holds it, so a symlink cannot pull an outside file into context.
export function resolve(name, { cwd, pluginRoot, pluginName = "t3-pstack", host = hosts("claude"), cache = {} }) {
  const own = (skill) => (pluginRoot ? file(join(pluginRoot, "skills", skill, "SKILL.md")) : null);
  const plugins = () => (cache.plugins ??= pluginIndex(host));
  if (name.includes(":")) {
    const [plugin, skill] = name.split(":");
    return (plugin === pluginName && own(skill)) || plugins().get(name) || null;
  }
  const projects = (cache.projects ??= projectDirs(cwd));
  if ((cache.disabled ??= disabled(host, projects)).has(name)) return null;
  for (const root of host.skillRoots) {
    const path = file(join(root, name, "SKILL.md"));
    if (path) return path;
  }
  for (const dir of projects) {
    for (const sub of host.projectSubdirs) {
      const path = file(join(dir, sub, name, "SKILL.md"));
      if (path && inside(dir, path)) return path;
    }
  }
  return own(name) || plugins().get(`:${name}`) || null;
}

export function chain(prompt, options) {
  const host = options.host ?? hosts("claude");
  const text = prompt.replace(FENCE, (block) => " ".repeat(block.length));
  const seen = new Set();
  const steps = [];
  const cache = {};
  for (const m of text.matchAll(TOKEN)) {
    if (seen.has(m[2])) continue;
    const path = resolve(m[2], { ...options, host, cache });
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
    // Devin's hook input has no cwd, and Claude Code reads a project directory
    // from this file only when its prompt hook input lacks one too.
    const cwd = data.cwd ?? process.env.DEVIN_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? process.env.DEVIN_PLUGIN_ROOT;
    const context = chain(data.prompt ?? "", { cwd, pluginRoot, host });
    if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } }));
  } catch {
    // Fail open.
  }
}
