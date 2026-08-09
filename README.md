# fleet-debrief

**The morning debrief for your AI agent fleet.** One command. It reads the
session transcripts Claude Code already writes to disk and answers three
questions no other tool answers together:

1. **What did my agents do while I was away?** Every session in the window —
   cost, duration, files touched, subagent activity, and the runs that need a
   second look (hook errors, denials, unparseable records) sorted to the top.
2. **What exactly happened in this run?** A step-by-step timeline of any
   session, subagent turns included, with its blast radius: every file the run
   edited, including edits that were later reverted — and the ones you then
   fixed by hand.
3. **Why did run A work when run B didn't?** Pick two runs and get an aligned,
   side-by-side diff: the step where they diverge, the tool-call deltas, the
   files only one of them touched, and the cost difference.

Local-only. Zero config. Nothing to sign up for, nothing leaves your machine.

## Quickstart

```bash
git clone https://github.com/kpachhai/fleet-debrief  # pii-allow:own-repo-url
cd fleet-debrief
npm install && npm run build
npm start          # -> http://127.0.0.1:7317
```

That's it. If you've ever run Claude Code on this machine, the debrief is
already populated — it reads `~/.claude/projects` retroactively, so your last
weeks of sessions are there before you configure anything. (`npx fleet-debrief`
ships once this is published to npm.)

## Privacy posture

Session transcripts are among the most intimate records a developer keeps:
every prompt you typed, every file the agent touched. So:

- The server binds `127.0.0.1` only, and `/api/*` rejects requests whose
  `Host` or `Origin` is not this machine (DNS-rebinding and CSRF defense).
- **No outbound network calls, at all.** Prices come from a table vendored
  into the repo with its as-of date shown on screen, never fetched.
- Read-only: every filesystem call is a stat, a readdir, or a read. Your
  transcripts are someone else's files; this tool never writes to them.
- No accounts, no telemetry, no CDN assets. The UI works with the network off.

## Status

v0. Claude Code is the only supported source today; the transcript reader,
session model, and pricing engine are extracted from
[agentic-os](https://github.com/kpachhai/agentic-os), <!-- pii-allow:own-public-repo --> where they run against
real multi-hundred-megabyte corpora. The run-vs-run diff aligns on tool-call
structure (deliberately, not on prose — see the comment in `server/diff.ts`).

Roadmap, in order: budgets and spend alerts on top of the debrief; more coding
CLIs as sources; then hash-chained run logs with optional public-ledger
anchoring — turning the debrief you read into evidence you can hand an auditor.

## Development

```bash
npm run dev:server   # API with reload on :7317
npm run dev:ui       # Vite dev server, proxies /api
npm run typecheck && npm test
```

Contributions welcome. Two rules inherited from the parent project: never
commit fixtures captured from real transcripts (synthetic only — see
`tests/`), and nothing may make an outbound network call.

## License

Apache-2.0.
