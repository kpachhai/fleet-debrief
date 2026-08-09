import { useEffect, useState } from "react";
import { DebriefView } from "./views/DebriefView.js";
import { SessionView } from "./views/SessionView.js";
import { DiffView } from "./views/DiffView.js";

/**
 * Hash routing, no router dependency. Three routes:
 *   #/                                  the debrief (default)
 *   #/session/<projectDir>/<sessionId>  one run's timeline
 *   #/diff/<aProj>/<aSess>/<bProj>/<bSess>  two runs, aligned
 */
function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);

  let view: React.ReactNode;
  if (parts[0] === "session" && parts.length >= 3) {
    view = (
      <SessionView
        projectDir={decodeURIComponent(parts[1])}
        sessionId={decodeURIComponent(parts[2])}
      />
    );
  } else if (parts[0] === "diff" && parts.length >= 5) {
    view = (
      <DiffView
        a={{
          projectDir: decodeURIComponent(parts[1]),
          sessionId: decodeURIComponent(parts[2]),
        }}
        b={{
          projectDir: decodeURIComponent(parts[3]),
          sessionId: decodeURIComponent(parts[4]),
        }}
      />
    );
  } else {
    view = <DebriefView />;
  }

  return (
    <>
      <header className="top">
        <h1>fleet-debrief</h1>
        <span className="sub">what your agents did while you were away</span>
        <nav>
          <a href="#/">debrief</a>
        </nav>
      </header>
      {view}
    </>
  );
}
