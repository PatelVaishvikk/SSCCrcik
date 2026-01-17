import Link from "next/link";
import { formatDate } from "@/lib/format";
import {
  getAvailableYears,
  getRecentMatches,
  getYearData,
  getYearSummary,
} from "@/lib/data";
import { getAdminSession } from "@/lib/admin-session";
import LiveMatchesBoardClient from "@/components/LiveMatchesBoardClient";
import styles from "./page.module.css";

export default async function Home() {
  const years = await getAvailableYears();
  const recentMatches = await getRecentMatches(6);
  const session = await getAdminSession();
  const latestYear = years[0];
  const latestData = latestYear ? await getYearData(latestYear) : null;
  const summaries = await Promise.all(years.map((year) => getYearSummary(year)));

  const latestAct = latestData?.tournaments?.act?.events?.[0];
  const latestAbct = latestData?.tournaments?.abct?.events?.[0];
  const topBatter = latestAct?.combined?.leaderboards?.batting?.[0];
  const topBowler = latestAct?.combined?.leaderboards?.bowling?.[0];

  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          {/* <span className="badge">Suhrad Sports Club</span> */}
          <div style={{ marginBottom: "20px" }}>
            <img src="/suhrad-logo.png" alt="Suhrad Sports Club" style={{ maxWidth: "300px", height: "auto" }} />
          </div>
          <h1 className={styles.heroTitle}>Cricket Command Center</h1>
          <p>
            Season archives, smart scoring, and performance analysis built for
            SSC tournaments.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-title">
            <span className="kicker">Live now</span>
            <h2>SSC live scores</h2>
            <p>Instant scorecards powered by smart scoring.</p>
          </div>
          <LiveMatchesBoardClient />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.dashboard}>
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <span className="kicker">Live center</span>
                  <h2>Recent results</h2>
                </div>
                <Link className="pill" href={`/tournaments/${latestYear}/matches`}>
                  Full match center
                </Link>
              </div>
              <div className={styles.scoreList}>
                {recentMatches.map((item) => {
                  const match = item.match;
                  const matchId = match.match_id;
                  const tournamentId = match.tournament_id;
                  const href = matchId && tournamentId ? `/match/${tournamentId}/${matchId}` : "/";
                  return (
                    <Link key={`${matchId}-${tournamentId}`} href={href} className={styles.scoreItem}>
                      <div className={styles.scoreTeams}>
                        <span>{match.team_a}</span>
                        <span>{match.team_a_summary || "-"}</span>
                      </div>
                      <div className={styles.scoreTeams}>
                        <span>{match.team_b}</span>
                        <span>{match.team_b_summary || "-"}</span>
                      </div>
                      <span className={styles.scoreMeta}>
                        {match.match_summary?.summary || match.match_result}
                      </span>
                      <span className={styles.scoreMeta}>
                        {match.tournament_name} • {formatDate(match.match_start_time)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className={styles.panel}>
              {session ? (
                <div className="card emphasis">
                  <div className={styles.panelHeader}>
                    <div>
                      <span className="kicker">Admin hub</span>
                      <h2>Organizer actions</h2>
                    </div>
                  </div>
                  <div className={styles.actionGrid}>
                    <Link href="/admin/scoring" className="pill">
                      Start scoring
                    </Link>
                    <Link href="/admin/tournaments" className="pill">
                      Create tournament
                    </Link>
                    <Link href="/admin/matches" className="pill">
                      Create match
                    </Link>
                    <Link href="/admin/teams" className="pill">
                      Build teams
                    </Link>
                    <Link href="/admin" className="pill">
                      Admin dashboard
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="card emphasis">
                  <div className={styles.panelHeader}>
                    <div>
                      <span className="kicker">Admin</span>
                      <h2>Organizer login</h2>
                    </div>
                  </div>
                  <span className="text-muted">
                    Admin tools appear after signing in with an SSC account.
                  </span>
                  <div className={styles.actionGrid}>
                    <Link href="/admin/login" className="pill">
                      Admin login
                    </Link>
                  </div>
                </div>
              )}

              <div className="card">
                <div className={styles.panelHeader}>
                  <div>
                    <span className="kicker">Season spotlight</span>
                    <h2>{latestYear} highlights</h2>
                  </div>
                </div>
                <div className={styles.leaderSpotlight}>
                  <div className="stat">
                    <span className="stat-value">{topBatter?.name || "TBD"}</span>
                    <span className="stat-label">Top batter</span>
                  </div>
                  <div className="stat">
                    <span className="stat-value">{topBowler?.name || "TBD"}</span>
                    <span className="stat-label">Top bowler</span>
                  </div>
                  <span className="text-muted">
                    {latestAct?.event_name || ""}
                  </span>
                </div>
              </div>

              <div className="card">
                <div className={styles.panelHeader}>
                  <div>
                    <span className="kicker">ABCT snapshot</span>
                    <h2>{latestAbct?.event_name || "ABCT"}</h2>
                  </div>
                </div>
                <div className={styles.leaderSpotlight}>
                  <span className="text-muted">
                    Matches: {latestAbct?.combined?.schedule?.length || 0}
                  </span>
                  <Link href={`/tournaments/${latestYear}`} className="pill">
                    View ABCT season
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-title">
            <span className="kicker">Seasons</span>
            <h2>Year-wise tournaments</h2>
          </div>
          <div className={styles.yearGrid}>
            {summaries.map((summary) => (
              <Link key={summary.year} href={`/tournaments/${summary.year}`} className="card">
                <div className="list">
                  <strong>Season {summary.year}</strong>
                  <span className="text-muted">Matches: {summary.matches}</span>
                  <span className="text-muted">ACT: {summary.actEvents} • ABCT: {summary.abctEvents}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
