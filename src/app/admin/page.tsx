import Link from "next/link";
import AdminLogoutButton from "@/components/admin/AdminLogoutButton";
import AdminFlow from "@/components/admin/AdminFlow";
import AdminResumeCard from "@/components/admin/AdminResumeCard";
import { formatDate } from "@/lib/format";
import { getAvailableYears, getLatestMatch, getYearSummary } from "@/lib/data";
import styles from "./admin.module.css";

export default async function AdminPage() {
  const years = await getAvailableYears();
  const summaries = await Promise.all(years.map((year) => getYearSummary(year)));
  const latestMatch = await getLatestMatch();

  const totals = summaries.reduce(
    (acc, summary) => ({
      matches: acc.matches + summary.matches,
      actEvents: acc.actEvents + summary.actEvents,
      abctEvents: acc.abctEvents + summary.abctEvents,
    }),
    { matches: 0, actEvents: 0, abctEvents: 0 }
  );

  const latest = latestMatch?.match;
  const latestLink =
    latest && latest.match_id && latest.tournament_id
      ? `/match/${latest.tournament_id}/${latest.match_id}`
      : "/tournaments";
  const latestYear = years[0];

  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <span className="badge">Admin center</span>
          <h1 className={styles.heroTitle}>Organizer command desk</h1>
          <p className={styles.heroText}>
            Build tournaments, schedule fixtures, and run smart scoring while keeping
            player history synced with every season.
          </p>
          <div className={styles.heroActions}>
            <Link className="pill" href="/admin/scoring">
              Open scoring desk
            </Link>
            <Link className="pill" href="/admin/scoring-v2">
              Scoring console v2
            </Link>
            <Link className="pill" href="/admin/tournaments">
              New tournament
            </Link>
            <Link className="pill" href="/admin/matches">
              Schedule match
            </Link>
            <Link className="pill" href="/tournaments">
              View seasons
            </Link>
            <AdminLogoutButton />
          </div>
          <AdminResumeCard />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-title">
            <span className="kicker">Workflow</span>
            <h2>Simple admin flow</h2>
            <p>
              Create tournaments, build teams, schedule matches, add match players,
              then score live.
            </p>
          </div>
          <AdminFlow />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.dashboard}>
            <div className={styles.stack}>
              <div className="card emphasis">
                <div className="list">
                  <span className="kicker">Operations</span>
                  <h2>Season coverage</h2>
                  <div className={styles.statGrid}>
                    <div className="stat">
                      <span className="stat-value">{years.length}</span>
                      <span className="stat-label">Seasons</span>
                    </div>
                    <div className="stat">
                      <span className="stat-value">{totals.matches}</span>
                      <span className="stat-label">Matches</span>
                    </div>
                    <div className="stat">
                      <span className="stat-value">{totals.actEvents}</span>
                      <span className="stat-label">ACT events</span>
                    </div>
                    <div className="stat">
                      <span className="stat-value">{totals.abctEvents}</span>
                      <span className="stat-label">ABCT events</span>
                    </div>
                  </div>
                  <span className="text-muted">
                    Latest season: {latestYear || "TBD"}
                  </span>
                </div>
              </div>

              <div className="card">
                <div className="list">
                  <span className="kicker">Latest result</span>
                  {latest ? (
                    <>
                      <div className={styles.matchTeams}>
                        <span>{latest.team_a}</span>
                        <span>{latest.team_a_summary || "-"}</span>
                      </div>
                      <div className={styles.matchTeams}>
                        <span>{latest.team_b}</span>
                        <span>{latest.team_b_summary || "-"}</span>
                      </div>
                      <span className="text-muted">
                        {latest.match_summary?.summary || latest.match_result}
                      </span>
                      <span className="text-muted">
                        {latest.tournament_name} • {formatDate(latest.match_start_time)}
                      </span>
                      <div className={styles.linkRow}>
                        <Link className="pill" href={latestLink}>
                          Open match center
                        </Link>
                      </div>
                    </>
                  ) : (
                    <span className="text-muted">No matches found yet.</span>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.stack}>
              <div className="card">
                <div className="list">
                  <span className="kicker">Control room</span>
                  <h2>Organizer actions</h2>
                  <div className={styles.actionGrid}>
                    <Link href="/admin/scoring" className={`card emphasis ${styles.actionCard}`}>
                      <span className="pill">Live</span>
                      <span className={styles.actionTitle}>Smart scoring</span>
                      <span className="text-muted">
                        Track every ball with auto run rate and wickets.
                      </span>
                    </Link>
                    <Link href="/admin/tournaments" className={`card ${styles.actionCard}`}>
                      <span className="pill">Setup</span>
                      <span className={styles.actionTitle}>Tournament builder</span>
                      <span className="text-muted">
                        ACT and ABCT seasons, dates, and merged courts.
                      </span>
                    </Link>
                    <Link href="/admin/teams" className={`card ${styles.actionCard}`}>
                      <span className="pill">Squads</span>
                      <span className={styles.actionTitle}>Team builder</span>
                      <span className="text-muted">
                        Add captains, vice captains, and full rosters.
                      </span>
                    </Link>
                    <Link href="/admin/players" className={`card ${styles.actionCard}`}>
                      <span className="pill">Players</span>
                      <span className={styles.actionTitle}>Player assignment</span>
                      <span className="text-muted">
                        Add past or new players to match squads.
                      </span>
                    </Link>
                    <Link href="/admin/matches" className={`card ${styles.actionCard}`}>
                      <span className="pill">Fixtures</span>
                      <span className={styles.actionTitle}>Match control</span>
                      <span className="text-muted">
                        Add fixtures, overs, and match day details.
                      </span>
                    </Link>
                    <Link href="/tournaments" className={`card ${styles.actionCard}`}>
                      <span className="pill">Archive</span>
                      <span className={styles.actionTitle}>Season library</span>
                      <span className="text-muted">
                        Review past results, leaderboards, and scorecards.
                      </span>
                    </Link>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="list">
                  <span className="kicker">Playbook</span>
                  <strong>Match day workflow</strong>
                  <div className={styles.noteList}>
                    <span>1. Create or select the tournament season.</span>
                    <span>2. Build teams and confirm rosters.</span>
                    <span>3. Add fixtures with teams, overs, and dates.</span>
                    <span>4. Assign match squads before the toss.</span>
                    <span>5. Open smart scoring during live play.</span>
                  </div>
                  <div className={styles.linkRow}>
                    <Link className="pill" href="/admin/matches">
                      Go to fixtures
                    </Link>
                    <Link className="pill" href="/admin/scoring">
                      Start scoring
                    </Link>
                    <Link className="pill" href="/admin/scoring-v2">
                      Scoring v2
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
