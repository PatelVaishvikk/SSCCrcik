import Link from "next/link";
import { formatDate, formatTime } from "@/lib/format";
import styles from "./MatchCard.module.css";

export type MatchCardProps = {
  match: Record<string, any>;
  className?: string;
};

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

function getLogoSrc(logo?: string) {
  if (!logo) return "";
  if (logo.startsWith("http") || logo.startsWith("/")) return logo;
  // Fallback for raw filenames
  return `/team-logos/${logo}`;
}

export default function MatchCard({ match, className }: MatchCardProps) {
  const matchId = match.match_id || match.matchId || match.match_id;
  const tournamentId = match.tournament_id || match.tournamentId;
  const date = formatDate(match.match_start_time || match.created_date || "");
  const time = formatTime(match.match_start_time || match.created_date || "");
  const title = `${match.team_a || "Team A"} vs ${match.team_b || "Team B"}`;
  const result = match.match_summary?.summary || match.match_result || "Result pending";
  const round = match.tournament_round_name || "";
  const teamAScore = match.team_a_summary || "";
  const teamBScore = match.team_b_summary || "";
  const winner = match.winning_team || "";
  const winBy = match.win_by || "";
  const metaLine = [match.ball_type, match.ground_name].filter(Boolean).join(" • ");
  const teamALogo = match.team_a_logo || "";
  const teamBLogo = match.team_b_logo || "";
  const status = String(match.status || "").toLowerCase();
  const statusLabel = status === "live" ? "Live" : status === "future" ? "Upcoming" : "Final";
  const statusClass =
    status === "live"
      ? styles.statusLive
      : status === "future"
        ? styles.statusUpcoming
        : styles.statusFinal;
  const dateLine = [date, time].filter(Boolean).join(" • ");

  return (
    <article className={`${styles.card} ${className || ""}`}>
      <div className={styles.media}>
        <div className={styles.mediaTop}>
          <span className={`${styles.statusTag} ${statusClass}`}>{statusLabel}</span>
          <span className={styles.roundTag}>{round || "Match"}</span>
        </div>
        <div className={styles.teamRow}>
          <div className={styles.teamBlock}>
            <div className={styles.logo}>
              {teamALogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={getLogoSrc(teamALogo)}
                  alt={match.team_a || "Team A"}
                  loading="lazy"
                />
              ) : (
                <span>{getInitials(match.team_a)}</span>
              )}
            </div>
            <span className={styles.teamName}>{match.team_a || "Team A"}</span>
          </div>
          <span className={styles.vs}>VS</span>
          <div className={styles.teamBlock}>
            <div className={styles.logo}>
              {teamBLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={getLogoSrc(teamBLogo)}
                  alt={match.team_b || "Team B"}
                  loading="lazy"
                />
              ) : (
                <span>{getInitials(match.team_b)}</span>
              )}
            </div>
            <span className={styles.teamName}>{match.team_b || "Team B"}</span>
          </div>
        </div>
        <div className={styles.mediaMeta}>
          {dateLine ? <span>{dateLine}</span> : null}
          {match.tournament_name ? <span>{match.tournament_name}</span> : null}
        </div>
      </div>
      <div className={styles.body}>
        <strong className={styles.title}>{title}</strong>
        <div className={styles.scoreRow}>
          <span className={styles.scoreTeam}>{match.team_a || "Team A"}</span>
          <span className={styles.scoreValue}>{teamAScore || "-"}</span>
        </div>
        <div className={styles.scoreRow}>
          <span className={styles.scoreTeam}>{match.team_b || "Team B"}</span>
          <span className={styles.scoreValue}>{teamBScore || "-"}</span>
        </div>
        {winner ? (
          <span className={styles.result}>
            Winner: {winner} {winBy ? `(${winBy})` : ""}
          </span>
        ) : null}
        <span className={styles.result}>{result}</span>
        <div className={styles.footer}>
          {metaLine ? <span className={styles.meta}>{metaLine}</span> : <span />}
          {tournamentId && matchId ? (
            <Link
              className={`pill ${styles.cta}`}
              href={`/match/${tournamentId}/${matchId}`}
              prefetch={false}
            >
              Scorecard
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}
