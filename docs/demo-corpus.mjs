#!/usr/bin/env node
/**
 * Builds a synthetic transcript corpus for the README demo.
 *
 * Everything here is fabricated. The demo must never be recorded against real
 * transcripts: those carry working directory paths, project names, and the
 * handles of anyone who shares the machine, none of which can be published.
 *
 * The corpus is shaped for the story the diff feature tells: two runs of the
 * SAME task that share an opening and then part ways, one landing it cheaply and
 * one thrashing. Real corpora rarely contain that pair on purpose.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("usage: demo-corpus.mjs <projects-dir>");
  process.exit(1);
}

const NOW = Date.now();
const minutesAgo = (m) => new Date(NOW - m * 60_000);

let uuidCounter = 0;
const nextUuid = () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`;

function usage(input, output, cacheRead, cacheCreation) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
  };
}

/**
 * Turn a compact step list into transcript records. Each step is either prose,
 * a tool call, or an edit result; the reader treats those three shapes very
 * differently, so a believable corpus needs all of them.
 */
function records(steps, { cwd, model, branch }) {
  const lines = [];
  let parent = null;
  for (const step of steps) {
    const uuid = nextUuid();
    const timestamp = step.at.toISOString();
    const base = { uuid, timestamp, cwd, version: "2.1.4", gitBranch: branch };
    if (step.role === "user") {
      lines.push({
        ...base,
        type: "user",
        parentUuid: parent,
        message: { role: "user", content: step.text },
      });
    } else if (step.role === "edit") {
      lines.push({
        ...base,
        type: "user",
        parentUuid: parent,
        message: { role: "user", content: [] },
        toolUseResult: {
          filePath: step.file,
          structuredPatch: [
            {
              lines: [
                ...Array.from({ length: step.added }, (_, i) => `+line ${i}`),
                ...Array.from({ length: step.removed }, (_, i) => `-line ${i}`),
              ],
            },
          ],
        },
      });
    } else {
      const content = [];
      if (step.text) content.push({ type: "text", text: step.text });
      for (const tool of step.tools ?? []) content.push({ type: "tool_use", name: tool });
      lines.push({
        ...base,
        type: "assistant",
        parentUuid: parent,
        message: {
          role: "assistant",
          model: step.model ?? model,
          content,
          usage: usage(step.in ?? 1200, step.out ?? 400, step.cr ?? 60000, step.cc ?? 2000),
        },
      });
    }
    if (step.denied) {
      const denialUuid = nextUuid();
      lines.push({
        ...base,
        uuid: denialUuid,
        type: "user",
        parentUuid: uuid,
        message: { role: "user", content: [] },
        toolDenialKind: "user_rejected",
      });
      parent = denialUuid;
      continue;
    }
    parent = uuid;
  }
  return lines;
}

function write(projectDir, sessionId, lines, mtime, aiTitle) {
  const dir = path.join(root, projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const all = aiTitle
    ? [...lines, { type: "ai-title", uuid: nextUuid(), timestamp: mtime.toISOString(), aiTitle }]
    : lines;
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, all.map((l) => JSON.stringify(l)).join("\n"));
  fs.utimesSync(file, mtime, mtime);
}

// ---------------------------------------------------------------------------
// The pair. Same task, shared opening, then they part ways at the third step:
// the good run edits the client directly; the bad run goes hunting first and
// keeps going.
// ---------------------------------------------------------------------------
const CHECKOUT = { cwd: "/work/storefront/api", model: "claude-opus-5", branch: "retry-budget" };
const TASK = "Add a retry budget to the checkout client so a flaky payment call cannot retry forever.";

const goodRun = [
  { role: "user", text: TASK, at: minutesAgo(210) },
  { role: "assistant", tools: ["Read"], at: minutesAgo(209) },
  { role: "assistant", tools: ["Edit"], at: minutesAgo(207) },
  { role: "edit", file: "/work/storefront/api/src/checkout/client.ts", added: 34, removed: 6, at: minutesAgo(207) },
  { role: "assistant", tools: ["Edit"], at: minutesAgo(205) },
  { role: "edit", file: "/work/storefront/api/src/checkout/retry.ts", added: 58, removed: 0, at: minutesAgo(205) },
  { role: "assistant", tools: ["Bash"], at: minutesAgo(203) },
  { role: "assistant", text: "Retry budget added, capped at 3 attempts with jitter. Suite green.", out: 700, at: minutesAgo(201) },
];

const badRun = [
  { role: "user", text: TASK, at: minutesAgo(95) },
  { role: "assistant", tools: ["Read"], at: minutesAgo(94) },
  // Divergence starts here: it searches instead of editing.
  { role: "assistant", tools: ["Grep"], at: minutesAgo(93) },
  { role: "assistant", tools: ["Read"], at: minutesAgo(92) },
  { role: "assistant", tools: ["Edit"], at: minutesAgo(90) },
  { role: "edit", file: "/work/storefront/api/src/http/interceptor.ts", added: 71, removed: 12, at: minutesAgo(90) },
  { role: "assistant", tools: ["Bash"], at: minutesAgo(87), cr: 190000 },
  { role: "assistant", tools: ["Edit"], at: minutesAgo(84), cr: 240000 },
  { role: "edit", file: "/work/storefront/api/src/http/interceptor.ts", added: 22, removed: 40, at: minutesAgo(84) },
  { role: "assistant", tools: ["Bash"], at: minutesAgo(80), cr: 310000, denied: true },
  { role: "assistant", tools: ["Bash"], at: minutesAgo(74), cr: 380000, out: 1400 },
  { role: "assistant", text: "Still red. The interceptor retries at the wrong layer and double-counts attempts.", out: 900, at: minutesAgo(70) },
];

write("-work-storefront-api", "a1b2c3d4-0000-4000-8000-000000000001",
  records(goodRun, CHECKOUT), minutesAgo(201), "Add a retry budget to the checkout client");
write("-work-storefront-api", "a1b2c3d4-0000-4000-8000-000000000002",
  records(badRun, CHECKOUT), minutesAgo(70), "Add a retry budget to the checkout client");

// ---------------------------------------------------------------------------
// Fleet context, so the debrief looks like a morning rather than a test case.
// ---------------------------------------------------------------------------
write("-work-storefront-web", "b2c3d4e5-0000-4000-8000-000000000001",
  records([
    { role: "user", text: "Convert the cart summary to the new currency formatter.", at: minutesAgo(330) },
    { role: "assistant", tools: ["Read"], at: minutesAgo(329) },
    { role: "assistant", tools: ["Edit"], at: minutesAgo(327) },
    { role: "edit", file: "/work/storefront/web/src/cart/Summary.tsx", added: 41, removed: 18, at: minutesAgo(327) },
    { role: "assistant", tools: ["Bash"], at: minutesAgo(325) },
    { role: "assistant", text: "Formatter swapped, snapshots updated.", at: minutesAgo(322) },
  ], { cwd: "/work/storefront/web", model: "claude-sonnet-4-5", branch: "currency-formatter" }),
  minutesAgo(322), "Convert the cart summary to the new currency formatter");

write("-work-storefront-payments", "c3d4e5f6-0000-4000-8000-000000000001",
  records([
    { role: "user", text: "Rotate the webhook signing secret and backfill verification.", at: minutesAgo(430) },
    { role: "assistant", tools: ["Read"], at: minutesAgo(429) },
    { role: "assistant", tools: ["Bash"], at: minutesAgo(427), denied: true },
    { role: "assistant", tools: ["Edit"], at: minutesAgo(420) },
    { role: "edit", file: "/work/storefront/payments/src/webhooks/verify.ts", added: 63, removed: 9, at: minutesAgo(420) },
    { role: "assistant", text: "Rotation staged behind a flag. I did not touch production secrets.", at: minutesAgo(415) },
  ], { cwd: "/work/storefront/payments", model: "claude-opus-5", branch: "rotate-webhook-secret" }),
  minutesAgo(415), "Rotate the webhook signing secret");

write("-work-storefront-infra", "d4e5f6a7-0000-4000-8000-000000000001",
  records([
    { role: "user", text: "Pin the node image and split the terraform state per environment.", at: minutesAgo(520) },
    { role: "assistant", tools: ["Read"], at: minutesAgo(519) },
    { role: "assistant", tools: ["Edit"], at: minutesAgo(515) },
    { role: "edit", file: "/work/storefront/infra/modules/api/main.tf", added: 96, removed: 24, at: minutesAgo(515) },
    { role: "assistant", tools: ["Bash"], at: minutesAgo(510) },
    { role: "assistant", text: "State split per environment; plan is clean on both.", at: minutesAgo(505) },
  ], { cwd: "/work/storefront/infra", model: "claude-sonnet-4-5", branch: "split-state" }),
  minutesAgo(505), "Pin the node image and split terraform state");

console.log(`wrote synthetic corpus to ${root}`);
