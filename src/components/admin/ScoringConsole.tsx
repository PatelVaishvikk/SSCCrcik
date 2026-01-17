"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./ScoringConsole.module.css";
import {
  applyScoringEvent,
  buildInitialSnapshot,
  formatOvers,
  getNextBallLabel,
  type ExtraType,
  type MatchSnapshot,
  type ScoringEvent,
  type ScoringPayload,
} from "@/lib/scoring/engine";

const RUN_BUTTONS = [0, 1, 2, 3, 4, 6];
const EXTRA_TYPES: Array<{ value: ExtraType; label: string; description: string }> = [
  { value: "WD", label: "Wide", description: "No ball count" },
  { value: "NB", label: "No ball", description: "No ball count" },
  { value: "B", label: "Bye", description: "Ball counts" },
  { value: "LB", label: "Leg bye", description: "Ball counts" },
  { value: "PEN", label: "Penalty", description: "No ball count" },
];
const DISMISSAL_TYPES = [
  "bowled",
  "caught",
  "lbw",
  "run out",
  "stumped",
  "hit wicket",
  "retired hurt",
  "obstructing field",
];

type Tournament = {
  tournament_id: string;
  name: string;
  year?: number;
  type?: string;
};

type Team = {
  team_id: string;
  name: string;
  short_name?: string;
  player_ids?: string[];
};

type Match = {
  match_id: string;
  tournament_id: string;
  team_a_id: string;
  team_b_id: string;
  overs?: number | null;
  match_date?: string | null;
  status?: string;
  squad_a_ids?: string[];
  squad_b_ids?: string[];
};

type Player = {
  player_id: string;
  name: string;
  role?: string;
};

type SnapshotState = MatchSnapshot & {
  lastEventSeq?: number;
};

function buildIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as any)?.error || "Request failed";
    throw new Error(message);
  }
  return data as T;
}

export default function ScoringConsole() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedTournament, setSelectedTournament] = useState("");
  const [selectedMatch, setSelectedMatch] = useState("");
  const [inningsNo, setInningsNo] = useState(1);
  const [battingTeamId, setBattingTeamId] = useState("");
  const [bowlingTeamId, setBowlingTeamId] = useState("");
  const [strikerId, setStrikerId] = useState("");
  const [nonStrikerId, setNonStrikerId] = useState("");
  const [bowlerId, setBowlerId] = useState("");
  const [snapshot, setSnapshot] = useState<SnapshotState | null>(null);
  const [history, setHistory] = useState<SnapshotState[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [extrasOpen, setExtrasOpen] = useState(false);
  const [extraType, setExtraType] = useState<ExtraType>("WD");
  const [extraRuns, setExtraRuns] = useState(1);
  const [extraBatRuns, setExtraBatRuns] = useState(0);

  const [wicketOpen, setWicketOpen] = useState(false);
  const [dismissalType, setDismissalType] = useState(DISMISSAL_TYPES[0]);
  const [outPlayer, setOutPlayer] = useState<"striker" | "non-striker">("striker");
  const [nextBatterId, setNextBatterId] = useState("");
  const [crossed, setCrossed] = useState(false);
  const [wicketRuns, setWicketRuns] = useState(0);
  const [wicketExtraType, setWicketExtraType] = useState<ExtraType | "">("");
  const [wicketExtraRuns, setWicketExtraRuns] = useState(1);

  const [overPromptOpen, setOverPromptOpen] = useState(false);
  const [pendingBowlerId, setPendingBowlerId] = useState("");
  const [lastPromptBall, setLastPromptBall] = useState<number | null>(null);
  const [overPromptBowlerId, setOverPromptBowlerId] = useState("");

  const teamMap = useMemo(
    () => new Map(teams.map((team) => [team.team_id, team])),
    [teams]
  );

  const playerMap = useMemo(
    () => new Map(players.map((player) => [player.player_id, player])),
    [players]
  );

  const activeMatch = useMemo(
    () => matches.find((match) => match.match_id === selectedMatch) || null,
    [matches, selectedMatch]
  );

  const battingRoster = useMemo(() => {
    if (!activeMatch || !battingTeamId) return [] as string[];
    const team = teamMap.get(battingTeamId);
    const squadIds =
      battingTeamId === activeMatch.team_a_id
        ? activeMatch.squad_a_ids
        : activeMatch.squad_b_ids;
    return (squadIds?.length ? squadIds : team?.player_ids || []).filter(Boolean);
  }, [activeMatch, battingTeamId, teamMap]);

  const bowlingRoster = useMemo(() => {
    if (!activeMatch || !bowlingTeamId) return [] as string[];
    const team = teamMap.get(bowlingTeamId);
    const squadIds =
      bowlingTeamId === activeMatch.team_a_id
        ? activeMatch.squad_a_ids
        : activeMatch.squad_b_ids;
    return (squadIds?.length ? squadIds : team?.player_ids || []).filter(Boolean);
  }, [activeMatch, bowlingTeamId, teamMap]);

  const dismissedIds = useMemo(() => {
    const dismissed = new Set<string>();
    if (!snapshot?.batsmen) return dismissed;
    Object.entries(snapshot.batsmen).forEach(([playerId, line]) => {
      if (line?.isOut) dismissed.add(playerId);
    });
    return dismissed;
  }, [snapshot]);

  const availableBatters = useMemo(() => {
    return battingRoster.filter(
      (playerId) =>
        playerId !== strikerId &&
        playerId !== nonStrikerId &&
        !dismissedIds.has(playerId)
    );
  }, [battingRoster, dismissedIds, strikerId, nonStrikerId]);

  useEffect(() => {
    fetchJson<{ tournaments: Tournament[] }>("/api/admin/tournaments")
      .then((data) => setTournaments(data.tournaments || []))
      .catch(() => setTournaments([]));

    fetchJson<{ players: Player[] }>("/api/admin/players")
      .then((data) => setPlayers(data.players || []))
      .catch(() => setPlayers([]));
  }, []);

  useEffect(() => {
    if (!selectedTournament) {
      setMatches([]);
      setTeams([]);
      return;
    }
    fetchJson<{ matches: Match[] }>(`/api/admin/matches?tournamentId=${selectedTournament}`)
      .then((data) => setMatches(data.matches || []))
      .catch(() => setMatches([]));

    fetchJson<{ teams: Team[] }>(`/api/admin/teams?tournamentId=${selectedTournament}`)
      .then((data) => setTeams(data.teams || []))
      .catch(() => setTeams([]));
  }, [selectedTournament]);

  useEffect(() => {
    if (!activeMatch) return;
    setBattingTeamId(activeMatch.team_a_id);
    setBowlingTeamId(activeMatch.team_b_id);
  }, [activeMatch?.match_id]);

  useEffect(() => {
    if (!selectedMatch) {
      setSnapshot(null);
      setHistory([]);
      return;
    }
    setLoading(true);
    fetch(`/api/matches/${selectedMatch}/snapshot?inningsNo=${inningsNo}`)
      .then(async (response) => {
        if (response.status === 404) {
          setSnapshot(null);
          setHistory([]);
          return null;
        }
        const data = await response.json();
        setSnapshot((data?.snapshot as SnapshotState) || null);
        return null;
      })
      .catch(() => setSnapshot(null))
      .finally(() => setLoading(false));
  }, [selectedMatch, inningsNo]);

  useEffect(() => {
    if (!snapshot) return;
    setStrikerId(snapshot.strikerId || "");
    setNonStrikerId(snapshot.nonStrikerId || "");
    setBowlerId(snapshot.bowlerId || "");
  }, [snapshot?.strikerId, snapshot?.nonStrikerId, snapshot?.bowlerId]);

  useEffect(() => {
    if (!snapshot || snapshot.status !== "live") return;
    if (!snapshot.balls || snapshot.balls % 6 !== 0) return;
    if (snapshot.balls === 0 || lastPromptBall === snapshot.balls) return;
    const currentBowler = snapshot.bowlerId || bowlerId;
    setOverPromptBowlerId(currentBowler);
    setPendingBowlerId("");
    setBowlerId("");
    setOverPromptOpen(true);
    setLastPromptBall(snapshot.balls);
  }, [snapshot?.balls, snapshot?.status, lastPromptBall, bowlerId, snapshot?.bowlerId]);

  useEffect(() => {
    if (!snapshot) return;
    if (lastPromptBall !== null && snapshot.balls < lastPromptBall) {
      setLastPromptBall(null);
    }
    if (snapshot.status === "completed" && overPromptOpen) {
      setOverPromptOpen(false);
    }
  }, [snapshot?.balls, snapshot?.status, lastPromptBall, overPromptOpen]);

  useEffect(() => {
    const invalidBatRuns = ["WD", "PEN", "B", "LB"].includes(extraType);
    if (invalidBatRuns) setExtraBatRuns(0);
  }, [extraType]);

  useEffect(() => {
    const invalidBatRuns = ["WD", "PEN", "B", "LB"].includes(wicketExtraType);
    if (invalidBatRuns) setWicketRuns(0);
  }, [wicketExtraType]);

  useEffect(() => {
    if (strikerId && !battingRoster.includes(strikerId)) {
      setStrikerId("");
    }
    if (nonStrikerId && !battingRoster.includes(nonStrikerId)) {
      setNonStrikerId("");
    }
  }, [battingRoster, strikerId, nonStrikerId]);

  useEffect(() => {
    if (bowlerId && !bowlingRoster.includes(bowlerId)) {
      setBowlerId("");
    }
  }, [bowlingRoster, bowlerId]);

  const handleSwapTeams = () => {
    setBattingTeamId((prev) => {
      if (!activeMatch) return prev;
      const nextBatting = prev === activeMatch.team_a_id ? activeMatch.team_b_id : activeMatch.team_a_id;
      setBowlingTeamId(prev === activeMatch.team_a_id ? activeMatch.team_a_id : activeMatch.team_b_id);
      return nextBatting;
    });
  };

  const getOptimisticBase = () => {
    if (snapshot) return snapshot;
    if (!selectedMatch || !strikerId || !nonStrikerId || !bowlerId) {
      setMessage("Select match, striker, non-striker, and bowler before scoring.");
      return null;
    }
    return buildInitialSnapshot({
      matchId: selectedMatch,
      inningsNo,
      strikerId,
      nonStrikerId,
      bowlerId,
      oversLimit: activeMatch?.overs ?? null,
    }) as SnapshotState;
  };

  const applyOptimistic = (
    type: ScoringEvent["type"],
    payload: ScoringPayload
  ) => {
    const base = getOptimisticBase();
    if (!base || !selectedMatch) return null;
    if (base.status !== "live" && type !== "INNINGS_END") {
      setMessage("Innings already completed.");
      return null;
    }
    const nextBall = getNextBallLabel(base.balls);
    const seq = (base.lastEventSeq || 0) + 1;
    const eventPayload = {
      ...payload,
      strikerId: payload.strikerId || base.strikerId,
      nonStrikerId: payload.nonStrikerId || base.nonStrikerId,
      bowlerId: payload.bowlerId || base.bowlerId,
    };
    const event: ScoringEvent = {
      matchId: selectedMatch,
      inningsNo,
      seq,
      over: nextBall.over,
      ballInOver: nextBall.ballInOver,
      type,
      payload: eventPayload,
      createdBy: "optimistic",
      createdAt: new Date().toISOString(),
      idempotencyKey: "optimistic",
    };

    let updated: SnapshotState;
    try {
      if (type === "INNINGS_END") {
        updated = { ...base, status: "completed", lastEventSeq: seq };
      } else {
        updated = { ...applyScoringEvent(base, event), lastEventSeq: seq };
      }
    } catch (error: any) {
      setMessage(error?.message || "Unable to score this delivery.");
      return null;
    }

    setHistory((prev) => [...prev.slice(-6), base]);
    setSnapshot(updated);
    setStrikerId(updated.strikerId || "");
    setNonStrikerId(updated.nonStrikerId || "");
    setBowlerId(updated.bowlerId || "");
    return updated;
  };

  const postEvent = async (type: ScoringEvent["type"], payload: ScoringPayload) => {
    if (!selectedMatch) return;
    setMessage(null);
    setLoading(true);
    const previousSnapshot = snapshot;
    const optimistic = applyOptimistic(type, payload);
    if (!optimistic) {
      setLoading(false);
      return;
    }

    const requestPayload: any = {
      inningsNo,
      type,
      payload: {
        ...payload,
        strikerId: payload.strikerId || strikerId || snapshot?.strikerId,
        nonStrikerId: payload.nonStrikerId || nonStrikerId || snapshot?.nonStrikerId,
        bowlerId: payload.bowlerId || bowlerId || snapshot?.bowlerId,
      },
      idempotencyKey: buildIdempotencyKey(),
    };

    if (!snapshot) {
      requestPayload.initial = {
        strikerId,
        nonStrikerId,
        bowlerId,
        oversLimit: activeMatch?.overs ?? null,
      };
    }

    try {
      const data = await fetchJson<{ snapshot: SnapshotState }>(
        `/api/matches/${selectedMatch}/events`,
        {
          method: "POST",
          body: JSON.stringify(requestPayload),
        }
      );
      if (data.snapshot) {
        setSnapshot(data.snapshot);
        setStrikerId(data.snapshot.strikerId || "");
        setNonStrikerId(data.snapshot.nonStrikerId || "");
        setBowlerId(data.snapshot.bowlerId || "");
      }
    } catch (error: any) {
      if (optimistic) {
        setSnapshot(previousSnapshot || null);
      }
      setMessage(error?.message || "Unable to score this ball.");
    } finally {
      setLoading(false);
    }
  };

  const handleRun = (runs: number) => {
    postEvent("BALL_ADDED", { runs });
  };

  const handleExtras = () => {
    postEvent("EXTRA", {
      runs: extraBatRuns,
      extras: { type: extraType, runs: extraRuns },
    });
    setExtrasOpen(false);
  };

  const handleWicket = () => {
    if (!strikerId || !nonStrikerId) {
      setMessage("Select striker and non-striker before recording a wicket.");
      return;
    }
    const outId = outPlayer === "striker" ? strikerId : nonStrikerId;
    const payload: ScoringPayload = {
      runs: wicketRuns,
      dismissal: {
        type: dismissalType,
        playerOutId: outId,
        crossed,
      },
    };
    if (nextBatterId) {
      payload.nextBatterId = nextBatterId;
    }
    if (wicketExtraType) {
      payload.extras = { type: wicketExtraType, runs: wicketExtraRuns };
    }
    postEvent("WICKET", payload);
    setWicketOpen(false);
  };

  const handleUndo = async () => {
    if (!selectedMatch || !snapshot?.lastEventSeq) return;
    const previous = history[history.length - 1];
    const prevHistory = history.slice(0, -1);
    const beforeUndo = snapshot;
    if (previous) {
      setSnapshot(previous);
      setHistory(prevHistory);
    }
    setMessage(null);
    setLoading(true);

    try {
      const data = await fetchJson<{ snapshot: SnapshotState }>(
        `/api/matches/${selectedMatch}/undo`,
        {
          method: "POST",
          body: JSON.stringify({
            inningsNo,
            targetSeq: snapshot.lastEventSeq,
            idempotencyKey: buildIdempotencyKey(),
          }),
        }
      );
      if (data.snapshot) {
        setSnapshot(data.snapshot);
        setStrikerId(data.snapshot.strikerId || "");
        setNonStrikerId(data.snapshot.nonStrikerId || "");
        setBowlerId(data.snapshot.bowlerId || "");
      }
    } catch (error: any) {
      if (beforeUndo) {
        setSnapshot(beforeUndo);
      }
      setMessage(error?.message || "Unable to undo last ball.");
    } finally {
      setLoading(false);
    }
  };

  const handleEndInnings = () => {
    postEvent("INNINGS_END", { runs: 0 });
  };

  const handleConfirmBowler = () => {
    const nextBowler = pendingBowlerId || overPromptBowlerId;
    if (!nextBowler) {
      setMessage("Select the next bowler to continue.");
      return;
    }
    setBowlerId(nextBowler);
    setOverPromptOpen(false);
  };

  const completedOvers = snapshot?.balls ? Math.floor(snapshot.balls / 6) : 0;
  const nextOverNumber = completedOvers + 1;
  const scoreDisplay = snapshot
    ? `${snapshot.runs}-${snapshot.wickets}`
    : "0-0";
  const oversDisplay = snapshot?.overs || "0.0";
  const runRateDisplay = snapshot?.runRate || "0.00";
  const bowlerLine = snapshot?.bowlers?.[snapshot?.bowlerId || bowlerId || ""];
  const bowlerOvers = bowlerLine ? formatOvers(bowlerLine.balls) : "0.0";

  return (
    <div className={styles.console}>
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>Live scoring engine</span>
          <h2 className={styles.title}>Scorer console</h2>
          <p className={styles.subtitle}>
            Tap runs, extras, or wickets to publish ball-by-ball updates. Undo stays visible for
            safety.
          </p>
        </div>
        <div className={styles.statusRow}>
          <span className={styles.statusBadge}>{snapshot?.status || "setup"}</span>
          <span className={styles.statusMeta}>
            Innings {inningsNo} | {scoreDisplay} ({oversDisplay})
          </span>
        </div>
      </div>

      {message ? <div className={styles.alert}>{message}</div> : null}

      <div className={styles.grid}>
        <div className="card">
          <div className={styles.cardHeader}>
            <strong>Match setup</strong>
            <span className={styles.cardHint}>Pick the fixture before scoring.</span>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.label}>Tournament</label>
            <select
              className={styles.select}
              value={selectedTournament}
              onChange={(event) => {
                setSelectedTournament(event.target.value);
                setSelectedMatch("");
                setSnapshot(null);
              }}
            >
              <option value="">Select tournament</option>
              {tournaments.map((tournament) => (
                <option key={tournament.tournament_id} value={tournament.tournament_id}>
                  {tournament.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.label}>Match</label>
            <select
              className={styles.select}
              value={selectedMatch}
              onChange={(event) => setSelectedMatch(event.target.value)}
            >
              <option value="">Select match</option>
              {matches.map((match) => {
                const teamA = teamMap.get(match.team_a_id)?.short_name || "Team A";
                const teamB = teamMap.get(match.team_b_id)?.short_name || "Team B";
                return (
                  <option key={match.match_id} value={match.match_id}>
                    {teamA} vs {teamB}
                  </option>
                );
              })}
            </select>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.label}>Innings</label>
            <div className={styles.inlineControls}>
              {[1, 2].map((num) => (
                <button
                  key={num}
                  className={`${styles.toggleButton} ${inningsNo === num ? styles.toggleActive : ""}`}
                  onClick={() => setInningsNo(num)}
                  type="button"
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.label}>Batting team</label>
            <select
              className={styles.select}
              value={battingTeamId}
              onChange={(event) => setBattingTeamId(event.target.value)}
            >
              <option value="">Select batting team</option>
              {[activeMatch?.team_a_id, activeMatch?.team_b_id]
                .filter(Boolean)
                .map((teamId) => (
                  <option key={teamId} value={teamId}>
                    {teamMap.get(teamId as string)?.name || "Team"}
                  </option>
                ))}
            </select>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.label}>Bowling team</label>
            <select
              className={styles.select}
              value={bowlingTeamId}
              onChange={(event) => setBowlingTeamId(event.target.value)}
            >
              <option value="">Select bowling team</option>
              {[activeMatch?.team_a_id, activeMatch?.team_b_id]
                .filter(Boolean)
                .map((teamId) => (
                  <option key={teamId} value={teamId}>
                    {teamMap.get(teamId as string)?.name || "Team"}
                  </option>
                ))}
            </select>
            <button className={styles.swapButton} onClick={handleSwapTeams} type="button">
              Swap
            </button>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.label}>Striker</label>
            <select
              className={styles.select}
              value={strikerId}
              onChange={(event) => setStrikerId(event.target.value)}
            >
              <option value="">Select striker</option>
              {battingRoster.map((playerId) => (
                <option key={playerId} value={playerId}>
                  {playerMap.get(playerId)?.name || playerId}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.label}>Non-striker</label>
            <select
              className={styles.select}
              value={nonStrikerId}
              onChange={(event) => setNonStrikerId(event.target.value)}
            >
              <option value="">Select non-striker</option>
              {battingRoster.map((playerId) => (
                <option key={playerId} value={playerId}>
                  {playerMap.get(playerId)?.name || playerId}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.label}>Current bowler</label>
            <select
              className={styles.select}
              value={bowlerId}
              onChange={(event) => setBowlerId(event.target.value)}
            >
              <option value="">Select bowler</option>
              {bowlingRoster.map((playerId) => (
                <option key={playerId} value={playerId}>
                  {playerMap.get(playerId)?.name || playerId}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.rightColumn}>
          <div className={`card ${styles.scoreCard}`}>
            <div className={styles.scoreHeader}>
              <div>
                <span className={styles.label}>Live score</span>
                <div className={styles.scoreValue}>{scoreDisplay}</div>
              </div>
              <div className={styles.scoreMeta}>
                <span>Overs {oversDisplay}</span>
                <span>RR {runRateDisplay}</span>
                <span>{activeMatch?.overs ? `${activeMatch.overs} ov match` : "Open"}</span>
              </div>
            </div>
            <div className={styles.playerRow}>
              <div>
                <span className={styles.playerLabel}>Striker</span>
                <strong>{playerMap.get(snapshot?.strikerId || strikerId)?.name || "TBD"}</strong>
                <span className={styles.playerMeta}>
                  {snapshot?.batsmen?.[snapshot?.strikerId || ""]?.runs || 0} (
                  {snapshot?.batsmen?.[snapshot?.strikerId || ""]?.balls || 0})
                </span>
              </div>
              <div>
                <span className={styles.playerLabel}>Non-striker</span>
                <strong>
                  {playerMap.get(snapshot?.nonStrikerId || nonStrikerId)?.name || "TBD"}
                </strong>
                <span className={styles.playerMeta}>
                  {snapshot?.batsmen?.[snapshot?.nonStrikerId || ""]?.runs || 0} (
                  {snapshot?.batsmen?.[snapshot?.nonStrikerId || ""]?.balls || 0})
                </span>
              </div>
              <div>
                <span className={styles.playerLabel}>Bowler</span>
                <strong>{playerMap.get(snapshot?.bowlerId || bowlerId)?.name || "TBD"}</strong>
                <span className={styles.playerMeta}>
                  {bowlerOvers} | {bowlerLine?.runs || 0} / {bowlerLine?.wickets || 0}
                </span>
              </div>
            </div>
            <div className={styles.lastBallsSection}>
              <span className={styles.label}>Last 12 balls</span>
              <div className={styles.ballStrip}>
                {(snapshot?.lastBalls || []).map((ball, index) => (
                  <span
                    key={`${ball.label}-${index}`}
                    className={`${styles.ballChip} ${ball.isWicket ? styles.ballWicket : ""}`}
                  >
                    {ball.label}
                  </span>
                ))}
                {!snapshot?.lastBalls?.length ? (
                  <span className={styles.ballEmpty}>No deliveries yet</span>
                ) : null}
              </div>
            </div>
            <div className={styles.scoreActions}>
              <button
                className={styles.secondaryButton}
                onClick={handleEndInnings}
                type="button"
                disabled={loading || !selectedMatch || snapshot?.status === "completed"}
              >
                End innings
              </button>
            </div>
          </div>

          <div className={`card ${styles.rosterCard}`}>
            <div className={styles.cardHeader}>
              <strong>Next batter</strong>
              <span className={styles.cardHint}>Choose quickly when a wicket falls.</span>
            </div>
            <select
              className={styles.select}
              value={nextBatterId}
              onChange={(event) => setNextBatterId(event.target.value)}
            >
              <option value="">Select next batter</option>
              {availableBatters.map((playerId) => (
                <option key={playerId} value={playerId}>
                  {playerMap.get(playerId)?.name || playerId}
                </option>
              ))}
            </select>
            <input
              className={styles.input}
              value={nextBatterId}
              onChange={(event) => setNextBatterId(event.target.value)}
              placeholder="Or enter player id"
            />
          </div>
        </div>
      </div>

      <div className={styles.controlDock}>
        <div className={styles.runGrid}>
          {RUN_BUTTONS.map((runs) => (
            <button
              key={runs}
              className={styles.runButton}
              onClick={() => handleRun(runs)}
              disabled={
                loading || !selectedMatch || snapshot?.status === "completed" || overPromptOpen
              }
              type="button"
            >
              {runs}
            </button>
          ))}
        </div>
        <div className={styles.actionRow}>
          <button
            className={styles.actionButton}
            onClick={() => setExtrasOpen(true)}
            disabled={
              loading || !selectedMatch || snapshot?.status === "completed" || overPromptOpen
            }
            type="button"
          >
            Extras
          </button>
          <button
            className={styles.actionButton}
            onClick={() => setWicketOpen(true)}
            disabled={
              loading || !selectedMatch || snapshot?.status === "completed" || overPromptOpen
            }
            type="button"
          >
            Wicket
          </button>
          <button
            className={styles.undoButton}
            onClick={handleUndo}
            disabled={loading || !snapshot?.lastEventSeq}
            type="button"
          >
            Undo
          </button>
        </div>
      </div>

      {extrasOpen ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <strong>Extras</strong>
              <button className={styles.closeButton} onClick={() => setExtrasOpen(false)}>
                Close
              </button>
            </div>
            <div className={styles.optionGrid}>
              {EXTRA_TYPES.map((extra) => (
                <button
                  key={extra.value}
                  className={`${styles.optionButton} ${
                    extraType === extra.value ? styles.optionActive : ""
                  }`}
                  onClick={() => setExtraType(extra.value)}
                  type="button"
                >
                  <span>{extra.label}</span>
                  <span className={styles.optionHint}>{extra.description}</span>
                </button>
              ))}
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.label}>Extra runs</label>
              <div className={styles.inlineControls}>
                {[1, 2, 3, 4, 5].map((runs) => (
                  <button
                    key={runs}
                    className={`${styles.toggleButton} ${
                      extraRuns === runs ? styles.toggleActive : ""
                    }`}
                    onClick={() => setExtraRuns(runs)}
                    type="button"
                  >
                    {runs}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.label}>Bat runs</label>
              <div className={styles.inlineControls}>
                {[0, 1, 2, 3, 4, 6].map((runs) => (
                  <button
                    key={runs}
                    className={`${styles.toggleButton} ${
                      extraBatRuns === runs ? styles.toggleActive : ""
                    }`}
                    onClick={() => setExtraBatRuns(runs)}
                    type="button"
                    disabled={["WD", "PEN", "B", "LB"].includes(extraType)}
                  >
                    {runs}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.secondaryButton} onClick={() => setExtrasOpen(false)}>
                Cancel
              </button>
              <button className={styles.primaryButton} onClick={handleExtras}>
                Add extra
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {wicketOpen ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <strong>Wicket</strong>
              <button className={styles.closeButton} onClick={() => setWicketOpen(false)}>
                Close
              </button>
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.label}>Dismissal type</label>
              <select
                className={styles.select}
                value={dismissalType}
                onChange={(event) => setDismissalType(event.target.value)}
              >
                {DISMISSAL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.label}>Player out</label>
              <div className={styles.inlineControls}>
                {["striker", "non-striker"].map((value) => (
                  <button
                    key={value}
                    className={`${styles.toggleButton} ${
                      outPlayer === value ? styles.toggleActive : ""
                    }`}
                    onClick={() => setOutPlayer(value as "striker" | "non-striker")}
                    type="button"
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.label}>Runs on wicket</label>
              <div className={styles.inlineControls}>
                {[0, 1, 2, 3, 4].map((runs) => (
                  <button
                    key={runs}
                    className={`${styles.toggleButton} ${
                      wicketRuns === runs ? styles.toggleActive : ""
                    }`}
                    onClick={() => setWicketRuns(runs)}
                    type="button"
                    disabled={["WD", "PEN", "B", "LB"].includes(wicketExtraType)}
                  >
                    {runs}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.label}>Extras on wicket (optional)</label>
              <select
                className={styles.select}
                value={wicketExtraType}
                onChange={(event) => setWicketExtraType(event.target.value as ExtraType | "")}
              >
                <option value="">None</option>
                {EXTRA_TYPES.map((extra) => (
                  <option key={extra.value} value={extra.value}>
                    {extra.label}
                  </option>
                ))}
              </select>
              {wicketExtraType ? (
                <div className={styles.inlineControls}>
                  {[1, 2, 3, 4, 5].map((runs) => (
                    <button
                      key={runs}
                      className={`${styles.toggleButton} ${
                        wicketExtraRuns === runs ? styles.toggleActive : ""
                      }`}
                      onClick={() => setWicketExtraRuns(runs)}
                      type="button"
                    >
                      {runs}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.label}>Crossed before wicket?</label>
              <div className={styles.inlineControls}>
                <button
                  className={`${styles.toggleButton} ${crossed ? styles.toggleActive : ""}`}
                  onClick={() => setCrossed(!crossed)}
                  type="button"
                >
                  {crossed ? "Yes" : "No"}
                </button>
              </div>
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.label}>Next batter</label>
              <select
                className={styles.select}
                value={nextBatterId}
                onChange={(event) => setNextBatterId(event.target.value)}
              >
                <option value="">Select next batter</option>
                {availableBatters.map((playerId) => (
                  <option key={playerId} value={playerId}>
                    {playerMap.get(playerId)?.name || playerId}
                  </option>
                ))}
              </select>
              <input
                className={styles.input}
                value={nextBatterId}
                onChange={(event) => setNextBatterId(event.target.value)}
                placeholder="Or enter player id"
              />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.secondaryButton} onClick={() => setWicketOpen(false)}>
                Cancel
              </button>
              <button className={styles.primaryButton} onClick={handleWicket}>
                Confirm wicket
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {overPromptOpen ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <strong>Over complete</strong>
              <button className={styles.closeButton} onClick={handleConfirmBowler}>
                Continue
              </button>
            </div>
            <div className={styles.cardHint}>
              Over {completedOvers} complete. Select the bowler for over {nextOverNumber}.
            </div>
            {overPromptBowlerId ? (
              <div className={styles.cardHint}>
                Previous bowler: {playerMap.get(overPromptBowlerId)?.name || "TBD"}
              </div>
            ) : null}
            <div className={styles.fieldRow}>
              <label className={styles.label}>Next bowler</label>
              <select
                className={styles.select}
                value={pendingBowlerId}
                onChange={(event) => setPendingBowlerId(event.target.value)}
              >
                <option value="">Select bowler</option>
                {bowlingRoster
                  .filter((playerId) => playerId !== overPromptBowlerId)
                  .map((playerId) => (
                    <option key={playerId} value={playerId}>
                      {playerMap.get(playerId)?.name || playerId}
                    </option>
                  ))}
              </select>
              <input
                className={styles.input}
                value={pendingBowlerId}
                onChange={(event) => setPendingBowlerId(event.target.value)}
                placeholder="Or enter player id"
              />
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  setBowlerId(overPromptBowlerId);
                  setOverPromptOpen(false);
                }}
              >
                Keep current
              </button>
              <button className={styles.primaryButton} onClick={handleConfirmBowler}>
                Set bowler
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
