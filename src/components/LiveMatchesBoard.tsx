"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type LiveMatch = {
  match_id: string;
  tournament_name: string;
  status: string;
  batting: {
    team_name: string;
    runs: number;
    wickets: number;
    overs: string;
    run_rate: string;
    striker_stats?: {
      name: string;
      runs: number;
      balls: number;
    };
    non_striker_stats?: {
      name: string;
      runs: number;
      balls: number;
    };
  };
  bowling: {
    team_name: string;
    bowler_stats?: {
      name: string;
      overs: string;
      runs: number;
      wickets: number;
    };
  };
  striker: string;
  non_striker: string;
};

export default function LiveMatchesBoard() {
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let inFlight = false;
    let mounted = true;

    const load = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const res = await fetch("/api/public/live", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (mounted && res.ok) {
          setMatches(data.matches || []);
        }
      } finally {
        if (mounted) setLoading(false);
        inFlight = false;
      }
    };

    load();
    const interval = setInterval(load, 5000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mounted = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  if (loading) {
    return <span className="text-muted">Loading live matches...</span>;
  }

  if (!matches.length) {
    return <span className="text-muted">No live matches right now.</span>;
  }

  return (
    <div className="grid two">
      {matches.map((match) => (
        <Link key={match.match_id} href={`/live/${match.match_id}`} className="card">
          <div className="list">
            <span className="pill">{match.tournament_name || "Live match"}</span>
            <strong>{match.batting.team_name}</strong>
            <span className="text-muted">
              {match.batting.runs}/{match.batting.wickets} • {match.batting.overs} ov
            </span>
            <span className="text-muted">Run rate: {match.batting.run_rate}</span>
            <span className="text-muted">Bowling: {match.bowling.team_name}</span>
            <span className="text-muted">
              {match.batting.striker_stats?.name || match.striker}{" "}
              {match.batting.striker_stats
                ? `${match.batting.striker_stats.runs}(${match.batting.striker_stats.balls})`
                : ""}
              {" • "}
              {match.batting.non_striker_stats?.name || match.non_striker}{" "}
              {match.batting.non_striker_stats
                ? `${match.batting.non_striker_stats.runs}(${match.batting.non_striker_stats.balls})`
                : ""}
            </span>
            {match.bowling.bowler_stats ? (
              <span className="text-muted">
                Bowler: {match.bowling.bowler_stats.name}{" "}
                {match.bowling.bowler_stats.overs} - {match.bowling.bowler_stats.runs} -{" "}
                {match.bowling.bowler_stats.wickets}
              </span>
            ) : null}
          </div>
        </Link>
      ))}
    </div>
  );
}
