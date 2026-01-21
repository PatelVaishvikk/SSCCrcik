/**
 * Performance Metrics Module - World's Best Scoring Engine
 * Provides detailed performance metrics for batters and bowlers.
 */

import type { BallSummary, BattingLine, BowlingLine } from "./types";

// ============================================================================
// TYPES
// ============================================================================

export type BatterMetrics = {
    playerId: string;
    playerName: string;
    runs: number;
    balls: number;
    fours: number;
    sixes: number;
    strikeRate: string;
    dotBallPercent: number;
    boundaryPercent: number;
    runsByPhase: {
        powerplay: { runs: number; balls: number; sr: string };
        middle: { runs: number; balls: number; sr: string };
        death: { runs: number; balls: number; sr: string };
    };
    scoringShots: number;
    controlPercent: number;
};

export type BowlerMetrics = {
    playerId: string;
    playerName: string;
    overs: string;
    maidens: number;
    runs: number;
    wickets: number;
    economy: string;
    dotBallPercent: number;
    boundaryPercent: number;
    economyByPhase: {
        powerplay: { runs: number; balls: number; economy: string };
        middle: { runs: number; balls: number; economy: string };
        death: { runs: number; balls: number; economy: string };
    };
    averagePerWicket: string;
    strikeRate: string;
};

export type MatchMetrics = {
    totalDotBalls: number;
    totalBoundaries: number;
    totalExtras: number;
    runRateProgression: number[];
    wicketIntervals: number[];
    partnershipBreakdown: Array<{
        runs: number;
        balls: number;
        batter1: string;
        batter2: string;
    }>;
};

// ============================================================================
// PHASE DETECTION
// ============================================================================

function getPhase(balls: number, totalOvers: number): "powerplay" | "middle" | "death" {
    const overs = balls / 6;
    if (totalOvers <= 10) {
        if (overs < 2) return "powerplay";
        if (overs < 7) return "middle";
        return "death";
    } else if (totalOvers <= 20) {
        if (overs < 6) return "powerplay";
        if (overs < 15) return "middle";
        return "death";
    } else {
        if (overs < 10) return "powerplay";
        if (overs < 40) return "middle";
        return "death";
    }
}

// ============================================================================
// BATTER METRICS
// ============================================================================

export function calculateBatterMetrics(
    playerId: string,
    playerName: string,
    balls: BallSummary[],
    totalOvers: number
): BatterMetrics {
    const playerBalls = balls.filter(b =>
        b.isLegal // Only count balls faced by this batter
    );

    // For now, assume all balls in the array are for this batter
    // In a real implementation, we'd filter by striker_id
    const legalBalls = balls.filter(b => b.isLegal);
    const runs = legalBalls.reduce((sum, b) => sum + b.totalRuns, 0);
    const fours = legalBalls.filter(b => b.totalRuns === 4).length;
    const sixes = legalBalls.filter(b => b.totalRuns >= 6).length;
    const dots = legalBalls.filter(b => b.totalRuns === 0).length;
    const scoringShots = legalBalls.filter(b => b.totalRuns > 0).length;

    const strikeRate = legalBalls.length > 0
        ? ((runs / legalBalls.length) * 100).toFixed(1)
        : "0.0";
    const dotBallPercent = legalBalls.length > 0
        ? Math.round((dots / legalBalls.length) * 100)
        : 0;
    const boundaryPercent = legalBalls.length > 0
        ? Math.round(((fours + sixes) / legalBalls.length) * 100)
        : 0;
    const controlPercent = legalBalls.length > 0
        ? Math.round((scoringShots / legalBalls.length) * 100)
        : 0;

    // Phase breakdown
    const phases = {
        powerplay: { runs: 0, balls: 0 },
        middle: { runs: 0, balls: 0 },
        death: { runs: 0, balls: 0 },
    };

    let cumulativeBalls = 0;
    legalBalls.forEach(b => {
        cumulativeBalls++;
        const phase = getPhase(cumulativeBalls, totalOvers);
        phases[phase].runs += b.totalRuns;
        phases[phase].balls++;
    });

    const formatPhaseSR = (p: { runs: number; balls: number }) => ({
        ...p,
        sr: p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(1) : "0.0",
    });

    return {
        playerId,
        playerName,
        runs,
        balls: legalBalls.length,
        fours,
        sixes,
        strikeRate,
        dotBallPercent,
        boundaryPercent,
        runsByPhase: {
            powerplay: formatPhaseSR(phases.powerplay),
            middle: formatPhaseSR(phases.middle),
            death: formatPhaseSR(phases.death),
        },
        scoringShots,
        controlPercent,
    };
}

// ============================================================================
// BOWLER METRICS
// ============================================================================

export function calculateBowlerMetrics(
    playerId: string,
    playerName: string,
    stats: BowlingLine,
    balls: BallSummary[],
    totalOvers: number
): BowlerMetrics {
    const legalBalls = balls.filter(b => b.isLegal);
    const dots = legalBalls.filter(b => b.totalRuns === 0).length;
    const boundaries = legalBalls.filter(b => b.totalRuns >= 4).length;

    const overs = Math.floor(stats.balls / 6);
    const remainingBalls = stats.balls % 6;
    const oversStr = `${overs}.${remainingBalls}`;

    const economy = stats.balls > 0
        ? (stats.runs / (stats.balls / 6)).toFixed(2)
        : "0.00";
    const dotBallPercent = legalBalls.length > 0
        ? Math.round((dots / legalBalls.length) * 100)
        : 0;
    const boundaryPercent = legalBalls.length > 0
        ? Math.round((boundaries / legalBalls.length) * 100)
        : 0;
    const averagePerWicket = stats.wickets > 0
        ? (stats.runs / stats.wickets).toFixed(1)
        : "-";
    const strikeRate = stats.wickets > 0
        ? (stats.balls / stats.wickets).toFixed(1)
        : "-";

    // Phase breakdown
    const phases = {
        powerplay: { runs: 0, balls: 0 },
        middle: { runs: 0, balls: 0 },
        death: { runs: 0, balls: 0 },
    };

    let cumulativeBalls = 0;
    legalBalls.forEach(b => {
        cumulativeBalls++;
        const phase = getPhase(cumulativeBalls, totalOvers);
        phases[phase].runs += b.totalRuns;
        phases[phase].balls++;
    });

    const formatPhaseEcon = (p: { runs: number; balls: number }) => ({
        ...p,
        economy: p.balls > 0 ? (p.runs / (p.balls / 6)).toFixed(2) : "0.00",
    });

    return {
        playerId,
        playerName,
        overs: oversStr,
        maidens: stats.maidens || 0,
        runs: stats.runs,
        wickets: stats.wickets,
        economy,
        dotBallPercent,
        boundaryPercent,
        economyByPhase: {
            powerplay: formatPhaseEcon(phases.powerplay),
            middle: formatPhaseEcon(phases.middle),
            death: formatPhaseEcon(phases.death),
        },
        averagePerWicket,
        strikeRate,
    };
}

// ============================================================================
// MATCH METRICS
// ============================================================================

export function calculateMatchMetrics(
    balls: BallSummary[],
    runsPerOver: number[]
): MatchMetrics {
    const legalBalls = balls.filter(b => b.isLegal);

    const totalDotBalls = legalBalls.filter(b => b.totalRuns === 0).length;
    const totalBoundaries = legalBalls.filter(b => b.totalRuns >= 4).length;
    const totalExtras = balls.filter(b => b.extraType).length;

    // Run rate progression (cumulative run rate after each over)
    const runRateProgression: number[] = [];
    let totalRuns = 0;
    runsPerOver.forEach((runs, index) => {
        totalRuns += runs;
        const overs = index + 1;
        runRateProgression.push(Math.round((totalRuns / overs) * 100) / 100);
    });

    // Wicket intervals (balls between wickets)
    const wicketIntervals: number[] = [];
    let ballsSinceLastWicket = 0;
    balls.forEach(b => {
        if (b.isLegal) ballsSinceLastWicket++;
        if (b.isWicket) {
            wicketIntervals.push(ballsSinceLastWicket);
            ballsSinceLastWicket = 0;
        }
    });

    return {
        totalDotBalls,
        totalBoundaries,
        totalExtras,
        runRateProgression,
        wicketIntervals,
        partnershipBreakdown: [], // Would need partnership tracking data
    };
}

// ============================================================================
// COMPARISON METRICS
// ============================================================================

export type TeamComparison = {
    runRate: { team1: string; team2: string };
    boundaries: { team1: number; team2: number };
    dotBalls: { team1: number; team2: number };
    extras: { team1: number; team2: number };
    powerplayScore: { team1: string; team2: string };
};

export function compareTeams(
    team1Balls: BallSummary[],
    team2Balls: BallSummary[],
    totalOvers: number
): TeamComparison {
    const calc = (balls: BallSummary[]) => {
        const legal = balls.filter(b => b.isLegal);
        const runs = legal.reduce((sum, b) => sum + b.totalRuns, 0);
        return {
            runs,
            balls: legal.length,
            boundaries: legal.filter(b => b.totalRuns >= 4).length,
            dots: legal.filter(b => b.totalRuns === 0).length,
            extras: balls.filter(b => b.extraType).length,
        };
    };

    const t1 = calc(team1Balls);
    const t2 = calc(team2Balls);

    // Calculate powerplay (first 6 overs for T20)
    const ppBalls = totalOvers <= 20 ? 36 : 60;
    const t1PP = calc(team1Balls.filter((_, i) => i < ppBalls));
    const t2PP = calc(team2Balls.filter((_, i) => i < ppBalls));

    return {
        runRate: {
            team1: t1.balls > 0 ? (t1.runs / (t1.balls / 6)).toFixed(2) : "0.00",
            team2: t2.balls > 0 ? (t2.runs / (t2.balls / 6)).toFixed(2) : "0.00",
        },
        boundaries: { team1: t1.boundaries, team2: t2.boundaries },
        dotBalls: { team1: t1.dots, team2: t2.dots },
        extras: { team1: t1.extras, team2: t2.extras },
        powerplayScore: {
            team1: `${t1PP.runs}/${team1Balls.slice(0, ppBalls).filter(b => b.isWicket).length}`,
            team2: `${t2PP.runs}/${team2Balls.slice(0, ppBalls).filter(b => b.isWicket).length}`,
        },
    };
}
