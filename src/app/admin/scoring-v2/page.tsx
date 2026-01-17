import Link from "next/link";
import AdminFlow from "@/components/admin/AdminFlow";
import AdminMatchScorer from "@/components/admin/AdminMatchScorer";
import styles from "../admin.module.css";

export default function ScoringConsolePage() {
  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <span className="badge">Admin / scoring v2</span>
          <h1 className={styles.heroTitle}>Live scoring console</h1>
          <p className={styles.heroText}>
            Production-grade ball-by-ball scoring with audit-safe undo/edit support and
            instant snapshots.
          </p>
          <div className={styles.heroActions}>
            <Link className="pill" href="/admin">
              Back to admin
            </Link>
            <Link className="pill" href="/admin/scoring">
              Legacy scorer
            </Link>
            <Link className="pill" href="/admin/matches">
              Match control
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
          <AdminMatchScorer />
        </div>
      </section>
    </div>
  );
}
