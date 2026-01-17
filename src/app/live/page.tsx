import LiveMatchesBoardClient from "@/components/LiveMatchesBoardClient";
import styles from "./page.module.css";

export default function LivePage() {
  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <span className="badge">Live center</span>
          <h1 className={styles.heroTitle}>Matchday live feed</h1>
          <p className={styles.heroText}>
            Follow live SSC matches with over-by-over updates, strike rotation,
            and real-time run rates.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-title">
            <span className="kicker">Live now</span>
            <h2>Smart scorecards</h2>
          </div>
          <LiveMatchesBoardClient />
        </div>
      </section>
    </div>
  );
}
