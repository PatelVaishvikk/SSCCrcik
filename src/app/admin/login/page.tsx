import Link from "next/link";
import AdminAuthPanel from "@/components/admin/AdminAuthPanel";
import styles from "../admin.module.css";

export default function AdminLoginPage() {
  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <span className="badge">Admin access</span>
          <h1 className={styles.heroTitle}>Suhrad Sports Club console</h1>
          <p className={styles.heroText}>
            Use your @suhradsportsclub.ca email to sign in or create an organizer
            account. Admin access unlocks tournament setup, team management, and
            smart scoring tools.
          </p>
          <div className={styles.heroActions}>
            <Link className="pill" href="/">
              Back to home
            </Link>
            <Link className="pill" href="/live">
              Live scores
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.authShell}>
            <AdminAuthPanel />
            <div className="card">
              <div className="list">
                <span className="kicker">Admin tools</span>
                <strong>What you can do</strong>
                <div className={styles.noteList}>
                  <span>1. Create ACT/ABCT tournaments.</span>
                  <span>2. Add teams, captains, and vice captains.</span>
                  <span>3. Schedule matches and overs.</span>
                  <span>4. Run smart scoring with strike rotation.</span>
                </div>
                <span className="text-muted">
                  Only Suhrad Sports Club organizers can access the admin console.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
