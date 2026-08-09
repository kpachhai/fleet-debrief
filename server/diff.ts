import { sessionCost } from "./debrief.js";
import type { SessionDetail, TimelineEntry, TokenTotals } from "./sessions.js";

/**
 * Run-vs-run diff: align two sessions' mainline timelines, find where they
 * diverge, and delta the numbers. This answers "the same task worked Tuesday
 * and failed Thursday - what changed?", which no trace viewer answers today.
 *
 * Alignment is structural, not semantic. Each step is reduced to a coarse
 * signature (record type, role, tool names), and the two signature sequences
 * are aligned with a longest-common-subsequence pass. Coarse is deliberate:
 * prose varies between any two runs of the same task, so aligning on text
 * would call everything a divergence, while tool-call structure is what
 * actually distinguishes "took the same path" from "went somewhere else".
 */

export type DiffStep = {
  index: number;
  timestamp: string;
  type: string;
  role: string | null;
  toolUses: string[];
  /** First line of prose, for the reader to orient by; never the full body. */
  excerpt: string;
  tokens: TokenTotals | null;
};

export type DiffOp =
  | { kind: "same"; a: DiffStep; b: DiffStep }
  | { kind: "a-only"; a: DiffStep }
  | { kind: "b-only"; b: DiffStep };

export type ToolDelta = { name: string; a: number; b: number };

export type RunDiff = {
  a: RunRef;
  b: RunRef;
  ops: DiffOp[];
  /**
   * Index into ops of the first non-matching op, or -1 when the runs share
   * their whole aligned structure. Everything before it is the common prefix -
   * the point of the whole exercise is what happens at this index.
   */
  divergenceIndex: number;
  /** Steps aligned as identical, as a share of the longer run. */
  similarity: number;
  deltas: {
    durationMs: { a: number; b: number };
    messageCount: { a: number; b: number };
    costUsd: { a: number | null; b: number | null };
    tokens: { a: TokenTotals; b: TokenTotals };
    tools: ToolDelta[];
    files: { onlyA: string[]; onlyB: string[]; both: string[] };
    sidechainTurns: { a: number; b: number };
  };
  /** True when either run exceeded the alignment cap and was truncated. */
  truncated: boolean;
};

export type RunRef = {
  projectDir: string;
  sessionId: string;
  title: string;
  startedAt: string;
  endedAt: string;
};

/**
 * Longest timeline the aligner will take. LCS is O(a*b) in space and time;
 * 1500x1500 is ~2M cells, well under a frame of work, while an unbounded pair
 * of hundred-thousand-step transcripts would not be.
 */
const MAX_STEPS = 1500;

/**
 * Mainline conversation steps only. Sidechains are a subagent's own
 * conversation: two runs that delegated differently already show up in the
 * sidechain-turn delta, and folding delegated steps into the alignment would
 * make the mainline paths unreadable.
 */
function stepsOf(detail: SessionDetail): { steps: DiffStep[]; truncated: boolean } {
  const mainline = detail.timeline.filter(
    (entry) =>
      !entry.isSidechain &&
      !entry.isMeta &&
      (entry.type === "user" || entry.type === "assistant"),
  );
  const truncated = mainline.length > MAX_STEPS;
  const kept = truncated ? mainline.slice(0, MAX_STEPS) : mainline;
  return {
    steps: kept.map((entry, index) => ({
      index,
      timestamp: entry.timestamp,
      type: entry.type,
      role: entry.role,
      toolUses: entry.toolUses.map((tool) => tool.name),
      excerpt: firstLine(entry),
      tokens: entry.tokens,
    })),
    truncated,
  };
}

function firstLine(entry: TimelineEntry): string {
  const line = entry.text.split("\n", 1)[0] ?? "";
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

/**
 * What two steps must share to count as "the same step". Tool names are
 * sorted: the order tools appear inside one assistant message is not a path
 * decision, while which tools were called is.
 */
function signature(step: DiffStep): string {
  return `${step.type}|${step.role ?? ""}|${[...step.toolUses].sort().join(",")}`;
}

/** Classic LCS table over step signatures. */
function align(a: DiffStep[], b: DiffStep[]): DiffOp[] {
  const aSignatures = a.map(signature);
  const bSignatures = b.map(signature);

  // (a.length+1) x (b.length+1) table of LCS lengths, flat for locality.
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        aSignatures[i] === bSignatures[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (aSignatures[i] === bSignatures[j]) {
      ops.push({ kind: "same", a: a[i], b: b[j] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ kind: "a-only", a: a[i] });
      i++;
    } else {
      ops.push({ kind: "b-only", b: b[j] });
      j++;
    }
  }
  while (i < a.length) ops.push({ kind: "a-only", a: a[i++] });
  while (j < b.length) ops.push({ kind: "b-only", b: b[j++] });
  return ops;
}

function toolCounts(detail: SessionDetail): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tool of detail.toolCalls) counts.set(tool.name, tool.count);
  return counts;
}

function refOf(detail: SessionDetail): RunRef {
  return {
    projectDir: detail.projectDir,
    sessionId: detail.sessionId,
    title: detail.title,
    startedAt: detail.startedAt,
    endedAt: detail.endedAt,
  };
}

function runDurationMs(detail: SessionDetail): number {
  const start = Date.parse(detail.startedAt);
  const end = Date.parse(detail.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return end - start;
}

export function diffRuns(a: SessionDetail, b: SessionDetail): RunDiff {
  const stepsA = stepsOf(a);
  const stepsB = stepsOf(b);
  const ops = align(stepsA.steps, stepsB.steps);

  const divergenceIndex = ops.findIndex((op) => op.kind !== "same");
  const sameCount = ops.filter((op) => op.kind === "same").length;
  const longer = Math.max(stepsA.steps.length, stepsB.steps.length);

  const toolsA = toolCounts(a);
  const toolsB = toolCounts(b);
  const toolNames = [...new Set([...toolsA.keys(), ...toolsB.keys()])].sort();
  const tools: ToolDelta[] = toolNames
    .map((name) => ({
      name,
      a: toolsA.get(name) ?? 0,
      b: toolsB.get(name) ?? 0,
    }))
    .filter((delta) => delta.a !== delta.b);

  const filesA = new Set(a.touchedFiles.map((file) => file.path));
  const filesB = new Set(b.touchedFiles.map((file) => file.path));

  return {
    a: refOf(a),
    b: refOf(b),
    ops,
    divergenceIndex,
    similarity: longer === 0 ? 1 : sameCount / longer,
    deltas: {
      durationMs: { a: runDurationMs(a), b: runDurationMs(b) },
      messageCount: { a: a.messageCount, b: b.messageCount },
      costUsd: { a: sessionCost(a).costUsd, b: sessionCost(b).costUsd },
      tokens: { a: a.tokens, b: b.tokens },
      tools,
      files: {
        onlyA: [...filesA].filter((path) => !filesB.has(path)).sort(),
        onlyB: [...filesB].filter((path) => !filesA.has(path)).sort(),
        both: [...filesA].filter((path) => filesB.has(path)).sort(),
      },
      sidechainTurns: { a: a.sidechainTurns, b: b.sidechainTurns },
    },
    truncated: stepsA.truncated || stepsB.truncated,
  };
}
