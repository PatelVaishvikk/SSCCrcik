import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatRange, formatNumber } from "@/lib/format";
import { getAbctYearSummary, getYearData } from "@/lib/data";
import styles from "./page.module.css";

type YearPageProps = {
  params: Promise<{ year: string }>;
};

function getTeams(schedule: Array<Record<string, any>>) {
  const teams = new Set<string>();
  for (const match of schedule) {
    if (match.team_a) teams.add(String(match.team_a));
    if (match.team_b) teams.add(String(match.team_b));
  }
  return [...teams];
}

function getLeaderboards(event: Record<string, any>) {
  const lb = event.combined?.leaderboards || {};
  return {
    batting: lb.batting || [],
    bowling: lb.bowling || [],
    fielding: lb.fielding || [],
    mvp: lb.mvp || [],
  };
}

function getEventStats(event: Record<string, any>) {
  const schedule = event.combined?.schedule || [];
  const teams = getTeams(schedule);
  const players = Number(event.player_count) || 0;
  return {
    matches: Number(event.schedule_count) || schedule.length,
    teams: teams.length,
    players,
  };
}

export default async function YearPage({ params }: YearPageProps) {
  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!year) return notFound();
  const data = await getYearData(year);
  if (!data) return notFound();

  const abctSummary = await getAbctYearSummary(year);

  const actEvents = data.tournaments?.act?.events || [];
  const abctEvents = data.tournaments?.abct?.events || [];
  const eventTabs = [
    ...actEvents.map((event: any, index: number) => ({
      label: `ACT: ${event.event_name}`,
      id: `act-${index}`,
    })),
    ...abctEvents.map((event: any, index: number) => ({
      label: `ABCT: ${event.event_name}`,
      id: `abct-${index}`,
    })),
  ];

  return (
    <div>
      <section className={styles.yearHero}>
        <div className="container">
          <div className={styles.heroGrid}>
            <div className="list">
              <span className="badge">Season {year}</span>
              <h1 className={styles.yearTitle}>Atmiya Cricket Tournaments</h1>
              <p>
                Year-wise ACT and ABCT results with merged court data, match centers,
                and leaderboards.
              </p>
              <div className={styles.yearMeta}>
                <span className="pill">ACT events: {actEvents.length}</span>
                <span className="pill">ABCT events: {abctEvents.length}</span>
                <span className="pill">
                  Updated {formatDate(data.generated_at || "")}
                </span>
              </div>
              <div className={styles.yearNav}>
                <Link href="#overview" className={styles.navLink}>
                  Overview
                </Link>
                <Link href={`/tournaments/${year}/matches`} className={styles.navLink}>
                  Match center
                </Link>
                <Link href={`/tournaments/${year}/leaderboards`} className={styles.navLink}>
                  Leaderboards
                </Link>
              </div>
              <div className={styles.eventTabs}>
                {eventTabs.map((tab) => (
                  <Link key={tab.id} href={`#${tab.id}`} className={styles.tabLink}>
                    {tab.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="overview" className="section">
        <div className="container">
          <div className="section-title">
            <span className="kicker">Season overview</span>
            <h2>Quick tournament snapshots</h2>
            <p>Jump into leaderboards, analysis, or match scorecards.</p>
          </div>
          <div className={styles.eventSection}>
            <div className={styles.eventHeader}>
              <div>
                <span className={styles.sectionTag}>ACT tournaments</span>
                <h3>Atmiya Cricket Tournaments</h3>
              </div>
              <Link href={`/tournaments/${year}/matches#act-0`} className="pill">
                Jump to ACT matches
              </Link>
            </div>
            <div className={styles.eventGrid}>
              {actEvents.map((event: any, index: number) => {
                const stats = getEventStats(event);
                const leaderboards = getLeaderboards(event);
                const eventId = `act-${index}`;
                return (
                  <article
                    key={eventId}
                    id={eventId}
                    className={`${styles.eventCard} ${styles.sectionAnchor}`}
                  >
                    <div className={styles.eventCover}>
                      <span className={styles.eventType}>ACT</span>
                      <span className={styles.eventDates}>
                        {formatRange(event.start_date, event.end_date)}
                      </span>
                    </div>
                    <div className={styles.eventBody}>
                      <strong>{event.event_name}</strong>
                      <div className={styles.eventStats}>
                        <div>
                          <span>Matches</span>
                          <strong>{stats.matches}</strong>
                        </div>
                        <div>
                          <span>Teams</span>
                          <strong>{stats.teams}</strong>
                        </div>
                        <div>
                          <span>Players</span>
                          <strong>{formatNumber(stats.players)}</strong>
                        </div>
                      </div>
                      <div className={styles.eventHighlight}>
                        <span className="text-muted">Top batter</span>
                        <strong>{leaderboards.batting?.[0]?.name || "TBD"}</strong>
                      </div>
                      <div className={styles.eventActions}>
                        <Link
                          href={`/tournaments/${year}/leaderboards#${eventId}`}
                          className="pill"
                        >
                          Leaderboards
                        </Link>
                        <Link href={`/tournaments/${year}/matches#${eventId}`} className="pill">
                          Match center
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
          <div className={styles.eventSection}>
            <div className={styles.eventHeader}>
              <div>
                <span className={styles.sectionTag}>ABCT tournaments</span>
                <h3>Atmiya Box Cricket Tournaments</h3>
              </div>
              <Link href={`/tournaments/${year}/matches#abct-0`} className="pill">
                Jump to ABCT matches
              </Link>
            </div>
            <div className={styles.eventGrid}>
              {abctEvents.map((event: any, index: number) => {
                const stats = getEventStats(event);
                const leaderboards = getLeaderboards(event);
                const eventId = `abct-${index}`;
                const winner = abctSummary?.overall_winner;
                return (
                  <article
                    key={eventId}
                    id={eventId}
                    className={`${styles.eventCard} ${styles.sectionAnchor}`}
                  >
                    <div className={styles.eventCover}>
                      <span className={styles.eventType}>ABCT</span>
                      <span className={styles.eventDates}>
                        {formatRange(event.start_date, event.end_date)}
                      </span>
                    </div>
                    <div className={styles.eventBody}>
                      <strong>{event.event_name}</strong>
                      {winner ? (
                        <span className={styles.championTag}>
                          Champion: {winner.team_name}
                        </span>
                      ) : null}
                      <div className={styles.eventStats}>
                        <div>
                          <span>Matches</span>
                          <strong>{stats.matches}</strong>
                        </div>
                        <div>
                          <span>Teams</span>
                          <strong>{stats.teams}</strong>
                        </div>
                        <div>
                          <span>Players</span>
                          <strong>{formatNumber(stats.players)}</strong>
                        </div>
                      </div>
                      <div className={styles.eventHighlight}>
                        <span className="text-muted">Top batter</span>
                        <strong>{leaderboards.batting?.[0]?.name || "TBD"}</strong>
                      </div>
                      <div className={styles.eventActions}>
                        <Link
                          href={`/tournaments/${year}/leaderboards#${eventId}`}
                          className="pill"
                        >
                          Leaderboards
                        </Link>
                        <Link href={`/tournaments/${year}/matches#${eventId}`} className="pill">
                          Match center
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.footerSection}>
        <div className="container">
          <Link href="/" className="pill">
            Back to home
          </Link>
        </div>
      </section>
    </div>
  );
}
