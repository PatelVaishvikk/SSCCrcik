"use client";

import { useEffect, useState } from "react";
import MatchScorer from "@/components/matches/MatchScorer";

const ACTIVE_TOURNAMENT_KEY = "ssc_active_tournament_id";

type Tournament = {
  tournament_id: string;
  name: string;
};

type Match = {
  match_id: string;
  tournament_id: string;
  team_a_id: string;
  team_b_id: string;
  match_date?: string | null;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data as T;
}

export default function AdminMatchScorer() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedTournament, setSelectedTournament] = useState("");
  const [selectedMatch, setSelectedMatch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ tournaments: Tournament[] }>("/api/admin/tournaments")
      .then((data) => {
        const list = data.tournaments || [];
        setTournaments(list);
        const stored = localStorage.getItem(ACTIVE_TOURNAMENT_KEY) || "";
        const next = stored || list[0]?.tournament_id || "";
        setSelectedTournament(next);
      })
      .catch((err) => setError(err?.message || "Unable to load tournaments"));
  }, []);

  useEffect(() => {
    if (!selectedTournament) return;
    fetchJson<{ matches: Match[] }>(`/api/admin/matches?tournamentId=${selectedTournament}`)
      .then((data) => {
        setMatches(data.matches || []);
        setSelectedMatch(data.matches?.[0]?.match_id || "");
      })
      .catch((err) => setError(err?.message || "Unable to load matches"));
  }, [selectedTournament]);

  return (
    <div className="card">
      <div className="list">
        <div className="grid two">
          <select
            className="search-input"
            value={selectedTournament}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedTournament(value);
              if (value) localStorage.setItem(ACTIVE_TOURNAMENT_KEY, value);
            }}
          >
            <option value="">Select tournament</option>
            {tournaments.map((tournament) => (
              <option key={tournament.tournament_id} value={tournament.tournament_id}>
                {tournament.name}
              </option>
            ))}
          </select>
          <select
            className="search-input"
            value={selectedMatch}
            onChange={(event) => setSelectedMatch(event.target.value)}
          >
            <option value="">Select match</option>
            {matches.map((match) => (
              <option key={match.match_id} value={match.match_id}>
                {match.match_id}
              </option>
            ))}
          </select>
        </div>
        {error ? <span className="text-muted">{error}</span> : null}
      </div>
      {selectedMatch ? <MatchScorer matchId={selectedMatch} /> : null}
    </div>
  );
}
