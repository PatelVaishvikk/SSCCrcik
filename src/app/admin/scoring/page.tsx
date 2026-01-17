import Link from "next/link";
import SmartScoringBoard from "@/components/admin/SmartScoringBoard";
import AdminFlow from "@/components/admin/AdminFlow";
import styles from "../admin.module.css";

export default function AdminScoringPage() {
  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <span className="badge">Admin / scoring</span>
          <h1 className={styles.heroTitle}>Smart scoring desk</h1>
          <p className={styles.heroText}>
            Run live scoring with instant run rates, wickets, and ball tracking.
            Keep match summaries sharp for the analysis dashboard.
          </p>
          <div className={styles.heroActions}>
            <Link className="pill" href="/admin">
              Back to admin
            </Link>
            <Link className="pill" href="/admin/matches">
              Match control
            </Link>
            <Link className="pill" href="/admin/scoring-v2">
              Scoring console v2
            </Link>
            <Link className="pill" href="/admin/players">
              Player assignment
            </Link>
            <Link className="pill" href="/tournaments">
              View match center
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <AdminFlow current="scoring" />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.builderGrid}>
            <SmartScoringBoard />
            <div className={styles.stack}>
              <div className="card">
                <div className="list">
                  <span className="kicker">Scoring notes</span>
                  <strong>Keep the feed clean</strong>
                  <div className={styles.noteList}>
                    <span>1. Tap runs for legal balls only.</span>
                    <span>2. Use Wd or Nb for extras without ball count.</span>
                    <span>3. Track wickets to keep strike rate accurate.</span>
                    <span>4. Undo the last ball if needed.</span>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="list">
                  <span className="kicker">Next steps</span>
                  <strong>After the innings</strong>
                  <span className="text-muted">
                    Switch batting at the innings break and keep the scorecard ready
                    for match center analysis.
                  </span>
                  <div className={styles.linkRow}>
                    <Link className="pill" href="/admin/matches">
                      Update fixtures
                    </Link>
                    <Link className="pill" href="/tournaments">
                      Review analytics
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
