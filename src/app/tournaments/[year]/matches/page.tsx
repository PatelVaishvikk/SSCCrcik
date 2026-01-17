import Link from "next/link";
import { notFound } from "next/navigation";
import MatchCard from "@/components/MatchCard";
import { formatRange } from "@/lib/format";
import { getYearData } from "@/lib/data";
import styles from "./page.module.css";

type YearPageProps = {
  params: Promise<{ year: string }>;
  searchParams?: { [key: string]: string | string[] | undefined };
};

function getParam(value?: string | string[]) {
  if (!value) return "";
  return Array.isArray(value) ? value[0] : value;
}

function getTeams(schedule: Array<Record<string, any>>) {
  const teams = new Set<string>();
  for (const match of schedule) {
    if (match.team_a) teams.add(String(match.team_a));
    if (match.team_b) teams.add(String(match.team_b));
  }
  return [...teams];
}

function getEventStats(event: Record<string, any>) {
  const schedule = event.combined?.schedule || [];
  return {
    matches: schedule.length,
    teams: getTeams(schedule).length,
  };
}

export default async function MatchesPage({ params, searchParams }: YearPageProps) {
  const { year: yearParam } = await params;
  const sp = await searchParams;
  const year = Number(yearParam);
  if (!year) return notFound();
  const data = await getYearData(year);
  if (!data) return notFound();

  const actEvents = data.tournaments?.act?.events || [];
  const abctEvents = data.tournaments?.abct?.events || [];
  const sections = [
    ...actEvents.map((event: any, index: number) => ({
      event,
      index,
      type: "ACT",
    })),
    ...abctEvents.map((event: any, index: number) => ({
      event,
      index,
      type: "ABCT",
    })),
  ];
  const activeEvent = getParam(sp?.event);
  const viewParam = getParam(sp?.view);
  const hasActiveEvent = sections.some(
    (section) => `${section.type.toLowerCase()}-${section.index}` === activeEvent,
  );
  const showAll = viewParam === "all" && hasActiveEvent;
  const visibleSections = showAll
    ? sections.filter(
        (section) => `${section.type.toLowerCase()}-${section.index}` === activeEvent,
      )
    : sections;
  const featuredMatch = sections
    .flatMap((section) => section.event.combined?.schedule || [])
    .sort((a, b) => {
      const aDate = Date.parse(a.match_start_time || a.created_date || "") || 0;
      const bDate = Date.parse(b.match_start_time || b.created_date || "") || 0;
      return bDate - aDate;
    })[0];

  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <span className="badge">Match center</span>
              <h1 className={styles.heroTitle}>Season {year} match hub</h1>
              <p>Browse every match, open scorecards, and track results by event.</p>
              <div className={styles.tabRow}>
                <Link href="#all-matches" className={styles.tabLink}>
                  All matches
                </Link>
                {sections.map(({ event, index, type }) => {
                  const eventId = `${type.toLowerCase()}-${index}`;
                  return (
                    <Link key={eventId} href={`#${eventId}`} className={styles.tabLink}>
                      {type}: {event.event_name}
                    </Link>
                  );
                })}
              </div>
            </div>
            {featuredMatch ? (
              <div className={styles.heroCard}>
                <MatchCard match={featuredMatch} className={styles.featuredCard} />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section id="all-matches" className={styles.sectionAnchor} />

      {visibleSections.map(({ event, index, type }) => {
          const eventId = `${type.toLowerCase()}-${index}`;
          const schedule = [...(event.combined?.schedule || [])].sort((a, b) => {
            const aDate = Date.parse(a.match_start_time || a.created_date || "") || 0;
            const bDate = Date.parse(b.match_start_time || b.created_date || "") || 0;
            return bDate - aDate;
          });
          const stats = getEventStats(event);
          const isActive = showAll && activeEvent === eventId;
          const visibleMatches = isActive ? schedule : schedule.slice(0, 6);
          const hasMore = schedule.length > visibleMatches.length;

          return (
            <section
              key={eventId}
              id={eventId}
              className={`${styles.matchSection} ${styles.sectionAnchor}`}
            >
              <div className="container">
                <div className={styles.matchHeader}>
                  <div className={styles.matchHeaderTop}>
                    <span className={styles.eventTag}>{type}</span>
                    <span className={styles.eventRange}>
                      {formatRange(event.start_date, event.end_date)}
                    </span>
                  </div>
                  <div className={styles.matchHeaderBody}>
                    <div>
                      <strong>{event.event_name}</strong>
                      <span className="text-muted">
                        {stats.matches} matches - {stats.teams} teams
                      </span>
                    </div>
                    <div className={styles.eventActions}>
                      <Link
                        href={`/tournaments/${year}/leaderboards#${eventId}`}
                        className="pill"
                      >
                        Leaderboards
                      </Link>
                      <Link href={`/tournaments/${year}#${eventId}`} className="pill">
                        Event overview
                      </Link>
                      {isActive ? (
                        <Link href={`/tournaments/${year}/matches#${eventId}`} className="pill">
                          Back to all events
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className={styles.matchGrid}>
                  {visibleMatches.map((match: any) => (
                    <MatchCard key={match.match_id} match={match} />
                  ))}
                </div>
                {hasMore ? (
                  <div className={styles.viewAllRow}>
                    <Link
                      href={`/tournaments/${year}/matches?event=${eventId}&view=all#${eventId}`}
                      className="pill"
                    >
                      View all matches ({schedule.length})
                    </Link>
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}

      <section className={styles.matchSection}>
        <div className="container">
          <Link href={`/tournaments/${year}`} className="pill">
            Back to season
          </Link>
        </div>
      </section>
    </div>
  );
}
