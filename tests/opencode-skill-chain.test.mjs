// The OpenCode plugin: OpenCode expands no `/name` in a prompt, so the plugin
// reads the skill index OpenCode already advertises in the system prompt and
// adds one system entry naming the skills the prompt asked for, in order.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN = join(import.meta.dir, "../plugins/pstack/opencode/skill-chain.js");
const { default: plugin, index, tokens, chainFor } = await import(PLUGIN);

const system = () => [
  { type: "text", text: "You are an agent." },
  {
    type: "text",
    text: [
      "Skills provide specialized instructions.",
      "<available_skills>",
      "  <skill>",
      "    <id>grill</id>",
      "    <name>grill</name>",
      "    <description>Clarify an ambiguous feature.</description>",
      "  </skill>",
      "  <skill>",
      "    <id>claude-how</id>",
      "    <name>how</name>",
      "    <description>Explain how a subsystem works.</description>",
      "  </skill>",
      "  <skill>",
      "    <id>ship</id>",
      "    <name>ship</name>",
      "    <description>Deliver a ticket.</description>",
      "  </skill>",
      "</available_skills>",
    ].join("\n"),
  },
];

// A stand-in for OpenCode's plugin context: it hands the plugin's hook back.
function fakeContext() {
  const hooks = new Map();
  const context = { session: { hook: (name, cb) => hooks.set(name, cb) } };
  plugin.setup(context);
  return { context, run: (input) => hooks.get("context")(input) };
}

const user = (id, text) => ({ id, role: "user", content: [{ type: "text", text }], metadata: {} });

describe("opencode skill-chain plugin", () => {
  test("reads the advertised skills by id and by name", () => {
    const skills = index(system());
    expect(skills.get("grill")).toBe("grill");
    expect(skills.get("how")).toBe("claude-how");
    expect(skills.get("ship")).toBe("ship");
    expect(skills.get("nope")).toBeUndefined();
  });

  test("reads the names a prompt used, in order", () => {
    expect(tokens("then /grill and /how, and /grill").map((t) => t.name)).toEqual(["grill", "how"]);
    expect(tokens("it costs $5, maybe $1,000").map((t) => t.name)).toEqual([]);
    expect(tokens("read /tmp/x, $HOME, then /ship").map((t) => t.name)).toEqual(["ship"]);
    expect(tokens("```\n/grill\n```\n then /how").map((t) => t.name)).toEqual(["how"]);
  });

  test("names the named skills in prompt order, and skips unknown ones", () => {
    const chain = chainFor("then /grill, /nope, and /how", index(system()));
    expect(chain).toContain("1. `/grill`: grill");
    expect(chain).toContain("2. `/how`: claude-how");
    expect(chain).toContain("skill tool");
    expect(chain).not.toContain("nope");
  });

  test("a plugin: prefix resolves through the skill name", () => {
    const chain = chainFor("first think, then /t3-pstack:how", index(system()));
    expect(chain).toContain("`/t3-pstack:how`: claude-how");
  });

  test("stays silent for one leading skill, and for no known skill", () => {
    expect(chainFor("/grill me on the export feature", index(system()))).toBeNull();
    expect(chainFor("no skills here", index(system()))).toBeNull();
    expect(chainFor("first think, then /grill me", index(system()))).not.toBeNull();
  });

  test("adds the chain to the system prompt once per user message", async () => {
    const { run } = fakeContext();
    const input = { sessionID: "ses_1", messages: [user("msg_1", "then /grill and /how")], system: system() };
    const before = input.system.length;
    await run(input);
    expect(input.system.length).toBe(before + 1);
    expect(input.system.at(-1).text).toContain("`/how`: claude-how");

    // A tool call in the same turn re-sends the same message: no second entry.
    await run(input);
    expect(input.system.length).toBe(before + 1);

    // A new user message gets its own chain.
    const next = { sessionID: "ses_1", messages: [user("msg_2", "then /ship")], system: system() };
    await run(next);
    expect(next.system.at(-1).text).toContain("`/ship`: ship");
  });

  test("leaves a prompt with no named skill alone", async () => {
    const { run } = fakeContext();
    const input = { sessionID: "ses_2", messages: [user("msg_3", "fix the bug")], system: system() };
    await run(input);
    expect(input.system.length).toBe(2);
  });

  test("fails open on a context or input it cannot use", async () => {
    expect(() => plugin.setup({})).not.toThrow();
    const { run } = fakeContext();
    for (const input of [undefined, {}, { sessionID: "s", system: [] }, { messages: [{ role: "user", content: [] }] }]) {
      await run(input);
    }
    expect(true).toBe(true);
  });

  test("ships an id OpenCode can load", () => {
    expect(plugin.id).toBe("t3-pstack.skill-chain");
    expect(typeof plugin.setup).toBe("function");
    expect(readFileSync(PLUGIN, "utf8")).toContain('hook("context"');
  });
});
