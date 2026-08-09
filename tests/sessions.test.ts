import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listSessions } from "../server/sessions.js";

/**
 * Synthetic transcripts in a temp directory - never captured real data. The
 * property under test is title derivation: a session opened with a slash
 * command must be named after what the operator typed, not after the harness's
 * expansion of the command.
 */

let root: string;

type Line = Record<string, unknown>;

function userText(uuid: string, text: string, extra: Line = {}): Line {
  return {
    type: "user",
    uuid,
    timestamp: new Date(0).toISOString(),
    cwd: "/tmp/proj",
    message: { role: "user", content: text },
    ...extra,
  };
}

function writeSession(sessionId: string, lines: Line[]): void {
  const dir = path.join(root, "-tmp-proj");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${sessionId}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n"),
  );
}

function titleOf(sessionId: string): string {
  const sessions = listSessions(root, { limit: 50 });
  const match = sessions.find((s) => s.sessionId === sessionId);
  if (!match) throw new Error(`no such session in listing: ${sessionId}`);
  return match.title;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sessions-test-"));

  // A session started with `/effort`: the harness writes the command envelope
  // and its stdout as ordinary non-meta user records before the operator's
  // own first message.
  writeSession("11111111-1111-1111-1111-111111111111", [
    userText("u0", "<local-command-caveat>Caveat: ...</local-command-caveat>", {
      isMeta: true,
    }),
    userText(
      "u1",
      "<command-name>/effort</command-name>\n            <command-message>effort</command-message>\n            <command-args></command-args>",
    ),
    userText(
      "u2",
      "<local-command-stdout>Set effort level to ultracode</local-command-stdout>",
    ),
    userText("u3", "Continue the fleet-debrief rename"),
  ]);

  // Envelope records only: nothing the operator typed, so no prose exists to
  // name the run with.
  writeSession("22222222-2222-2222-2222-222222222222", [
    userText("u1", "<command-name>/clear</command-name>"),
    userText("u2", "<local-command-stdout>cleared</local-command-stdout>"),
  ]);

  // Envelope and prose in one record: the prose still names the run.
  writeSession("33333333-3333-3333-3333-333333333333", [
    userText(
      "u1",
      "<command-name>/commit</command-name>\n<command-args></command-args>\nalso push it when the tests pass",
    ),
  ]);

  // An explicit title from the harness still outranks any prompt.
  writeSession("44444444-4444-4444-4444-444444444444", [
    userText("u1", "<command-name>/effort</command-name>"),
    userText("u2", "some later prose"),
    {
      type: "ai-title",
      uuid: "t1",
      timestamp: new Date(0).toISOString(),
      aiTitle: "Rename the package",
    },
  ]);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("session title derivation", () => {
  it("skips the slash-command envelope and names the run after the operator", () => {
    expect(titleOf("11111111-1111-1111-1111-111111111111")).toBe(
      "Continue the fleet-debrief rename",
    );
  });

  it("falls back to the session id when only envelope records exist", () => {
    expect(titleOf("22222222-2222-2222-2222-222222222222")).toBe(
      "22222222-2222-2222-2222-222222222222",
    );
  });

  it("keeps prose that shares a record with an envelope", () => {
    expect(titleOf("33333333-3333-3333-3333-333333333333")).toBe(
      "also push it when the tests pass",
    );
  });

  it("still prefers an explicit ai-title", () => {
    expect(titleOf("44444444-4444-4444-4444-444444444444")).toBe(
      "Rename the package",
    );
  });
});
