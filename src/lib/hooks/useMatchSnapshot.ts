"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSocketClient } from "@/lib/socket-client";
import { applyEvent } from "@/lib/scoring/v2/engine";
import { computeAllowedActions } from "@/lib/scoring/v2/permissions";
import type { MatchRole, MatchSnapshot, ScoreEvent } from "@/lib/scoring/v2/types";
import type {
  SocketBallAddedPayload,
  SocketBallEvent,
  SocketJoinPayload,
  SocketSnapshotUpdatedPayload,
} from "@/lib/socket-events";

export type SnapshotResponse = {
  snapshot: MatchSnapshot | null;
  role?: string;
  user?: { id: string; name: string } | null;
};

function buildScoreEvent(matchId: string, event: SocketBallEvent): ScoreEvent {
  return {
    matchId,
    inningsNo: event.inningsNo,
    seq: event.seq,
    over: event.over,
    ballInOver: event.ballInOver,
    type: event.type,
    payload: event.payload,
    createdBy: "socket",
    createdAt: "",
    idempotencyKey: "",
  };
}

async function fetchSnapshot(matchId: string) {
  const res = await fetch(`/api/matches/${matchId}/snapshot`, { cache: "no-store" });
  if (res.status === 404) {
    return { snapshot: null } as SnapshotResponse;
  }
  if (!res.ok) {
    throw new Error("Failed to load snapshot");
  }
  return (await res.json()) as SnapshotResponse;
}

export function useMatchSnapshot(matchId: string) {
  const queryClient = useQueryClient();
  const versionRef = useRef<number | null>(null);

  const queryKey = useMemo(() => ["matchSnapshot", matchId], [matchId]);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchSnapshot(matchId),
    enabled: Boolean(matchId),
  });

  useEffect(() => {
    const version = query.data?.snapshot?.version;
    if (typeof version === "number" && Number.isFinite(version)) {
      versionRef.current = version;
    }
  }, [query.data?.snapshot?.version]);

  useEffect(() => {
    if (!matchId) return;
    let active = true;
    let socket: Awaited<ReturnType<typeof getSocketClient>> | null = null;

    const getCurrentVersion = () => {
      const cached = queryClient.getQueryData<SnapshotResponse>(queryKey);
      const cachedVersion = cached?.snapshot?.version;
      if (typeof cachedVersion === "number" && Number.isFinite(cachedVersion)) {
        return cachedVersion;
      }
      const refVersion = versionRef.current;
      return typeof refVersion === "number" && Number.isFinite(refVersion) ? refVersion : 0;
    };

    const requestSync = () => {
      if (socket?.connected) {
        const lastVersion = getCurrentVersion();
        const payload: SocketJoinPayload = {
          matchId,
          lastVersion,
        };
        socket.emit("syncMatch", payload);
      } else {
        queryClient.invalidateQueries({ queryKey });
      }
    };

    const handleSnapshotUpdated = (payload: SocketSnapshotUpdatedPayload) => {
      if (!payload || payload.matchId !== matchId) return;
      const incomingVersion = Number(payload.version || payload.snapshot?.version || 0);
      const currentVersion = getCurrentVersion();
      if (!Number.isFinite(incomingVersion) || incomingVersion <= currentVersion) return;
      if (!payload.snapshot) {
        requestSync();
        return;
      }
      queryClient.setQueryData(queryKey, (prev: SnapshotResponse | undefined) => {
        const role = (prev?.role || "VIEWER") as MatchRole;
        const nextSnapshot = {
          ...payload.snapshot,
          allowedActions: computeAllowedActions(payload.snapshot as MatchSnapshot, role),
        };
        return { ...(prev || {}), snapshot: nextSnapshot } as SnapshotResponse;
      });
      versionRef.current = incomingVersion;
    };

    const handleBallAdded = (payload: SocketBallAddedPayload) => {
      if (!payload || payload.matchId !== matchId) return;
      const incomingVersion = Number(payload.version || payload.event?.seq || 0);
      const currentVersion = getCurrentVersion();
      if (!Number.isFinite(incomingVersion) || incomingVersion <= currentVersion) return;
      if (currentVersion && incomingVersion > currentVersion + 1) {
        requestSync();
        return;
      }
      let didUpdate = false;
      let needsSync = false;
      queryClient.setQueryData(queryKey, (prev: SnapshotResponse | undefined) => {
        if (!prev?.snapshot || !payload.event) {
          needsSync = true;
          return prev;
        }
        if (prev.snapshot.inningsNo !== payload.event.inningsNo) {
          needsSync = true;
          return prev;
        }
        const config = {
          overs: prev.snapshot.oversConfig,
          settings: prev.snapshot.settings || {},
        };
        try {
          const nextSnapshot = applyEvent({
            snapshot: prev.snapshot,
            event: buildScoreEvent(matchId, payload.event),
            config,
            scorer: prev.snapshot.scorer,
          });
          const role = (prev.role || "VIEWER") as MatchRole;
          nextSnapshot.allowedActions = computeAllowedActions(nextSnapshot, role);
          didUpdate = true;
          return { ...prev, snapshot: nextSnapshot } as SnapshotResponse;
        } catch {
          needsSync = true;
          return prev;
        }
      });
      if (didUpdate) {
        versionRef.current = incomingVersion;
      } else if (needsSync) {
        requestSync();
      }
    };

    const handleConnect = () => {
      if (!socket) return;
      const lastVersion = getCurrentVersion();
      const payload: SocketJoinPayload = {
        matchId,
        lastVersion,
      };
      socket.emit("joinMatch", payload);
    };

    getSocketClient().then((client) => {
      if (!active) return;
      socket = client;
      handleConnect();
      socket.on("connect", handleConnect);
      socket.on("snapshotUpdated", handleSnapshotUpdated);
      socket.on("ballAdded", handleBallAdded);
    });

    return () => {
      active = false;
      if (socket) {
        socket.emit("leaveMatch", { matchId });
        socket.off("connect", handleConnect);
        socket.off("snapshotUpdated", handleSnapshotUpdated);
        socket.off("ballAdded", handleBallAdded);
      }
    };
  }, [matchId, queryClient, queryKey]);

  return query;
}
