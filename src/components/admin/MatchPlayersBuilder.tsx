"use client";

import { useEffect, useMemo, useState } from "react";

const ACTIVE_TOURNAMENT_KEY = "ssc_active_tournament_id";
const ACTIVE_TOURNAMENT_NAME_KEY = "ssc_active_tournament_name";

type Player = {
  player_id: string;
  name: string;
  city: string;
  role: string;
  batting_hand?: string;
  bowling_style?: string;
  source?: string;
};

type TeamDoc = {
  team_id: string;
  name: string;
  player_ids?: string[];
};

type MatchDoc = {
  match_id: string;
  tournament_id: string;
  team_a_id: string;
  team_b_id: string;
  match_date?: string | null;
  overs?: number | null;
  squad_a_ids?: string[];
  squad_b_ids?: string[];
};

type ArchiveEvent = {
  event_id: string;
  year: number;
  type?: string;
  event_name?: string;
};

export default function MatchPlayersBuilder() {
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [teams, setTeams] = useState<TeamDoc[]>([]);
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedTournament, setSelectedTournament] = useState("");
  const [selectedMatch, setSelectedMatch] = useState("");
  const [squadA, setSquadA] = useState<string[]>([]);
  const [squadB, setSquadB] = useState<string[]>([]);
  const [activeSide, setActiveSide] = useState<"A" | "B">("A");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [archivedEvents, setArchivedEvents] = useState<ArchiveEvent[]>([]);
  const [importEventId, setImportEventId] = useState("");
  const [importTeams, setImportTeams] = useState<any[]>([]);
  const [importTeamId, setImportTeamId] = useState("");

  const [newPlayer, setNewPlayer] = useState({
    name: "",
    city: "",
    role: "",
    batting_hand: "",
    bowling_style: "",
  });

  const teamMap = useMemo(() => {
    const map = new Map<string, TeamDoc>();
    teams.forEach((team) => map.set(team.team_id, team));
    return map;
  }, [teams]);

  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    players.forEach((player) => map.set(player.player_id, player));
    return map;
  }, [players]);

  const currentMatch = useMemo(
    () => matches.find((match) => match.match_id === selectedMatch),
    [matches, selectedMatch]
  );

  const teamA = currentMatch ? teamMap.get(currentMatch.team_a_id) : undefined;
  const teamB = currentMatch ? teamMap.get(currentMatch.team_b_id) : undefined;
  const teamAName = teamA?.name || "Team A";
  const teamBName = teamB?.name || "Team B";

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
      if (!selectedTournament || (nextId && selectedTournament !== nextId)) {
        setSelectedTournament(nextId);
      }
    }
  };

  const loadTournamentData = async (tournamentId: string) => {
    if (!tournamentId) return;
    const [teamsRes, matchesRes, playersRes] = await Promise.all([
      fetch(`/api/admin/teams?tournamentId=${tournamentId}`),
      fetch(`/api/admin/matches?tournamentId=${tournamentId}`),
      fetch("/api/admin/players"),
    ]);
    const teamsData = await teamsRes.json();
    const matchesData = await matchesRes.json();
    const playersData = await playersRes.json();
    if (teamsRes.ok) setTeams(teamsData.teams || []);
    if (matchesRes.ok) setMatches(matchesData.matches || []);
    if (playersRes.ok) setPlayers(playersData.players || []);
  };

  const loadArchivedEvents = async () => {
    const res = await fetch("/api/admin/archive/events");
    const data = await res.json();
    if (res.ok) {
      setArchivedEvents(data.events || []);
    }
  };

  const loadImportTeams = async (eventId: string) => {
    if (!eventId) return;
    const res = await fetch(`/api/admin/archive/teams?eventId=${eventId}`);
    const data = await res.json();
    if (res.ok) {
      setImportTeams(data.teams || []);
    }
  };

  useEffect(() => {
    loadTournaments();
    loadArchivedEvents();
  }, []);

  useEffect(() => {
    if (selectedTournament) {
      loadTournamentData(selectedTournament);
    } else {
      setTeams([]);
      setMatches([]);
    }
  }, [selectedTournament]);

  useEffect(() => {
    if (!matches.length) {
      setSelectedMatch("");
      setSquadA([]);
      setSquadB([]);
      return;
    }
    if (!selectedMatch || !matches.some((match) => match.match_id === selectedMatch)) {
      setSelectedMatch(matches[0].match_id);
    }
  }, [matches, selectedMatch]);

  useEffect(() => {
    if (!currentMatch) {
      setSquadA([]);
      setSquadB([]);
      return;
    }
    setSquadA(
      Array.isArray(currentMatch.squad_a_ids) ? currentMatch.squad_a_ids : []
    );
    setSquadB(
      Array.isArray(currentMatch.squad_b_ids) ? currentMatch.squad_b_ids : []
    );
    setActiveSide("A");
    setStatus(null);
  }, [currentMatch?.match_id]);

  useEffect(() => {
    if (!importEventId && archivedEvents.length) {
      setImportEventId(archivedEvents[0].event_id);
    }
  }, [archivedEvents, importEventId]);

  useEffect(() => {
    if (!importEventId) {
      setImportTeams([]);
      setImportTeamId("");
      return;
    }
    loadImportTeams(importEventId);
    setImportTeamId("");
  }, [importEventId]);

  const handleTournamentChange = (value: string) => {
    setSelectedTournament(value);
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

  const togglePlayerForSide = (playerId: string) => {
    setSquadA((prev) => {
      if (activeSide !== "A") return prev.filter((id) => id !== playerId);
      return prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : [...prev, playerId];
    });
    setSquadB((prev) => {
      if (activeSide !== "B") return prev.filter((id) => id !== playerId);
      return prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : [...prev, playerId];
    });
  };

  const removeFromSquad = (side: "A" | "B", playerId: string) => {
    if (side === "A") {
      setSquadA((prev) => prev.filter((id) => id !== playerId));
    } else {
      setSquadB((prev) => prev.filter((id) => id !== playerId));
    }
  };

  const loadTeamRoster = (side: "A" | "B") => {
    if (!currentMatch) return;
    const roster =
      side === "A"
        ? teamMap.get(currentMatch.team_a_id)?.player_ids || []
        : teamMap.get(currentMatch.team_b_id)?.player_ids || [];
    const unique = Array.from(new Set(roster.map((id) => String(id))));
    if (side === "A") {
      setSquadA(unique);
      setSquadB((prev) => prev.filter((id) => !unique.includes(id)));
    } else {
      setSquadB(unique);
      setSquadA((prev) => prev.filter((id) => !unique.includes(id)));
    }
  };

  const clearSquad = (side: "A" | "B") => {
    if (side === "A") setSquadA([]);
    else setSquadB([]);
  };

  const saveSquads = async () => {
    if (!currentMatch || !selectedTournament) {
      setStatus("Select a tournament and match first.");
      return;
    }
    setLoading(true);
    setStatus(null);
    const res = await fetch("/api/admin/matches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId: currentMatch.match_id,
        tournamentId: selectedTournament,
        squadAIds: squadA,
        squadBIds: squadB,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "Unable to save match squads.");
      setLoading(false);
      return;
    }
    if (data.match) {
      setMatches((prev) =>
        prev.map((match) => (match.match_id === data.match.match_id ? data.match : match))
      );
    }
    setStatus("Match squads saved.");
    setLoading(false);
  };

  const addPlayer = async () => {
    if (!newPlayer.name.trim()) {
      setStatus("Player name is required.");
      return;
    }
    setLoading(true);
    setStatus(null);
    const res = await fetch("/api/admin/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newPlayer),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "Unable to add player.");
      setLoading(false);
      return;
    }
    setPlayers((prev) => [data.player, ...prev]);
    if (data.player?.player_id) {
      setSquadA((prev) =>
        activeSide === "A"
          ? Array.from(new Set([...prev, data.player.player_id]))
          : prev
      );
      setSquadB((prev) =>
        activeSide === "B"
          ? Array.from(new Set([...prev, data.player.player_id]))
          : prev
      );
    }
    setNewPlayer({ name: "", city: "", role: "", batting_hand: "", bowling_style: "" });
    setLoading(false);
  };

  const importPlayers = async () => {
    if (!importEventId || !importTeamId) {
      setStatus("Select a past tournament and team to import players.");
      return;
    }
    setLoading(true);
    setStatus(null);
    const res = await fetch("/api/admin/import-players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: importEventId,
        teamId: importTeamId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "Unable to import players.");
      setLoading(false);
      return;
    }
    if (Array.isArray(data.createdPlayers) && data.createdPlayers.length) {
      setPlayers((prev) => [...data.createdPlayers, ...prev]);
    }
    const playerIds: string[] = Array.isArray(data.playerIds) ? data.playerIds : [];
    if (playerIds.length) {
      if (activeSide === "A") {
        setSquadA((prev) => Array.from(new Set([...prev, ...playerIds])));
        setSquadB((prev) => prev.filter((id) => !playerIds.includes(id)));
      } else {
        setSquadB((prev) => Array.from(new Set([...prev, ...playerIds])));
        setSquadA((prev) => prev.filter((id) => !playerIds.includes(id)));
      }
    }
    setStatus(
      playerIds.length
        ? `Imported ${playerIds.length} player(s).`
        : "No players found to import."
    );
    setLoading(false);
  };

  const filteredPlayers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return players;
    return players.filter(
      (player) =>
        player.name.toLowerCase().includes(query) ||
        player.city.toLowerCase().includes(query) ||
        player.role.toLowerCase().includes(query)
    );
  }, [players, search]);

  const activeTeamName = activeSide === "A" ? teamAName : teamBName;

  return (
    <div className="card">
      <div className="list">
        <span className="pill">Match player setup</span>
        <div className="grid two">
          <select
            className="search-input"
            value={selectedTournament}
            onChange={(event) => handleTournamentChange(event.target.value)}
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
            {matches.map((match) => {
              const matchTeamA = teamMap.get(match.team_a_id);
              const matchTeamB = teamMap.get(match.team_b_id);
              return (
                <option key={match.match_id} value={match.match_id}>
                  {matchTeamA?.name || "Team A"} vs {matchTeamB?.name || "Team B"}
                </option>
              );
            })}
          </select>
        </div>

        {!currentMatch ? (
          <span className="text-muted">Select a match to manage squads.</span>
        ) : null}

        <div className="grid two">
          <div className="card">
            <div className="list">
              <div className="player-row">
                <strong>{teamAName}</strong>
                <span className="text-muted">{squadA.length} players</span>
              </div>
              <div className="grid two">
                <button
                  className="pill"
                  type="button"
                  onClick={() => loadTeamRoster("A")}
                  disabled={!teamA?.player_ids?.length}
                >
                  Load team roster
                </button>
                <button className="pill" type="button" onClick={() => clearSquad("A")}>
                  Clear squad
                </button>
              </div>
              <div className="grid three">
                {squadA.length ? (
                  squadA.map((id) => (
                    <button
                      type="button"
                      key={id}
                      className="pill pill-active"
                      onClick={() => removeFromSquad("A", id)}
                    >
                      {playerMap.get(id)?.name || id}
                    </button>
                  ))
                ) : (
                  <span className="text-muted">No players yet.</span>
                )}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="list">
              <div className="player-row">
                <strong>{teamBName}</strong>
                <span className="text-muted">{squadB.length} players</span>
              </div>
              <div className="grid two">
                <button
                  className="pill"
                  type="button"
                  onClick={() => loadTeamRoster("B")}
                  disabled={!teamB?.player_ids?.length}
                >
                  Load team roster
                </button>
                <button className="pill" type="button" onClick={() => clearSquad("B")}>
                  Clear squad
                </button>
              </div>
              <div className="grid three">
                {squadB.length ? (
                  squadB.map((id) => (
                    <button
                      type="button"
                      key={id}
                      className="pill pill-active"
                      onClick={() => removeFromSquad("B", id)}
                    >
                      {playerMap.get(id)?.name || id}
                    </button>
                  ))
                ) : (
                  <span className="text-muted">No players yet.</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid two">
          <button
            className="pill"
            type="button"
            onClick={saveSquads}
            disabled={loading || !currentMatch}
          >
            {loading ? "Saving..." : "Save match squads"}
          </button>
          {status ? <span className="text-muted">{status}</span> : null}
        </div>

        <div className="card">
          <div className="list">
            <div className="player-row">
              <span className="kicker">Player pool</span>
              <span className="text-muted">Assign to {activeTeamName}</span>
            </div>
            <div className="grid two">
              <button
                className={`pill ${activeSide === "A" ? "pill-active" : ""}`}
                type="button"
                onClick={() => setActiveSide("A")}
                disabled={!currentMatch}
              >
                {teamAName}
              </button>
              <button
                className={`pill ${activeSide === "B" ? "pill-active" : ""}`}
                type="button"
                onClick={() => setActiveSide("B")}
                disabled={!currentMatch}
              >
                {teamBName}
              </button>
            </div>
            <input
              className="search-input"
              placeholder="Search players"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <div className="list">
              <span className="kicker">Import players</span>
              <div className="grid two">
                <select
                  className="search-input"
                  value={importEventId}
                  onChange={(event) => setImportEventId(event.target.value)}
                >
                  <option value="">Select past tournament</option>
                  {archivedEvents.map((event) => (
                    <option key={event.event_id} value={event.event_id}>
                      {event.year} • {event.type || "Tournament"} • {event.event_name || "Event"}
                    </option>
                  ))}
                </select>
                <select
                  className="search-input"
                  value={importTeamId}
                  onChange={(event) => setImportTeamId(event.target.value)}
                >
                  <option value="">Select past team</option>
                  {importTeams.map((team: any) => (
                    <option key={team.team_id} value={team.team_id}>
                      {team.team_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid two">
                <span className="text-muted">
                  {importEventId
                    ? importTeams.length
                      ? `${importTeams.length} teams available`
                      : "No teams loaded."
                    : "Select a past tournament to load teams."}
                </span>
                <button
                  className="pill"
                  type="button"
                  onClick={importPlayers}
                  disabled={loading || !importEventId || !importTeamId || !currentMatch}
                >
                  {loading ? "Importing..." : `Import to ${activeTeamName}`}
                </button>
              </div>
            </div>

            <div className="grid two">
              <input
                className="search-input"
                placeholder="New player name"
                value={newPlayer.name}
                onChange={(event) =>
                  setNewPlayer((prev) => ({ ...prev, name: event.target.value }))
                }
              />
              <input
                className="search-input"
                placeholder="City"
                value={newPlayer.city}
                onChange={(event) =>
                  setNewPlayer((prev) => ({ ...prev, city: event.target.value }))
                }
              />
              <input
                className="search-input"
                placeholder="Role (e.g. All-rounder)"
                value={newPlayer.role}
                onChange={(event) =>
                  setNewPlayer((prev) => ({ ...prev, role: event.target.value }))
                }
              />
              <input
                className="search-input"
                placeholder="Batting hand (RHB/LHB)"
                value={newPlayer.batting_hand}
                onChange={(event) =>
                  setNewPlayer((prev) => ({ ...prev, batting_hand: event.target.value }))
                }
              />
              <input
                className="search-input"
                placeholder="Bowling style"
                value={newPlayer.bowling_style}
                onChange={(event) =>
                  setNewPlayer((prev) => ({ ...prev, bowling_style: event.target.value }))
                }
              />
              <button
                className="pill"
                type="button"
                onClick={addPlayer}
                disabled={loading || !currentMatch}
              >
                Add player to {activeTeamName}
              </button>
            </div>

            <div className="grid three">
              {filteredPlayers.slice(0, 240).map((player) => {
                const inA = squadA.includes(player.player_id);
                const inB = squadB.includes(player.player_id);
                const isActiveSide = activeSide === "A" ? inA : inB;
                const tag = inA ? " • A" : inB ? " • B" : "";
                return (
                  <button
                    type="button"
                    key={player.player_id}
                    className={`pill ${isActiveSide ? "pill-active" : ""}`}
                    onClick={() => togglePlayerForSide(player.player_id)}
                    disabled={!currentMatch}
                  >
                    {player.name}
                    {player.source === "custom" ? " • new" : ""}
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
