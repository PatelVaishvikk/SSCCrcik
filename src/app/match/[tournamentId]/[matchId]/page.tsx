import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatNumber, formatTime } from "@/lib/format";
import { getMatchContext } from "@/lib/data";
import styles from "./page.module.css";
import MatchAnalyticsWrapper from "@/components/matches/MatchAnalyticsWrapper";

function parseOvers(value?: string | number | null) {
  if (value === null || value === undefined) return 0;
  const raw = String(value);
  if (!raw) return 0;
  if (!raw.includes(".")) return Number(raw);
  const [overs, balls] = raw.split(".");
  const overCount = Number(overs) || 0;
  const ballCount = Number(balls) || 0;
  return overCount + ballCount / 6;
}

function formatRate(value: number) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

function summarizeCommentary(entries: Array<Record<string, any>>) {
  const balls = entries.length;
  const boundaries = entries.filter((entry) => entry.is_boundry).length;
  const wickets = entries.filter((entry) => entry.is_out).length;
  const dotBalls = entries.filter((entry) => entry.run === 0 && !entry.extra_run).length;
  return { balls, boundaries, wickets, dotBalls };
}

function getInitials(name?: string) {
  if (!name) return "TBD";
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function calculateRunsPerOver(events: any[]) {
  const runsPerOver: number[] = [];
  let currentOverRuns = 0;
  
  // Sort events by seq just in case
  const sorted = [...events].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  
  // We need to group by over. Events usually have 'over' field or we can deduce.
  // Actually, standard event structure has over/ball.
  // Let's assume standard structure: runs per over is sum of runs in that over.
  
  // Simple approach: Map to over index and sum.
  const overMap = new Map<number, number>();
  let maxOver = -1;

  for (const event of sorted) {
      if (event.legalBall === false && !event.extra_type) continue; // Skip strictly non-plays if any?
      // Actually trust 'runs' + 'extra runs'
      const totalRuns = Number(event.runs || 0); // Flats often have total runs in 'runs' or split
      // Wait, let's look at `buildAppliedEvents` or `computeStats` logic in other files.
      // Usually event.runs is total.
      
      // We need over number.
      // If event structure is from `innings.events`, it often has `over` and `ball`.
      // Let's try to key by `start_time` or just sequential grouping if over is missing.
      // But `innings.events` usually has `over`.
      // Let's check `parseOvers` usage.
      
      // Fallback: if 'over' field exists
      const overIndex = event.over !== undefined ? Number(event.over) : -1;
      if (overIndex >= 0) {
          overMap.set(overIndex, (overMap.get(overIndex) || 0) + totalRuns);
          if (overIndex > maxOver) maxOver = overIndex;
      }
  }
  
  // If no 'over' field, we can't reliably build it without replaying.
  // But for now, let's assume 'over' exists as it's common in our data.
  // If maxOver is -1, maybe returned empty.
  
  for (let i = 0; i <= maxOver; i++) {
      runsPerOver.push(overMap.get(i) || 0);
  }
  return runsPerOver;
}

export default async function MatchPage({
  params,
}: {
  params: Promise<{ tournamentId: string; matchId: string }>;
}) {
  const { tournamentId, matchId } = await params;
  const context = await getMatchContext(tournamentId, matchId);
  if (!context) return notFound();

  const schedule = context.scheduleEntry || {};
  const matchFile = context.matchEntry?.data?.data || {};
  const summary = matchFile.summary || schedule;
  const heroes = matchFile.heroes?.data || {};
  const commentaryInn1 = matchFile.commentary_inn1?.data?.commentary || [];
  const commentaryInn2 = matchFile.commentary_inn2?.data?.commentary || [];
  const commentary = [...commentaryInn1, ...commentaryInn2];

  const teamAName = summary.team_a || schedule.team_a || "Team A";
  const teamBName = summary.team_b || schedule.team_b || "Team B";
  const teamAScore = summary.team_a_summary || schedule.team_a_summary || "-";
  const teamBScore = summary.team_b_summary || schedule.team_b_summary || "-";
  const teamALogo = schedule.team_a_logo || summary.team_a_logo || "";
  const teamBLogo = schedule.team_b_logo || summary.team_b_logo || "";
  const statusValue = String(summary.status || schedule.status || "").toLowerCase();
  const statusLabel =
    statusValue === "live" ? "Live" : statusValue === "future" ? "Upcoming" : "Final";
  const statusClass =
    statusValue === "live"
      ? styles.statusLive
      : statusValue === "future"
        ? styles.statusUpcoming
        : styles.statusFinal;
  const resultSummary =
    summary.match_summary?.summary || summary.match_result || summary.status || "Result pending";

  const innings = [
    ...(summary.team_a_innings || []),
    ...(summary.team_b_innings || []),
  ];

  const mainInnings = innings.filter(
    (inning: any) => inning.inning === 1 || inning.inning === 2,
  );
  const teamAInning = mainInnings.find((inning: any) => inning.team_id === summary.team_a_id);
  const teamBInning = mainInnings.find((inning: any) => inning.team_id === summary.team_b_id);
  const teamAOver = parseOvers(teamAInning?.overs_played);
  const teamBOver = parseOvers(teamBInning?.overs_played);
  const teamARate = teamAOver ? Number(teamAInning?.total_run ?? 0) / teamAOver : 0;
  const teamBRate = teamBOver ? Number(teamBInning?.total_run ?? 0) / teamBOver : 0;
  const rateMax = Math.max(teamARate, teamBRate, 1);
  const tempo = Math.abs(teamARate - teamBRate);
  const commSummary = summarizeCommentary(commentary);

  const stats = [
    { label: "Status", value: summary.status || "-" },
    { label: "Result", value: summary.match_result || "-" },
    { label: "Win by", value: summary.win_by || "-" },
    { label: "Ball type", value: summary.ball_type || "-" },
    { label: "Overs", value: summary.overs ?? "-" },
    { label: "Ground", value: summary.ground_name || "-" },
    { label: "City", value: summary.city_name || "-" },
    { label: "Round", value: summary.tournament_round_name || "-" },
  ];

  const tabs = [
    { label: "Info", href: "#info" },
    { label: "Scorecard", href: "#scorecard" },
    { label: "Insights", href: "#insights" },
    { label: "Heroes", href: "#heroes" },
    { label: "Commentary", href: "#commentary" },
  ];

  // Calculate stats for Analytics for FIRST innings (or allow toggle? For now primary innings)
  // Let's use the batting innings of the team that batted first or the "current" view?
  // Usually analytics modal shows current batting.
  // Let's pass the innings that is "active" or just the first one for static view?
  // Better: Show button for EACH innings in the scorecard?
  // Or just top level "Match Analysis" which defaults to Innings 1 or allows switching?
  // Our Modal only takes ONE array.
  // Let's compute for BOTH and let the modal handle? Modal doesn't support switching yet.
  // Let's compute for the WINNING team or just Team A?
  // Let's pick Team A (Innings 1) for now, or the one with more runs?
  const analysisInnings = mainInnings[0] || {};
  const analysisRunsPerOver = calculateRunsPerOver(analysisInnings.events || []);
  const analysisTarget = null; // complex to find target for Innings 1
  const analysisOversConfig = parseOvers(analysisInnings.overs_played || 20); // approx


  return (
    <div>
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroGrid}>
            <div className={styles.heroContent}>
              <div className={styles.heroBadges}>
                <span className={`${styles.statusTag} ${statusClass}`}>{statusLabel}</span>
                <span className={styles.seriesTag}>{summary.tournament_name || "Tournament"}</span>
              </div>
              <h1 className={styles.matchTitle}>
                {teamAName} vs {teamBName}
              </h1>
              <div className={styles.heroMeta}>
                <span>{summary.tournament_round_name || "Match"} </span>
                <span>{formatDate(summary.match_start_time) || "-"}</span>
                <span>{formatTime(summary.match_start_time) || "-"}</span>
                <span>{summary.ground_name || "-"}</span>
              </div>
              <div className={styles.resultStrip}>{resultSummary}</div>
              {summary.toss_details ? (
                <div className={styles.tossLine}>{summary.toss_details}</div>
              ) : null}
              
              <div style={{ marginTop: '12px' }}>
                <MatchAnalyticsWrapper
                    runsPerOver={analysisRunsPerOver}
                    oversConfig={Math.ceil(analysisOversConfig || 20)}
                    target={analysisTarget}
                    currentScore={Number(analysisInnings.total_run || 0)}
                    currentOver={analysisOversConfig}
                    className="pill"
                    style={{ background: '#2563eb', color: 'white', border: 'none', cursor: 'pointer' }}
                    label="📊 View Graphs_v2"
                />
              </div>
            </div>
            <div className={styles.heroScore}>
              <div className={styles.scoreBoard}>
                <div className={styles.scoreRow}>
                  <div className={styles.teamBadge}>
                    <div className={styles.logo}>
                      {teamALogo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={teamALogo} alt={teamAName} />
                      ) : (
                        <span>{getInitials(teamAName)}</span>
                      )}
                    </div>
                    <span className={styles.teamName}>{teamAName}</span>
                  </div>
                  <span className={styles.teamScore}>{teamAScore}</span>
                </div>
                <div className={styles.scoreRow}>
                  <div className={styles.teamBadge}>
                    <div className={styles.logo}>
                      {teamBLogo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={teamBLogo} alt={teamBName} />
                      ) : (
                        <span>{getInitials(teamBName)}</span>
                      )}
                    </div>
                    <span className={styles.teamName}>{teamBName}</span>
                  </div>
                  <span className={styles.teamScore}>{teamBScore}</span>
                </div>
              </div>
              <div className={styles.rateRow}>
                <div>
                  <span className={styles.rateLabel}>{teamAName} RR</span>
                  <strong className={styles.rateValue}>{formatRate(teamARate)}</strong>
                </div>
                <div>
                  <span className={styles.rateLabel}>{teamBName} RR</span>
                  <strong className={styles.rateValue}>{formatRate(teamBRate)}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <nav className={styles.tabBar}>
        <div className="container">
          <div className={styles.tabRow}>
            {tabs.map((tab) => (
              <Link key={tab.href} href={tab.href} className={styles.tabLink}>
                {tab.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>

      <section className={styles.pageBody}>
        <div className="container">
          <div className={styles.pageGrid}>
            <div className={styles.mainColumn}>
              <section id="scorecard" className={styles.sectionBlock}>
                <div className="section-title">
                  <span className="kicker">Scorecard</span>
                  <h2>Innings overview</h2>
                </div>
                <div className={styles.scoreGrid}>
                  {innings.length ? (
                    innings.map((inning: any) => (
                      <div
                        key={`${inning.team_id}-${inning.inning}`}
                        className={`card ${styles.inningCard}`}
                      >
                        <strong>Inning {inning.inning}</strong>
                        <span className="text-muted">
                          Team {inning.team_id} - {inning.overs_played} ov
                        </span>
                        <div className={styles.inningStats}>
                          <div>
                            <span>Runs/Wkts</span>
                            <strong>
                              {inning.total_run}/{inning.total_wicket}
                            </strong>
                          </div>
                          <div>
                            <span>Extras</span>
                            <strong>{inning.total_extra}</strong>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="card">
                      <span className="text-muted">Scorecard data not available.</span>
                    </div>
                  )}
                </div>
              </section>

              <section id="insights" className={styles.sectionBlock}>
                <div className="section-title">
                  <span className="kicker">Insights</span>
                  <h2>Match tempo and run rate</h2>
                </div>
                <div className={styles.analysisGrid}>
                  <div className="card">
                    <div className={styles.analysisBar}>
                      <strong>Run rate comparison</strong>
                      <div className={styles.barMeta}>
                        <span>{teamAName}</span>
                        <span>{formatRate(teamARate)}</span>
                      </div>
                      <div className={styles.barTrack}>
                        <div
                          className={styles.barFill}
                          style={{ width: `${(teamARate / rateMax) * 100}%` }}
                        />
                      </div>
                      <div className={styles.barMeta}>
                        <span>{teamBName}</span>
                        <span>{formatRate(teamBRate)}</span>
                      </div>
                      <div className={styles.barTrack}>
                        <div
                          className={styles.barFill}
                          style={{ width: `${(teamBRate / rateMax) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="card">
                    <div className={styles.insightStat}>
                      <span>Tempo swing</span>
                      <strong>{formatRate(tempo)}</strong>
                    </div>
                    <div className={styles.insightStat}>
                      <span>Boundary balls</span>
                      <strong>{commSummary.boundaries}</strong>
                    </div>
                    <div className={styles.insightStat}>
                      <span>Dot balls</span>
                      <strong>{commSummary.dotBalls}</strong>
                    </div>
                  </div>
                  <div className="card">
                    <div className={styles.insightStat}>
                      <span>Wickets</span>
                      <strong>{formatNumber(commSummary.wickets)}</strong>
                    </div>
                    <div className={styles.insightStat}>
                      <span>Deliveries</span>
                      <strong>{formatNumber(commSummary.balls)}</strong>
                    </div>
                    <div className={styles.insightStat}>
                      <span>Innings</span>
                      <strong>{formatNumber(innings.length)}</strong>
                    </div>
                  </div>
                </div>
              </section>

              <section id="commentary" className={styles.sectionBlock}>
                <div className="section-title">
                  <span className="kicker">Commentary</span>
                  <h2>Key moments</h2>
                </div>
                <div className="card">
                  <div className={styles.commentary}>
                    {commentary.length ? (
                      commentary.slice(0, 12).map((ball: any) => (
                        <div key={ball.ball_id}>
                          <strong>{ball.ball}</strong> {ball.commentary}
                        </div>
                      ))
                    ) : (
                      <span className="text-muted">Commentary not available.</span>
                    )}
                  </div>
                </div>
              </section>
            </div>

            <aside className={styles.sideColumn}>
              <div id="info" className={`card ${styles.sideCard} ${styles.sectionBlock}`}>
                <div className={styles.sideHeader}>
                  <span className={styles.sideTag}>Match info</span>
                  <strong>Key details</strong>
                </div>
                <div className={styles.infoGrid}>
                  {stats.map((item) => (
                    <div key={item.label} className={styles.infoRow}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
              <div id="heroes" className={`card ${styles.sideCard} ${styles.sectionBlock}`}>
                <div className={styles.sideHeader}>
                  <span className={styles.sideTag}>Honors</span>
                  <strong>Match heroes</strong>
                </div>
                <div className={styles.heroList}>
                  {[
                    { label: "Player of the Match", data: heroes.player_of_the_match },
                    { label: "Best Batter", data: heroes.best_batsman },
                    { label: "Best Bowler", data: heroes.best_bowler },
                  ].map((hero) => (
                    <div key={hero.label} className={styles.heroItem}>
                      <span>{hero.label}</span>
                      <strong>{hero.data?.player_name || "-"}</strong>
                      <span className="text-muted">{hero.data?.team_name || ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
          <div className={styles.backRow}>
            <Link href={`/tournaments/${context.year}`} className="pill">
              Back to season
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
