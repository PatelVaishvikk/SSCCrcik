import Link from "next/link";
import type { CSSProperties } from "react";
import { getYearSummaries } from "@/lib/data";
import styles from "./page.module.css";

export default async function TournamentsPage() {
  const summaries = await getYearSummaries();

  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <div className="list">
            <span className="badge">Tournament archives</span>
            <h1 className={styles.heroTitle}>Choose a season</h1>
            <p>
              Select a year to explore ACT and ABCT tournaments, match centers,
              scorecards, and leaderboards.
            </p>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <div className={styles.yearGrid}>
            {summaries.map((summary, index) => (
              <Link
                key={summary.year}
                href={`/tournaments/${summary.year}`}
                className={`card ${styles.yearCard} reveal`}
                prefetch={false}
                style={{ "--delay": `${index * 60}ms` } as CSSProperties}
              >
                <span className="pill">Season {summary.year}</span>
                <div className="stat">
                  <span className="stat-value">{summary.matches}</span>
                  <span className="stat-label">Matches</span>
                </div>
                <div className={styles.yearMeta}>
                  <span>ACT: {summary.actEvents}</span>
                  <span>ABCT: {summary.abctEvents}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
