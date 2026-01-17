import Link from "next/link";
import TeamBuilder from "@/components/admin/TeamBuilder";
import AdminFlow from "@/components/admin/AdminFlow";
import styles from "../admin.module.css";

export default function AdminTeamsPage() {
  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <span className="badge">Admin / teams</span>
          <h1 className={styles.heroTitle}>Team management</h1>
          <p className={styles.heroText}>
            Build tournament rosters, assign captains and vice captains, and keep
            player pools consistent across seasons. Import past tournament teams
            or build brand-new squads with fresh registrations.
          </p>
          <div className={styles.heroActions}>
            <Link className="pill" href="/admin">
              Back to admin
            </Link>
            <Link className="pill" href="/admin/tournaments">
              Tournament builder
            </Link>
            <Link className="pill" href="/admin/matches">
              Match control
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <AdminFlow current="teams" />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.builderGrid}>
            <TeamBuilder />
            <div className={styles.stack}>
              <div className="card">
                <div className="list">
                  <span className="kicker">Roster tips</span>
                  <strong>Balanced squads</strong>
                  <span className="text-muted">
                    Select a mix of batters, bowlers, and all-rounders for each team.
                  </span>
                  <span className="text-muted">
                    Use captains and vice captains to highlight leadership roles.
                  </span>
                </div>
              </div>
              <div className="card">
                <div className="list">
                  <span className="kicker">Workflow</span>
                  <strong>After team setup</strong>
                  <div className={styles.noteList}>
                    <span>1. Create matches using these team rosters.</span>
                    <span>2. Select squads inside smart scoring.</span>
                    <span>3. Review live stats in the public score center.</span>
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
