"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import styles from "./MatchLiveView.module.css";
import { useMatchSnapshot } from "@/lib/hooks/useMatchSnapshot";
import { computeAllowedActions } from "@/lib/scoring/v2/permissions";
import type { MatchRole } from "@/lib/scoring/v2/types";
import AnalyticsModal from "./AnalyticsModal";

function buildIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function postJson(url: string, body: Record<string, any>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || "Request failed");
  }
  return data;
}

export default function MatchLiveView({ matchId }: { matchId: string }) {
  const { data, isLoading, error } = useMatchSnapshot(matchId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);


  const snapshot = data?.snapshot || null;
  const role = (data?.role || "VIEWER") as MatchRole;
  const allowedActions = snapshot ? snapshot.allowedActions || computeAllowedActions(snapshot, role) : null;

  const statusText = useMemo(() => {
    if (!snapshot) return "Match setup pending";
    if (snapshot.pendingAction === "SELECT_BOWLER") return "Waiting for next bowler";
    if (snapshot.pendingAction === "SELECT_BATSMAN") return "Waiting for new batter";
    if (snapshot.pendingAction === "START_INNINGS_2_APPROVAL") return "Innings break";
    if (snapshot.status === "COMPLETED") return "Match completed";
    return "Live";
  }, [snapshot]);

  const handleEndInnings = async () => {
    if (!snapshot) return;
    try {
      await postJson(`/api/matches/${matchId}/innings/end`, {
        inningsNo: snapshot.inningsNo,
        idempotencyKey: buildIdempotencyKey(),
      });
      setActionError(null);
    } catch (err: any) {
      setActionError(err?.message || "Unable to end innings");
    }
  };

  const handleLockMatch = async () => {
    try {
      await postJson(`/api/matches/${matchId}/lock`, {
        idempotencyKey: buildIdempotencyKey(),
      });
      setActionError(null);
    } catch (err: any) {
      setActionError(err?.message || "Unable to lock match");
    }
  };

  if (isLoading) {
    return <div className="card">Loading live match...</div>;
  }

  if (error) {
    return <div className="card">Unable to load match snapshot.</div>;
  }

  if (!snapshot) {
    return (
      <div className="card">
        <h2>Match not started</h2>
        <p className="text-muted">Scoring has not begun for this match.</p>
      </div>
    );
  }

  const scorerName = snapshot.scorer?.name || "-";
  const strikerLine = snapshot.strikerId ? snapshot.batsmen[snapshot.strikerId] : null;
  const nonStrikerLine = snapshot.nonStrikerId ? snapshot.batsmen[snapshot.nonStrikerId] : null;
  const bowlerLine = snapshot.bowlerId ? snapshot.bowlers[snapshot.bowlerId] : null;

  const strikerSR =
    strikerLine && strikerLine.balls
      ? ((strikerLine.runs / strikerLine.balls) * 100).toFixed(1)
      : "-";
  const nonStrikerSR =
    nonStrikerLine && nonStrikerLine.balls
      ? ((nonStrikerLine.runs / nonStrikerLine.balls) * 100).toFixed(1)
      : "-";
  const bowlerOvers =
    bowlerLine && bowlerLine.balls
      ? `${Math.floor(bowlerLine.balls / 6)}.${bowlerLine.balls % 6}`
      : "-";
  const bowlerEcon =
    bowlerLine && bowlerLine.balls
      ? (bowlerLine.runs / (bowlerLine.balls / 6)).toFixed(2)
      : "-";

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <span className={styles.liveBadge}>{statusText}</span>
          <h1 className={styles.title}>Live match (Updated)</h1>
          <p className={styles.subtitle}>Scorer: {scorerName}</p>
        </div>
          <div className={styles.scoreBlock}>
          <div className={styles.scoreLine}>
            <strong 
                onClick={() => setAnalyticsOpen(true)}
                style={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}
                title="View Analysis"
            >
                {snapshot.runs}/{snapshot.wickets}
            </strong>
            <span>{snapshot.overs} ov</span>
          </div>
          <div className={styles.metaLine}>
            <span>RR {snapshot.runRate}</span>
            {snapshot.target ? <span>Target {snapshot.target}</span> : null}
            {snapshot.requiredRR ? <span>Req RR {snapshot.requiredRR}</span> : null}
          </div>
        </div>
      </section>

      <section className={styles.cards}>
        <div className={styles.card}>
          <span>Striker</span>
          <strong>{snapshot.strikerId || "TBD"}</strong>
          <em>
            {strikerLine
              ? `${strikerLine.runs} (${strikerLine.balls}) · 4s ${strikerLine.fours} · 6s ${strikerLine.sixes} · SR ${strikerSR}`
              : "-"}
          </em>
        </div>
        <div className={styles.card}>
          <span>Non-striker</span>
          <strong>{snapshot.nonStrikerId || "TBD"}</strong>
          <em>
            {nonStrikerLine
              ? `${nonStrikerLine.runs} (${nonStrikerLine.balls}) · 4s ${nonStrikerLine.fours} · 6s ${nonStrikerLine.sixes} · SR ${nonStrikerSR}`
              : "-"}
          </em>
        </div>
        <div className={styles.card}>
          <span>Bowler</span>
          <strong>{snapshot.bowlerId || "TBD"}</strong>
          <em>
            {bowlerLine
              ? `${bowlerOvers} · M ${bowlerLine.maidens} · ${bowlerLine.runs}/${bowlerLine.wickets} · Econ ${bowlerEcon}`
              : "-"}
          </em>
        </div>
      </section>

      <section className={styles.overStrip}>
        <span>Current over</span>
        <div className={styles.ballRow}>
          {snapshot.currentOverBalls.length ? (
            snapshot.currentOverBalls.map((ball) => (
              <span
                key={`${ball.seq}-${ball.label}`}
                className={`${styles.ballChip} ${ball.isWicket ? styles.ballWicket : ""}`}
              >
                {ball.label}
              </span>
            ))
          ) : (
            <span className={styles.ballEmpty}>No balls yet</span>
          )}
        </div>
      </section>

      <section className={styles.commentary}>
        <div className={styles.commentaryHeader}>
          <h3>Commentary</h3>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
                type="button" 
                onClick={() => setAnalyticsOpen(true)}
                style={{ 
                    background: '#ef4444', 
                    color: 'white', 
                    border: 'none', 
                    cursor: 'pointer', 
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                }}
            >
                View Analysis Graph
            </button>
            <Link href={`/matches/${matchId}/score`} className={styles.scorerLink}>
                Scorer console
            </Link>
          </div>
        </div>
        <div className={styles.commentaryList}>
          {snapshot.commentaryTail.length ? (
            snapshot.commentaryTail.map((entry) => (
              <div key={entry.seq} className={styles.commentaryItem}>
                <span>{entry.text}</span>
              </div>
            ))
          ) : (
            <div className={styles.commentaryItem}>No commentary yet.</div>
          )}
        </div>
      </section>

      {(role === "ADMIN" || role === "ORGANIZER") && allowedActions ? (
        <section className={styles.actions}>
          <h3>Match controls</h3>
          {actionError ? <p className={styles.actionError}>{actionError}</p> : null}
          <div className={styles.actionRow}>
            {allowedActions.canStartInnings2 ? (
              <Link className={styles.actionButton} href={`/matches/${matchId}/score`}>
                Start innings 2
              </Link>
            ) : null}
            <button
              type="button"
              className={styles.actionButton}
              onClick={handleEndInnings}
              disabled={!allowedActions.canEndInnings}
            >
              End innings
            </button>
            <button
              type="button"
              className={styles.actionButton}
              disabled={!allowedActions.canLockMatch}
            >
              Lock match
            </button>
          </div>
        </section>
      ) : null}

      <AnalyticsModal
        isOpen={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        runsPerOver={snapshot.runsPerOver || []}
        oversConfig={snapshot.oversConfig}
        target={snapshot.target}
        currentScore={snapshot.runs}
        currentOver={snapshot.balls ? Math.floor(snapshot.balls / 6) : 0}
      />
    </div>
  );
}
