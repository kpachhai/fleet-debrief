import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSession, listSessions } from "../server/sessions.js";

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

  // A first prompt that is a markdown document, which is the common case for a
  // long handoff. The title must be a label; the body must survive untouched.
  writeSession("66666666-6666-6666-6666-666666666666", [
    userText(
      "u1",
      "# HANDOFF — continue the rename\n\n> This file is the complete state.\n\nI'm picking up mid-stream.",
    ),
  ]);

  // Block markers other than a heading, and a nested one.
  writeSession("77777777-7777-7777-7777-777777777777", [
    userText("u1", "> - # dig into the flaky payment test"),
  ]);

  // Nothing but markers: no label can be made, so the id has to win.
  writeSession("88888888-8888-8888-8888-888888888888", [
    userText("u1", "###\n\n>\n\n- \n"),
  ]);

  // Terminal escapes, as written by commands that colorize or repaint. The
  // transcript stores them JSON-escaped; once parsed they are real ESC bytes.
  writeSession("55555555-5555-5555-5555-555555555555", [
    userText("u1", "Set model to \u001b[1mFable 5\u001b[22m now"),
    {
      type: "assistant",
      uuid: "a1",
      parentUuid: "u1",
      timestamp: new Date(0).toISOString(),
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [
          { type: "text", text: "\u001b[2Ktransforming...\u001b[2K built in 218ms" },
        ],
      },
    },
    {
      type: "assistant",
      uuid: "a2",
      parentUuid: "a1",
      timestamp: new Date(0).toISOString(),
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "plain prose, no escapes" }],
      },
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

describe("markdown in a first prompt", () => {
  it("names the run after the heading, not the whole document", () => {
    expect(titleOf("66666666-6666-6666-6666-666666666666")).toBe(
      "HANDOFF — continue the rename",
    );
  });

  it("strips nested block markers", () => {
    expect(titleOf("77777777-7777-7777-7777-777777777777")).toBe(
      "dig into the flaky payment test",
    );
  });

  it("falls back to the session id when the prompt is only markers", () => {
    expect(titleOf("88888888-8888-8888-8888-888888888888")).toBe(
      "88888888-8888-8888-8888-888888888888",
    );
  });

  it("leaves the message body alone - markdown there is content, not decoration", () => {
    const detail = getSession(
      root,
      "-tmp-proj",
      "66666666-6666-6666-6666-666666666666",
    );
    const first = detail?.timeline.find((e) => e.uuid === "u1");
    expect(first?.text).toContain("# HANDOFF — continue the rename");
    expect(first?.text).toContain("> This file is the complete state.");
  });
});

describe("terminal escape sequences", () => {
  const sessionId = "55555555-5555-5555-5555-555555555555";

  function detail() {
    const found = getSession(root, "-tmp-proj", sessionId);
    if (!found) throw new Error("fixture session did not load");
    return found;
  }

  it("strips colour codes from the title", () => {
    expect(titleOf(sessionId)).toBe("Set model to Fable 5 now");
  });

  it("strips erase-line codes from timeline text", () => {
    const entry = detail().timeline.find((e) => e.uuid === "a1");
    expect(entry?.text).toBe("transforming... built in 218ms");
  });

  it("leaves text without escapes untouched", () => {
    const entry = detail().timeline.find((e) => e.uuid === "a2");
    expect(entry?.text).toBe("plain prose, no escapes");
  });

  it("leaves no escape byte in any timeline text", () => {
    // Built from a char code on purpose: an escape written literally here is
    // an invisible byte in the source, and asserting against the JSON string
    // instead would pass vacuously, since JSON.stringify renders ESC in its
    // escaped six-character form rather than as a raw byte.
    const esc = String.fromCharCode(27);
    const leaked = detail().timeline.filter((e) => e.text.includes(esc));
    expect(leaked).toEqual([]);
  });
});
