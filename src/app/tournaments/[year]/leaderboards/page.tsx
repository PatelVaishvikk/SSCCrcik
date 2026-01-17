import Link from "next/link";
import { notFound } from "next/navigation";
import LeaderboardCard from "@/components/LeaderboardCard";
import { formatRange } from "@/lib/format";
import { getYearData } from "@/lib/data";
import styles from "./page.module.css";

type YearPageProps = {
  params: Promise<{ year: string }>;
};

function getLeaderboards(event: Record<string, any>) {
  const lb = event.combined?.leaderboards || {};
  return {
    batting: lb.batting || [],
    bowling: lb.bowling || [],
    fielding: lb.fielding || [],
    mvp: lb.mvp || [],
  };
}

export default async function LeaderboardsPage({ params }: YearPageProps) {
  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!year) return notFound();
  const data = await getYearData(year);
  if (!data) return notFound();

  const actEvents = data.tournaments?.act?.events || [];
  const abctEvents = data.tournaments?.abct?.events || [];

  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <span className="badge">Leaderboards</span>
          <h1 className={styles.heroTitle}>Season {year} leaders</h1>
          <p>Top performers across batting, bowling, fielding, and MVP scores.</p>
        </div>
      </section>

      {[...actEvents.map((event: any, index: number) => ({
        event,
        index,
        type: "ACT",
      })),
      ...abctEvents.map((event: any, index: number) => ({
        event,
        index,
        type: "ABCT",
      }))]
        .map(({ event, index, type }) => {
          const leaderboards = getLeaderboards(event);
          const eventId = `${type.toLowerCase()}-${index}`;
          return (
            <section
              key={eventId}
              id={eventId}
              className={`${styles.boardSection} ${styles.sectionAnchor}`}
            >
              <div className="container">
                <div className={styles.boardHeader}>
                  <span className="pill">{type}</span>
                  <strong>{event.event_name}</strong>
                  <span className="text-muted">
                    {formatRange(event.start_date, event.end_date)}
                  </span>
                </div>
                <details className={styles.detailsBlock}>
                  <summary>Open leaderboards</summary>
                  <div className={styles.boardGrid}>
                    <LeaderboardCard title="Top batters" type="batting" entries={leaderboards.batting} />
                    <LeaderboardCard title="Top bowlers" type="bowling" entries={leaderboards.bowling} />
                    <LeaderboardCard title="Fielding" type="fielding" entries={leaderboards.fielding} />
                    <LeaderboardCard title="MVP" type="mvp" entries={leaderboards.mvp} />
                  </div>
                </details>
              </div>
            </section>
          );
        })}

      <section className={styles.boardSection}>
        <div className="container">
          <Link href={`/tournaments/${year}`}>Back to season</Link>
        </div>
      </section>
    </div>
  );
}
