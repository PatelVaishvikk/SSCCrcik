"use client";

import dynamic from "next/dynamic";

const LiveMatchesBoard = dynamic(() => import("./LiveMatchesBoard"), {
  ssr: false,
  loading: () => <span className="text-muted">Loading live matches...</span>,
});

export default function LiveMatchesBoardClient() {
  return <LiveMatchesBoard />;
}
