#!/usr/bin/env node
// UserPromptSubmit hook: load every skill a prompt names, in prompt order.
//
// Claude Code and Codex expand only a leading `/skill` or `$skill`. A later
// `/how` or `$why` is plain text. This hook finds every `/name`,
// `/plugin:name`, and `$name` that resolves to an installed SKILL.md and tells
// the agent to read them in order. A token that resolves to nothing (`/tmp`,
// `$HOME`) is ignored. One skill at the very start is already expanded, so the
// hook prints nothing then. Any failure prints nothing: the prompt goes through
// unchanged.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = /(?<![^\s(`"'])[/$]([a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?)(?![\w/:-])/g;

const file = (path) => {
  try {
    return statSync(path).isFile() ? realpathSync(path) : null;
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

// Every installed copy of a plugin's skill, under `<cache>/<marketplace>/<plugin>/<version>/skills/`.
// The copy marked in use wins, then the newest.
function cachedSkill(plugin, skill) {
  const home = homedir();
  const hits = [];
  for (const cache of [join(home, ".claude/plugins/cache"), join(home, ".codex/plugins/cache")]) {
    for (const market of dirs(cache)) {
      for (const name of plugin ? [plugin] : dirs(join(cache, market))) {
        for (const version of dirs(join(cache, market, name))) {
          const root = join(cache, market, name, version);
          const path = file(join(root, "skills", skill, "SKILL.md"));
          if (path) hits.push({ path, inUse: existsSync(join(root, ".in_use")), mtime: statSync(path).mtimeMs });
        }
      }
    }
  }
  hits.sort((a, b) => b.inUse - a.inUse || b.mtime - a.mtime);
  return hits[0]?.path ?? null;
}

export function resolve(name, { cwd, pluginRoot, pluginName = "t3-pstack" }) {
  const own = (skill) => (pluginRoot ? file(join(pluginRoot, "skills", skill, "SKILL.md")) : null);
  if (name.includes(":")) {
    const [plugin, skill] = name.split(":");
    return (plugin === pluginName && own(skill)) || cachedSkill(plugin, skill);
  }
  const home = homedir();
  const roots = [
    ...(cwd ? [".claude/skills", ".agents/skills"].map((d) => join(cwd, d)) : []),
    ...[".claude/skills", ".agents/skills", ".codex/skills"].map((d) => join(home, d)),
  ];
  for (const root of roots) {
    const path = file(join(root, name, "SKILL.md"));
    if (path) return path;
  }
  return own(name) || cachedSkill(null, name);
}

export function chain(prompt, options) {
  const seen = new Set();
  const steps = [];
  for (const m of prompt.matchAll(TOKEN)) {
    if (seen.has(m[1])) continue;
    const path = resolve(m[1], options);
    if (!path) continue;
    seen.add(m[1]);
    steps.push({ token: m[0], path, at: m.index });
  }
  if (!steps.length || (steps.length === 1 && !prompt.slice(0, steps[0].at).trim())) return null;
  return [
    "Skill chain. The user named these skills, in this order:",
    ...steps.map((s, i) => `${i + 1}. \`${s.token}\`: ${s.path}`),
    "Read each SKILL.md above in full, in this order, before you act. A skill already expanded in this message counts as read.",
    "Then run the user's steps in the same order. The words after each name are that step's instructions.",
    "Each skill's directory is its base directory for relative paths. A skill that pauses for the user still pauses. Continue the chain after the user answers.",
  ].join("\n");
}

const isMain = import.meta.main ?? (process.argv[1] !== undefined && file(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)));
if (isMain) {
  try {
    const data = JSON.parse(readFileSync(0, "utf8"));
    const context = chain(data.prompt ?? "", { cwd: data.cwd ?? process.cwd(), pluginRoot: process.env.CLAUDE_PLUGIN_ROOT });
    if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } }));
  } catch {
    // Fail open.
  }
}
