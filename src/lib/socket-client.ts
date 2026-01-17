import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;
let socketPromise: Promise<Socket> | null = null;

export async function getSocketClient() {
  if (socket) return socket;
  if (!socketPromise) {
    socketPromise = fetch("/api/socket").then(() => {
      socket = io({ path: "/api/socket" });
      socketPromise = null;
      return socket;
    });
  }
  return socketPromise;
}
