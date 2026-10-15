// OpenCode prompt hook: load every skill a prompt names, in prompt order.
//
// Claude Code expands only a leading `/skill` and Codex only a leading
// `$skill`; OpenCode expands none of them, and a prompt that names two skills
// gets neither. OpenCode does advertise its skills to the model (an
// `<available_skills>` block in the system prompt, each with an id the `skill`
// tool accepts), so this plugin reads that block, matches the names the prompt
// used, and adds one system entry listing them in prompt order.
//
// Install: copy to `~/.config/opencode/plugins/` (the directory OpenCode scans
// for local plugins). Any failure prints nothing and the prompt goes through
// unchanged.
//
// The plugin API here is OpenCode v2's: a plugin default-exports
// `{ id, setup(context) }`, and `context.session.hook("context", callback)`
// receives the system prompt and messages for each model call. Mutating
// `input.system` is what reaches the model.

// A skill name starts with a letter, so `$5` and `$1,000` are not names.
const TOKEN = /(?<![^\s(`"'])([/$])([a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)?)(?![\w/:-])/g;
const FENCE = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\S\n]*$/gm;
const BLOCK = /<available_skills>[\s\S]*?<\/available_skills>/g;
const ENTRY = /<skill>[\s\S]*?<\/skill>/g;
const TAG = (name) => new RegExp(`<${name}>([^<]*)</${name}>`);

// Every skill OpenCode advertises, as candidate name -> id. Both the id and
// the display name resolve, so `/pstack-how` and `/how` find the same skill
// when either is what the block carries.
export function index(system) {
  const found = new Map();
  for (const text of (system ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.text ?? ""))) {
    for (const block of text.match(BLOCK) ?? []) {
      for (const entry of block.match(ENTRY) ?? []) {
        const id = entry.match(TAG("id"))?.[1]?.trim();
        const name = entry.match(TAG("name"))?.[1]?.trim();
        if (!id) continue;
        found.set(id, id);
        if (name) found.set(name, id);
      }
    }
  }
  return found;
}

// The names a prompt used, in prompt order, deduplicated. Fenced code is not
// a request, so it is blanked out before the scan.
export function tokens(prompt) {
  const text = String(prompt ?? "").replace(FENCE, (block) => " ".repeat(block.length));
  const seen = new Set();
  const found = [];
  for (const match of text.matchAll(TOKEN)) {
    if (seen.has(match[2])) continue;
    seen.add(match[2]);
    found.push({ token: match[0], name: match[2], sigil: match[1], at: match.index });
  }
  return found;
}

// The chain for a prompt, or null when it names no advertised skill. A name
// carries an optional `plugin:` prefix, which OpenCode's ids do not, so the
// last segment is tried when the whole name misses.
export function chainFor(prompt, skills) {
  const steps = [];
  for (const found of tokens(prompt)) {
    const id = skills.get(found.name) ?? (found.name.includes(":") ? skills.get(found.name.split(":").pop()) : undefined);
    if (id) steps.push({ token: found.token, id, sigil: found.sigil, at: found.at });
  }
  const text = String(prompt ?? "").replace(FENCE, (block) => " ".repeat(block.length));
  const leadingNative = steps.length === 1 && steps[0].sigil === "/" && !text.slice(0, steps[0].at).trim();
  if (!steps.length || leadingNative) return null;
  return [
    "Skill chain. The user's prompt names these skills, in this order:",
    ...steps.map((step, i) => `${i + 1}. \`${step.token}\`: ${step.id}`),
    "Invoke each with the skill tool, in this order, passing the words after its name as its arguments. A skill already loaded in this session counts as invoked.",
    "Run the user's steps in the same order. The words after each name are that step's instructions. A name that appears only inside quoted or pasted material is not a request, so skip it.",
    "A skill that pauses for the user still pauses. Continue the chain after the user answers.",
  ].join("\n");
}

// The last user message in the model call, which is the one the chain belongs
// to. `input.messages` is a flat list: { id, role, content: [{ type, text }] }.
function lastUser(messages) {
  const message = [...(messages ?? [])].reverse().find((m) => m?.role === "user");
  if (!message) return null;
  const text = (message.content ?? []).filter((part) => part?.type === "text").map((part) => part.text ?? "").join("\n");
  return text.trim() ? { id: message.id, text } : null;
}

const server = (context) => {
  // One entry per user message: a prompt's own turn can call the model several
  // times as it uses tools, and the chain belongs to the message, not the call.
  const injected = new Map();
  const hook = context?.session?.hook;
  if (typeof hook !== "function") return;
  hook("context", async (input) => {
    try {
      const message = lastUser(input?.messages);
      if (!message || injected.get(input.sessionID) === message.id) return;
      const chain = chainFor(message.text, index(input.system));
      if (!chain) return;
      injected.set(input.sessionID, message.id);
      input.system.push({ type: "text", text: chain });
    } catch {
      // Fail open: the prompt goes through unchanged.
    }
  });
};

export default { id: "t3-pstack.skill-chain", setup: server };
