import PlayerDirectory from "@/components/PlayerDirectory";
import { getPlayerCount } from "@/lib/data";
import styles from "./page.module.css";

export default async function PlayersPage() {
  const playerCount = await getPlayerCount();

  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroGrid}>
            <div className="list">
              <span className="badge">Player history</span>
              <h1 className={styles.heroTitle}>Every player, every season</h1>
              <p>
                Search across {playerCount} players. Each profile merges
                tournaments, stats, and match highlights.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <PlayerDirectory initialTotal={playerCount} />
        </div>
      </section>
    </div>
  );
}
