import Link from "next/link";
import MatchBuilder from "@/components/admin/MatchBuilder";
import AdminFlow from "@/components/admin/AdminFlow";
import styles from "../admin.module.css";

export default function AdminMatchesPage() {
  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <span className="badge">Admin / matches</span>
          <h1 className={styles.heroTitle}>Match control</h1>
          <p className={styles.heroText}>
            Build fixtures for every tournament, assign teams, overs, and match dates
            so the scoring console is ready to go.
          </p>
          <div className={styles.heroActions}>
            <Link className="pill" href="/admin">
              Back to admin
            </Link>
            <Link className="pill" href="/admin/tournaments">
              Tournament builder
            </Link>
            <Link className="pill" href="/admin/players">
              Player assignment
            </Link>
            <Link className="pill" href="/admin/scoring">
              Open scoring
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <AdminFlow current="matches" />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.builderGrid}>
            <MatchBuilder />
            <div className={styles.stack}>
              <div className="card">
                <div className="list">
                  <span className="kicker">Fixtures</span>
                  <strong>Match setup tips</strong>
                  <span className="text-muted">
                    Use consistent team names across fixtures so player history stays clean.
                  </span>
                  <span className="text-muted">
                    Add overs for the format so run rates and analysis panels stay accurate.
                  </span>
                </div>
              </div>
              <div className="card">
                <div className="list">
                  <span className="kicker">Workflow</span>
                  <strong>From fixture to scoreboard</strong>
                  <div className={styles.noteList}>
                    <span>1. Enter tournament name and match details.</span>
                    <span>2. Save the fixture draft before match day.</span>
                    <span>3. Open smart scoring once the toss is done.</span>
                    <span>4. Review stats in the match center.</span>
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
