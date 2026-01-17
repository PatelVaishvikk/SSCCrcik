"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type PlayerPreview = {
  id: string;
  name: string;
  city?: string;
  role?: string;
  tournaments: number;
  photo?: string;
};

const PAGE_SIZE = 24;

export default function PlayerDirectory({
  initialPlayers = [],
  initialTotal = 0,
}: {
  initialPlayers?: PlayerPreview[];
  initialTotal?: number;
}) {
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<PlayerPreview[]>(initialPlayers);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const requestId = useRef(0);

  const fetchPlayers = async ({ reset }: { reset: boolean }) => {
    const currentId = ++requestId.current;
    const offset = reset ? 0 : page * PAGE_SIZE;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      const res = await fetch(`/api/public/players?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || currentId !== requestId.current) return;
      setPlayers((prev) => (reset ? data.players || [] : [...prev, ...(data.players || [])]));
      setTotal(Number(data.total || 0));
      setHasMore(Boolean(data.hasMore));
    } finally {
      if (currentId === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    const handle = setTimeout(() => {
      setPage(0);
      fetchPlayers({ reset: true });
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (page === 0) return;
    fetchPlayers({ reset: false });
  }, [page]);

  useEffect(() => {
    if (!initialPlayers.length) {
      fetchPlayers({ reset: true });
    } else {
      setHasMore(initialPlayers.length < initialTotal);
    }
  }, []);

  return (
    <div className="list">
      <div className="card">
        <div className="list">
          <span className="pill">Search players</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by player name"
            className="search-input"
            aria-label="Search players"
          />
          <span className="text-muted">
            Showing {players.length} of {total || "?"}
          </span>
        </div>
      </div>
      <div className="grid three">
        {players.map((player) => (
          <Link key={player.id} href={`/players/${player.id}`} className="card">
            <div className="list">
              <div className="player-row">
                <div
                  className="avatar"
                  style={
                    player.photo ? { backgroundImage: `url(${player.photo})` } : undefined
                  }
                />
                <div className="list">
                  <strong>{player.name}</strong>
                  <span className="text-muted">{player.city || ""}</span>
                </div>
              </div>
              <div className="grid two">
                <div className="stat">
                  <span className="stat-value">{player.tournaments}</span>
                  <span className="stat-label">Tournaments</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{player.role || "-"}</span>
                  <span className="stat-label">Role</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {hasMore ? (
        <button
          className="pill"
          type="button"
          onClick={() => setPage((value) => value + 1)}
          disabled={loading}
        >
          {loading ? "Loading..." : "Load more players"}
        </button>
      ) : null}
    </div>
  );
}
