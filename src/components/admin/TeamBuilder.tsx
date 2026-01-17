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

export default function TeamBuilder() {
  const [mode, setMode] = useState<"past" | "new">("past");
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState("");
  const [rosterTarget, setRosterTarget] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [editingTeamId, setEditingTeamId] = useState("");
  const [archivedEvents, setArchivedEvents] = useState<any[]>([]);
  const [archivedTeams, setArchivedTeams] = useState<any[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedArchivedTeams, setSelectedArchivedTeams] = useState<string[]>([]);
  const [archivedSearch, setArchivedSearch] = useState("");
  const [playerSourceEventId, setPlayerSourceEventId] = useState("");
  const [playerSourceTeams, setPlayerSourceTeams] = useState<any[]>([]);
  const [playerSourceTeamId, setPlayerSourceTeamId] = useState("");
  const [form, setForm] = useState({
    tournamentId: "",
    name: "",
    shortName: "",
    captainId: "",
    viceCaptainId: "",
  });
  const [newPlayer, setNewPlayer] = useState({
    name: "",
    city: "",
    role: "",
    batting_hand: "",
    bowling_style: "",
  });
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        setForm((prev) => ({ ...prev, tournamentId: nextId }));
      }
    }
  };

  const loadTeams = async (tournamentId: string) => {
    if (!tournamentId) return;
    const res = await fetch(`/api/admin/teams?tournamentId=${tournamentId}`);
    const data = await res.json();
    if (res.ok) {
      setTeams(data.teams || []);
    }
  };

  const loadPlayers = async () => {
    const res = await fetch("/api/admin/players");
    const data = await res.json();
    if (res.ok) {
      setPlayers(data.players || []);
    }
  };

  const loadArchivedEvents = async () => {
    const res = await fetch("/api/admin/archive/events");
    const data = await res.json();
    if (res.ok) {
      setArchivedEvents(data.events || []);
    }
  };

  const loadArchivedTeams = async (eventId: string) => {
    if (!eventId) return;
    const res = await fetch(`/api/admin/archive/teams?eventId=${eventId}`);
    const data = await res.json();
    if (res.ok) {
      setArchivedTeams(data.teams || []);
    }
  };

  const loadPlayerSourceTeams = async (eventId: string) => {
    if (!eventId) return;
    const res = await fetch(`/api/admin/archive/teams?eventId=${eventId}`);
    const data = await res.json();
    if (res.ok) {
      setPlayerSourceTeams(data.teams || []);
    }
  };

  useEffect(() => {
    loadTournaments();
    loadPlayers();
    loadArchivedEvents();
  }, []);

  useEffect(() => {
    loadTeams(form.tournamentId);
    setSelected([]);
    setSelectedArchivedTeams([]);
    setArchivedTeams([]);
    setSelectedEventId("");
    setEditingTeamId("");
    setForm((prev) => ({ ...prev, captainId: "", viceCaptainId: "" }));
  }, [form.tournamentId]);

  useEffect(() => {
    if (!selectedEventId) {
      setArchivedTeams([]);
      setSelectedArchivedTeams([]);
      setArchivedSearch("");
      return;
    }
    loadArchivedTeams(selectedEventId);
    setSelectedArchivedTeams([]);
    setArchivedSearch("");
  }, [selectedEventId]);

  useEffect(() => {
    if (!playerSourceEventId) {
      setPlayerSourceTeams([]);
      setPlayerSourceTeamId("");
      return;
    }
    loadPlayerSourceTeams(playerSourceEventId);
    setPlayerSourceTeamId("");
  }, [playerSourceEventId]);

  useEffect(() => {
    if (mode === "past" && !selectedEventId && archivedEvents.length) {
      setSelectedEventId(archivedEvents[0].event_id);
    }
  }, [archivedEvents, mode, selectedEventId]);

  useEffect(() => {
    if (mode === "new" && !playerSourceEventId && archivedEvents.length) {
      setPlayerSourceEventId(archivedEvents[0].event_id);
    }
  }, [archivedEvents, mode, playerSourceEventId]);

  const togglePlayer = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
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

  const filteredArchivedTeams = useMemo(() => {
    const query = archivedSearch.trim().toLowerCase();
    if (!query) return archivedTeams;
    return archivedTeams.filter((team: any) =>
      String(team.team_name || "").toLowerCase().includes(query)
    );
  }, [archivedSearch, archivedTeams]);

  const toggleArchivedTeam = (id: string) => {
    setSelectedArchivedTeams((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const importTeams = async () => {
    if (!form.tournamentId || !selectedEventId || !selectedArchivedTeams.length) {
      setStatus("Select a target tournament, source event, and teams to import.");
      return;
    }
    setLoading(true);
    setStatus(null);
    const res = await fetch("/api/admin/import-teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tournamentId: form.tournamentId,
        eventId: selectedEventId,
        teamIds: selectedArchivedTeams,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "Unable to import teams.");
      setLoading(false);
      return;
    }
    const created = data.created?.length || 0;
    const skipped = data.skipped?.length || 0;
    if (created || skipped) {
      setStatus(`Imported ${created} team(s).${skipped ? ` Skipped ${skipped}.` : ""}`);
    }
    await loadTeams(form.tournamentId);
    await loadPlayers();
    setSelectedArchivedTeams([]);
    setLoading(false);
  };

  const importPlayers = async () => {
    if (!playerSourceEventId || !playerSourceTeamId) {
      setStatus("Select a past tournament and team to import players.");
      return;
    }
    setLoading(true);
    setStatus(null);
    const res = await fetch("/api/admin/import-players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: playerSourceEventId,
        teamId: playerSourceTeamId,
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
      setSelected((prev) => Array.from(new Set([...prev, ...playerIds])));
    }
    setStatus(
      playerIds.length
        ? `Imported ${playerIds.length} player(s).`
        : "No players found to import."
    );
    setLoading(false);
  };

  const saveTeam = async () => {
    if (!form.tournamentId || !form.name.trim() || selected.length === 0) {
      setStatus("Tournament, team name, and players are required.");
      return;
    }
    setLoading(true);
    setStatus(null);
    const payload = {
      tournamentId: form.tournamentId,
      teamId: editingTeamId || undefined,
      name: form.name,
      shortName: form.shortName,
      captainId: selected.includes(form.captainId) ? form.captainId : "",
      viceCaptainId: selected.includes(form.viceCaptainId) ? form.viceCaptainId : "",
      playerIds: selected,
    };
    const res = await fetch("/api/admin/teams", {
      method: editingTeamId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "Unable to save team.");
      setLoading(false);
      return;
    }
    setEditingTeamId("");
    setForm((prev) => ({ ...prev, name: "", shortName: "" }));
    setRosterTarget("");
    setSelected([]);
    await loadTeams(form.tournamentId);
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
    setSelected((prev) => [data.player.player_id, ...prev]);
    setNewPlayer({ name: "", city: "", role: "", batting_hand: "", bowling_style: "" });
    setLoading(false);
  };

  const handleTournamentChange = (value: string) => {
    setForm((prev) => ({ ...prev, tournamentId: value }));
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

  const playerSourceTeam = useMemo(
    () => playerSourceTeams.find((team) => team.team_id === playerSourceTeamId),
    [playerSourceTeamId, playerSourceTeams]
  );

  const startEditTeam = (team: any) => {
    setMode("new");
    setEditingTeamId(team.team_id);
    setForm((prev) => ({
      ...prev,
      tournamentId: team.tournament_id || prev.tournamentId,
      name: team.name || "",
      shortName: team.short_name || "",
      captainId: team.captain_id || "",
      viceCaptainId: team.vice_captain_id || "",
    }));
    const roster = Array.isArray(team.player_ids) ? team.player_ids : [];
    setSelected(roster.map((id: string) => String(id)));
    setRosterTarget(roster.length ? String(roster.length) : "");
    setStatus(`Editing ${team.name}.`);
  };

  const cancelEditTeam = () => {
    setEditingTeamId("");
    setForm((prev) => ({
      ...prev,
      name: "",
      shortName: "",
      captainId: "",
      viceCaptainId: "",
    }));
    setSelected([]);
    setRosterTarget("");
    setStatus(null);
  };

  const deleteTeam = async (team: any) => {
    if (!form.tournamentId) return;
    if (!window.confirm(`Delete ${team.name}?`)) return;
    setLoading(true);
    setStatus(null);
    const tournamentId = team.tournament_id || form.tournamentId;
    const res = await fetch(
      `/api/admin/teams?teamId=${team.team_id}&tournamentId=${tournamentId}`,
      { method: "DELETE" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "Unable to delete team.");
      setLoading(false);
      return;
    }
    setStatus("Team deleted.");
    await loadTeams(form.tournamentId);
    setLoading(false);
  };

  return (
    <div className="card">
      <div className="list">
        <span className="pill">Team builder</span>
        <div className="grid two">
          <button
            type="button"
            className={`pill ${mode === "past" ? "pill-active" : ""}`}
            onClick={() => {
              setMode("past");
              setEditingTeamId("");
              setStatus(null);
            }}
          >
            Past tournament teams
          </button>
          <button
            type="button"
            className={`pill ${mode === "new" ? "pill-active" : ""}`}
            onClick={() => {
              setMode("new");
              setStatus(null);
            }}
          >
            Create new team
          </button>
        </div>

        <div className="grid two">
          <select
            className="search-input"
            value={form.tournamentId}
            onChange={(event) => handleTournamentChange(event.target.value)}
          >
            <option value="">Select target tournament</option>
            {tournaments.map((tournament) => (
              <option key={tournament.tournament_id} value={tournament.tournament_id}>
                {tournament.name}
              </option>
            ))}
          </select>
          {mode === "past" ? (
            <select
              className="search-input"
              value={selectedEventId}
              onChange={(event) => setSelectedEventId(event.target.value)}
            >
              <option value="">Select past tournament</option>
              {archivedEvents.map((event) => (
                <option key={event.event_id} value={event.event_id}>
                  {event.year} • {event.type || "Tournament"} • {event.event_name || "Event"}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="search-input"
              placeholder="Team name"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          )}
        </div>

        {mode === "past" && !archivedEvents.length ? (
          <span className="text-muted">No archived tournaments found yet.</span>
        ) : null}

        {mode === "past" ? (
          <>
            <div className="grid two">
              <input
                className="search-input"
                placeholder="Search past teams"
                value={archivedSearch}
                onChange={(event) => setArchivedSearch(event.target.value)}
              />
              <button
                className="pill"
                type="button"
                onClick={() =>
                  setSelectedArchivedTeams(
                    selectedArchivedTeams.length
                      ? []
                      : archivedTeams.map((team) => team.team_id).filter(Boolean)
                  )
                }
              >
                {selectedArchivedTeams.length ? "Clear selection" : "Select all"}
              </button>
            </div>

            {!selectedEventId ? (
              <span className="text-muted">Select a past tournament to load teams.</span>
            ) : archivedTeams.length === 0 ? (
              <span className="text-muted">No teams found for this tournament.</span>
            ) : null}

            <div className="list">
              <span className="text-muted">
                Teams ({selectedArchivedTeams.length}/{archivedTeams.length})
              </span>
              <div className="grid three">
                {filteredArchivedTeams.map((team: any) => {
                  const active = selectedArchivedTeams.includes(team.team_id);
                  return (
                    <button
                      type="button"
                      key={team.team_id}
                      className={`pill ${active ? "pill-active" : ""}`}
                      onClick={() => toggleArchivedTeam(team.team_id)}
                    >
                      {team.team_name}
                      {team.players?.length ? ` • ${team.players.length} players` : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            {status ? <span className="text-muted">{status}</span> : null}
            <button
              className="pill"
              type="button"
              onClick={importTeams}
              disabled={
                loading ||
                selectedArchivedTeams.length === 0 ||
                !form.tournamentId ||
                !selectedEventId
              }
            >
              {loading ? "Importing..." : "Import selected teams"}
            </button>
          </>
        ) : (
          <>
            <div className="grid two">
              <input
                className="search-input"
                placeholder="Short name"
                value={form.shortName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, shortName: event.target.value }))
                }
              />
              <input
                className="search-input"
                placeholder="Target roster size"
                type="number"
                min="0"
                value={rosterTarget}
                onChange={(event) => setRosterTarget(event.target.value)}
              />
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
                  value={playerSourceEventId}
                  onChange={(event) => setPlayerSourceEventId(event.target.value)}
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
                  value={playerSourceTeamId}
                  onChange={(event) => setPlayerSourceTeamId(event.target.value)}
                >
                  <option value="">Select past team</option>
                  {playerSourceTeams.map((team: any) => (
                    <option key={team.team_id} value={team.team_id}>
                      {team.team_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid two">
                <span className="text-muted">
                  {!playerSourceEventId
                    ? "Select a past tournament to load teams."
                    : !playerSourceTeamId
                    ? "Select a past team to view players."
                    : playerSourceTeam?.players?.length
                    ? `${playerSourceTeam.players.length} players available`
                    : "No players loaded for this team."}
                </span>
                <button
                  className="pill"
                  type="button"
                  onClick={importPlayers}
                  disabled={loading || !playerSourceEventId || !playerSourceTeamId}
                >
                  {loading ? "Importing..." : "Import players"}
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
              <button className="pill" type="button" onClick={addPlayer} disabled={loading}>
                Add player
              </button>
            </div>

            <div className="grid two">
              <select
                className="search-input"
                value={form.captainId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, captainId: event.target.value }))
                }
              >
                <option value="">Select captain</option>
                {selected.map((id) => {
                  const player = players.find((item) => item.player_id === id);
                  return (
                    <option key={id} value={id}>
                      {player?.name || id}
                    </option>
                  );
                })}
              </select>
              <select
                className="search-input"
                value={form.viceCaptainId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, viceCaptainId: event.target.value }))
                }
              >
                <option value="">Select vice captain</option>
                {selected.map((id) => {
                  const player = players.find((item) => item.player_id === id);
                  return (
                    <option key={id} value={id}>
                      {player?.name || id}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="list">
              <span className="text-muted">
                Players ({selected.length}
                {rosterTarget ? `/${rosterTarget}` : ""})
              </span>
              <div className="grid three">
                {filteredPlayers.slice(0, 240).map((player) => {
                  const active = selected.includes(player.player_id);
                  return (
                    <button
                      type="button"
                      key={player.player_id}
                      className={`pill ${active ? "pill-active" : ""}`}
                      onClick={() => togglePlayer(player.player_id)}
                    >
                      {player.name}
                      {player.source === "custom" ? " • new" : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            {status ? <span className="text-muted">{status}</span> : null}
            <div className="grid two">
              <button
                className="pill"
                type="button"
                onClick={saveTeam}
                disabled={loading || !form.tournamentId}
              >
                {loading ? "Saving..." : editingTeamId ? "Update team" : "Save team"}
              </button>
              {editingTeamId ? (
                <button
                  className="pill"
                  type="button"
                  onClick={cancelEditTeam}
                  disabled={loading}
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
          </>
        )}

        {teams.length ? (
          <div className="list">
            <span className="text-muted">Teams</span>
            {teams.map((team) => (
              <div key={team.team_id} className="card">
                <strong>{team.name}</strong>
                <span className="text-muted">
                  Players: {team.player_ids?.length || 0}
                </span>
                <div className="grid two">
                  <button className="pill" type="button" onClick={() => startEditTeam(team)}>
                    Edit
                  </button>
                  <button className="pill" type="button" onClick={() => deleteTeam(team)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-muted">No teams yet.</span>
        )}
      </div>
    </div>
  );
}
