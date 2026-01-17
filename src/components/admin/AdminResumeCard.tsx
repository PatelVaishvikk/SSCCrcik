"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "@/app/admin/admin.module.css";

type ResumeState = {
  path: string;
  label: string;
  timeLabel?: string;
};

function formatResumeTime(value: string | null) {
  if (!value) return undefined;
  const timestamp = Number(value);
  if (Number.isNaN(timestamp)) return undefined;
  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminResumeCard() {
  const [resume, setResume] = useState<ResumeState | null>(null);

  useEffect(() => {
    const path = localStorage.getItem("ssc_last_admin_path");
    const label = localStorage.getItem("ssc_last_admin_label");
    if (!path || !label) {
      setResume(null);
      return;
    }
    const timeLabel = formatResumeTime(
      localStorage.getItem("ssc_last_admin_time")
    );
    setResume({
      path,
      label,
      timeLabel,
    });
  }, []);

  const clearResume = () => {
    localStorage.removeItem("ssc_last_admin_path");
    localStorage.removeItem("ssc_last_admin_label");
    localStorage.removeItem("ssc_last_admin_time");
    setResume(null);
  };

  if (!resume) return null;

  return (
    <div className={`card emphasis ${styles.resumeCard}`}>
      <div className={styles.resumeCopy}>
        <span className="kicker">Resume</span>
        <h2 className={styles.resumeTitle}>Continue where you left off</h2>
        <p className={`text-muted ${styles.resumeMeta}`}>
          {resume.label}
          {resume.timeLabel ? ` • ${resume.timeLabel}` : ""}
        </p>
      </div>
      <div className={styles.resumeActions}>
        <Link className="pill" href={resume.path}>
          Open {resume.label}
        </Link>
        <button className="pill" type="button" onClick={clearResume}>
          Clear resume
        </button>
      </div>
    </div>
  );
}
