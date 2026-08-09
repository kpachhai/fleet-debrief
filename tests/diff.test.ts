import { describe, expect, it } from "vitest";
import { diffRuns } from "../server/diff.js";
import type { SessionDetail, TimelineEntry } from "../server/sessions.js";

/**
 * Synthetic fixtures only - never captured transcripts. These assert the
 * aligner's structural claims: identical runs align fully, an inserted step
 * shows up as one-sided, and the divergence index lands on the first
 * non-matching op.
 */

function entry(
  index: number,
  role: "user" | "assistant",
  tools: string[] = [],
): TimelineEntry {
  return {
    uuid: `u${index}-${role}-${tools.join("_") || "text"}`,
    parentUuid: null,
    type: role,
    timestamp: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
    role,
    model: role === "assistant" ? "claude-sonnet-4-5" : null,
    text: `step ${index}`,
    textTruncated: false,
    toolUses: tools.map((name) => ({ name, count: 1 })),
    tokens:
      role === "assistant"
        ? { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 }
        : null,
    attributionSkill: null,
    attributionMcpServer: null,
    isSidechain: false,
    isMeta: false,
    denialKind: null,
    isBranchPoint: false,
  };
}

function detail(
  sessionId: string,
  timeline: TimelineEntry[],
  touched: string[] = [],
): SessionDetail {
  const assistantTurns = timeline.filter((e) => e.role === "assistant").length;
  return {
    sessionId,
    projectDir: "-tmp-proj",
    cwd: "/tmp/proj",
    cwdSource: "record",
    title: `run ${sessionId}`,
    titleSource: "session-id",
    startedAt: timeline[0]?.timestamp ?? "",
    endedAt: timeline[timeline.length - 1]?.timestamp ?? "",
    version: "2.0.0",
    gitBranch: "main",
    messageCount: timeline.length,
    userTurns: timeline.length - assistantTurns,
    assistantTurns,
    models: [{ name: "claude-sonnet-4-5", count: assistantTurns }],
    tokens: {
      input: assistantTurns * 100,
      output: assistantTurns * 50,
      cacheRead: 0,
      cacheCreation: 0,
    },
    tokensByModel: [
      {
        model: "claude-sonnet-4-5",
        tokens: {
          input: assistantTurns * 100,
          output: assistantTurns * 50,
          cacheRead: 0,
          cacheCreation: 0,
        },
      },
    ],
    sidechainTurns: 0,
    filesTouched: touched.length,
    linesAdded: 0,
    linesRemoved: 0,
    toolCalls: [],
    skills: [],
    mcpServers: [],
    hookInvocations: 0,
    hookErrorRecords: 0,
    toolDenials: [],
    skippedLines: 0,
    sizeBytes: 0,
    mtimeMs: 0,
    timeline,
    filePath: `/tmp/${sessionId}.jsonl`,
    touchedFiles: touched.map((path) => ({
      path,
      edits: 1,
      linesAdded: 1,
      linesRemoved: 0,
      firstTouchedAt: "",
      lastTouchedAt: "",
      userModified: false,
    })),
    blastRadius: {
      files: touched.length,
      edits: touched.length,
      linesAdded: touched.length,
      linesRemoved: 0,
      filesUserModified: 0,
    },
  };
}

const baseline = [
  entry(0, "user"),
  entry(1, "assistant", ["Read"]),
  entry(2, "assistant", ["Edit"]),
  entry(3, "assistant", ["Bash"]),
];

describe("diffRuns", () => {
  it("aligns identical runs completely", () => {
    const diff = diffRuns(
      detail("a", baseline, ["/tmp/x.ts"]),
      detail("b", baseline, ["/tmp/x.ts"]),
    );
    expect(diff.divergenceIndex).toBe(-1);
    expect(diff.similarity).toBe(1);
    expect(diff.ops.every((op) => op.kind === "same")).toBe(true);
    expect(diff.deltas.files.onlyA).toEqual([]);
    expect(diff.deltas.files.both).toEqual(["/tmp/x.ts"]);
  });

  it("finds the divergence where a run inserts a step", () => {
    const detoured = [
      baseline[0],
      baseline[1],
      entry(9, "assistant", ["Grep"]), // the detour
      baseline[2],
      baseline[3],
    ];
    const diff = diffRuns(detail("a", baseline), detail("b", detoured));
    expect(diff.divergenceIndex).toBe(2);
    const op = diff.ops[2];
    expect(op.kind).toBe("b-only");
    if (op.kind === "b-only") {
      expect(op.b.toolUses).toEqual(["Grep"]);
    }
    expect(diff.ops.filter((o) => o.kind === "same")).toHaveLength(4);
  });

  it("reports one-sided file touches", () => {
    const diff = diffRuns(
      detail("a", baseline, ["/tmp/shared.ts", "/tmp/only-a.ts"]),
      detail("b", baseline, ["/tmp/shared.ts", "/tmp/only-b.ts"]),
    );
    expect(diff.deltas.files.onlyA).toEqual(["/tmp/only-a.ts"]);
    expect(diff.deltas.files.onlyB).toEqual(["/tmp/only-b.ts"]);
    expect(diff.deltas.files.both).toEqual(["/tmp/shared.ts"]);
  });

  it("ignores sidechain and meta entries in alignment", () => {
    const withSidechain = [
      baseline[0],
      { ...entry(5, "assistant", ["Task"]), isSidechain: true },
      baseline[1],
      baseline[2],
      baseline[3],
    ];
    const diff = diffRuns(detail("a", baseline), detail("b", withSidechain));
    expect(diff.divergenceIndex).toBe(-1);
  });
});
