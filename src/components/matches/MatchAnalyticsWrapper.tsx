"use client";

import { useState } from "react";
import AnalyticsModal from "@/components/matches/AnalyticsModal";

type Props = {
  runsPerOver: number[];
  oversConfig: number;
  target?: number | null;
  currentScore: number;
  currentOver: number;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
};

export default function MatchAnalyticsWrapper({
  runsPerOver,
  oversConfig,
  target,
  currentScore,
  currentOver,
  label = "View Analysis",
  className,
  style,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        style={style}
        onClick={() => setIsOpen(true)}
      >
        {label}
      </button>

      <AnalyticsModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        runsPerOver={runsPerOver}
        oversConfig={oversConfig}
        target={target}
        currentScore={currentScore}
        currentOver={currentOver}
      />
    </>
  );
}
