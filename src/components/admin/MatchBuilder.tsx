"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const ACTIVE_TOURNAMENT_KEY = "ssc_active_tournament_id";
const ACTIVE_TOURNAMENT_NAME_KEY = "ssc_active_tournament_name";

type DraftMatch = {
  tournamentId: string;
  teamAId: string;
  teamBId: string;
  matchDate: string;
  overs: string;
  tossWinnerId: string;
  tossDecision: string;
  groupId: string;
  groupName: string;
  round: string;
  stage: string;
  venue: string;
  noConsecutiveBowler: boolean;
  countWideAsBall: boolean;
  countNoBallAsBall: boolean;
};

export default function MatchBuilder() {
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [editingMatchId, setEditingMatchId] = useState("");
  const [form, setForm] = useState<DraftMatch>({
    tournamentId: "",
    teamAId: "",
    teamBId: "",
    matchDate: "",
    overs: "10",
    tossWinnerId: "",
    tossDecision: "",
    groupId: "",
    groupName: "",
    round: "",
    stage: "LEAGUE",
    venue: "",
    noConsecutiveBowler: false,
    countWideAsBall: false,
    countNoBallAsBall: false,
  });
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const teamMap = useMemo(() => {
    const map = new Map<string, any>();
    teams.forEach((team) => map.set(team.team_id, team));
    return map;
  }, [teams]);

  const update = (key: keyof DraftMatch, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const loadTournaments = async () => {
    const res = await fetch("/api/admin/tournaments");
    const data = await res.json();
    if (res.ok) {
      const list = data.tournaments || [];
      const stored = localStorage.getItem(ACTIVE_TOURNAMENT_KEY);
      let filtered = list;
      let activeId = stored || "";
      if (stored) {
        const match = list.find(
          (tournament: any) => tournament.tournament_id === stored
        );
        if (match) {
          filtered = [match];
          activeId = match.tournament_id;
        } else {
          localStorage.removeItem(ACTIVE_TOURNAMENT_KEY);
          localStorage.removeItem(ACTIVE_TOURNAMENT_NAME_KEY);
          activeId = "";
        }
      }
      setTournaments(filtered);
      const nextId = activeId || filtered[0]?.tournament_id || "";
      if (!form.tournamentId || (nextId && form.tournamentId !== nextId)) {
        update("tournamentId", nextId);
      }
    }
  };

  const handleTournamentChange = (value: string) => {
    update("tournamentId", value);
    if (!value) {
      localStorage.removeItem(ACTIVE_TOURNAMENT_KEY);
      localStorage.removeItem(ACTIVE_TOURNAMENT_NAME_KEY);
      return;
    }
    const tournament = tournaments.find((item) => item.tournament_id === value);
    localStorage.setItem(ACTIVE_TOURNAMENT_KEY, value);
    if (tournament?.name) {
      localStorage.setItem(ACTIVE_TOURNAMENT_NAME_KEY, tournament.name);
    }
  };

  const loadTeamsAndMatches = async (tournamentId: string) => {
    if (!tournamentId) return;
    const [teamsRes, matchesRes] = await Promise.all([
      fetch(`/api/admin/teams?tournamentId=${tournamentId}`),
      fetch(`/api/admin/matches?tournamentId=${tournamentId}`),
    ]);
    const teamsData = await teamsRes.json();
    const matchesData = await matchesRes.json();
    if (teamsRes.ok) setTeams(teamsData.teams || []);
    if (matchesRes.ok) setMatches(matchesData.matches || []);
  };

  useEffect(() => {
    loadTournaments();
  }, []);

  useEffect(() => {
    loadTeamsAndMatches(form.tournamentId);
  }, [form.tournamentId]);

  useEffect(() => {
    setForm((prev) => ({ ...prev, teamAId: "", teamBId: "" }));
    setEditingMatchId("");
  }, [form.tournamentId]);

  const addMatch = async () => {
    if (!form.tournamentId || !form.teamAId || !form.teamBId) return;
    setLoading(true);
    setStatus(null);
    const payload = {
      tournamentId: form.tournamentId,
      matchId: editingMatchId || undefined,
      teamAId: form.teamAId,
      teamBId: form.teamBId,
      matchDate: form.matchDate,
      overs: form.overs,
      tossWinnerId: form.tossWinnerId,
      tossDecision: form.tossDecision,
      groupId: form.groupId,
      groupName: form.groupName,
      round: form.round,
      stage: form.stage,
      venue: form.venue,
      settings: {
        noConsecutiveBowler: form.noConsecutiveBowler,
        countWideAsBall: form.countWideAsBall,
        countNoBallAsBall: form.countNoBallAsBall,
      },
    };
    const res = await fetch("/api/admin/matches", {
      method: editingMatchId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "Unable to save match.");
      setLoading(false);
      return;
    }
    setEditingMatchId("");
    setForm((prev) => ({ ...prev, teamAId: "", teamBId: "" }));
    await loadTeamsAndMatches(form.tournamentId);
    setLoading(false);
  };

  const startEditMatch = (match: any) => {
    setEditingMatchId(match.match_id);
    setForm((prev) => ({
      ...prev,
      tournamentId: match.tournament_id || prev.tournamentId,
      teamAId: match.team_a_id || "",
      teamBId: match.team_b_id || "",
      matchDate: match.match_date || "",
      overs: String(match.overs || prev.overs || ""),
      tossWinnerId: match.toss_winner_id || "",
      tossDecision: match.toss_decision || "",
      groupId: match.group_id || "",
      groupName: match.group_name || "",
      round: match.round || "",
      stage: match.stage || "LEAGUE",
      venue: match.venue || "",
      noConsecutiveBowler: Boolean(match.settings?.noConsecutiveBowler),
      countWideAsBall: Boolean(match.settings?.countWideAsBall),
      countNoBallAsBall: Boolean(match.settings?.countNoBallAsBall),
    }));
    setStatus(`Editing match ${match.match_id}.`);
  };

  const cancelEditMatch = () => {
    setEditingMatchId("");
    setForm((prev) => ({
      ...prev,
      teamAId: "",
      teamBId: "",
      matchDate: "",
      tossWinnerId: "",
      tossDecision: "",
      groupId: "",
      groupName: "",
      round: "",
      stage: "LEAGUE",
      venue: "",
      noConsecutiveBowler: false,
      countWideAsBall: false,
      countNoBallAsBall: false,
    }));
    setStatus(null);
  };

  const deleteMatch = async (match: any) => {
    if (!form.tournamentId) return;
    if (!window.confirm("Delete this match?")) return;
    setLoading(true);
    setStatus(null);
    const tournamentId = match.tournament_id || form.tournamentId;
    const res = await fetch(
      `/api/admin/matches?matchId=${match.match_id}&tournamentId=${tournamentId}`,
      { method: "DELETE" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "Unable to delete match.");
      setLoading(false);
      return;
    }
    setStatus("Match deleted.");
    await loadTeamsAndMatches(form.tournamentId);
    setLoading(false);
  };

  return (
    <div className="card">
      <div className="list">
        <span className="pill">Create match</span>
        <div className="grid two">
          <select
            className="search-input"
            value={form.tournamentId}
            onChange={(event) => handleTournamentChange(event.target.value)}
          >
            <option value="">Select tournament</option>
            {tournaments.map((tournament) => (
              <option key={tournament.tournament_id} value={tournament.tournament_id}>
                {tournament.name}
              </option>
            ))}
          </select>
          <input
            className="search-input"
            placeholder="Overs"
            value={form.overs}
            onChange={(event) => update("overs", event.target.value)}
          />
          <select
            className="search-input"
            value={form.stage}
            onChange={(event) => update("stage", event.target.value)}
          >
            <option value="LEAGUE">League</option>
            <option value="GROUP">Group</option>
            <option value="KNOCKOUT">Knockout</option>
          </select>
          <input
            className="search-input"
            placeholder="Group ID"
            value={form.groupId}
            onChange={(event) => update("groupId", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="Group name"
            value={form.groupName}
            onChange={(event) => update("groupName", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="Round / fixture label"
            value={form.round}
            onChange={(event) => update("round", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="Venue"
            value={form.venue}
            onChange={(event) => update("venue", event.target.value)}
          />
          <select
            className="search-input"
            value={form.teamAId}
            onChange={(event) => update("teamAId", event.target.value)}
          >
            <option value="">Team A</option>
            {teams.map((team) => (
              <option key={team.team_id} value={team.team_id}>
                {team.name}
              </option>
            ))}
          </select>
          <select
            className="search-input"
            value={form.teamBId}
            onChange={(event) => update("teamBId", event.target.value)}
          >
            <option value="">Team B</option>
            {teams.map((team) => (
              <option key={team.team_id} value={team.team_id}>
                {team.name}
              </option>
            ))}
          </select>
          <input
            className="search-input"
            placeholder="Match date"
            value={form.matchDate}
            onChange={(event) => update("matchDate", event.target.value)}
          />
          <select
            className="search-input"
            value={form.tossWinnerId}
            onChange={(event) => update("tossWinnerId", event.target.value)}
          >
            <option value="">Toss winner</option>
            {teams.map((team) => (
              <option key={team.team_id} value={team.team_id}>
                {team.name}
              </option>
            ))}
          </select>
          <select
            className="search-input"
            value={form.tossDecision}
            onChange={(event) => update("tossDecision", event.target.value)}
          >
            <option value="">Toss decision</option>
            <option value="bat">Bat</option>
            <option value="bowl">Bowl</option>
          </select>
        </div>
        <div className="grid two">
          <label className="text-muted">
            <input
              type="checkbox"
              checked={form.noConsecutiveBowler}
              onChange={(event) => update("noConsecutiveBowler", event.target.checked)}
            />{" "}
            Prevent consecutive overs by same bowler
          </label>
          <label className="text-muted">
            <input
              type="checkbox"
              checked={form.countWideAsBall}
              onChange={(event) => update("countWideAsBall", event.target.checked)}
            />{" "}
            Count wides as legal balls
          </label>
          <label className="text-muted">
            <input
              type="checkbox"
              checked={form.countNoBallAsBall}
              onChange={(event) => update("countNoBallAsBall", event.target.checked)}
            />{" "}
            Count no-balls as legal balls
          </label>
        </div>
        <span className="text-muted">
          Need teams? Use <Link href="/admin/teams">Team Builder</Link>. Need match
          players? Use <Link href="/admin/players">Player Assignment</Link>.
        </span>
        {status ? <span className="text-muted">{status}</span> : null}
        <div className="grid two">
          <button className="pill" type="button" onClick={addMatch} disabled={loading}>
            {loading ? "Saving..." : editingMatchId ? "Update match" : "Create match"}
          </button>
          {editingMatchId ? (
            <button className="pill" type="button" onClick={cancelEditMatch} disabled={loading}>
              Cancel edit
            </button>
          ) : null}
        </div>
        {matches.length ? (
          <div className="list">
            <span className="text-muted">Matches</span>
            {matches.map((match, index) => {
              const teamA = teamMap.get(match.team_a_id);
              const teamB = teamMap.get(match.team_b_id);
              return (
                <div key={`${match.match_id}-${index}`} className="card">
                  <strong>
                    {teamA?.name || "Team A"} vs {teamB?.name || "Team B"}
                  </strong>
                  <span className="text-muted">
                    {match.match_date || "TBD"} • {match.overs || "-"} ov •{" "}
                    {match.stage || "LEAGUE"}
                    {match.group_name ? ` • ${match.group_name}` : ""}
                    {match.venue ? ` • ${match.venue}` : ""}
                  </span>
                  <div className="grid two">
                    <button className="pill" type="button" onClick={() => startEditMatch(match)}>
                      Edit
                    </button>
                    <button className="pill" type="button" onClick={() => deleteMatch(match)}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <span className="text-muted">No matches yet.</span>
        )}
      </div>
    </div>
  );
}
