import { useEffect, useState } from "react";
import {
  fetchSession,
  money,
  timeOf,
  type SessionDetail,
} from "../api.js";
import { compact } from "../format.js";

export function SessionView({
  projectDir,
  sessionId,
}: {
  projectDir: string;
  sessionId: string;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSidechains, setShowSidechains] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    fetchSession(projectDir, sessionId)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [projectDir, sessionId]);

  if (error) return <div className="empty">{error}</div>;
  if (!detail) return <div className="empty">reading transcript…</div>;

  const totalTokens =
    detail.tokens.input +
    detail.tokens.output +
    detail.tokens.cacheRead +
    detail.tokens.cacheCreation;

  const entries = detail.timeline.filter(
    (entry) => showSidechains || !entry.isSidechain,
  );

  return (
    <>
      <div className="controls">
        <a href="#/">← debrief</a>
        <span className="hint">{detail.cwd}</span>
      </div>

      <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{detail.title}</h2>

      <div className="totals">
        <div className="stat">
          <div className="label">turns</div>
          <div className="value num">{detail.messageCount}</div>
        </div>
        <div className="stat">
          <div className="label">tokens</div>
          <div className="value num">{compact(totalTokens)}</div>
        </div>
        <div className="stat">
          <div className="label">files touched</div>
          <div className="value num">
            {detail.blastRadius.files}
            <small>
              {" "}
              +{compact(detail.blastRadius.linesAdded)}/−
              {compact(detail.blastRadius.linesRemoved)}
            </small>
          </div>
        </div>
        <div className="stat">
          <div className="label">subagent turns</div>
          <div className="value num">{detail.sidechainTurns}</div>
        </div>
        <div className="stat">
          <div className="label">models</div>
          <div className="value" style={{ fontSize: 13 }}>
            {detail.models.map((model) => model.name).join(", ") || "—"}
          </div>
        </div>
      </div>

      {detail.touchedFiles.length > 0 && (
        <section className="project">
          <h2>blast radius</h2>
          <table>
            <thead>
              <tr>
                <th>file</th>
                <th className="right">edits</th>
                <th className="right">+/−</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {detail.touchedFiles.map((file) => (
                <tr key={file.path}>
                  <td style={{ overflowWrap: "anywhere" }}>{file.path}</td>
                  <td className="right num">{file.edits}</td>
                  <td className="right num">
                    +{file.linesAdded}/−{file.linesRemoved}
                  </td>
                  <td>
                    {file.userModified && (
                      <span className="badge warn">user fixed after</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="project">
        <h2>
          timeline
          <label style={{ marginLeft: 12, fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={showSidechains}
              onChange={(event) => setShowSidechains(event.target.checked)}
            />{" "}
            show subagent turns
          </label>
        </h2>
        <ul className="timeline">
          {entries.map((entry, index) => (
            <li key={entry.uuid || index}>
              <span className="when num">{timeOf(entry.timestamp)}</span>
              <span
                className={
                  "who " +
                  (entry.isSidechain
                    ? "sidechain"
                    : entry.role === "assistant"
                      ? "assistant"
                      : "")
                }
              >
                {entry.isSidechain ? "subagent" : (entry.role ?? entry.type)}
                {entry.isBranchPoint ? " ⑂" : ""}
              </span>
              <span className="what">
                {entry.text && (
                  <div className="text">
                    {entry.text}
                    {entry.textTruncated ? "…" : ""}
                  </div>
                )}
                {entry.toolUses.length > 0 && (
                  <div className="tools">
                    {entry.toolUses
                      .map((tool) =>
                        tool.count > 1 ? `${tool.name}×${tool.count}` : tool.name,
                      )
                      .join(" · ")}
                  </div>
                )}
                {entry.denialKind && (
                  <span className="badge warn">denied: {entry.denialKind}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
