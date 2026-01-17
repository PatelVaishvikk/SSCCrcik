"use client";

import { useEffect, useState } from "react";

const ACTIVE_TOURNAMENT_KEY = "ssc_active_tournament_id";
const ACTIVE_TOURNAMENT_NAME_KEY = "ssc_active_tournament_name";

type DraftTournament = {
  name: string;
  type: string;
  format: string;
  year: string;
  startDate: string;
  endDate: string;
  overs: string;
  pointsWin: string;
  pointsTie: string;
  pointsNoResult: string;
  pointsLoss: string;
  allOutCountsFullOvers: boolean;
  bonusEnabled: boolean;
  bonusWin: string;
  bonusMax: string;
  bonusWinMarginRuns: string;
  bonusWinMarginWickets: string;
  bonusChaseWithinOvers: string;
};

export default function TournamentBuilder() {
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [activeTournamentId, setActiveTournamentId] = useState("");
  const [editingTournamentId, setEditingTournamentId] = useState("");
  const [form, setForm] = useState<DraftTournament>({
    name: "",
    type: "ACT",
    format: "LEAGUE",
    year: new Date().getFullYear().toString(),
    startDate: "",
    endDate: "",
    overs: "",
    pointsWin: "2",
    pointsTie: "1",
    pointsNoResult: "1",
    pointsLoss: "0",
    allOutCountsFullOvers: false,
    bonusEnabled: false,
    bonusWin: "1",
    bonusMax: "1",
    bonusWinMarginRuns: "",
    bonusWinMarginWickets: "",
    bonusChaseWithinOvers: "",
  });
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTournaments = async () => {
    const res = await fetch("/api/admin/tournaments");
    const data = await res.json();
    if (res.ok) {
      setTournaments(data.tournaments || []);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem(ACTIVE_TOURNAMENT_KEY);
    if (stored) {
      setActiveTournamentId(stored);
    }
    loadTournaments();
  }, []);

  const update = (key: keyof DraftTournament, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const saveTournament = async () => {
    if (!form.name.trim()) return;
    setLoading(true);
    setStatus(null);
    const payload = {
      tournamentId: editingTournamentId || undefined,
      name: form.name,
      type: form.type,
      format: form.format,
      year: form.year,
      startDate: form.startDate,
      endDate: form.endDate,
      overs: form.overs ? Number(form.overs) : null,
      pointsRules: {
        win: Number(form.pointsWin),
        tie: Number(form.pointsTie),
        noResult: Number(form.pointsNoResult),
        loss: Number(form.pointsLoss),
        allOutCountsFullOvers: form.allOutCountsFullOvers,
      },
      bonusRules: {
        enabled: form.bonusEnabled,
        winBonus: Number(form.bonusWin),
        maxBonus: Number(form.bonusMax),
        winMarginRuns: form.bonusWinMarginRuns ? Number(form.bonusWinMarginRuns) : null,
        winMarginWickets: form.bonusWinMarginWickets
          ? Number(form.bonusWinMarginWickets)
          : null,
        chaseWithinOvers: form.bonusChaseWithinOvers
          ? Number(form.bonusChaseWithinOvers)
          : null,
      },
    };
    const res = await fetch("/api/admin/tournaments", {
      method: editingTournamentId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "Unable to save tournament.");
      setLoading(false);
      return;
    }
    if (data.tournament?.tournament_id) {
      if (editingTournamentId) {
        if (data.tournament.tournament_id === activeTournamentId) {
          localStorage.setItem(
            ACTIVE_TOURNAMENT_NAME_KEY,
            data.tournament.name || ""
          );
        }
        setStatus(`${data.tournament.name} updated.`);
      } else {
        localStorage.setItem(ACTIVE_TOURNAMENT_KEY, data.tournament.tournament_id);
        localStorage.setItem(ACTIVE_TOURNAMENT_NAME_KEY, data.tournament.name || "");
        setActiveTournamentId(data.tournament.tournament_id);
        setStatus(`${data.tournament.name} created and set as active.`);
      }
    }
    setEditingTournamentId("");
    setForm({
      name: "",
      type: "ACT",
      format: "LEAGUE",
      year: new Date().getFullYear().toString(),
      startDate: "",
      endDate: "",
      overs: "",
      pointsWin: "2",
      pointsTie: "1",
      pointsNoResult: "1",
      pointsLoss: "0",
      allOutCountsFullOvers: false,
      bonusEnabled: false,
      bonusWin: "1",
      bonusMax: "1",
      bonusWinMarginRuns: "",
      bonusWinMarginWickets: "",
      bonusChaseWithinOvers: "",
    });
    await loadTournaments();
    setLoading(false);
  };

  const startEdit = (tournament: any) => {
    setEditingTournamentId(tournament.tournament_id);
    setForm({
      name: tournament.name || "",
      type: tournament.type || "ACT",
      format: tournament.format || "LEAGUE",
      year: String(tournament.year || ""),
      startDate: tournament.start_date || "",
      endDate: tournament.end_date || "",
      overs: tournament.overs ? String(tournament.overs) : "",
      pointsWin: String(tournament.points_rules?.win ?? 2),
      pointsTie: String(tournament.points_rules?.tie ?? 1),
      pointsNoResult: String(tournament.points_rules?.noResult ?? tournament.points_rules?.no_result ?? 1),
      pointsLoss: String(tournament.points_rules?.loss ?? 0),
      allOutCountsFullOvers: Boolean(tournament.points_rules?.allOutCountsFullOvers),
      bonusEnabled: Boolean(tournament.bonus_rules?.enabled),
      bonusWin: String(tournament.bonus_rules?.winBonus ?? 1),
      bonusMax: String(tournament.bonus_rules?.maxBonus ?? 1),
      bonusWinMarginRuns: tournament.bonus_rules?.winMarginRuns
        ? String(tournament.bonus_rules?.winMarginRuns)
        : "",
      bonusWinMarginWickets: tournament.bonus_rules?.winMarginWickets
        ? String(tournament.bonus_rules?.winMarginWickets)
        : "",
      bonusChaseWithinOvers: tournament.bonus_rules?.chaseWithinOvers
        ? String(tournament.bonus_rules?.chaseWithinOvers)
        : "",
    });
    setStatus(`Editing ${tournament.name}.`);
  };

  const cancelEdit = () => {
    setEditingTournamentId("");
    setForm({
      name: "",
      type: "ACT",
      format: "LEAGUE",
      year: new Date().getFullYear().toString(),
      startDate: "",
      endDate: "",
      overs: "",
      pointsWin: "2",
      pointsTie: "1",
      pointsNoResult: "1",
      pointsLoss: "0",
      allOutCountsFullOvers: false,
      bonusEnabled: false,
      bonusWin: "1",
      bonusMax: "1",
      bonusWinMarginRuns: "",
      bonusWinMarginWickets: "",
      bonusChaseWithinOvers: "",
    });
    setStatus(null);
  };

  const deleteTournament = async (tournamentId: string, name: string) => {
    if (!window.confirm(`Delete ${name}? This removes all teams and matches.`)) return;
    setLoading(true);
    setStatus(null);
    const res = await fetch(`/api/admin/tournaments?tournamentId=${tournamentId}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "Unable to delete tournament.");
      setLoading(false);
      return;
    }
    if (tournamentId === activeTournamentId) {
      localStorage.removeItem(ACTIVE_TOURNAMENT_KEY);
      localStorage.removeItem(ACTIVE_TOURNAMENT_NAME_KEY);
      setActiveTournamentId("");
    }
    setStatus("Tournament deleted.");
    await loadTournaments();
    setLoading(false);
  };

  const setActiveTournament = (tournament: any) => {
    if (!tournament?.tournament_id) return;
    localStorage.setItem(ACTIVE_TOURNAMENT_KEY, tournament.tournament_id);
    localStorage.setItem(ACTIVE_TOURNAMENT_NAME_KEY, tournament.name || "");
    setActiveTournamentId(tournament.tournament_id);
    setStatus(`Active tournament set to ${tournament.name}.`);
  };

  return (
    <div className="card">
      <div className="list">
        <span className="pill">Create tournament</span>
        <div className="grid two">
          <input
            className="search-input"
            placeholder="Tournament name"
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
          />
          <select
            className="search-input"
            value={form.type}
            onChange={(event) => update("type", event.target.value)}
          >
            <option value="ACT">ACT</option>
            <option value="ABCT">ABCT</option>
          </select>
          <select
            className="search-input"
            value={form.format}
            onChange={(event) => update("format", event.target.value)}
          >
            <option value="LEAGUE">League</option>
            <option value="KNOCKOUT">Knockout</option>
            <option value="GROUP_KNOCKOUT">Group + Knockout</option>
            <option value="BOX">Box cricket</option>
          </select>
          <input
            className="search-input"
            placeholder="Year"
            value={form.year}
            onChange={(event) => update("year", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="Default overs"
            value={form.overs}
            onChange={(event) => update("overs", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="Start date"
            value={form.startDate}
            onChange={(event) => update("startDate", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="End date"
            value={form.endDate}
            onChange={(event) => update("endDate", event.target.value)}
          />
        </div>
        <div className="grid three">
          <input
            className="search-input"
            placeholder="Win points"
            value={form.pointsWin}
            onChange={(event) => update("pointsWin", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="Tie points"
            value={form.pointsTie}
            onChange={(event) => update("pointsTie", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="No result points"
            value={form.pointsNoResult}
            onChange={(event) => update("pointsNoResult", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="Loss points"
            value={form.pointsLoss}
            onChange={(event) => update("pointsLoss", event.target.value)}
          />
          <label className="text-muted">
            <input
              type="checkbox"
              checked={form.allOutCountsFullOvers}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, allOutCountsFullOvers: event.target.checked }))
              }
            />{" "}
            All out counts full overs for NRR
          </label>
          <label className="text-muted">
            <input
              type="checkbox"
              checked={form.bonusEnabled}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, bonusEnabled: event.target.checked }))
              }
            />{" "}
            Enable bonus points
          </label>
          <input
            className="search-input"
            placeholder="Bonus points per trigger"
            value={form.bonusWin}
            onChange={(event) => update("bonusWin", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="Bonus cap"
            value={form.bonusMax}
            onChange={(event) => update("bonusMax", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="Bonus win margin runs"
            value={form.bonusWinMarginRuns}
            onChange={(event) => update("bonusWinMarginRuns", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="Bonus win margin wickets"
            value={form.bonusWinMarginWickets}
            onChange={(event) => update("bonusWinMarginWickets", event.target.value)}
          />
          <input
            className="search-input"
            placeholder="Bonus chase within overs"
            value={form.bonusChaseWithinOvers}
            onChange={(event) => update("bonusChaseWithinOvers", event.target.value)}
          />
        </div>
        {status ? <span className="text-muted">{status}</span> : null}
        <div className="grid two">
          <button className="pill" type="button" onClick={saveTournament} disabled={loading}>
            {loading ? "Saving..." : editingTournamentId ? "Update tournament" : "Create tournament"}
          </button>
          {editingTournamentId ? (
            <button className="pill" type="button" onClick={cancelEdit} disabled={loading}>
              Cancel edit
            </button>
          ) : null}
        </div>
        {tournaments.length ? (
          <div className="list">
            <span className="text-muted">Active tournaments</span>
            {tournaments.map((tournament, index) => (
              <div key={`${tournament.tournament_id}-${index}`} className="card">
                <strong>
                  {tournament.name}
                  {tournament.tournament_id === activeTournamentId ? " • Active" : ""}
                </strong>
                <span className="text-muted">
                  {tournament.type} • {tournament.format || "LEAGUE"} •{" "}
                  {tournament.overs ? `${tournament.overs} ov` : "Overs TBD"} • {tournament.year} •{" "}
                  {tournament.start_date || "TBD"} to {tournament.end_date || "TBD"}
                </span>
                <button
                  className="pill"
                  type="button"
                  onClick={() => setActiveTournament(tournament)}
                >
                  {tournament.tournament_id === activeTournamentId
                    ? "Active tournament"
                    : "Use for setup"}
                </button>
                <div className="grid two">
                  <button className="pill" type="button" onClick={() => startEdit(tournament)}>
                    Edit
                  </button>
                  <button
                    className="pill"
                    type="button"
                    onClick={() => deleteTournament(tournament.tournament_id, tournament.name)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-muted">No tournaments yet.</span>
        )}
      </div>
    </div>
  );
}
