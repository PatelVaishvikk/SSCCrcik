import Link from "next/link";
import LiveScoreboard from "@/components/LiveScoreboard";
import styles from "./page.module.css";

type LivePageProps = {
  params: Promise<{ matchId: string }>;
};

export default async function LiveMatchPage({ params }: LivePageProps) {
  const { matchId } = await params;

  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <span className="badge">Live scoreboard</span>
          <h1 className={styles.heroTitle}>Match live updates</h1>
          <p className={styles.heroText}>
            Real-time SSC scoreboard with strike rotation, run rate, and recent balls.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <LiveScoreboard matchId={matchId} />
          <div className={styles.linkRow}>
            <Link href="/live">Back to live center</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
