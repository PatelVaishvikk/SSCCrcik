import { getYearSummaries } from "@/lib/data";
import SeasonHubClient from "./season-hub-client";
import styles from "./page.module.css";

export default async function TournamentsHubPage() {
  const summaries = await getYearSummaries();
  const years = summaries.map((summary) => summary.year);
  const latestYear = years[0] || new Date().getFullYear();

  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <span className="badge">Tournament hub</span>
          <h1 className={styles.heroTitle}>Pick a season</h1>
          <p>
            Choose a year to open the season archive, leaderboards, or the match center.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SeasonHubClient summaries={summaries} latestYear={latestYear} />
        </div>
      </section>
    </div>
  );
}
