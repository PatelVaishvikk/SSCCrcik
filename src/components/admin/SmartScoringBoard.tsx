"use client";

import { useEffect, useMemo, useState } from "react";

const ACTIVE_TOURNAMENT_KEY = "ssc_active_tournament_id";
const ACTIVE_TOURNAMENT_NAME_KEY = "ssc_active_tournament_name";
const ACTIVE_MATCH_KEY = "ssc_active_match_id";

type LiveState = {
  match_id: string;
  tournament_id: string;
  status: string;
  overs?: number | null;
  innings: Array<any>;
  current_innings: number;
  last_updated?: string;
};

function formatOvers(balls: number) {
  const overs = Math.floor(balls / 6);
  const ball = balls % 6;
  return `${overs}.${ball}`;
}

type BattingStats = {
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
};

type BowlingStats = {
  runs: number;
  balls: number;
  wickets: number;
};

function computeStats(events: Array<Record<string, any>>) {
  const batting = new Map<string, BattingStats>();
  const bowling = new Map<string, BowlingStats>();

  const ensureBatting = (id: string) => {
    if (!batting.has(id)) {
      batting.set(id, { runs: 0, balls: 0, fours: 0, sixes: 0 });
    }
    return batting.get(id) as BattingStats;
  };

  const ensureBowling = (id: string) => {
    if (!bowling.has(id)) {
      bowling.set(id, { runs: 0, balls: 0, wickets: 0 });
    }
    return bowling.get(id) as BowlingStats;
  };

  events.forEach((event) => {
    const strikerId = String(event.striker_id || "").trim();
    const bowlerId = String(event.bowler_id || "").trim();
    const runs = Number(event.runs || 0);
    const legalBall = event.legalBall !== false;
    const wicket = Boolean(event.wicket);

    if (strikerId) {
      const stat = ensureBatting(strikerId);
      if (legalBall) {
        stat.balls += 1;
        stat.runs += runs;
        if (runs === 4) stat.fours += 1;
        if (runs === 6) stat.sixes += 1;
      }
    }

    if (bowlerId) {
      const stat = ensureBowling(bowlerId);
      stat.runs += runs;
      if (legalBall) stat.balls += 1;
      if (wicket) stat.wickets += 1;
    }
  });

  return { batting, bowling };
}

function batterSummary(
  id: string | null | undefined,
  playerMap: Map<string, any>,
  batting: Map<string, BattingStats>
) {
  const safeId = String(id || "").trim();
  const stats = safeId ? batting.get(safeId) : undefined;
  const runs = stats?.runs || 0;
  const balls = stats?.balls || 0;
  const fours = stats?.fours || 0;
  const sixes = stats?.sixes || 0;
  const name = playerMap.get(safeId)?.name || "TBD";
  const strikeRate = balls ? ((runs / balls) * 100).toFixed(1) : "0.0";
  return { name, runs, balls, fours, sixes, strikeRate };
}

function bowlerSummary(
  id: string | null | undefined,
  playerMap: Map<string, any>,
  bowling: Map<string, BowlingStats>
) {
  const safeId = String(id || "").trim();
  const stats = safeId ? bowling.get(safeId) : undefined;
  const balls = stats?.balls || 0;
  const runs = stats?.runs || 0;
  const wickets = stats?.wickets || 0;
  const name = playerMap.get(safeId)?.name || "TBD";
  const overs = formatOvers(balls);
  const economy = balls ? (runs / (balls / 6)).toFixed(2) : "0.00";
  return { name, overs, runs, wickets, economy };
}

function buildBallFeed(
  events: Array<Record<string, any>>,
  totalBalls: number,
  playerMap: Map<string, any>
) {
  let ballCount = totalBalls || 0;
  const feed: Array<{
    label: string;
    result: string;
    batter: string;
    bowler: string;
    wicket: boolean;
  }> = [];

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    const legalBall = event.legalBall !== false;
    const ballNumber = ballCount > 0 ? ballCount : 0;
    const over = ballNumber ? Math.floor((ballNumber - 1) / 6) : 0;
    const ballInOver = ballNumber ? ((ballNumber - 1) % 6) + 1 : 0;
    const label = ballNumber ? `${over}.${ballInOver}` : "-";
    const extraTag = event.extra_type ? String(event.extra_type).toUpperCase() : "";
    const result = event.wicket
      ? "W"
      : `${event.runs}${extraTag ? ` ${extraTag}` : ""}`;
    const batter = playerMap.get(String(event.striker_id || ""))?.name || "TBD";
    const bowler = playerMap.get(String(event.bowler_id || ""))?.name || "TBD";
    feed.push({
      label,
      result,
      batter,
      bowler,
      wicket: Boolean(event.wicket),
    });
    if (legalBall && ballCount > 0) {
      ballCount -= 1;
    }
  }

  return feed.reverse();
}

function getDismissedIds(events: Array<Record<string, any>>) {
  const dismissed = new Set<string>();
  events.forEach((event) => {
    if (!event?.wicket) return;
    const outId = String(event.out_batter_id || event.striker_id || "").trim();
    if (outId) dismissed.add(outId);
  });
  return dismissed;
}

function pickNextBatsman(
  roster: Array<string>,
  strikerId: string,
  nonStrikerId: string,
  dismissed: Set<string>
) {
  for (const rawId of roster) {
    const id = String(rawId || "").trim();
    if (!id) continue;
    if (id === strikerId || id === nonStrikerId) continue;
    if (dismissed.has(id)) continue;
    return id;
  }
  return "";
}

export default function SmartScoringBoard() {
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [players, setPlayers] = useState<any[]>([]);
  const [selectedTournament, setSelectedTournament] = useState("");
  const [selectedMatch, setSelectedMatch] = useState("");
  const [battingTeamId, setBattingTeamId] = useState("");
  const [bowlingTeamId, setBowlingTeamId] = useState("");
  const [strikerId, setStrikerId] = useState("");
  const [nonStrikerId, setNonStrikerId] = useState("");
  const [bowlerId, setBowlerId] = useState("");
  const [nextBatsmanId, setNextBatsmanId] = useState("");
  const [live, setLive] = useState<LiveState | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const playerMap = useMemo(() => {
    const map = new Map<string, any>();
    players.forEach((player) => map.set(player.player_id, player));
    return map;
  }, [players]);

  const teamMap = useMemo(() => {
    const map = new Map<string, any>();
    teams.forEach((team) => map.set(team.team_id, team));
    return map;
  }, [teams]);

  const currentMatch = useMemo(
    () => matches.find((match) => match.match_id === selectedMatch),
    [matches, selectedMatch]
  );

  const matchSquadMap = useMemo(() => {
    const map = new Map<string, string[]>();
    if (currentMatch?.team_a_id && Array.isArray(currentMatch.squad_a_ids)) {
      if (currentMatch.squad_a_ids.length) {
        map.set(currentMatch.team_a_id, currentMatch.squad_a_ids);
      }
    }
    if (currentMatch?.team_b_id && Array.isArray(currentMatch.squad_b_ids)) {
      if (currentMatch.squad_b_ids.length) {
        map.set(currentMatch.team_b_id, currentMatch.squad_b_ids);
      }
    }
    return map;
  }, [currentMatch]);

  const battingRoster = useMemo(() => {
    const matchSquad = matchSquadMap.get(battingTeamId);
    if (matchSquad?.length) return matchSquad;
    const team = teamMap.get(battingTeamId);
    return team?.player_ids || [];
  }, [battingTeamId, matchSquadMap, teamMap]);

  const bowlingRoster = useMemo(() => {
    const matchSquad = matchSquadMap.get(bowlingTeamId);
    if (matchSquad?.length) return matchSquad;
    const team = teamMap.get(bowlingTeamId);
    return team?.player_ids || [];
  }, [bowlingTeamId, matchSquadMap, teamMap]);

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

  const getMatchStorageKey = (tournamentId: string) =>
    `${ACTIVE_MATCH_KEY}:${tournamentId}`;

  const loadTeamsAndMatches = async (tournamentId: string) => {
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

  const loadLive = async (matchId: string) => {
    if (!matchId) return;
    const res = await fetch(`/api/admin/scoring?matchId=${matchId}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      setLive(null);
      return;
    }
    const data = await res.json();
    setLive(data.live || null);
  };

  useEffect(() => {
    loadTournaments();
  }, []);

  useEffect(() => {
    if (selectedTournament) {
      loadTeamsAndMatches(selectedTournament);
    }
  }, [selectedTournament]);

  useEffect(() => {
    if (!selectedTournament || !matches.length) return;
    if (selectedMatch && matches.some((match) => match.match_id === selectedMatch)) {
      return;
    }
    const stored = localStorage.getItem(getMatchStorageKey(selectedTournament));
    if (stored && matches.some((match) => match.match_id === stored)) {
      setSelectedMatch(stored);
      return;
    }
    const liveMatch = matches.find((match) => match.status === "live");
    if (liveMatch) {
      setSelectedMatch(liveMatch.match_id);
      return;
    }
    setSelectedMatch(matches[0].match_id);
  }, [matches, selectedMatch, selectedTournament]);

  useEffect(() => {
    if (!selectedMatch) return;
    loadLive(selectedMatch);
    const interval = setInterval(() => loadLive(selectedMatch), 1000);
    return () => clearInterval(interval);
  }, [selectedMatch]);

  useEffect(() => {
    if (!selectedTournament || !selectedMatch) return;
    localStorage.setItem(getMatchStorageKey(selectedTournament), selectedMatch);
  }, [selectedMatch, selectedTournament]);

  useEffect(() => {
    setStrikerId("");
    setNonStrikerId("");
    setBowlerId("");
    setNextBatsmanId("");
  }, [selectedMatch]);

  useEffect(() => {
    if (!currentMatch) return;
    setBattingTeamId(currentMatch.team_a_id || "");
    setBowlingTeamId(currentMatch.team_b_id || "");
  }, [currentMatch]);

  useEffect(() => {
    const current = live?.innings?.[live.current_innings || 0];
    if (!current) return;
    if (current.batting_team_id && current.batting_team_id !== battingTeamId) {
      setBattingTeamId(current.batting_team_id);
    }
    if (current.bowling_team_id && current.bowling_team_id !== bowlingTeamId) {
      setBowlingTeamId(current.bowling_team_id);
    }
    if (current.striker_id && current.striker_id !== strikerId) {
      setStrikerId(current.striker_id);
    }
    if (current.non_striker_id && current.non_striker_id !== nonStrikerId) {
      setNonStrikerId(current.non_striker_id);
    }
    if (current.bowler_id && current.bowler_id !== bowlerId) {
      setBowlerId(current.bowler_id);
    }
  }, [live, battingTeamId, bowlerId, bowlingTeamId, nonStrikerId, strikerId]);

  useEffect(() => {
    if (!strikerId && battingRoster.length) {
      setStrikerId(battingRoster[0]);
    }
    if (!nonStrikerId && battingRoster.length > 1) {
      setNonStrikerId(battingRoster[1]);
    }
  }, [battingRoster, nonStrikerId, strikerId]);

  useEffect(() => {
    if (!bowlerId && bowlingRoster.length) {
      setBowlerId(bowlingRoster[0]);
    }
  }, [bowlerId, bowlingRoster]);

  const sendAction = async (payload: Record<string, any>) => {
    setMessage(null);
    const res = await fetch("/api/admin/scoring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error || "Unable to update score.");
      return;
    }
    setLive(data.live || null);
    if (data.needsBatsman) {
      setMessage("Select the next batsman after wicket.");
    }
  };

  const startInnings = async (action: "start" | "switchInnings") => {
    if (!selectedMatch || !selectedTournament) return;
    if (!battingTeamId || !bowlingTeamId || !strikerId || !nonStrikerId) {
      setMessage("Select batting team and opening batters.");
      return;
    }
    await sendAction({
      action,
      matchId: selectedMatch,
      tournamentId: selectedTournament,
      battingTeamId,
      bowlingTeamId,
      strikerId,
      nonStrikerId,
      bowlerId,
      overs: currentMatch?.overs,
    });
  };

  const ball = async (
    runs: number,
    legalBall: boolean,
    wicket = false,
    extraType = ""
  ) => {
    if (!selectedMatch) return;
    let nextId = nextBatsmanId;
    if (wicket) {
      const innings = live?.innings?.[live.current_innings || 0];
      const events = Array.isArray(innings?.events) ? innings.events : [];
      const dismissed = getDismissedIds(events);
      if (nextId) {
        const safeNext = String(nextId).trim();
        if (
          !safeNext ||
          safeNext === strikerId ||
          safeNext === nonStrikerId ||
          dismissed.has(safeNext)
        ) {
          setMessage("Select a new batsman for the wicket.");
          return;
        }
      } else {
        nextId = pickNextBatsman(battingRoster, strikerId, nonStrikerId, dismissed);
        if (!nextId) {
          setMessage("No available batsman left.");
          return;
        }
      }
    }
    await sendAction({
      action: "ball",
      matchId: selectedMatch,
      runs,
      legalBall,
      wicket,
      extraType,
      nextStrikerId: wicket ? nextId : "",
    });
    if (wicket) setNextBatsmanId("");
  };

  const updatePlayers = async () => {
    if (!selectedMatch) return;
    await sendAction({
      action: "setPlayers",
      matchId: selectedMatch,
      strikerId,
      nonStrikerId,
      bowlerId,
    });
  };

  const endMatch = async () => {
    if (!selectedMatch) return;
    await sendAction({ action: "end", matchId: selectedMatch });
  };

  const undoLastBall = async () => {
    if (!selectedMatch) return;
    await sendAction({ action: "undo", matchId: selectedMatch });
  };

  const currentInnings = live?.innings?.[live.current_innings || 0] || null;
  const inningsRuns = currentInnings?.runs || 0;
  const inningsWickets = currentInnings?.wickets || 0;
  const inningsBalls = currentInnings?.balls || 0;
  const overs = formatOvers(inningsBalls);
  const runRate = inningsBalls ? (inningsRuns / (inningsBalls / 6)).toFixed(2) : "0.00";

  const events = useMemo(
    () => (Array.isArray(currentInnings?.events) ? currentInnings?.events : []),
    [currentInnings]
  );

  const { batting, bowling } = useMemo(() => computeStats(events), [events]);

  const recentEvents = useMemo(() => events.slice(-12), [events]);

  const strikerStats = batterSummary(
    currentInnings?.striker_id || strikerId,
    playerMap,
    batting
  );
  const nonStrikerStats = batterSummary(
    currentInnings?.non_striker_id || nonStrikerId,
    playerMap,
    batting
  );
  const bowlerStats = bowlerSummary(
    currentInnings?.bowler_id || bowlerId,
    playerMap,
    bowling
  );

  const ballFeed = useMemo(
    () => buildBallFeed(recentEvents, inningsBalls, playerMap),
    [recentEvents, inningsBalls, playerMap]
  );

  return (
    <div className="card">
      <div className="list">
        <span className="pill">Smart scoring</span>
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
              const teamA = teamMap.get(match.team_a_id);
              const teamB = teamMap.get(match.team_b_id);
              return (
                <option key={match.match_id} value={match.match_id}>
                  {teamA?.name || "Team A"} vs {teamB?.name || "Team B"}
                </option>
              );
            })}
          </select>
          <select
            className="search-input"
            value={battingTeamId}
            onChange={(event) => setBattingTeamId(event.target.value)}
          >
            <option value="">Batting team</option>
            {teams.map((team) => (
              <option key={team.team_id} value={team.team_id}>
                {team.name}
              </option>
            ))}
          </select>
          <select
            className="search-input"
            value={bowlingTeamId}
            onChange={(event) => setBowlingTeamId(event.target.value)}
          >
            <option value="">Bowling team</option>
            {teams.map((team) => (
              <option key={team.team_id} value={team.team_id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid three">
          <select
            className="search-input"
            value={strikerId}
            onChange={(event) => setStrikerId(event.target.value)}
          >
            <option value="">Striker</option>
            {battingRoster.map((id: string) => (
              <option key={id} value={id}>
                {playerMap.get(id)?.name || id}
              </option>
            ))}
          </select>
          <select
            className="search-input"
            value={nonStrikerId}
            onChange={(event) => setNonStrikerId(event.target.value)}
          >
            <option value="">Non-striker</option>
            {battingRoster.map((id: string) => (
              <option key={id} value={id}>
                {playerMap.get(id)?.name || id}
              </option>
            ))}
          </select>
          <select
            className="search-input"
            value={bowlerId}
            onChange={(event) => setBowlerId(event.target.value)}
          >
            <option value="">Bowler</option>
            {bowlingRoster.map((id: string) => (
              <option key={id} value={id}>
                {playerMap.get(id)?.name || id}
              </option>
            ))}
          </select>
        </div>

        <div className="grid two">
          <button className="pill" type="button" onClick={() => startInnings("start")}>
            Start innings
          </button>
          <button className="pill" type="button" onClick={() => startInnings("switchInnings")}>
            Switch innings
          </button>
        </div>

        <div className="grid two">
          <button className="pill" type="button" onClick={updatePlayers}>
            Update players
          </button>
          <button className="pill" type="button" onClick={endMatch}>
            End match
          </button>
        </div>

        <div className="grid three">
          <button className="pill" type="button" onClick={() => ball(0, true)}>
            0
          </button>
          <button className="pill" type="button" onClick={() => ball(1, true)}>
            1
          </button>
          <button className="pill" type="button" onClick={() => ball(2, true)}>
            2
          </button>
          <button className="pill" type="button" onClick={() => ball(3, true)}>
            3
          </button>
          <button className="pill" type="button" onClick={() => ball(4, true)}>
            4
          </button>
          <button className="pill" type="button" onClick={() => ball(6, true)}>
            6
          </button>
          <button className="pill" type="button" onClick={() => ball(1, false, false, "wd")}>
            Wide
          </button>
          <button className="pill" type="button" onClick={() => ball(1, false, false, "nb")}>
            No-ball
          </button>
          <button className="pill" type="button" onClick={() => ball(0, true, true)}>
            Wicket
          </button>
        </div>

        <div className="grid two">
          <select
            className="search-input"
            value={nextBatsmanId}
            onChange={(event) => setNextBatsmanId(event.target.value)}
          >
            <option value="">Next batsman (on wicket)</option>
            {battingRoster.map((id: string) => (
              <option key={id} value={id}>
                {playerMap.get(id)?.name || id}
              </option>
            ))}
          </select>
          <button
            className="pill"
            type="button"
            onClick={undoLastBall}
            disabled={!events.length}
          >
            Undo last ball
          </button>
        </div>

        {message ? <span className="text-muted">{message}</span> : null}

        <div className="score-table">
          <div className="score-grid batters header">
            <span>Batters</span>
            <span>R</span>
            <span>B</span>
            <span>4s</span>
            <span>6s</span>
            <span>SR</span>
          </div>
          <div className="score-grid batters">
            <strong>{strikerStats.name} *</strong>
            <span>{strikerStats.runs}</span>
            <span>{strikerStats.balls}</span>
            <span>{strikerStats.fours}</span>
            <span>{strikerStats.sixes}</span>
            <span>{strikerStats.strikeRate}</span>
          </div>
          <div className="score-grid batters">
            <strong>{nonStrikerStats.name}</strong>
            <span>{nonStrikerStats.runs}</span>
            <span>{nonStrikerStats.balls}</span>
            <span>{nonStrikerStats.fours}</span>
            <span>{nonStrikerStats.sixes}</span>
            <span>{nonStrikerStats.strikeRate}</span>
          </div>
        </div>

        <div className="score-table">
          <div className="score-grid bowlers header">
            <span>Bowler</span>
            <span>O</span>
            <span>R</span>
            <span>W</span>
            <span>Econ</span>
          </div>
          <div className="score-grid bowlers">
            <strong>{bowlerStats.name}</strong>
            <span>{bowlerStats.overs}</span>
            <span>{bowlerStats.runs}</span>
            <span>{bowlerStats.wickets}</span>
            <span>{bowlerStats.economy}</span>
          </div>
        </div>

        {ballFeed.length ? (
          <div className="ball-feed">
            {ballFeed.map((event, index) => (
              <div
                key={`${event.label}-${event.result}-${index}`}
                className={`ball-row ${event.wicket ? "ball-wicket" : ""}`}
              >
                <span className="ball-label">{event.label}</span>
                <span className="ball-result">{event.result}</span>
                <span className="ball-meta">
                  {event.batter} • {event.bowler}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid two">
          <div className="stat">
            <span className="stat-value">
              {inningsRuns}/{inningsWickets}
            </span>
            <span className="stat-label">Score</span>
          </div>
          <div className="stat">
            <span className="stat-value">{overs}</span>
            <span className="stat-label">Overs</span>
          </div>
          <div className="stat">
            <span className="stat-value">{runRate}</span>
            <span className="stat-label">Run rate</span>
          </div>
          <div className="stat">
            <span className="stat-value">{live?.status || "idle"}</span>
            <span className="stat-label">Status</span>
          </div>
        </div>
      </div>
    </div>
  );
}
