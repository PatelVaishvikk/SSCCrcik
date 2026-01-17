import type { NextApiRequest, NextApiResponse } from "next";
import { Server, type Socket } from "socket.io";
import { setSocketServer } from "@/lib/socket";
import { getDb } from "@/lib/mongo";
import {
  ensureScoringIndexes,
  getLatestSnapshotDoc,
  serializeSnapshotDoc,
} from "@/lib/scoring/v2/store";
import type { SocketJoinPayload } from "@/lib/socket-events";

type NextApiResponseWithSocket = NextApiResponse & {
  socket: NextApiResponse["socket"] & {
    server: {
      io?: Server;
    };
  };
};

function parseJoinPayload(payload: SocketJoinPayload | string | null | undefined) {
  if (typeof payload === "string") {
    return { matchId: payload, lastVersion: null };
  }
  if (!payload || typeof payload !== "object") {
    return { matchId: "", lastVersion: null };
  }
  const matchId = typeof payload.matchId === "string" ? payload.matchId : "";
  const rawVersion = payload.lastVersion;
  const lastVersion =
    typeof rawVersion === "number"
      ? rawVersion
      : typeof rawVersion === "string"
        ? Number(rawVersion)
        : null;
  return {
    matchId,
    lastVersion: Number.isFinite(lastVersion) ? lastVersion : null,
  };
}

async function syncSnapshot(socket: Socket, matchId: string, lastVersion: number | null) {
  if (!matchId || lastVersion === null) return;
  try {
    const db = await getDb();
    await ensureScoringIndexes(db);
    const doc = await getLatestSnapshotDoc(db, matchId);
    if (!doc) return;
    const snapshot = serializeSnapshotDoc(doc);
    const version = Number(snapshot.version || doc.last_event_seq || 0);
    if (!Number.isFinite(version) || version <= lastVersion) return;
    socket.emit("snapshotUpdated", { matchId, version, snapshot });
  } catch {
    // ignore sync errors; client will refetch if needed
  }
}

export default function handler(req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (!res.socket.server.io) {
    const io = new Server(res.socket.server, {
      path: "/api/socket",
      cors: { origin: "*" },
    });
    res.socket.server.io = io;
    setSocketServer(io);
    io.on("connection", (socket) => {
      const handleJoin = (payload: SocketJoinPayload | string) => {
        const { matchId, lastVersion } = parseJoinPayload(payload);
        if (!matchId) return;
        socket.join(`match:${matchId}`);
        void syncSnapshot(socket, matchId, lastVersion);
      };
      const handleLeave = (payload: SocketJoinPayload | string) => {
        const { matchId } = parseJoinPayload(payload);
        if (matchId) socket.leave(`match:${matchId}`);
      };

      socket.on("joinMatch", handleJoin);
      socket.on("syncMatch", handleJoin);
      socket.on("leaveMatch", handleLeave);
    });
  }
  res.end();
}
