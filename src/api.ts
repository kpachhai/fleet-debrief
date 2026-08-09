/** Typed fetch helpers over the local API. Shapes mirror the server modules. */

export type TokenTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

export type NamedCount = { name: string; count: number };

export type SessionSummary = {
  sessionId: string;
  projectDir: string;
  cwd: string;
  title: string;
  startedAt: string;
  endedAt: string;
  gitBranch: string;
  messageCount: number;
  userTurns: number;
  assistantTurns: number;
  models: NamedCount[];
  tokens: TokenTotals;
  tokensByModel: { model: string; tokens: TokenTotals }[];
  sidechainTurns: number;
  filesTouched: number;
  linesAdded: number;
  linesRemoved: number;
  toolCalls: NamedCount[];
  skills: NamedCount[];
  mcpServers: NamedCount[];
  hookInvocations: number;
  hookErrorRecords: number;
  toolDenials: NamedCount[];
  skippedLines: number;
  mtimeMs: number;
};

export type DebriefSession = SessionSummary & {
  costUsd: number | null;
  unpricedModels: string[];
  durationMs: number;
  attentionScore: number;
};

export type Debrief = {
  generatedAt: string;
  sinceHours: number;
  since: string;
  pricingAsOf: string;
  totals: {
    sessions: number;
    projects: number;
    costUsd: number;
    unpricedModels: string[];
    tokens: TokenTotals;
    filesTouched: number;
    linesAdded: number;
    linesRemoved: number;
    sidechainTurns: number;
    hookErrorRecords: number;
    toolDenials: number;
    skippedLines: number;
  };
  projects: {
    cwd: string;
    projectDir: string;
    sessions: DebriefSession[];
    costUsd: number;
    filesTouched: number;
  }[];
  truncated: boolean;
};

export type TimelineEntry = {
  uuid: string;
  type: string;
  timestamp: string;
  role: string | null;
  model: string | null;
  text: string;
  textTruncated: boolean;
  toolUses: NamedCount[];
  tokens: TokenTotals | null;
  isSidechain: boolean;
  isMeta: boolean;
  denialKind: string | null;
  isBranchPoint: boolean;
};

export type TouchedFile = {
  path: string;
  edits: number;
  linesAdded: number;
  linesRemoved: number;
  userModified: boolean;
};

export type SessionDetail = SessionSummary & {
  timeline: TimelineEntry[];
  touchedFiles: TouchedFile[];
  blastRadius: {
    files: number;
    edits: number;
    linesAdded: number;
    linesRemoved: number;
    filesUserModified: number;
  };
};

export type DiffStep = {
  index: number;
  timestamp: string;
  type: string;
  role: string | null;
  toolUses: string[];
  excerpt: string;
  tokens: TokenTotals | null;
};

export type DiffOp =
  | { kind: "same"; a: DiffStep; b: DiffStep }
  | { kind: "a-only"; a: DiffStep }
  | { kind: "b-only"; b: DiffStep };

export type RunDiff = {
  a: { projectDir: string; sessionId: string; title: string };
  b: { projectDir: string; sessionId: string; title: string };
  ops: DiffOp[];
  divergenceIndex: number;
  similarity: number;
  alignedSteps: number;
  comparedSteps: number;
  shortRun: boolean;
  deltas: {
    durationMs: { a: number; b: number };
    messageCount: { a: number; b: number };
    costUsd: { a: number | null; b: number | null };
    tokens: { a: TokenTotals; b: TokenTotals };
    tools: { name: string; a: number; b: number }[];
    files: { onlyA: string[]; onlyB: string[]; both: string[] };
    sidechainTurns: { a: number; b: number };
  };
  truncated: boolean;
};

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = (await response.json()) as T & { error?: string; path?: string };
  if (!response.ok) {
    // A missing source reports the path it looked at, and that path is the whole
    // answer: "source missing" on its own leaves the reader nothing to act on.
    const detail = body.path ? `${body.error}: ${body.path}` : body.error;
    throw new Error(detail ?? `${response.status} on ${url}`);
  }
  return body;
}

/**
 * Omitting `hours` is meaningful: the server then answers with the window it was
 * started with, so `--since 7d` decides what the page opens on. The response
 * always reports the window it used, so the caller never has to ask separately.
 */
export const fetchDebrief = (hours: number | null) =>
  get<Debrief>(hours === null ? "/api/debrief" : `/api/debrief?hours=${hours}`);

export const fetchSession = (projectDir: string, sessionId: string) =>
  get<SessionDetail>(
    `/api/sessions/${encodeURIComponent(projectDir)}/${encodeURIComponent(sessionId)}`,
  );

export const fetchDiff = (
  a: { projectDir: string; sessionId: string },
  b: { projectDir: string; sessionId: string },
) =>
  get<RunDiff>(
    `/api/diff?aProject=${encodeURIComponent(a.projectDir)}&aSession=${encodeURIComponent(a.sessionId)}` +
      `&bProject=${encodeURIComponent(b.projectDir)}&bSession=${encodeURIComponent(b.sessionId)}`,
  );

export function money(value: number | null): string {
  if (value === null) return "unpriced";
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

export function duration(ms: number): string {
  if (ms <= 0) return "—";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function timeOf(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
