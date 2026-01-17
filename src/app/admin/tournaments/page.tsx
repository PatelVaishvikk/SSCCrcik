import Link from "next/link";
import TournamentBuilder from "@/components/admin/TournamentBuilder";
import AdminFlow from "@/components/admin/AdminFlow";
import styles from "../admin.module.css";

export default function AdminTournamentsPage() {
  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <span className="badge">Admin / tournaments</span>
          <h1 className={styles.heroTitle}>Tournament builder</h1>
          <p className={styles.heroText}>
            Spin up ACT and ABCT seasons, set date ranges, and keep ABCT courts merged
            into a single yearly champion.
          </p>
          <div className={styles.heroActions}>
            <Link className="pill" href="/admin">
              Back to admin
            </Link>
            <Link className="pill" href="/admin/matches">
              Add matches
            </Link>
            <Link className="pill" href="/admin/scoring">
              Open scoring
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <AdminFlow current="tournaments" />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.builderGrid}>
            <TournamentBuilder />
            <div className={styles.stack}>
              <div className="card">
                <div className="list">
                  <span className="kicker">Formats</span>
                  <strong>ACT vs ABCT</strong>
                  <span className="text-muted">
                    ACT covers full ground tournaments with match schedules and leaderboards.
                  </span>
                  <span className="text-muted">
                    ABCT merges multi-court brackets into a single yearly champion.
                  </span>
                </div>
              </div>
              <div className="card">
                <div className="list">
                  <span className="kicker">Checklist</span>
                  <strong>Before you publish</strong>
                  <div className={styles.noteList}>
                    <span>1. Confirm tournament name and year.</span>
                    <span>2. Add start and end dates for schedule grouping.</span>
                    <span>3. Move to match control to enter fixtures.</span>
                    <span>4. Use smart scoring to capture live stats.</span>
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
