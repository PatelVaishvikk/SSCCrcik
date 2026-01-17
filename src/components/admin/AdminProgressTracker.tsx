"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const stageMap: Record<string, string> = {
  "/admin/tournaments": "Tournament Builder",
  "/admin/teams": "Team Builder",
  "/admin/matches": "Match Control",
  "/admin/players": "Player Assignment",
  "/admin/scoring": "Smart Scoring",
  "/admin/scoring-v2": "Scoring Console",
};

export default function AdminProgressTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/admin")) return;
    if (pathname === "/admin" || pathname === "/admin/login") return;
    const label = stageMap[pathname] || "Admin";
    localStorage.setItem("ssc_last_admin_path", pathname);
    localStorage.setItem("ssc_last_admin_label", label);
    localStorage.setItem("ssc_last_admin_time", Date.now().toString());
  }, [pathname]);

  return null;
}
