import type { Server as SocketIOServer } from "socket.io";
import type { SocketBallAddedPayload, SocketSnapshotUpdatedPayload } from "@/lib/socket-events";

type SocketGlobal = typeof globalThis & {
  _sscIo?: SocketIOServer;
};

export function setSocketServer(io: SocketIOServer) {
  (globalThis as SocketGlobal)._sscIo = io;
}

export function getSocketServer() {
  return (globalThis as SocketGlobal)._sscIo;
}

function emitToMatch(matchId: string, event: string, payload: Record<string, any>) {
  const io = getSocketServer();
  if (!io) return false;
  io.to(`match:${matchId}`).emit(event, payload);
  return true;
}

export function emitSnapshotUpdate(matchId: string, payload: SocketSnapshotUpdatedPayload) {
  return emitToMatch(matchId, "snapshotUpdated", payload);
}

export function emitBallAdded(matchId: string, payload: SocketBallAddedPayload) {
  return emitToMatch(matchId, "ballAdded", payload);
}
