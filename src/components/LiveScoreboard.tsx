"use client";

import { useEffect, useMemo, useState } from "react";

type LiveMatch = {
  match_id: string;
  tournament_name: string;
  status: string;
  analysis?: {
    overs_limit: number | null;
    projected_score: number | null;
    last_six: {
      runs: number;
      wickets: number;
      boundaries: number;
      balls: number;
    };
    target: number | null;
    runs_needed: number | null;
    balls_remaining: number | null;
    required_rate: string | null;
    runsPerOver?: number[];
    // Enhanced analytics
    winProbability?: {
      battingTeam: number;
      bowlingTeam: number;
      confidence: "high" | "medium" | "low";
    };
    pressureIndex?: {
      value: number;
      level: "low" | "moderate" | "high" | "extreme";
      factors: string[];
    };
    momentum?: {
      direction: "batting" | "bowling" | "neutral";
      strength: number;
      trend: "rising" | "falling" | "stable";
    };
    projectedScoreEnhanced?: {
      conservative: number;
      predicted: number;
      aggressive: number;
      confidence: number;
    };
    phaseAnalysis?: {
      powerplay: { runs: number; wickets: number; balls: number; runRate: string };
      middle: { runs: number; wickets: number; balls: number; runRate: string };
      death: { runs: number; wickets: number; balls: number; runRate: string };
      currentPhase: "powerplay" | "middle" | "death";
    };
    dotBallPercent?: number;
    boundaryPercent?: number;
    runRateComparison?: {
      current: string;
      required: string | null;
      difference: string | null;
    };
    scoringAreas?: {
      offSide: number;
      onSide: number;
      straight: number;
    };
  };
  batting: {
    team_name: string;
    short_name: string;
    runs: number;
    wickets: number;
    overs: string;
    run_rate: string;
    balls: number;
    striker_stats?: {
      name: string;
      runs: number;
      balls: number;
      fours: number;
      sixes: number;
      strike_rate: string;
    };
    non_striker_stats?: {
      name: string;
      runs: number;
      balls: number;
      fours: number;
      sixes: number;
      strike_rate: string;
    };
  };
  bowling: {
    team_name: string;
    bowler: string;
    bowler_stats?: {
      name: string;
      overs: string;
      runs: number;
      wickets: number;
      economy: string;
    };
  };
  striker: string;
  non_striker: string;
  last_event: {
    runs: number;
    wicket: boolean;
    extra_type?: string;
  } | null;
  recent_events: Array<{
    runs: number;
    wicket: boolean;
    legalBall: boolean;
    extra_type?: string;
    striker_id?: string;
    bowler_id?: string;
    striker_name?: string;
    bowler_name?: string;
    timestamp?: string | null;
  }>;
};

import AnalyticsModal from "./matches/AnalyticsModal";

export default function LiveScoreboard({ matchId }: { matchId: string }) {
  const [match, setMatch] = useState<LiveMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const formatOvers = (balls: number | null | undefined) => {
    if (balls === null || balls === undefined) return "-";
    const overs = Math.floor(balls / 6);
    const ball = balls % 6;
    return `${overs}.${ball}`;
  };

  const ballFeed = useMemo(() => {
    if (!match?.recent_events?.length) return [];
    let ballCount = match.batting.balls || 0;
    const feed: Array<{
      label: string;
      result: string;
      batter: string;
      bowler: string;
      wicket: boolean;
    }> = [];
    for (let i = match.recent_events.length - 1; i >= 0; i -= 1) {
      const event = match.recent_events[i];
      const legalBall = event.legalBall !== false;
      const ballNumber = ballCount > 0 ? ballCount : 0;
      const over =
        ballNumber > 0 ? Math.floor((ballNumber - 1) / 6) : 0;
      const ballInOver =
        ballNumber > 0 ? ((ballNumber - 1) % 6) + 1 : 0;
      const label = ballNumber ? `${over}.${ballInOver}` : "-";
      const extraTag = event.extra_type ? event.extra_type.toUpperCase() : "";
      const result = event.wicket
        ? "W"
        : `${event.runs}${extraTag ? ` ${extraTag}` : ""}`;
      feed.push({
        label,
        result,
        batter: event.striker_name || "TBD",
        bowler: event.bowler_name || "TBD",
        wicket: event.wicket,
      });
      if (legalBall && ballCount > 0) {
        ballCount -= 1;
      }
    }
    return feed.reverse();
  }, [match]);

  useEffect(() => {
    let inFlight = false;
    let mounted = true;

    const load = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const res = await fetch(`/api/public/live/${matchId}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (mounted && res.ok) {
          setMatch(data.match || null);
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
  }, [matchId]);

  if (loading) {
    return <span className="text-muted">Loading live score...</span>;
  }

  if (!match) {
    return <span className="text-muted">Live score not available.</span>;
  }

  const lastSix = match.analysis?.last_six;
  const lastSixLabel = lastSix ? `${lastSix.runs}/${lastSix.wickets}` : "-";
  const lastSixBoundaries = lastSix ? lastSix.boundaries : "-";
  const hasTarget = match.analysis?.target !== null && match.analysis?.target !== undefined;

  return (
    <div className="card">
      <div className="list">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="pill">{match.tournament_name || "Live match"}</span>
            <button 
                onClick={() => setAnalyticsOpen(true)}
                style={{
                    background: 'none',
                    border: '1px solid #ddd',
                    borderRadius: '12px',
                    padding: '2px 8px',
                    fontSize: '0.75rem',
                    cursor: 'pointer'
                }}
            >
                📊 Analysis
            </button>
        </div>
        <strong>
          {match.batting.team_name} {match.batting.runs}/{match.batting.wickets}
        </strong>
        <span className="text-muted">
          {match.batting.overs} ov • Run rate {match.batting.run_rate}
        </span>
        <span className="text-muted">
          Bowling: {match.bowling.team_name} • {match.bowling.bowler}
        </span>
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
            <strong>{match.batting.striker_stats?.name || match.striker} *</strong>
            <span>{match.batting.striker_stats?.runs ?? "-"}</span>
            <span>{match.batting.striker_stats?.balls ?? "-"}</span>
            <span>{match.batting.striker_stats?.fours ?? "-"}</span>
            <span>{match.batting.striker_stats?.sixes ?? "-"}</span>
            <span>{match.batting.striker_stats?.strike_rate ?? "-"}</span>
          </div>
          <div className="score-grid batters">
            <strong>{match.batting.non_striker_stats?.name || match.non_striker}</strong>
            <span>{match.batting.non_striker_stats?.runs ?? "-"}</span>
            <span>{match.batting.non_striker_stats?.balls ?? "-"}</span>
            <span>{match.batting.non_striker_stats?.fours ?? "-"}</span>
            <span>{match.batting.non_striker_stats?.sixes ?? "-"}</span>
            <span>{match.batting.non_striker_stats?.strike_rate ?? "-"}</span>
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
            <strong>{match.bowling.bowler_stats?.name || match.bowling.bowler}</strong>
            <span>{match.bowling.bowler_stats?.overs ?? "-"}</span>
            <span>{match.bowling.bowler_stats?.runs ?? "-"}</span>
            <span>{match.bowling.bowler_stats?.wickets ?? "-"}</span>
            <span>{match.bowling.bowler_stats?.economy ?? "-"}</span>
          </div>
        </div>
        {match.analysis ? (
          <div className="grid two">
            <div className="stat">
              <span className="stat-value">
                {match.analysis.projected_score ?? "-"}
              </span>
              <span className="stat-label">Projected score</span>
            </div>
            <div className="stat">
              <span className="stat-value">{lastSixLabel}</span>
              <span className="stat-label">Last 6 balls</span>
            </div>
            {hasTarget ? (
              <>
                <div className="stat">
                  <span className="stat-value">
                    {match.analysis.runs_needed ?? "-"}
                  </span>
                  <span className="stat-label">Runs needed</span>
                </div>
                <div className="stat">
                  <span className="stat-value">
                    {match.analysis.required_rate ?? "-"}
                  </span>
                  <span className="stat-label">Req RR</span>
                </div>
              </>
            ) : (
              <>
                <div className="stat">
                  <span className="stat-value">{lastSixBoundaries}</span>
                  <span className="stat-label">Boundaries (last 6)</span>
                </div>
                <div className="stat">
                  <span className="stat-value">
                    {formatOvers(match.analysis.balls_remaining)}
                  </span>
                  <span className="stat-label">Overs remaining</span>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* Enhanced Analytics Section */}
        {match.analysis?.winProbability ? (
          <div style={{ 
            marginTop: '12px', 
            padding: '12px', 
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', 
            borderRadius: '12px',
            color: 'white'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>🎯 Win Probability</span>
              <span style={{ 
                fontSize: '0.65rem', 
                padding: '2px 6px', 
                background: 'rgba(255,255,255,0.1)', 
                borderRadius: '8px' 
              }}>
                {match.analysis.winProbability.confidence} confidence
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px' }}>
                  <span>{match.batting.team_name}</span>
                  <span style={{ fontWeight: 'bold', color: '#4ade80' }}>{match.analysis.winProbability.battingTeam}%</span>
                </div>
                <div style={{ 
                  height: '8px', 
                  background: 'rgba(255,255,255,0.2)', 
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <div style={{ 
                    height: '100%', 
                    width: `${match.analysis.winProbability.battingTeam}%`,
                    background: 'linear-gradient(90deg, #4ade80, #22c55e)',
                    borderRadius: '4px',
                    transition: 'width 0.5s ease'
                  }} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {match.analysis?.pressureIndex ? (
          <div style={{ 
            marginTop: '8px', 
            display: 'flex', 
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: match.analysis.pressureIndex.level === 'extreme' ? 'rgba(239, 68, 68, 0.1)' :
                        match.analysis.pressureIndex.level === 'high' ? 'rgba(251, 146, 60, 0.1)' :
                        'rgba(75, 85, 99, 0.1)',
            borderRadius: '8px',
            borderLeft: `3px solid ${
              match.analysis.pressureIndex.level === 'extreme' ? '#ef4444' :
              match.analysis.pressureIndex.level === 'high' ? '#fb923c' :
              match.analysis.pressureIndex.level === 'moderate' ? '#fbbf24' : '#4b5563'
            }`
          }}>
            <div>
              <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Pressure Index</span>
              <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                {match.analysis.pressureIndex.value}
                <span style={{ fontSize: '0.7rem', fontWeight: 'normal', marginLeft: '4px', textTransform: 'capitalize' }}>
                  ({match.analysis.pressureIndex.level})
                </span>
              </div>
            </div>
            {match.analysis.momentum && (
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Momentum</span>
                <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                  {match.analysis.momentum.direction === 'batting' ? '🟢 Batting' :
                   match.analysis.momentum.direction === 'bowling' ? '🔴 Bowling' : '⚪ Neutral'}
                  <span style={{ fontSize: '0.7rem', fontWeight: 'normal', marginLeft: '4px' }}>
                    {match.analysis.momentum.trend === 'rising' ? '↑' :
                     match.analysis.momentum.trend === 'falling' ? '↓' : '→'}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {match.analysis?.phaseAnalysis ? (
          <div style={{ 
            marginTop: '8px', 
            display: 'grid', 
            gridTemplateColumns: 'repeat(3, 1fr)', 
            gap: '8px', 
            fontSize: '0.7rem' 
          }}>
            {(['powerplay', 'middle', 'death'] as const).map((phase) => {
              const data = match.analysis?.phaseAnalysis?.[phase];
              const isCurrent = match.analysis?.phaseAnalysis?.currentPhase === phase;
              return (
                <div 
                  key={phase} 
                  style={{ 
                    padding: '6px 8px', 
                    background: isCurrent ? 'rgba(59, 130, 246, 0.1)' : 'rgba(0,0,0,0.03)',
                    borderRadius: '6px',
                    border: isCurrent ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent'
                  }}
                >
                  <div style={{ fontWeight: 'bold', textTransform: 'capitalize', marginBottom: '2px' }}>
                    {phase} {isCurrent && '●'}
                  </div>
                  <div>{data?.runs ?? 0}/{data?.wickets ?? 0}</div>
                  <div style={{ color: '#6b7280' }}>RR: {data?.runRate ?? '0.00'}</div>
                </div>
              );
            })}
          </div>
        ) : null}

        {(match.analysis?.dotBallPercent !== undefined || match.analysis?.boundaryPercent !== undefined) ? (
          <div style={{ 
            marginTop: '8px', 
            display: 'flex', 
            gap: '8px',
            fontSize: '0.75rem'
          }}>
            {match.analysis?.dotBallPercent !== undefined && (
              <div style={{ 
                flex: 1, 
                padding: '6px 10px', 
                background: 'rgba(107, 114, 128, 0.1)', 
                borderRadius: '6px',
                textAlign: 'center' 
              }}>
                <div style={{ fontWeight: 'bold' }}>{match.analysis.dotBallPercent}%</div>
                <div style={{ color: '#6b7280', fontSize: '0.65rem' }}>Dot Balls</div>
              </div>
            )}
            {match.analysis?.boundaryPercent !== undefined && (
              <div style={{ 
                flex: 1, 
                padding: '6px 10px', 
                background: 'rgba(16, 185, 129, 0.1)', 
                borderRadius: '6px',
                textAlign: 'center' 
              }}>
                <div style={{ fontWeight: 'bold', color: '#10b981' }}>{match.analysis.boundaryPercent}%</div>
                <div style={{ color: '#6b7280', fontSize: '0.65rem' }}>Boundaries</div>
              </div>
            )}
            {match.analysis?.scoringAreas && (
              <div style={{ 
                flex: 1, 
                padding: '6px 10px', 
                background: 'rgba(59, 130, 246, 0.1)', 
                borderRadius: '6px',
                textAlign: 'center' 
              }}>
                <div style={{ fontWeight: 'bold', color: '#3b82f6' }}>
                  {match.analysis.scoringAreas.offSide}% / {match.analysis.scoringAreas.onSide}%
                </div>
                <div style={{ color: '#6b7280', fontSize: '0.65rem' }}>Off / On Side</div>
              </div>
            )}
          </div>
        ) : null}
        {match.last_event ? (
          <span className="text-muted">
            Last ball:{" "}
            {match.last_event.wicket
              ? "W"
              : `${match.last_event.runs}${
                  match.last_event.extra_type
                    ? ` ${match.last_event.extra_type.toUpperCase()}`
                    : ""
                }`}
          </span>
        ) : null}
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
      </div>

      <AnalyticsModal
        isOpen={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        runsPerOver={match.analysis?.runsPerOver || []}
        oversConfig={match.analysis?.overs_limit || 20}
        target={match.analysis?.target || null}
        currentScore={match.batting.runs}
        currentOver={match.batting.balls ? Math.floor(match.batting.balls / 6) : 0}
      />
    </div>
  );
}
