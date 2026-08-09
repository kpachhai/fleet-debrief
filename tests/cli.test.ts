import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseWindowHours } from "../server/config.js";
import { buildDebrief } from "../server/debrief.js";
import { formatDebrief } from "../server/print.js";

/**
 * Synthetic transcripts in a temp directory - never captured real data.
 *
 * `formatDebrief` is exercised through `buildDebrief` rather than against a
 * hand-built object: a Debrief has enough fields that a literal would drift out
 * of step with the real shape and still typecheck against a stale expectation.
 */

let root: string;

function writeSession(
  projectDir: string,
  sessionId: string,
  mtime: Date,
  options: { title: string; denied?: boolean } = { title: "did a thing" },
): void {
  const dir = path.join(root, projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = mtime.toISOString();
  const lines: Record<string, unknown>[] = [
    {
      type: "user",
      uuid: "u1",
      timestamp,
      cwd: `/${projectDir.replace(/^-/, "").split("-").join("/")}`,
      message: { role: "user", content: options.title },
    },
    {
      type: "assistant",
      uuid: "a1",
      parentUuid: "u1",
      timestamp,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "done" }],
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    },
  ];
  if (options.denied) {
    lines.push({
      type: "user",
      uuid: "u2",
      parentUuid: "a1",
      timestamp,
      message: { role: "user", content: [] },
      toolDenialKind: "denied",
    });
  }
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n"));
  fs.utimesSync(filePath, mtime, mtime);
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
  const now = Date.now();
  writeSession("-work-acme-api", "11111111-1111-1111-1111-111111111111", new Date(now - 3600_000), {
    title: "add the retry budget",
  });
  writeSession("-work-acme-web", "22222222-2222-2222-2222-222222222222", new Date(now - 7200_000), {
    title: "a run that got denied",
    denied: true,
  });
  // Well outside any window used below, so the empty case has something to miss.
  writeSession("-work-acme-old", "33333333-3333-3333-3333-333333333333", new Date(now - 40 * 86400_000), {
    title: "ancient history",
  });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("parseWindowHours", () => {
  it("reads hours, days, and a bare number", () => {
    expect(parseWindowHours("24h")).toBe(24);
    expect(parseWindowHours("48H")).toBe(48);
    expect(parseWindowHours("7d")).toBe(168);
    expect(parseWindowHours("36")).toBe(36);
    expect(parseWindowHours(" 12h ")).toBe(12);
  });

  it("refuses anything it cannot read rather than defaulting", () => {
    for (const bad of ["2weeks", "", "-5h", "0h", "h", "1.2.3", "24 hours"]) {
      expect(() => parseWindowHours(bad)).toThrow(/invalid window/);
    }
  });
});

describe("formatDebrief", () => {
  it("leads with the window, run count, and cost", () => {
    const text = formatDebrief(buildDebrief(root, 24));
    expect(text.split("\n")[0]).toMatch(/^last 24h {3}2 runs {3}\$\d+\.\d{2} {3}0 files/);
  });

  it("labels a week as 7d rather than 168h", () => {
    const text = formatDebrief(buildDebrief(root, 168));
    expect(text).toContain("last 7d");
  });

  it("marks a run that needs attention and says why", () => {
    const text = formatDebrief(buildDebrief(root, 24));
    const denied = text
      .split("\n")
      .find((line) => line.includes("a run that got denied"));
    expect(denied?.trimStart().startsWith("!")).toBe(true);
    expect(text).toContain("tool denials");
  });

  it("groups under a shortened project label", () => {
    const text = formatDebrief(buildDebrief(root, 24));
    expect(text).toContain("acme/api");
    expect(text).toContain("acme/web");
  });

  it("says so plainly when the window is empty, and suggests a wider one", () => {
    const text = formatDebrief(buildDebrief(root, 1));
    expect(text).toContain("No sessions in the last 1h");
    expect(text).toContain("--since 7d");
  });

  it("emits no trailing blank lines, so a pipe stays tidy", () => {
    const text = formatDebrief(buildDebrief(root, 24));
    expect(text).toBe(text.trimEnd());
  });
});
