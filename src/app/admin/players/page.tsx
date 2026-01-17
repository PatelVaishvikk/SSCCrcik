import Link from "next/link";
import MatchPlayersBuilder from "@/components/admin/MatchPlayersBuilder";
import AdminFlow from "@/components/admin/AdminFlow";
import styles from "../admin.module.css";

export default function AdminPlayersPage() {
  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <span className="badge">Admin / players</span>
          <h1 className={styles.heroTitle}>Match player assignment</h1>
          <p className={styles.heroText}>
            Add past or new players to each match squad so the scoring desk only
            shows the right roster for the selected fixture.
          </p>
          <div className={styles.heroActions}>
            <Link className="pill" href="/admin">
              Back to admin
            </Link>
            <Link className="pill" href="/admin/matches">
              Match control
            </Link>
            <Link className="pill" href="/admin/scoring">
              Open scoring
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <AdminFlow current="players" />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.builderGrid}>
            <MatchPlayersBuilder />
            <div className={styles.stack}>
              <div className="card">
                <div className="list">
                  <span className="kicker">Squad tips</span>
                  <strong>Match-ready rosters</strong>
                  <span className="text-muted">
                    Add only the players available for this fixture to keep the
                    scoring desk clean.
                  </span>
                  <span className="text-muted">
                    Use imports from past events to speed up roster setup.
                  </span>
                </div>
              </div>
              <div className="card">
                <div className="list">
                  <span className="kicker">Workflow</span>
                  <strong>From squads to scoring</strong>
                  <div className={styles.noteList}>
                    <span>1. Pick a tournament and match.</span>
                    <span>2. Load or build squads for both teams.</span>
                    <span>3. Save squads before the toss.</span>
                    <span>4. Start scoring with the filtered roster.</span>
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
