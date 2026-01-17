"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import styles from "./GlobalSearch.module.css";

type PlayerResult = {
  id: string;
  name: string;
  city: string;
  role: string;
  photo: string;
  tournaments: number;
  source: string;
};

type TeamResult = {
  id: string;
  name: string;
  shortName: string;
  tournamentId: string;
  tournamentName: string;
  tournamentYear: number | null;
  tournamentFormat: string;
};

type TournamentResult = {
  id: string;
  name: string;
  year: number | null;
  format: string;
  status: string;
};

type SearchResults = {
  players: PlayerResult[];
  teams: TeamResult[];
  tournaments: TournamentResult[];
};

const EMPTY_RESULTS: SearchResults = {
  players: [],
  teams: [],
  tournaments: [],
};

const FORMAT_LABELS: Record<string, string> = {
  LEAGUE: "League",
  KNOCKOUT: "Knockout",
  GROUP_KNOCKOUT: "Group + Knockout",
  BOX: "Box cricket",
};

export default function GlobalSearch({ isAdmin = false }: { isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ season: "", city: "", format: "" });
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [keyHint, setKeyHint] = useState("Ctrl K");
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const filtersActive = Boolean(
    query.trim() || filters.season.trim() || filters.city.trim() || filters.format
  );

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (navigator.platform?.toLowerCase().includes("mac")) {
      setKeyHint("Cmd K");
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key?.toLowerCase();
      if (!key) return;
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (key === "escape" && open) {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!filtersActive) {
      setResults(EMPTY_RESULTS);
      setError("");
      setLoading(false);
      return;
    }

    const currentId = ++requestId.current;
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (filters.city.trim()) params.set("city", filters.city.trim());
        if (filters.season.trim()) params.set("season", filters.season.trim());
        if (filters.format) params.set("format", filters.format);
        params.set("limit", "6");
        const res = await fetch(`/api/public/search?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (currentId !== requestId.current) return;
        if (!res.ok) {
          setError(data.error || "Search failed.");
          setResults(EMPTY_RESULTS);
          return;
        }
        setResults(data.results || EMPTY_RESULTS);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        if (currentId !== requestId.current) return;
        setError("Search failed.");
      } finally {
        if (currentId === requestId.current) setLoading(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [open, query, filters, filtersActive]);

  const formattedFilters = useMemo(() => {
    const season = filters.season.trim();
    const city = filters.city.trim();
    const format = filters.format ? FORMAT_LABELS[filters.format] || filters.format : "";
    return { season, city, format };
  }, [filters]);

  const close = () => setOpen(false);

  const renderResult = (
    itemKey: string,
    content: ReactNode,
    href?: string,
    disabled?: boolean
  ) => {
    if (href && !disabled) {
      return (
        <Link
          key={itemKey}
          href={href}
          className={styles.resultItem}
          onClick={close}
          prefetch={false}
        >
          {content}
        </Link>
      );
    }
    return (
      <div key={itemKey} className={`${styles.resultItem} ${styles.resultDisabled}`}>
        {content}
      </div>
    );
  };

  const hasResults =
    results.players.length || results.teams.length || results.tournaments.length;

  return (
    <>
      <button
        type="button"
        className={`${styles.trigger} search-input`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="Open search"
      >
        <span className={styles.triggerLabel}>Search players, teams, tournaments</span>
        <span className={styles.triggerHint}>{keyHint}</span>
      </button>
      {open ? (
        <div
          className={styles.backdrop}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              close();
            }
          }}
          role="presentation"
        >
          <div
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.header}>
              <input
                ref={inputRef}
                className={`${styles.searchInput} search-input`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search players, teams, tournaments"
                aria-label="Search"
              />
              <button type="button" className="pill" onClick={close}>
                Close
              </button>
            </div>
            <div className={styles.filters}>
              <div className={styles.filterGroup}>
                <label htmlFor="search-season">Season</label>
                <input
                  id="search-season"
                  className="search-input"
                  placeholder="Year"
                  value={filters.season}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, season: event.target.value }))
                  }
                />
              </div>
              <div className={styles.filterGroup}>
                <label htmlFor="search-city">City</label>
                <input
                  id="search-city"
                  className="search-input"
                  placeholder="Filter by city"
                  value={filters.city}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, city: event.target.value }))
                  }
                />
              </div>
              <div className={styles.filterGroup}>
                <label htmlFor="search-format">Format</label>
                <select
                  id="search-format"
                  className="search-input"
                  value={filters.format}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, format: event.target.value }))
                  }
                >
                  <option value="">All formats</option>
                  <option value="LEAGUE">League</option>
                  <option value="KNOCKOUT">Knockout</option>
                  <option value="GROUP_KNOCKOUT">Group + Knockout</option>
                  <option value="BOX">Box cricket</option>
                </select>
              </div>
              <button
                type="button"
                className={styles.clearFilters}
                onClick={() => setFilters({ season: "", city: "", format: "" })}
                disabled={!filters.season && !filters.city && !filters.format}
              >
                Clear filters
              </button>
            </div>
            <div className={styles.results}>
              {loading ? <div className={styles.notice}>Searching...</div> : null}
              {error ? <div className={styles.notice}>{error}</div> : null}
              {!loading && !error && !filtersActive ? (
                <div className={styles.notice}>Start typing to search.</div>
              ) : null}
              {!loading && !error && filtersActive && !hasResults ? (
                <div className={styles.notice}>No matches found.</div>
              ) : null}
              {results.players.length ? (
                <div className={styles.group}>
                  <div className={styles.groupTitle}>Players</div>
                  <div className={styles.groupList}>
                    {results.players.map((player) => {
                      const href = player.source === "global" ? `/players/${player.id}` : "";
                      const meta = [player.city, player.role].filter(Boolean).join(" • ");
                      return renderResult(
                        player.id,
                        <div className={styles.resultBody}>
                          <div>
                            <strong>{player.name}</strong>
                            <div className={styles.resultMeta}>
                              {meta || "Player"}
                            </div>
                          </div>
                          <span className={styles.tag}>
                            {player.source === "custom" ? "Custom" : "Profile"}
                          </span>
                        </div>,
                        href,
                        player.source !== "global"
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {results.teams.length ? (
                <div className={styles.group}>
                  <div className={styles.groupTitle}>Teams</div>
                  <div className={styles.groupList}>
                    {results.teams.map((team) => {
                      const meta = [
                        team.tournamentName,
                        team.tournamentYear ? String(team.tournamentYear) : "",
                      ]
                        .filter(Boolean)
                        .join(" • ");
                      const href = isAdmin ? "/admin/teams" : "";
                      return renderResult(
                        team.id,
                        <div className={styles.resultBody}>
                          <div>
                            <strong>{team.name}</strong>
                            <div className={styles.resultMeta}>
                              {meta || "Team"}
                            </div>
                          </div>
                          <span className={styles.tag}>
                            {team.shortName || "Team"}
                          </span>
                        </div>,
                        href,
                        !isAdmin
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {results.tournaments.length ? (
                <div className={styles.group}>
                  <div className={styles.groupTitle}>Tournaments</div>
                  <div className={styles.groupList}>
                    {results.tournaments.map((tournament) => {
                      const formatLabel =
                        FORMAT_LABELS[tournament.format] || tournament.format || "Format";
                      const meta = [
                        tournament.year ? String(tournament.year) : "",
                        formatLabel,
                      ]
                        .filter(Boolean)
                        .join(" • ");
                      const href = isAdmin
                        ? `/admin/matches?tournamentId=${tournament.id}`
                        : `/tournaments/${tournament.year || "2026"}`;
                      return renderResult(
                        tournament.id,
                        <div className={styles.resultBody}>
                          <div>
                            <strong>{tournament.name}</strong>
                            <div className={styles.resultMeta}>
                              {meta || "Tournament"}
                            </div>
                          </div>
                          <span className={styles.tag}>
                            {tournament.status || "Managed"}
                          </span>
                        </div>,
                        href,
                        false
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {filtersActive && hasResults ? (
                <div className={styles.activeFilters}>
                  {formattedFilters.season ? (
                    <span>Season: {formattedFilters.season}</span>
                  ) : null}
                  {formattedFilters.city ? <span>City: {formattedFilters.city}</span> : null}
                  {formattedFilters.format ? (
                    <span>Format: {formattedFilters.format}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
