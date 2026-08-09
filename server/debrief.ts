import {
  listTranscriptFiles,
  type TranscriptFile,
} from "./transcripts.js";
import { summarizeFile, type SessionSummary, type TokenTotals } from "./sessions.js";
import { totalCost, PRICING_AS_OF, type TokenCounts } from "./pricing.js";

/**
 * The debrief: what the fleet did since a point in time, priced and grouped by
 * project. This is the view for the morning after an overnight run - every
 * session that was active in the window, its cost, its blast radius, and the
 * signals that deserve a second look (hook errors, denials, unparseable lines).
 *
 * Selection is by file mtime, checked BEFORE parsing: a transcript untouched
 * since the window opened cannot contain activity inside it, so the corpus a
 * debrief reads is bounded by what actually ran rather than by everything on
 * disk.
 */

export type DebriefSession = SessionSummary & {
  /** Priced from the per-model token split; null when any model is unpriced. */
  costUsd: number | null;
  unpricedModels: string[];
  durationMs: number;
  /** Signals worth a second look, precomputed so the UI sorts on one number. */
  attentionScore: number;
};

export type DebriefProject = {
  cwd: string;
  projectDir: string;
  sessions: DebriefSession[];
  costUsd: number;
  filesTouched: number;
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
    /** Models seen in the window that the vendored table cannot price. */
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
  projects: DebriefProject[];
  /** True when the file cap truncated the window; the totals are then a floor. */
  truncated: boolean;
};

/** Most transcripts a single debrief will parse; beyond this it reports a floor. */
const MAX_FILES = 500;

function tokensAsCounts(tokens: TokenTotals): TokenCounts {
  return {
    input: tokens.input,
    output: tokens.output,
    cacheRead: tokens.cacheRead,
    cacheCreation: tokens.cacheCreation,
  };
}

/** Cost of one session from its per-model split. Null when anything is unpriced. */
export function sessionCost(summary: SessionSummary): {
  costUsd: number | null;
  unpricedModels: string[];
} {
  const byModel = new Map<string, TokenCounts>();
  for (const entry of summary.tokensByModel) {
    byModel.set(entry.model, tokensAsCounts(entry.tokens));
  }
  const cost = totalCost(byModel);
  // A session with an unpriced model reports null rather than a partial figure:
  // a cost that silently omits one model reads as complete while understating.
  if (cost.unpricedModels.length > 0) {
    return { costUsd: null, unpricedModels: cost.unpricedModels };
  }
  return { costUsd: cost.totalUsd, unpricedModels: [] };
}

function durationMs(summary: SessionSummary): number {
  if (!summary.startedAt || !summary.endedAt) return 0;
  const start = Date.parse(summary.startedAt);
  const end = Date.parse(summary.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return end - start;
}

function denialCount(summary: SessionSummary): number {
  return summary.toolDenials.reduce((sum, denial) => sum + denial.count, 0);
}

/**
 * One number the debrief sorts "needs attention" on. Weights are coarse on
 * purpose - this is a triage order, not a quality score, and pretending finer
 * precision than "errors outrank denials outrank parse skips" would be false.
 */
function attentionScore(summary: SessionSummary): number {
  return (
    summary.hookErrorRecords * 10 +
    denialCount(summary) * 5 +
    Math.min(summary.skippedLines, 20)
  );
}

export function buildDebrief(
  transcriptsDir: string,
  sinceHours: number,
  now: number = Date.now(),
): Debrief {
  const clampedHours = Math.min(Math.max(sinceHours, 1), 24 * 30);
  const sinceMs = now - clampedHours * 60 * 60 * 1000;

  const active: TranscriptFile[] = listTranscriptFiles(transcriptsDir).filter(
    (file) => file.mtimeMs >= sinceMs,
  );
  const truncated = active.length > MAX_FILES;
  const files = truncated ? active.slice(0, MAX_FILES) : active;

  const byProject = new Map<string, DebriefProject>();
  const totals: Debrief["totals"] = {
    sessions: 0,
    projects: 0,
    costUsd: 0,
    unpricedModels: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    filesTouched: 0,
    linesAdded: 0,
    linesRemoved: 0,
    sidechainTurns: 0,
    hookErrorRecords: 0,
    toolDenials: 0,
    skippedLines: 0,
  };
  const unpriced = new Set<string>();

  for (const file of files) {
    const summary = summarizeFile(file);
    const cost = sessionCost(summary);
    const session: DebriefSession = {
      ...summary,
      costUsd: cost.costUsd,
      unpricedModels: cost.unpricedModels,
      durationMs: durationMs(summary),
      attentionScore: attentionScore(summary),
    };

    let project = byProject.get(summary.projectDir);
    if (!project) {
      project = {
        cwd: summary.cwd,
        projectDir: summary.projectDir,
        sessions: [],
        costUsd: 0,
        filesTouched: 0,
      };
      byProject.set(summary.projectDir, project);
    }
    project.sessions.push(session);
    if (session.costUsd !== null) project.costUsd += session.costUsd;
    project.filesTouched += summary.filesTouched;

    totals.sessions++;
    if (session.costUsd !== null) totals.costUsd += session.costUsd;
    for (const model of cost.unpricedModels) unpriced.add(model);
    totals.tokens.input += summary.tokens.input;
    totals.tokens.output += summary.tokens.output;
    totals.tokens.cacheRead += summary.tokens.cacheRead;
    totals.tokens.cacheCreation += summary.tokens.cacheCreation;
    totals.filesTouched += summary.filesTouched;
    totals.linesAdded += summary.linesAdded;
    totals.linesRemoved += summary.linesRemoved;
    totals.sidechainTurns += summary.sidechainTurns;
    totals.hookErrorRecords += summary.hookErrorRecords;
    totals.toolDenials += denialCount(summary);
    totals.skippedLines += summary.skippedLines;
  }

  // Inside a project: attention first, then cost, then recency, so the row a
  // reader should look at first is the row they see first.
  for (const project of byProject.values()) {
    project.sessions.sort(
      (a, b) =>
        b.attentionScore - a.attentionScore ||
        (b.costUsd ?? 0) - (a.costUsd ?? 0) ||
        b.mtimeMs - a.mtimeMs,
    );
  }

  const projects = [...byProject.values()].sort(
    (a, b) => b.costUsd - a.costUsd || a.cwd.localeCompare(b.cwd),
  );
  totals.projects = projects.length;
  totals.unpricedModels = [...unpriced].sort();

  return {
    generatedAt: new Date(now).toISOString(),
    sinceHours: clampedHours,
    since: new Date(sinceMs).toISOString(),
    pricingAsOf: PRICING_AS_OF,
    totals,
    projects,
    truncated,
  };
}
