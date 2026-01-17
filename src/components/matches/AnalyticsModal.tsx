"use client";

import styles from "./AnalyticsModal.module.css";
import { useMemo } from "react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  runsPerOver: number[];
  oversConfig: number;
  target?: number | null;
  currentScore: number;
  currentOver: number;
};

export default function AnalyticsModal({
  isOpen,
  onClose,
  runsPerOver = [],
  oversConfig,
  target,
  currentScore,
  currentOver,
}: Props) {
  if (!isOpen) return null;

  // --- Manhattan Data ---
  // Ensure we have at least 'currentOver' bars, even if 0 runs
  const manhattanData = useMemo(() => {
     return runsPerOver;
  }, [runsPerOver]);

  const maxBarValue = Math.max(Math.max(...manhattanData, 0), 10); // Minimum scale of 10

  // --- Worm Data ---
  const wormData = useMemo(() => {
    let sum = 0;
    return manhattanData.map((r) => {
      sum += r;
      return sum;
    });
  }, [manhattanData]);

  const maxWormY = Math.max(target || 0, currentScore, 50); // Min scale 50
  // X axis is total overs config (or current over + 5 if unlimited, but config usually exists)
  const maxWormX = Math.max(oversConfig, manhattanData.length, 5); 

  // Helpers for SVG Scale
  // ViewBox: 0 0 300 150
  const VB_W = 300;
  const VB_H = 150;

  const getWormPoint = (overIndex: number, runs: number) => {
    // overIndex 0 = end of over 1.
    // Start at (0, 0)
    const x = ((overIndex + 1) / maxWormX) * VB_W;
    const y = VB_H - (runs / maxWormY) * VB_H;
    return `${x},${y}`;
  };

  const wormPoints = useMemo(() => {
    const start = `0,${VB_H}`; // 0,0 runs
    const points = wormData.map((val, i) => getWormPoint(i, val)).join(" ");
    return `${start} ${points}`;
  }, [wormData, maxWormX, maxWormY]);

  const targetLine = useMemo(() => {
    if (!target) return null;
    const x2 = VB_W; // at max overs
    const y2 = VB_H - (target / maxWormY) * VB_H;
    return { x1: 0, y1: VB_H, x2, y2 };
  }, [target, maxWormY]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Match Analysis</span>
          <button className={styles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Manhattan Chart */}
        <div className={styles.chartSection}>
          <div className={styles.chartHeader}>Runs per Over (Manhattan)</div>
          <div className={styles.chart}>
             <svg viewBox={`0 0 ${manhattanData.length * 20} 100`} preserveAspectRatio="none" width="100%" height="100%">
                {manhattanData.map((runs, i) => {
                    // height is percentage of maxBarValue
                    const h = (runs / maxBarValue) * 100;
                    return (
                        <g key={i}>
                            <rect 
                                x={i * 20 + 2} 
                                y={100 - h} 
                                width={16} 
                                height={Math.max(h, 1)} // Min height 1 to show 0? No, 0 is 0.
                                className={styles.bar}
                                fillOpacity={0.8}
                            />
                            {runs > 0 && (
                                <text 
                                    x={i * 20 + 10} 
                                    y={100 - h - 2} 
                                    className={styles.barLabel}
                                >
                                    {runs}
                                </text>
                            )}
                        </g>
                    );
                })}
             </svg>
          </div>
        </div>

        {/* Worm Chart */}
        <div className={styles.chartSection}>
          <div className={styles.chartHeader}>Run Rate Comparison (Worm)</div>
          <div className={styles.chart}>
            <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" width="100%" height="100%">
               {/* Grid */}
               <line x1="0" y1={VB_H} x2={VB_W} y2={VB_H} className={styles.axisLine} />
               <line x1="0" y1="0" x2="0" y2={VB_H} className={styles.axisLine} />
               
               {/* Target Line */}
               {targetLine && (
                   <line 
                        x1={targetLine.x1} 
                        y1={targetLine.y1} 
                        x2={targetLine.x2} 
                        y2={targetLine.y2} 
                        className={styles.targetLine} 
                   />
               )}

               {/* Current Innings */}
               <polyline points={wormPoints} className={styles.wormLine} />
            </svg>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
            Solid: Current Innings {target ? "| Dashed: Target Rate" : ""}
          </div>
        </div>

      </div>
    </div>
  );
}
