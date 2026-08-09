import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDebrief } from "../server/debrief.js";

/**
 * Synthetic transcripts in a temp directory - never captured real data. The
 * window selection is the property under test: a transcript untouched since
 * the window opened must not be parsed into the debrief.
 */

let root: string;

function writeSession(
  projectDir: string,
  sessionId: string,
  mtime: Date,
  model = "claude-sonnet-4-5",
): void {
  const dir = path.join(root, projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = mtime.toISOString();
  const lines = [
    {
      type: "user",
      uuid: "u1",
      timestamp,
      cwd: "/tmp/proj",
      message: { role: "user", content: "do the thing" },
    },
    {
      type: "assistant",
      uuid: "a1",
      parentUuid: "u1",
      timestamp,
      message: {
        role: "assistant",
        model,
        content: [
          { type: "text", text: "done" },
          { type: "tool_use", name: "Edit" },
        ],
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 2000,
          cache_creation_input_tokens: 100,
        },
      },
    },
    {
      type: "user",
      uuid: "u2",
      parentUuid: "a1",
      timestamp,
      message: { role: "user", content: [] },
      toolUseResult: {
        filePath: "/tmp/proj/file.ts",
        structuredPatch: [{ lines: ["+added", "-removed", " context"] }],
      },
    },
  ];
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n"));
  fs.utimesSync(filePath, mtime, mtime);
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "debrief-test-"));
  const now = Date.now();
  writeSession(
    "-tmp-proj",
    "11111111-1111-1111-1111-111111111111",
    new Date(now - 2 * 60 * 60 * 1000), // 2h ago: inside a 24h window
  );
  writeSession(
    "-tmp-proj",
    "22222222-2222-2222-2222-222222222222",
    new Date(now - 72 * 60 * 60 * 1000), // 3 days ago: outside it
  );
  writeSession(
    "-tmp-other",
    "33333333-3333-3333-3333-333333333333",
    new Date(now - 1 * 60 * 60 * 1000),
    "some-unknown-model",
  );
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("buildDebrief", () => {
  it("selects by window before parsing, and groups by project", () => {
    const debrief = buildDebrief(root, 24);
    expect(debrief.totals.sessions).toBe(2);
    expect(debrief.totals.projects).toBe(2);
    const ids = debrief.projects.flatMap((p) =>
      p.sessions.map((s) => s.sessionId),
    );
    expect(ids).not.toContain("22222222-2222-2222-2222-222222222222");
  });

  it("prices a priced model and refuses to price an unknown one", () => {
    const debrief = buildDebrief(root, 24);
    const priced = debrief.projects
      .flatMap((p) => p.sessions)
      .find((s) => s.sessionId.startsWith("1"));
    const unpriced = debrief.projects
      .flatMap((p) => p.sessions)
      .find((s) => s.sessionId.startsWith("3"));

    expect(priced?.costUsd).toBeGreaterThan(0);
    // 1000 in + 500 out + 2000 cache-read + 100 cache-write at sonnet rates:
    // (1000*3 + 500*15 + 2000*3*0.1 + 100*3*1.25) / 1e6
    expect(priced?.costUsd).toBeCloseTo(0.011475, 6);
    expect(unpriced?.costUsd).toBeNull();
    expect(unpriced?.unpricedModels).toEqual(["some-unknown-model"]);
    expect(debrief.totals.unpricedModels).toEqual(["some-unknown-model"]);
  });

  it("counts the blast radius from edit results", () => {
    const debrief = buildDebrief(root, 24);
    expect(debrief.totals.filesTouched).toBe(2);
    expect(debrief.totals.linesAdded).toBe(2);
    expect(debrief.totals.linesRemoved).toBe(2);
  });

  it("widens with the window", () => {
    const debrief = buildDebrief(root, 24 * 7);
    expect(debrief.totals.sessions).toBe(3);
  });
});
