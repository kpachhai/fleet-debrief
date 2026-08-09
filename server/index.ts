import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadConfigOrExit, SourceMissingError, APP_ROOT } from "./config.js";
import { buildDebrief } from "./debrief.js";
import { diffRuns } from "./diff.js";
import { getSession, listSessions } from "./sessions.js";

/**
 * One process, loopback only. Session transcripts are among the most intimate
 * records a developer keeps - every prompt, every file touched - so the bind
 * host is a constant, not a config key, and /api/* refuses requests whose Host
 * or Origin is not this machine (DNS-rebinding and CSRF defense, respectively).
 * Nothing here makes an outbound network call.
 */
const BIND_HOST = "127.0.0.1";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isLoopbackHostHeader(value: string | undefined): boolean {
  if (!value) return false;
  const withoutPort = value.replace(/:\d+$/, "");
  return LOOPBACK_HOSTS.has(withoutPort);
}

function isLocalOrigin(value: string | undefined): boolean {
  if (!value) return true; // Same-origin fetches and curl send no Origin.
  try {
    const url = new URL(value);
    return LOOPBACK_HOSTS.has(url.hostname) || LOOPBACK_HOSTS.has(`[${url.hostname}]`);
  } catch {
    return false;
  }
}

const config = loadConfigOrExit();
const app = new Hono();

app.use("/api/*", async (context, next) => {
  if (!isLoopbackHostHeader(context.req.header("host"))) {
    return context.json({ error: "forbidden host" }, 403);
  }
  if (!isLocalOrigin(context.req.header("origin"))) {
    return context.json({ error: "cross-origin request rejected" }, 403);
  }
  return next();
});

app.onError((err, context) => {
  if (err instanceof SourceMissingError) {
    return context.json(
      { error: "source missing", source: err.source, path: err.missingPath },
      503,
    );
  }
  console.error(err);
  return context.json({ error: "internal error" }, 500);
});

app.get("/api/health", (context) =>
  context.json({
    ok: true,
    bind: BIND_HOST,
    transcriptsDir: config.transcriptsDir,
    defaultHours: config.defaultHours,
  }),
);

app.get("/api/debrief", (context) => {
  // No `hours` means "whatever this instance was started with", so `--since`
  // decides the window the UI opens on without the client having to ask twice.
  const hoursRaw = context.req.query("hours") ?? String(config.defaultHours);
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours) || hours <= 0) {
    return context.json({ error: `invalid hours: ${hoursRaw}` }, 400);
  }
  return context.json(buildDebrief(config.transcriptsDir, hours));
});

app.get("/api/sessions", (context) => {
  const limit = Number(context.req.query("limit") ?? "50");
  const q = context.req.query("q") ?? undefined;
  return context.json(
    listSessions(config.transcriptsDir, {
      limit: Number.isFinite(limit) ? limit : 50,
      q,
    }),
  );
});

app.get("/api/sessions/:projectDir/:sessionId", (context) => {
  const detail = getSession(
    config.transcriptsDir,
    context.req.param("projectDir"),
    context.req.param("sessionId"),
  );
  if (!detail) return context.json({ error: "no such session" }, 404);
  return context.json(detail);
});

app.get("/api/diff", (context) => {
  const aProject = context.req.query("aProject") ?? "";
  const aSession = context.req.query("aSession") ?? "";
  const bProject = context.req.query("bProject") ?? "";
  const bSession = context.req.query("bSession") ?? "";
  if (!aProject || !aSession || !bProject || !bSession) {
    return context.json(
      { error: "aProject, aSession, bProject and bSession are required" },
      400,
    );
  }
  const a = getSession(config.transcriptsDir, aProject, aSession);
  if (!a) return context.json({ error: `no such session: ${aSession}` }, 404);
  const b = getSession(config.transcriptsDir, bProject, bSession);
  if (!b) return context.json({ error: `no such session: ${bSession}` }, 404);
  return context.json(diffRuns(a, b));
});

app.all("/api/*", (context) => context.json({ error: "not found" }, 404));

// Built UI, when present. A repo checkout that has not run `npm run build`
// still gets a working API plus a plain-text pointer instead of a blank page.
const distDir = path.join(APP_ROOT, "dist");
if (fs.existsSync(path.join(distDir, "index.html"))) {
  app.use(
    "/*",
    serveStatic({
      root: path.relative(process.cwd(), distDir),
    }),
  );
  app.get("*", async (context) =>
    context.html(fs.readFileSync(path.join(distDir, "index.html"), "utf8")),
  );
} else {
  app.get("*", (context) =>
    context.text(
      "fleet-debrief API is running. Build the UI with `npm run build`, then reload.",
    ),
  );
}

serve({ fetch: app.fetch, port: config.port, hostname: BIND_HOST }, (info) => {
  console.log(`fleet-debrief -> http://${BIND_HOST}:${info.port}`);
  console.log(`reading: ${config.transcriptsDir}`);
});
