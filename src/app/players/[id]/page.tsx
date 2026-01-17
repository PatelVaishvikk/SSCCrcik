import Link from "next/link";
import { notFound } from "next/navigation";
import { formatRange } from "@/lib/format";
import { getPlayerHistory } from "@/lib/data";
import styles from "./page.module.css";

function renderStatRows(
  stats: Array<{ title?: string; value?: string | number; is_user_property?: number }>,
) {
  return stats.map((item) => (
    <div
      key={item.title}
      className={`${styles.statRow} ${
        item.is_user_property ? styles.statRowHighlight : ""
      }`}
    >
      <span>{item.title}</span>
      <strong>{item.value}</strong>
    </div>
  ));
}

function getStatValue(
  stats: Array<{ title?: string; value?: string | number }> | undefined,
  title: string,
) {
  return stats?.find((item) => item.title === title)?.value ?? "-";
}

export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const history = await getPlayerHistory();
  const player = history.players?.[id];
  if (!player) return notFound();

  const profile = player.profile || {};
  const career = player.career_stats || {};
  const tournaments = player.tournaments || [];
  const highlights = player.highlights || {};
  const roleChips = [
    profile.playing_role,
    profile.batting_hand,
    profile.bowling_style,
  ].filter(Boolean) as string[];
  const seasons = player.ssc_tournaments_played ?? "-";
  const playerId = player.player_id ?? id;
  const matches = getStatValue(career.batting, "Matches");
  const runs = getStatValue(career.batting, "Runs");
  const wickets = getStatValue(career.bowling, "Wickets");
  const battingAvg = getStatValue(career.batting, "Avg");
  const battingSr = getStatValue(career.batting, "SR");
  const economy = getStatValue(career.bowling, "Economy");
  const bestBowling = getStatValue(career.bowling, "Best Bowling");
  const highestRuns = getStatValue(career.batting, "Highest Runs");
  const catches = getStatValue(career.fielding, "Catches");
  const keyStats = [
    { label: "Seasons", value: seasons },
    { label: "Matches", value: matches },
    { label: "Runs", value: runs },
    { label: "Wickets", value: wickets },
    { label: "Batting Avg", value: battingAvg },
    { label: "Strike Rate", value: battingSr },
  ];
  const impactStats = [
    { label: "Highest Runs", value: highestRuns },
    { label: "Best Bowling", value: bestBowling },
    { label: "Economy", value: economy },
    { label: "Catches", value: catches },
  ];

  return (
    <div>
      <section className={styles.profileHeader}>
        <div className="container">
          <div className={styles.profileGrid}>
            <div className={`card ${styles.profileCard} reveal ${styles.revealDelayOne}`}>
              <div className={`player-row ${styles.playerHeader}`}>
                <div
                  className={`avatar ${styles.avatarLarge}`}
                  style={
                    profile.profile_photo
                      ? { backgroundImage: `url(${profile.profile_photo})` }
                      : undefined
                  }
                />
                <div className={`list ${styles.playerInfo}`}>
                  <div className={styles.identityRow}>
                    <span className="badge">Player profile</span>
                    <span className={styles.idBadge}>SSC ID {playerId}</span>
                  </div>
                  <h1 className={styles.playerName}>{profile.name || "Unknown"}</h1>
                  <div className={styles.metaRow}>
                    <span>{profile.city_name || "City not listed"}</span>
                    {profile.country_code ? (
                      <>
                        <span className={styles.metaDot} />
                        <span>{profile.country_code}</span>
                      </>
                    ) : null}
                  </div>
                  {roleChips.length ? (
                    <div className={styles.roleChips}>
                      {roleChips.map((chip) => (
                        <span key={chip} className={styles.roleChip}>
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className={styles.keyStats}>
                {keyStats.map((stat) => (
                  <div key={stat.label} className={styles.keyStat}>
                    <span className={styles.keyLabel}>{stat.label}</span>
                    <strong className={styles.keyValue}>{stat.value}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className={`card ${styles.scoreCard} reveal ${styles.revealDelayTwo}`}>
              <div className={styles.scoreHeader}>
                <span className={styles.scorePill}>Impact card</span>
                <span className={styles.scoreSub}>Rates, bests, and fielding</span>
              </div>
              <div className={styles.impactGrid}>
                {impactStats.map((stat) => (
                  <div key={stat.label} className={styles.impactStat}>
                    <span className={styles.impactLabel}>{stat.label}</span>
                    <strong className={styles.impactValue}>{stat.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-title">
            <span className="kicker">Stats</span>
            <h2>Career breakdown</h2>
          </div>
          <div className="grid three">
            {career.batting?.length ? (
              <div className="card">
                <div className="list">
                  <span className="pill">Batting</span>
                  <div className={styles.statTable}>{renderStatRows(career.batting)}</div>
                </div>
              </div>
            ) : null}
            {career.bowling?.length ? (
              <div className="card">
                <div className="list">
                  <span className="pill">Bowling</span>
                  <div className={styles.statTable}>{renderStatRows(career.bowling)}</div>
                </div>
              </div>
            ) : null}
            {career.fielding?.length ? (
              <div className="card">
                <div className="list">
                  <span className="pill">Fielding</span>
                  <div className={styles.statTable}>{renderStatRows(career.fielding)}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-title">
            <span className="kicker">Tournaments</span>
            <h2>Season history</h2>
            <p>ABCT courts are merged into a single year entry.</p>
          </div>
          <div className={styles.tournamentGrid}>
            {tournaments.map((entry: any) => (
              <div
                key={entry.tournament_id}
                className={`card ${styles.tournamentCard} ${
                  entry.overall_winner ? styles.championCard : ""
                }`}
              >
                <div className="list">
                  <div className={styles.tournamentHeader}>
                    <strong>{entry.tournament_name}</strong>
                    <div className={styles.tournamentMeta}>
                      <span>{entry.type}</span>
                      <span>{entry.year}</span>
                      <span>{formatRange(entry.start_date, entry.end_date)}</span>
                    </div>
                  </div>
                  {entry.overall_winner ? (
                    <span className={styles.championTag}>
                      Champion: {entry.overall_winner.team_name}
                    </span>
                  ) : null}
                  {entry.courts?.length ? (
                    <div className={styles.courtList}>
                      <span className={styles.courtLabel}>Courts played</span>
                      <div className={styles.courtTags}>
                        {entry.courts.map((court: any) => (
                          <span key={court.tournament_id} className={styles.courtTag}>
                            {court.tournament_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {entry.statistics ? (
                    <div className={styles.statTable}>
                      {Object.values(entry.statistics)
                        .flat()
                        .slice(0, 6)
                        .map((item: any) => (
                          <div key={item.title} className={styles.statRow}>
                            <span>{item.title}</span>
                            <strong>{item.value}</strong>
                          </div>
                        ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-title">
            <span className="kicker">Highlights</span>
            <h2>Match awards</h2>
          </div>
          <div className={styles.highlightList}>
            {[
              { key: "player_of_the_match", label: "Player of the Match" },
              { key: "best_batsman", label: "Best Batter" },
              { key: "best_bowler", label: "Best Bowler" },
            ].map((section) => (
              <div key={section.key} className={`card ${styles.highlightCard}`}>
                <div className="list">
                  <span className="pill">{section.label}</span>
                  {(highlights[section.key] || []).length ? (
                    (highlights[section.key] || []).map((match: any) => (
                      <Link
                        key={match.match_key}
                        href={`/match/${match.tournament_id}/${match.match_id}`}
                        className={styles.matchLink}
                      >
                        <span className={styles.matchTeams}>
                          {match.team_a} vs {match.team_b}
                        </span>
                        <span className={styles.matchResult}>{match.match_result}</span>
                      </Link>
                    ))
                  ) : (
                    <span className="text-muted">No records yet.</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.footerSection}>
        <div className="container">
          <Link href="/players" className={`pill ${styles.backLink}`}>
            &larr; Back to players
          </Link>
        </div>
      </section>
    </div>
  );
}
