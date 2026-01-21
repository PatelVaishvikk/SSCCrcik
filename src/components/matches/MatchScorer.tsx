"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import styles from "./MatchScorer.module.css";
import { useMatchSnapshot, type SnapshotResponse } from "@/lib/hooks/useMatchSnapshot";
import { applyEvent, buildInitialSnapshot, checkTermination, getNextBallLabel, isLegalDelivery } from "@/lib/scoring/v2/engine";
import { getMatchConfig } from "@/lib/scoring/v2/match";
import { computeAllowedActions } from "@/lib/scoring/v2/permissions";
import type {
  ExtraType,
  MatchRole,
  MatchSnapshot,
  MatchConfig,
  ScoreEvent,
  ScoreEventPayload,
  ScoreEventType,
} from "@/lib/scoring/v2/types";
import {
  deleteOfflineAction,
  enqueueOfflineAction,
  getClientId,
  getNextClientSeq,
  getOfflineCounts,
  listOfflineActions,
  resetFailedActions,
  updateOfflineAction,
} from "@/lib/offline-queue";
import WagonWheelInput from "./WagonWheelInput";
import AnalyticsModal from "./AnalyticsModal";

const RUN_BUTTONS = [0, 1, 2, 3, 4, 6];
const EXTRA_TYPES = [
  { value: "WD", label: "Wide" },
  { value: "NB", label: "No ball" },
  { value: "B", label: "Bye" },
  { value: "LB", label: "Leg bye" },
  { value: "PEN", label: "Penalty" },
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

type MatchContext = {
  match: any;
  teams: any[];
  players: Array<{ player_id: string; name: string; role?: string }>;
};

const BALL_EVENT_TYPES = new Set<ScoreEventType>(["BALL_ADDED", "EXTRA", "WICKET"]);

function buildIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isNetworkFailure(error: unknown) {
  if (!error) return false;
  if ((error as any).networkError) return true;
  if (error instanceof TypeError) return true;
  const message = String((error as any).message || "");
  return message.includes("Failed to fetch") || message.includes("NetworkError");
}

function getCurrentBallPosition(snapshot: MatchSnapshot | null) {
  if (!snapshot || !snapshot.balls) {
    return { over: 0, ballInOver: 0 };
  }
  return {
    over: Math.floor((snapshot.balls - 1) / 6),
    ballInOver: ((snapshot.balls - 1) % 6) + 1,
  };
}

async function postJson(url: string, body: Record<string, any>) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data?.error || "Request failed");
      (error as any).status = res.status;
      throw error;
    }
    return data;
  } catch (error: any) {
    if (error instanceof TypeError) {
      (error as any).networkError = true;
    }
    throw error;
  }
}

export default function MatchScorer({ matchId }: { matchId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useMatchSnapshot(matchId);
  const queryKey = useMemo(() => ["matchSnapshot", matchId], [matchId]);
  const [context, setContext] = useState<MatchContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const optimisticSeqRef = useRef(0);
  const syncInFlightRef = useRef(false);

  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const [extrasOpen, setExtrasOpen] = useState(false);
  const [extraType, setExtraType] = useState<ExtraType>("WD");
  const [extraRuns, setExtraRuns] = useState(1);
  const [extraBatRuns, setExtraBatRuns] = useState(0);

  const [wicketOpen, setWicketOpen] = useState(false);
  const [dismissalType, setDismissalType] = useState(DISMISSAL_TYPES[0]);
  const [outPlayer, setOutPlayer] = useState<"striker" | "non-striker">("striker");
  const [wicketRuns, setWicketRuns] = useState(0);
  const [crossed, setCrossed] = useState(false);
  const [fielderId, setFielderId] = useState("");

  const [pendingRun, setPendingRun] = useState<number | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);



  const [startStriker, setStartStriker] = useState("");
  const [startNonStriker, setStartNonStriker] = useState("");
  const [startBowler, setStartBowler] = useState("");
  const [startingInningsNo, setStartingInningsNo] = useState(1);

  const snapshot = data?.snapshot || null;
  const role = (data?.role || "VIEWER") as MatchRole;
  const allowedActions = snapshot ? snapshot.allowedActions || computeAllowedActions(snapshot, role) : null;

  const startTeams = useMemo(() => {
    if (!context?.match) return null;
    const match = context.match;
    const teamA = match.team_a_id;
    const teamB = match.team_b_id;
    if (startingInningsNo === 1) {
      const tossWinner = match.toss_winner_id;
      const decision = String(match.toss_decision || "").toLowerCase();
      if (decision === "bat") {
        return { battingTeamId: tossWinner, bowlingTeamId: tossWinner === teamA ? teamB : teamA };
      }
      if (decision === "bowl") {
        return { battingTeamId: tossWinner === teamA ? teamB : teamA, bowlingTeamId: tossWinner };
      }
      return { battingTeamId: teamA, bowlingTeamId: teamB };
    }
    if (startingInningsNo === 2 && match.innings1_batting_team_id) {
      const innings1Bat = match.innings1_batting_team_id;
      return {
        battingTeamId: innings1Bat === teamA ? teamB : teamA,
        bowlingTeamId: innings1Bat,
      };
    }
    return { battingTeamId: teamA, bowlingTeamId: teamB };
  }, [context?.match, startingInningsNo]);

  const startBattingSquad = useMemo(() => {
    if (!context?.match || !startTeams) return [] as string[];
    return startTeams.battingTeamId === context.match.team_a_id
      ? context.match.squad_a_ids || []
      : context.match.squad_b_ids || [];
  }, [context?.match, startTeams]);

  const startBowlingSquad = useMemo(() => {
    if (!context?.match || !startTeams) return [] as string[];
    return startTeams.bowlingTeamId === context.match.team_a_id
      ? context.match.squad_a_ids || []
      : context.match.squad_b_ids || [];
  }, [context?.match, startTeams]);

  useEffect(() => {
    setStartStriker("");
    setStartNonStriker("");
    setStartBowler("");
  }, [startingInningsNo, startTeams?.battingTeamId, startTeams?.bowlingTeamId]);

  useEffect(() => {
    if (snapshot?.pendingAction === "START_INNINGS_2_APPROVAL") {
      setStartingInningsNo(2);
    }
  }, [snapshot?.pendingAction]);

  useEffect(() => {
    const version = data?.snapshot?.version;
    if (typeof version === "number" && Number.isFinite(version)) {
      optimisticSeqRef.current = version;
    }
  }, [data?.snapshot?.version]);

  useEffect(() => {
    const updateNetworkStatus = () => {
      if (typeof navigator === "undefined") return;
      setIsOffline(!navigator.onLine);
    };
    updateNetworkStatus();
    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);
    return () => {
      window.removeEventListener("online", updateNetworkStatus);
      window.removeEventListener("offline", updateNetworkStatus);
    };
  }, []);

  useEffect(() => {
    if (!matchId) return;
    fetch(`/api/matches/${matchId}/context`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load context");
        return json as MatchContext;
      })
      .then((payload) => {
        setContext(payload);
        setContextError(null);
      })
      .catch((err) => {
        setContext(null);
        setContextError(err?.message || "Unable to load match context");
      });
  }, [matchId]);

  const teamMap = useMemo(() => {
    const map = new Map<string, any>();
    context?.teams?.forEach((team) => map.set(team.team_id, team));
    return map;
  }, [context?.teams]);

  const playerMap = useMemo(() => {
    const map = new Map<string, any>();
    context?.players?.forEach((player) => map.set(player.player_id, player));
    return map;
  }, [context?.players]);

  const battingTeamId = snapshot?.battingTeamId || "";
  const bowlingTeamId = snapshot?.bowlingTeamId || "";

  const battingXI = useMemo(() => {
    if (!context?.match) return [] as string[];
    if (battingTeamId === context.match.team_a_id) return context.match.squad_a_ids || [];
    if (battingTeamId === context.match.team_b_id) return context.match.squad_b_ids || [];
    return [] as string[];
  }, [context?.match, battingTeamId]);

  const bowlingXI = useMemo(() => {
    if (!context?.match) return [] as string[];
    if (bowlingTeamId === context.match.team_a_id) return context.match.squad_a_ids || [];
    if (bowlingTeamId === context.match.team_b_id) return context.match.squad_b_ids || [];
    return [] as string[];
  }, [context?.match, bowlingTeamId]);

  const dismissedIds = useMemo(() => {
    const dismissed = new Set<string>();
    if (!snapshot?.batsmen) return dismissed;
    Object.entries(snapshot.batsmen).forEach(([playerId, line]) => {
      if (line?.isOut) dismissed.add(playerId);
    });
    return dismissed;
  }, [snapshot?.batsmen]);

  const availableBatters = useMemo(() => {
    return battingXI.filter(
      (playerId) =>
        playerId !== snapshot?.strikerId &&
        playerId !== snapshot?.nonStrikerId &&
        !dismissedIds.has(playerId)
    );
  }, [battingXI, snapshot?.strikerId, snapshot?.nonStrikerId, dismissedIds]);

  const availableBowlers = useMemo(() => {
    return bowlingXI.filter((playerId) => playerId !== snapshot?.bowlerId);
  }, [bowlingXI, snapshot?.bowlerId]);

  const battingTeam = battingTeamId ? teamMap.get(battingTeamId) : null;
  const bowlingTeam = bowlingTeamId ? teamMap.get(bowlingTeamId) : null;

  const applyServerSnapshot = useCallback((payload: any) => {
    if (!payload?.snapshot) return;
    queryClient.setQueryData(queryKey, (prev: SnapshotResponse | undefined) => {
      const prevVersion = prev?.snapshot?.version ?? 0;
      const nextVersion = Number(payload.snapshot?.version ?? 0);
      if (!Number.isFinite(nextVersion) || nextVersion < prevVersion) return prev;
      const nextRole = (payload.role || prev?.role || "VIEWER") as MatchRole;
      const allowed =
        payload.allowedActions ||
        computeAllowedActions(payload.snapshot as MatchSnapshot, nextRole);
      const nextSnapshot = { ...payload.snapshot, allowedActions: allowed };
      return { ...(prev || {}), snapshot: nextSnapshot, role: nextRole } as SnapshotResponse;
    });
    const version = Number(payload.snapshot?.version ?? 0);
    if (Number.isFinite(version)) {
      optimisticSeqRef.current = version;
    }
  }, [queryClient, queryKey]);

  const resolveConfig = useCallback(
    (currentSnapshot: MatchSnapshot | null): MatchConfig => {
      const snapshotConfig = currentSnapshot
        ? {
          overs: currentSnapshot.oversConfig,
          settings: currentSnapshot.settings || {},
        }
        : null;
      if (context?.match) {
        const matchConfig = getMatchConfig(context.match);
        return {
          ...matchConfig,
          overs: snapshotConfig?.overs || matchConfig.overs,
          settings: { ...matchConfig.settings, ...(snapshotConfig?.settings || {}) },
        };
      }
      if (snapshotConfig) {
        return snapshotConfig;
      }
      return { overs: 0, settings: {} };
    },
    [context?.match]
  );

  const applyOptimisticEvent = useCallback(
    (event: ScoreEvent, config: MatchConfig) => {
      queryClient.setQueryData(queryKey, (prev: SnapshotResponse | undefined) => {
        const role = (prev?.role || "VIEWER") as MatchRole;
        let nextSnapshot: MatchSnapshot | null = null;
        let lastSeq = event.seq;
        if (!prev?.snapshot) {
          if (event.type !== "INNINGS_START") return prev;
          const payload = event.payload || {};
          nextSnapshot = buildInitialSnapshot({
            matchId: event.matchId,
            inningsNo: event.inningsNo,
            strikerId: payload.strikerId || "",
            nonStrikerId: payload.nonStrikerId || "",
            bowlerId: payload.bowlerId || "",
            battingTeamId: payload.battingTeamId || "",
            bowlingTeamId: payload.bowlingTeamId || "",
            oversConfig: config.overs,
            settings: config.settings || {},
            previousInnings: null,
            target: null,
          });
          nextSnapshot.version = event.seq;
        } else {
          nextSnapshot = applyEvent({
            snapshot: prev.snapshot,
            event,
            config,
            scorer: prev.snapshot.scorer,
          });
          if (nextSnapshot && BALL_EVENT_TYPES.has(event.type)) {
            const legalDelivery = isLegalDelivery(event.payload, config);
            if (legalDelivery && nextSnapshot.balls % 6 === 0) {
              lastSeq += 1;
              nextSnapshot = applyEvent({
                snapshot: nextSnapshot,
                event: {
                  ...event,
                  seq: lastSeq,
                  type: "OVER_END",
                  payload: {},
                },
                config,
                scorer: prev.snapshot.scorer,
              });
            }
            const termination = checkTermination(nextSnapshot, config);
            const isSecondInnings = nextSnapshot.inningsNo === 2;
            const allOut = termination.isAllOut;
            const oversComplete = termination.isOversComplete;
            const targetReached = isSecondInnings && termination.isChased;
            if (allOut || oversComplete || targetReached) {
              const inningsEndReason = targetReached
                ? "target_chased"
                : allOut
                  ? "all_out"
                  : "overs_complete";
              lastSeq += 1;
              nextSnapshot = applyEvent({
                snapshot: nextSnapshot,
                event: {
                  ...event,
                  seq: lastSeq,
                  type: "INNINGS_END",
                  payload: { reason: inningsEndReason },
                },
                config,
                scorer: prev.snapshot.scorer,
              });
            }
            if (targetReached || (isSecondInnings && (allOut || oversComplete))) {
              lastSeq += 1;
              const reason = targetReached ? "target_chased" : allOut ? "all_out" : "overs_complete";
              nextSnapshot = applyEvent({
                snapshot: nextSnapshot,
                event: {
                  ...event,
                  seq: lastSeq,
                  type: "MATCH_END",
                  payload: { reason },
                },
                config,
                scorer: prev.snapshot.scorer,
              });
            }
          }
        }
        if (nextSnapshot) {
             // Update ref inside callback where we know the final seq
             lastSeq = Math.max(lastSeq, nextSnapshot.version); 
             // We can't easily update ref here without side effects, but optimisticSeqRef is a ref.
             // Actually, the ref update outside was wrong because lastSeq is not in scope.
             // We can just rely on the fact that next call will see updated data?
             // Or update it here:
             optimisticSeqRef.current = Math.max(optimisticSeqRef.current, lastSeq);
        }
        
        nextSnapshot.allowedActions = computeAllowedActions(nextSnapshot, role);
        return { ...(prev || {}), snapshot: nextSnapshot } as SnapshotResponse;
      });
      // Removed erroneous update outside
    },
    [queryClient, queryKey]
  );

  const refreshQueueCounts = useCallback(async () => {
    if (!matchId) return;
    try {
      const counts = await getOfflineCounts(matchId);
      setPendingCount(counts.pending);
      setFailedCount(counts.failed);
    } catch {
      setPendingCount(0);
      setFailedCount(0);
    }
  }, [matchId]);

  const syncQueue = useCallback(
    async (options?: { resetFailed?: boolean }) => {
      if (!matchId || syncInFlightRef.current) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setIsOffline(true);
        setSyncError("Offline - waiting for connection.");
        return;
      }
      syncInFlightRef.current = true;
      setSyncing(true);
      setSyncError(null);
      try {
        if (options?.resetFailed) {
          await resetFailedActions(matchId);
        }
        const queued = await listOfflineActions(matchId);
        if (!queued.length) {
          await refreshQueueCounts();
          return;
        }

        const snapshotRes = await fetch(`/api/matches/${matchId}/snapshot`, { cache: "no-store" });
        let expectedVersion: number | null = null;
        if (snapshotRes.ok) {
          const payload = (await snapshotRes.json()) as SnapshotResponse;
          applyServerSnapshot(payload);
          expectedVersion = payload.snapshot?.version ?? null;
        }
        for (const item of queued) {
          if (item.status === "failed") {
            setSyncError("Resolve failed offline actions before syncing.");
            break;
          }
          try {
            const response = await postJson(item.endpoint, {
              ...item.payload,
              clientId: item.clientId,
              clientSeq: item.clientSeq,
              ...(Number.isFinite(expectedVersion) ? { expectedVersion } : {}),
            });
            applyServerSnapshot(response);
            expectedVersion = response?.snapshot?.version ?? expectedVersion;
            if (item.id) await deleteOfflineAction(item.id);
          } catch (error: any) {
            if (item.id) {
              await updateOfflineAction(item.id, {
                status: "failed",
                lastError: error?.message || "Sync failed",
              });
            }
            setSyncError(error?.message || "Sync failed");
            break;
          }
        }
      } catch (error: any) {
        setSyncError(error?.message || "Sync failed");
      } finally {
        await refreshQueueCounts();
        setSyncing(false);
        syncInFlightRef.current = false;
      }
    },
    [applyServerSnapshot, matchId, refreshQueueCounts]
  );

  const submitAction = useCallback(
    async (
      url: string,
      body: Record<string, any>,
      optimistic?: { event: ScoreEvent; config: MatchConfig },
      options?: { allowOffline?: boolean }
    ) => {
      if (!matchId) return null;
      const allowOffline = options?.allowOffline !== false;
      const clientId = getClientId();
      const clientSeq = await getNextClientSeq(matchId);
      const expectedVersion = snapshot?.version;
      const payload = {
        ...body,
        clientId,
        clientSeq,
        ...(Number.isFinite(expectedVersion) ? { expectedVersion } : {}),
      };

      const hasQueued = pendingCount > 0 || failedCount > 0;
      if (allowOffline && (hasQueued || (typeof navigator !== "undefined" && !navigator.onLine))) {
        await enqueueOfflineAction({ matchId, endpoint: url, payload: body, clientId, clientSeq });
        if (optimistic) {
          applyOptimisticEvent(optimistic.event, optimistic.config);
        }
        await refreshQueueCounts();
        setIsOffline(true);
        return { queued: true };
      }

      try {
        const response = await postJson(url, payload);
        applyServerSnapshot(response);
        return response;
      } catch (error: any) {
        if (allowOffline && optimistic && isNetworkFailure(error)) {
          await enqueueOfflineAction({ matchId, endpoint: url, payload: body, clientId, clientSeq });
          applyOptimisticEvent(optimistic.event, optimistic.config);
          await refreshQueueCounts();
          return { queued: true };
        }
        if (error?.status === 409) {
          refetch();
          throw new Error("Syncing latest match data. Please retry.");
        }
        throw error;
      }
    },
    [
      applyOptimisticEvent,
      applyServerSnapshot,
      matchId,
      refreshQueueCounts,
      snapshot?.version,
      pendingCount,
      failedCount,
      refetch,
    ]
  );

  const buildOptimisticEvent = useCallback(
    (params: {
      type: ScoreEventType;
      payload: ScoreEventPayload;
      inningsNo: number;
      idempotencyKey: string;
    }) => {
      const currentSnapshot = snapshot || null;
      if (!currentSnapshot && params.type !== "INNINGS_START") {
        return null;
      }
      const config = resolveConfig(currentSnapshot);
      const nextSeq = (optimisticSeqRef.current || currentSnapshot?.version || 0) + 1;
      const position = BALL_EVENT_TYPES.has(params.type)
        ? getNextBallLabel(currentSnapshot?.balls || 0)
        : getCurrentBallPosition(currentSnapshot);
      const event: ScoreEvent = {
        matchId,
        inningsNo: params.inningsNo,
        seq: nextSeq,
        over: position.over,
        ballInOver: position.ballInOver,
        type: params.type,
        payload: params.payload,
        createdBy: "offline",
        createdAt: new Date().toISOString(),
        idempotencyKey: params.idempotencyKey,
      };
      return { event, config };
    },
    [matchId, resolveConfig, snapshot]
  );

  useEffect(() => {
    if (!matchId) return;
    refreshQueueCounts();
    if (typeof navigator !== "undefined" && navigator.onLine) {
      syncQueue();
    }
  }, [matchId, refreshQueueCounts, syncQueue]);

  useEffect(() => {
    if (!matchId) return;
    const handleOnline = () => {
      setIsOffline(false);
      syncQueue();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [matchId, syncQueue]);

  const statusLabel = useMemo(() => {
    if (!snapshot) return "Awaiting start";
    if (snapshot.pendingAction === "SELECT_BOWLER") return "Waiting for next bowler selection";
    if (snapshot.pendingAction === "SELECT_BATSMAN") return "Waiting for new batter";
    if (snapshot.pendingAction === "START_INNINGS_2_APPROVAL") return "Waiting for innings 2";
    if (snapshot.status === "COMPLETED") return "Match completed";
    return "Scoring live";
  }, [snapshot]);

  const syncBanner =
    isOffline || pendingCount || failedCount || syncing || syncError ? (
      <div className={styles.syncBanner}>
        <span>{isOffline ? "Offline mode" : "Online sync"}</span>
        {syncing ? <span>Syncing queued actions...</span> : null}
        {pendingCount ? <span>{pendingCount} queued</span> : null}
        {failedCount ? <span>{failedCount} failed</span> : null}
        {syncError ? <span>{syncError}</span> : null}
        {!isOffline && pendingCount > 0 && !syncing ? (
          <button type="button" onClick={() => syncQueue()}>
            Sync now
          </button>
        ) : null}
        {!isOffline && failedCount > 0 && !syncing ? (
          <button type="button" onClick={() => syncQueue({ resetFailed: true })}>
            Retry failed
          </button>
        ) : null}
      </div>
    ) : null;

  const commitRun = async (runs: number, coords?: { x: number; y: number }) => {
    if (!snapshot) return;
    const idempotencyKey = buildIdempotencyKey();
    const body = {
      inningsNo: snapshot.inningsNo,
      type: "BALL_ADDED",
      idempotencyKey,
      payload: { runs, shotX: coords?.x, shotY: coords?.y },
    };
    const optimistic = buildOptimisticEvent({
      type: "BALL_ADDED",
      inningsNo: snapshot.inningsNo,
      idempotencyKey,
      payload: {
        runs,
        strikerId: snapshot.strikerId || undefined,
        nonStrikerId: snapshot.nonStrikerId || undefined,
        bowlerId: snapshot.bowlerId || undefined,
        shotX: coords?.x,
        shotY: coords?.y,
      },
    });
    await submitAction(`/api/matches/${matchId}/events`, body, optimistic || undefined);
    setPendingRun(null);
  };

  const handleRun = (runs: number) => {
    setPendingRun(runs);
  };


  const handleExtras = async () => {
    if (!snapshot) return;
    const batRuns = extraType === "NB" ? extraBatRuns : 0;
    const idempotencyKey = buildIdempotencyKey();
    const body = {
      inningsNo: snapshot.inningsNo,
      type: "EXTRA",
      idempotencyKey,
      payload: {
        runs: batRuns,
        extras: { type: extraType, runs: extraRuns },
      },
    };
    const optimistic = buildOptimisticEvent({
      type: "EXTRA",
      inningsNo: snapshot.inningsNo,
      idempotencyKey,
      payload: {
        runs: batRuns,
        extras: { type: extraType, runs: extraRuns },
        strikerId: snapshot.strikerId || undefined,
        nonStrikerId: snapshot.nonStrikerId || undefined,
        bowlerId: snapshot.bowlerId || undefined,
      },
    });
    await submitAction(`/api/matches/${matchId}/events`, body, optimistic || undefined);
    setExtrasOpen(false);
    setExtraRuns(1);
    setExtraBatRuns(0);
  };

  const handleWicket = async () => {
    if (!snapshot) return;
    const outId = outPlayer === "striker" ? snapshot.strikerId : snapshot.nonStrikerId;
    if (!outId) return;
    const idempotencyKey = buildIdempotencyKey();
    const body = {
      inningsNo: snapshot.inningsNo,
      type: "WICKET",
      idempotencyKey,
      payload: {
        runs: wicketRuns,
        dismissal: {
          type: dismissalType,
          playerOutId: outId,
          crossed,
          fielderId: fielderId || undefined,
        },
      },
    };
    const optimistic = buildOptimisticEvent({
      type: "WICKET",
      inningsNo: snapshot.inningsNo,
      idempotencyKey,
      payload: {
        runs: wicketRuns,
        dismissal: {
          type: dismissalType,
          playerOutId: outId,
          crossed,
          fielderId: fielderId || undefined,
        },
        strikerId: snapshot.strikerId || undefined,
        nonStrikerId: snapshot.nonStrikerId || undefined,
        bowlerId: snapshot.bowlerId || undefined,
      },
    });
    await submitAction(`/api/matches/${matchId}/events`, body, optimistic || undefined);
    setWicketOpen(false);
    setWicketRuns(0);
    setCrossed(false);
    setFielderId("");
  };

  const handleUndo = async () => {
    if (!snapshot) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSyncError("Undo needs a connection to sync safely.");
      return;
    }
    await submitAction(
      `/api/matches/${matchId}/undo`,
      {
        inningsNo: snapshot.inningsNo,
        idempotencyKey: buildIdempotencyKey(),
      },
      undefined,
      { allowOffline: false }
    );
  };

  const handleSelectBowler = async (bowlerId: string) => {
    if (!snapshot) return;
    const idempotencyKey = buildIdempotencyKey();
    const body = {
      inningsNo: snapshot.inningsNo,
      bowlerId,
      idempotencyKey,
    };
    const optimistic = buildOptimisticEvent({
      type: "BOWLER_SELECTED",
      inningsNo: snapshot.inningsNo,
      idempotencyKey,
      payload: { bowlerId },
    });
    await submitAction(`/api/matches/${matchId}/bowler/select`, body, optimistic || undefined);
  };

  const handleSelectBatsman = async (batsmanId: string) => {
    if (!snapshot) return;
    const idempotencyKey = buildIdempotencyKey();
    const body = {
      inningsNo: snapshot.inningsNo,
      batsmanId,
      idempotencyKey,
    };
    const optimistic = buildOptimisticEvent({
      type: "BATSMAN_SELECTED",
      inningsNo: snapshot.inningsNo,
      idempotencyKey,
      payload: { batsmanId },
    });
    await submitAction(`/api/matches/${matchId}/batsman/select`, body, optimistic || undefined);
  };

  const handleStartInnings = async () => {
    if (!context?.match || !startTeams) return;
    const idempotencyKey = buildIdempotencyKey();
    const body = {
      inningsNo: startingInningsNo,
      idempotencyKey,
      strikerId: startStriker,
      nonStrikerId: startNonStriker,
      bowlerId: startBowler,
      battingTeamId: startTeams.battingTeamId,
      bowlingTeamId: startTeams.bowlingTeamId,
    };
    const optimistic = buildOptimisticEvent({
      type: "INNINGS_START",
      inningsNo: startingInningsNo,
      idempotencyKey,
      payload: {
        strikerId: startStriker,
        nonStrikerId: startNonStriker,
        bowlerId: startBowler,
        battingTeamId: startTeams.battingTeamId,
        bowlingTeamId: startTeams.bowlingTeamId,
      },
    });
    await submitAction(`/api/matches/${matchId}/innings/start`, body, optimistic || undefined);
  };

  const handleEndInnings = async () => {
    if (!snapshot) return;
    const idempotencyKey = buildIdempotencyKey();
    const body = {
      inningsNo: snapshot.inningsNo,
      idempotencyKey,
    };
    const optimistic = buildOptimisticEvent({
      type: "INNINGS_END",
      inningsNo: snapshot.inningsNo,
      idempotencyKey,
      payload: {},
    });
    await submitAction(`/api/matches/${matchId}/innings/end`, body, optimistic || undefined);
  };

  const handleEndMatch = async () => {
    if (!confirm("Are you sure you want to END the match? This action cannot be undone.")) {
      return;
    }
    try {
      await submitAction(`/api/matches/${matchId}/end`, { reason: "manual" });
    } catch (error) {
       console.error(error);
       alert("Failed to end match: " + (error as any).message);
    }
  };

  if (isLoading) {
    return <div className="card">Loading scorer console...</div>;
  }

  if (error) {
    return <div className="card">Unable to load live scoring.</div>;
  }

  if (!snapshot) {
    const tossReady =
      context?.match &&
      Boolean(context.match.toss_winner_id) &&
      Boolean(context.match.toss_decision);
    return (
      <div className={styles.page}>
        {syncBanner}
        <div className="card">
          <h2>Start innings</h2>
          <p className="text-muted">Match scoring has not started yet.</p>
          {contextError ? <p className="text-muted">{contextError}</p> : null}
          {context?.match &&
          (!context.match.toss_winner_id || !context.match.toss_decision) ? (
            <p className="text-muted">Toss details are required before starting.</p>
          ) : null}
          {context ? (
            <div className={styles.startGrid}>
              <select
                value={startStriker}
                onChange={(event) => setStartStriker(event.target.value)}
              >
                <option value="">Select striker</option>
                {startBattingSquad.map((playerId: string) => (
                  <option key={playerId} value={playerId}>
                    {playerMap.get(playerId)?.name || playerId}
                  </option>
                ))}
              </select>
              <select
                value={startNonStriker}
                onChange={(event) => setStartNonStriker(event.target.value)}
              >
                <option value="">Select non-striker</option>
                {startBattingSquad.map((playerId: string) => (
                  <option key={playerId} value={playerId}>
                    {playerMap.get(playerId)?.name || playerId}
                  </option>
                ))}
              </select>
              <select
                value={startBowler}
                onChange={(event) => setStartBowler(event.target.value)}
              >
                <option value="">Select bowler</option>
                {startBowlingSquad.map((playerId: string) => (
                  <option key={playerId} value={playerId}>
                    {playerMap.get(playerId)?.name || playerId}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="pill"
                onClick={handleStartInnings}
                disabled={!startStriker || !startNonStriker || !startBowler || !tossReady}
              >
                Start innings
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {syncBanner}
      <section className={styles.header}>
        <div>
          <div className={styles.scoreLine}>
            <span 
                className={styles.score} 
                onClick={() => setAnalyticsOpen(true)}
                style={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}
                title="View Analytics"
            >
                {snapshot.runs}/{snapshot.wickets}
            </span>
            <span className={styles.overs}>{snapshot.overs} ov</span>
          </div>
          <div className={styles.metaLine}>
            <button 
                type="button"
                onClick={() => setAnalyticsOpen(true)}
                style={{ 
                    background: 'rgba(255,255,255,0.1)', 
                    border: '1px solid rgba(255,255,255,0.2)', 
                    color: '#fff', 
                    borderRadius: '12px',
                    padding: '4px 8px',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    marginRight: '8px'
                }}
            >
                📊 Analysis
            </button>
            <span>RR {snapshot.runRate}</span>
            {snapshot.target ? (
              <span>Target {snapshot.target}</span>
            ) : null}
            {snapshot.requiredRR ? (
              <span>Req RR {snapshot.requiredRR}</span>
            ) : null}
          </div>
        </div>
        <div className={styles.teamLine}>
          <span>{battingTeam?.name || "Batting"}</span>
          <span>vs</span>
          <span>{bowlingTeam?.name || "Bowling"}</span>
        </div>
        <div className={styles.status}>{statusLabel}</div>
      </section>

      <section className={styles.players}>
        <div className={styles.playerCard}>
          <span className={styles.playerLabel}>Striker</span>
          <strong>{snapshot.strikerId ? playerMap.get(snapshot.strikerId)?.name || snapshot.strikerId : "TBD"}</strong>
          <span className={styles.playerMeta}>
            {snapshot.strikerId && snapshot.batsmen[snapshot.strikerId]
              ? `${snapshot.batsmen[snapshot.strikerId].runs} (${snapshot.batsmen[snapshot.strikerId].balls})`
              : "-"}
          </span>
        </div>
        <div className={styles.playerCard}>
          <span className={styles.playerLabel}>Non-striker</span>
          <strong>{snapshot.nonStrikerId ? playerMap.get(snapshot.nonStrikerId)?.name || snapshot.nonStrikerId : "TBD"}</strong>
          <span className={styles.playerMeta}>
            {snapshot.nonStrikerId && snapshot.batsmen[snapshot.nonStrikerId]
              ? `${snapshot.batsmen[snapshot.nonStrikerId].runs} (${snapshot.batsmen[snapshot.nonStrikerId].balls})`
              : "-"}
          </span>
        </div>
        <div className={styles.playerCard}>
          {/* Use current partnership if available, else standard bowler card */}
           <span className={styles.playerLabel}>Partnership</span>
           <div className={styles.partnershipMeta}>
              <strong>{snapshot.currentPartnership?.runs || 0}</strong> runs From <strong>{snapshot.currentPartnership?.balls || 0}</strong> balls
           </div>
        </div>
        <div className={styles.playerCard}>
          <span className={styles.playerLabel}>Bowler</span>
          <strong>{snapshot.bowlerId ? playerMap.get(snapshot.bowlerId)?.name || snapshot.bowlerId : "TBD"}</strong>
          <span className={styles.playerMeta}>
            {snapshot.bowlerId && snapshot.bowlers[snapshot.bowlerId]
              ? `${Math.floor(snapshot.bowlers[snapshot.bowlerId].balls / 6)}.${snapshot.bowlers[snapshot.bowlerId].balls % 6} - ${snapshot.bowlers[snapshot.bowlerId].runs}/${snapshot.bowlers[snapshot.bowlerId].wickets}`
              : "-"}
          </span>
        </div>
      </section>

      <section className={styles.overStrip}>
        <span className={styles.overLabel}>This over</span>
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

      <section style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
         <h4 style={{ margin: '0 0 0.5rem 0', color: '#ccc', fontSize: '0.9rem', textTransform: 'uppercase' }}>Live Commentary</h4>
         <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '150px', overflowY: 'auto' }}>
            {[...snapshot.commentaryTail].reverse().map((entry, idx) => (
                <div 
                    key={`${entry.seq}-${idx}`} 
                    style={{ 
                        display: 'flex', 
                        gap: '0.5rem', 
                        fontSize: '0.9rem',
                        color: entry.highlight ? '#ffd700' : '#fff',
                        fontWeight: entry.highlight ? 'bold' : 'normal',
                        padding: '4px',
                        background: entry.type === 'WICKET' || entry.type === 'wicket' ? 'rgba(255, 0, 0, 0.2)' : 'transparent',
                        borderRadius: '4px'
                    }}
                >
                    <span style={{ opacity: 0.6, fontSize: '0.8rem', minWidth: '40px' }}>
                        {/* Try to extract over from text if possible, or just show seq/time? Time is verbose. Just text is fine. */}
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit', second:'2-digit' }) : ''}
                    </span>
                    <span>{entry.text}</span>
                </div>
            ))}
            {!snapshot.commentaryTail.length && <div style={{ opacity: 0.5, fontStyle: 'italic' }}>No commentary yet.</div>}
         </div>
      </section>

      <section className={styles.actions}>
        <div className={styles.runGrid}>
          {RUN_BUTTONS.map((run) => (
            <button
              key={run}
              type="button"
              className={styles.runButton}
              onClick={() => handleRun(run)}
              disabled={!allowedActions?.canScore}
            >
              {run}
            </button>
          ))}
        </div>
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => setExtrasOpen(true)}
            disabled={!allowedActions?.canScore}
          >
            Extras
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => setWicketOpen(true)}
            disabled={!allowedActions?.canScore}
          >
            Wicket
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={handleUndo}
            disabled={!allowedActions?.canUndo}
          >
            Undo
          </button>
          {role === "ADMIN" || role === "ORGANIZER" ? (
            <>
            <button
              type="button"
              className={styles.actionButton}
              onClick={handleEndInnings}
              disabled={!allowedActions?.canEndInnings}
            >
              End innings
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={handleEndMatch}
              disabled={!allowedActions?.canEndMatch}
              style={{ backgroundColor: "#2e2e2e", border: "1px solid #444" }} 
            >
              End Match
            </button>
            </>
          ) : null}
        </div>
      </section>

      {snapshot.pendingAction === "SELECT_BOWLER" ? (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3>Select next bowler</h3>
            <div className={styles.listGrid}>
              {availableBowlers.map((playerId: string) => (
                <button
                  key={playerId}
                  type="button"
                  className={styles.listButton}
                  onClick={() => handleSelectBowler(playerId)}
                  disabled={!allowedActions?.canSelectBowler}
                >
                  {playerMap.get(playerId)?.name || playerId}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {snapshot.pendingAction === "SELECT_BATSMAN" ? (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3>Select next batter</h3>
            <div className={styles.listGrid}>
              {availableBatters.map((playerId: string) => (
                <button
                  key={playerId}
                  type="button"
                  className={styles.listButton}
                  onClick={() => handleSelectBatsman(playerId)}
                  disabled={!allowedActions?.canSelectBatsman}
                >
                  {playerMap.get(playerId)?.name || playerId}
                </button>
              ))}
            </div>
            {availableBatters.length === 0 && (
                 <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                    <p style={{ color: '#aaa', fontStyle: 'italic' }}>No batters available.</p>
                    {allowedActions?.canEndInnings ? (
                        <button 
                            type="button" 
                            className={styles.actionButton}
                            onClick={handleEndInnings}
                            style={{ marginTop: '0.5rem', background: '#d32f2f' }}
                        >
                            End Innings
                        </button>
                    ) : (
                         <p style={{ fontSize: '0.8rem' }}>Waiting for resolution...</p>
                    )}
                 </div>
            )}
          </div>
        </div>
      ) : null}

      {snapshot.pendingAction === "START_INNINGS_2_APPROVAL" ? (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3>Start innings 2</h3>
            {allowedActions?.canStartInnings2 ? (
              <>
                <label className={styles.label}>Striker</label>
                <select value={startStriker} onChange={(event) => setStartStriker(event.target.value)}>
                  <option value="">Select striker</option>
                  {startBattingSquad.map((playerId: string) => (
                    <option key={playerId} value={playerId}>
                      {playerMap.get(playerId)?.name || playerId}
                    </option>
                  ))}
                </select>
                <label className={styles.label}>Non-striker</label>
                <select value={startNonStriker} onChange={(event) => setStartNonStriker(event.target.value)}>
                  <option value="">Select non-striker</option>
                  {startBattingSquad.map((playerId: string) => (
                    <option key={playerId} value={playerId}>
                      {playerMap.get(playerId)?.name || playerId}
                    </option>
                  ))}
                </select>
                <label className={styles.label}>Opening bowler</label>
                <select value={startBowler} onChange={(event) => setStartBowler(event.target.value)}>
                  <option value="">Select bowler</option>
                  {startBowlingSquad.map((playerId: string) => (
                    <option key={playerId} value={playerId}>
                      {playerMap.get(playerId)?.name || playerId}
                    </option>
                  ))}
                </select>
                <div className={styles.modalRow}>
                  <button
                    type="button"
                    onClick={handleStartInnings}
                    disabled={!startStriker || !startNonStriker || !startBowler}
                  >
                    Start innings 2
                  </button>
                </div>
              </>
            ) : (
              <p>Waiting for organizer to start innings 2.</p>
            )}
          </div>
        </div>
      ) : null}

      {extrasOpen ? (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3>Add extras</h3>
            <label className={styles.label}>Type</label>
            <select value={extraType} onChange={(event) => setExtraType(event.target.value)}>
              {EXTRA_TYPES.map((extra) => (
                <option key={extra.value} value={extra.value}>
                  {extra.label}
                </option>
              ))}
            </select>
            <label className={styles.label}>Extras runs</label>
            <input
              type="number"
              min={1}
              max={10}
              value={extraRuns}
              onChange={(event) => setExtraRuns(Number(event.target.value))}
            />
            {extraType === "NB" ? (
              <>
                <label className={styles.label}>Bat runs</label>
                <input
                  type="number"
                  min={0}
                  max={6}
                  value={extraBatRuns}
                  onChange={(event) => setExtraBatRuns(Number(event.target.value))}
                />
              </>
            ) : null}
            <div className={styles.modalRow}>
              <button type="button" onClick={() => setExtrasOpen(false)}>
                Cancel
              </button>
              <button type="button" onClick={handleExtras}>
                Add extras
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {wicketOpen ? (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3>Record wicket</h3>
            <label className={styles.label}>Dismissal</label>
            <select value={dismissalType} onChange={(event) => setDismissalType(event.target.value)}>
              {DISMISSAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <label className={styles.label}>Out batter</label>
            <div className={styles.toggleRow}>
              <button
                type="button"
                className={outPlayer === "striker" ? styles.toggleActive : ""}
                onClick={() => setOutPlayer("striker")}
              >
                Striker
              </button>
              <button
                type="button"
                className={outPlayer === "non-striker" ? styles.toggleActive : ""}
                onClick={() => setOutPlayer("non-striker")}
              >
                Non-striker
              </button>
            </div>
            <label className={styles.label}>Runs on ball</label>
            <input
              type="number"
              min={0}
              max={6}
              value={wicketRuns}
              onChange={(event) => setWicketRuns(Number(event.target.value))}
            />
            <label className={styles.label}>Fielder (optional)</label>
            <select value={fielderId} onChange={(event) => setFielderId(event.target.value)}>
              <option value="">None</option>
              {availableBowlers.map((playerId) => (
                <option key={playerId} value={playerId}>
                  {playerMap.get(playerId)?.name || playerId}
                </option>
              ))}
            </select>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={crossed}
                onChange={(event) => setCrossed(event.target.checked)}
              />
              Batters crossed
            </label>
            <div className={styles.modalRow}>
              <button type="button" onClick={() => setWicketOpen(false)}>
                Cancel
              </button>
              <button type="button" onClick={handleWicket}>
                Record wicket
              </button>
            </div>
          </div>
        </div>
      ) : null}
      
      {pendingRun !== null && (
        <WagonWheelInput
          onConfirm={(x, y) => commitRun(pendingRun, { x, y })}
          onCancel={() => commitRun(pendingRun)}
        />
      )}

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
