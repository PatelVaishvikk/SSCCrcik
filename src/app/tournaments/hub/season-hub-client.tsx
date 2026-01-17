"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./page.module.css";

type YearSummary = {
  year: number;
  actEvents: number;
  abctEvents: number;
  matches: number;
};

export default function SeasonHubClient({
  summaries,
  latestYear,
}: {
  summaries: YearSummary[];
  latestYear: number;
}) {
  const searchParams = useSearchParams();
  const view = String(searchParams.get("view") || "").toLowerCase();
  const [selectedYear, setSelectedYear] = useState(latestYear);

  const activeSummary = useMemo(
    () => summaries.find((summary) => summary.year === selectedYear),
    [summaries, selectedYear]
  );

  const yearButtons = summaries.map((summary) => {
    const active = summary.year === selectedYear;
    return (
      <button
        key={summary.year}
        type="button"
        className={`pill ${active ? "pill-active" : ""}`}
        onClick={() => setSelectedYear(summary.year)}
      >
        {summary.year}
      </button>
    );
  });

  const actionCards = [
    {
      key: "seasons",
      title: "Season archive",
      description: "ACT + ABCT summaries, highlight heroes, and timeline cards.",
      href: `/tournaments/${selectedYear}`,
      hint: "Season overview",
    },
    {
      key: "leaderboards",
      title: "Leaderboards",
      description: "Top batters, bowlers, fielders, and MVP tables.",
      href: `/tournaments/${selectedYear}/leaderboards`,
      hint: "Stats tables",
    },
    {
      key: "matches",
      title: "Match center",
      description: "Broadcast match cards, scorecards, and fixtures.",
      href: `/tournaments/${selectedYear}/matches`,
      hint: "Live + results",
    },
  ];

  return (
    <div className={styles.hubGrid}>
      <div className={`card ${styles.selectorCard}`}>
        <div className={styles.cardHeader}>
          <span className="kicker">Season selector</span>
          <h2 className={styles.cardTitle}>Choose a year</h2>
          <p className={styles.cardText}>The same year powers all leaderboards and matches.</p>
        </div>
        <div className={styles.yearRow}>{yearButtons}</div>
        <div className={styles.summaryGrid}>
          <div className="stat">
            <span className="stat-value">{activeSummary?.matches || 0}</span>
            <span className="stat-label">Matches</span>
          </div>
          <div className="stat">
            <span className="stat-value">{activeSummary?.actEvents || 0}</span>
            <span className="stat-label">ACT events</span>
          </div>
          <div className="stat">
            <span className="stat-value">{activeSummary?.abctEvents || 0}</span>
            <span className="stat-label">ABCT events</span>
          </div>
        </div>
      </div>

      <div className={styles.actionGrid}>
        {actionCards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className={`card ${styles.actionCard} ${
              view && view === card.key ? styles.actionActive : ""
            }`}
            prefetch={false}
          >
            <span className="pill">{card.hint}</span>
            <strong className={styles.actionTitle}>{card.title}</strong>
            <span className="text-muted">{card.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
