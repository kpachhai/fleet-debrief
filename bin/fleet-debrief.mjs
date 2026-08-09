#!/usr/bin/env node
/**
 * npx entry point.
 *
 * A published install runs compiled JavaScript under plain node. A checkout that
 * has not been built falls back to running the TypeScript through tsx, which is
 * a dev dependency and so is present exactly when that fallback is needed.
 *
 * Flags are parsed here rather than in the server because one of them decides
 * which entry point runs at all: --print never starts a server.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const USAGE = `fleet-debrief - what your agents did while you were away

Usage
  fleet-debrief [options]

Options
  --print          write the debrief to stdout and exit, no browser
  --since <window> window to report on, e.g. 12h, 48h, 7d  (default 24h)
  --port <n>       port for the local UI and API            (default 7317)
  --version        print the version and exit
  -h, --help       print this message and exit

Reads the session transcripts Claude Code already writes to disk. Local only:
it binds 127.0.0.1, makes no outbound network calls, and never writes to the
transcripts it reads.
`;

/** Read the value that follows a flag, failing loudly when it is missing. */
function valueFor(argv, flag) {
  const at = argv.indexOf(flag);
  if (at === -1) return null;
  const value = argv[at + 1];
  if (!value || value.startsWith("-")) {
    process.stderr.write(`fleet-debrief: ${flag} needs a value\n\n${USAGE}`);
    process.exit(1);
  }
  return value;
}

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}

if (argv.includes("--version")) {
  const { version } = require("../package.json");
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

const KNOWN_FLAGS = new Set([
  "--print",
  "--since",
  "--port",
  "--version",
  "--help",
  "-h",
]);

// Reject an unknown flag instead of ignoring it. Silently dropping `--sicne 7d`
// would show a 24h window and look like the tool was wrong about the data.
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith("-")) continue;
  if (!KNOWN_FLAGS.has(arg)) {
    process.stderr.write(`fleet-debrief: unknown option ${arg}\n\n${USAGE}`);
    process.exit(1);
  }
  if (arg === "--since" || arg === "--port") i += 1;
}

const env = { ...process.env };
const port = valueFor(argv, "--port");
if (port) env.PORT = port;
const since = valueFor(argv, "--since");
if (since) env.FLEET_DEBRIEF_SINCE = since;

const printMode = argv.includes("--print");
const compiled = path.join(here, "..", "dist-server", printMode ? "print.js" : "index.js");

// tsx is resolved lazily: it is not a runtime dependency, so it is absent from a
// published install, where the compiled entry always exists.
let nodeArgs;
let willCompile = false;
if (fs.existsSync(compiled)) {
  nodeArgs = [compiled];
} else {
  willCompile = true;
  const source = path.join(here, "..", "server", printMode ? "print.ts" : "index.ts");
  nodeArgs = [require.resolve("tsx/cli"), source];
}

if (!printMode && willCompile) {
  // Only on the fallback path. This file is plain .mjs, so it runs before tsx
  // compiles anything, which makes it the only place a message can appear before
  // a multi-second wait that would otherwise look like a hang. The compiled path
  // binds fast enough that the server's own banner is prompt, and in --print mode
  // an extra line would only get in the way of a pipe.
  process.stdout.write(
    "fleet-debrief: compiling the server, one moment (run npm run build to skip this)\n",
  );
}

const child = spawn(process.execPath, nodeArgs, { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
