/**
 * Live Analytics Engine - World's Best Scoring Engine
 * Provides real-time win probability, pressure index, momentum tracking,
 * projected scores, and phase analysis.
 */

import type { BallSummary, MatchSnapshot } from "./types";

// ============================================================================
// TYPES
// ============================================================================

export type WinProbability = {
    battingTeam: number;
    bowlingTeam: number;
    confidence: "high" | "medium" | "low";
};

export type PressureIndex = {
    value: number; // 0-100
    level: "low" | "moderate" | "high" | "extreme";
    factors: string[];
};

export type Momentum = {
    direction: "batting" | "bowling" | "neutral";
    strength: number; // 0-100
    trend: "rising" | "falling" | "stable";
    lastNBalls: number;
};

export type PhaseAnalysis = {
    powerplay: { runs: number; wickets: number; balls: number; runRate: string };
    middle: { runs: number; wickets: number; balls: number; runRate: string };
    death: { runs: number; wickets: number; balls: number; runRate: string };
    currentPhase: "powerplay" | "middle" | "death";
};

export type ProjectedScore = {
    conservative: number;
    predicted: number;
    aggressive: number;
    confidence: number; // 0-100
};

export type LiveAnalytics = {
    winProbability: WinProbability;
    pressureIndex: PressureIndex;
    momentum: Momentum;
    projectedScore: ProjectedScore;
    phaseAnalysis: PhaseAnalysis;
    dotBallPercent: number;
    boundaryPercent: number;
    scoringRate: number[];
    requiredRate: string | null;
    runRateComparison: {
        current: string;
        required: string | null;
        difference: string | null;
    };
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function getPhase(balls: number, totalOvers: number): "powerplay" | "middle" | "death" {
    const overs = balls / 6;
    if (totalOvers <= 10) {
        // Short format (T10)
        if (overs < 2) return "powerplay";
        if (overs < 7) return "middle";
        return "death";
    } else if (totalOvers <= 20) {
        // T20 format
        if (overs < 6) return "powerplay";
        if (overs < 15) return "middle";
        return "death";
    } else {
        // ODI/longer format
        if (overs < 10) return "powerplay";
        if (overs < 40) return "middle";
        return "death";
    }
}

// ============================================================================
// WIN PROBABILITY
// ============================================================================

export function calculateWinProbability(
    runs: number,
    wickets: number,
    balls: number,
    target: number | null,
    totalOvers: number,
    isSecondInnings: boolean,
    wicketsLimit?: number
): WinProbability {
    if (!isSecondInnings || !target) {
        // First innings: can't calculate win probability meaningfully
        return { battingTeam: 50, bowlingTeam: 50, confidence: "low" };
    }

    const totalBalls = totalOvers * 6;
    const ballsRemaining = Math.max(0, totalBalls - balls);
    const runsNeeded = Math.max(0, target - runs);
    const limit = typeof wicketsLimit === "number" && wicketsLimit > 0 ? wicketsLimit : 10;
    const wicketsInHand = Math.max(limit - wickets, 0);

    if (runsNeeded <= 0) {
        return { battingTeam: 100, bowlingTeam: 0, confidence: "high" };
    }

    if (wicketsInHand <= 0 || ballsRemaining <= 0) {
        return { battingTeam: 0, bowlingTeam: 100, confidence: "high" };
    }

    // Calculate required run rate
    const requiredRate = runsNeeded / (ballsRemaining / 6);
    const currentRate = balls > 0 ? runs / (balls / 6) : 0;

    // Base probability factors
    let battingProb = 50;

    // Factor 1: Run rate comparison (-30 to +30)
    const rateRatio = currentRate / Math.max(requiredRate, 0.1);
    battingProb += clamp((rateRatio - 1) * 30, -30, 30);

    // Factor 2: Wickets in hand (-25 to +15)
    const wicketFactor = (wicketsInHand - 5) * 5;
    battingProb += clamp(wicketFactor, -25, 15);

    // Factor 3: Balls remaining (-15 to +15)
    const ballsFactor = ((ballsRemaining / totalBalls) - 0.5) * 30;
    battingProb += clamp(ballsFactor, -15, 15);

    // Factor 4: Runs needed per ball difficulty
    const runsPerBall = runsNeeded / ballsRemaining;
    if (runsPerBall > 2.5) battingProb -= 20;
    else if (runsPerBall > 2) battingProb -= 10;
    else if (runsPerBall > 1.5) battingProb -= 5;
    else if (runsPerBall < 0.5) battingProb += 10;
    else if (runsPerBall < 1) battingProb += 5;

    battingProb = clamp(battingProb, 1, 99);
    const bowlingProb = 100 - battingProb;

    // Confidence based on match progression
    let confidence: "high" | "medium" | "low";
    const matchProgress = balls / totalBalls;
    if (matchProgress > 0.7) confidence = "high";
    else if (matchProgress > 0.4) confidence = "medium";
    else confidence = "low";

    return {
        battingTeam: Math.round(battingProb),
        bowlingTeam: Math.round(bowlingProb),
        confidence,
    };
}

// ============================================================================
// PRESSURE INDEX
// ============================================================================

export function calculatePressureIndex(
    runs: number,
    wickets: number,
    balls: number,
    target: number | null,
    totalOvers: number,
    isSecondInnings: boolean,
    recentBalls: BallSummary[]
): PressureIndex {
    const factors: string[] = [];
    let pressure = 30; // Base pressure

    const totalBalls = totalOvers * 6;
    const ballsRemaining = Math.max(0, totalBalls - balls);
    const currentRate = balls > 0 ? runs / (balls / 6) : 0;

    if (isSecondInnings && target) {
        const runsNeeded = Math.max(0, target - runs);
        const requiredRate = ballsRemaining > 0 ? runsNeeded / (ballsRemaining / 6) : 999;

        // Required rate pressure
        if (requiredRate > 15) {
            pressure += 40;
            factors.push("Extreme required rate");
        } else if (requiredRate > 12) {
            pressure += 30;
            factors.push("Very high required rate");
        } else if (requiredRate > 10) {
            pressure += 20;
            factors.push("High required rate");
        } else if (requiredRate > 8) {
            pressure += 10;
            factors.push("Above average required rate");
        }

        // Close finish pressure
        if (runsNeeded <= 20 && ballsRemaining <= 12) {
            pressure += 25;
            factors.push("Close finish approaching");
        }
    }

    // Wickets pressure
    if (wickets >= 8) {
        pressure += 25;
        factors.push("Tail exposed");
    } else if (wickets >= 6) {
        pressure += 15;
        factors.push("Middle order depleted");
    } else if (wickets >= 4) {
        pressure += 5;
        factors.push("Several wickets down");
    }

    // Recent events pressure
    const lastSix = recentBalls.slice(-6);
    const recentWickets = lastSix.filter(b => b.isWicket).length;
    const recentDots = lastSix.filter(b => b.isLegal && b.totalRuns === 0).length;

    if (recentWickets >= 2) {
        pressure += 20;
        factors.push("Wickets falling quickly");
    } else if (recentWickets === 1) {
        pressure += 10;
        factors.push("Recent wicket");
    }

    if (recentDots >= 4) {
        pressure += 15;
        factors.push("Dot ball pressure building");
    }

    // Match phase pressure
    const phase = getPhase(balls, totalOvers);
    if (phase === "death" && isSecondInnings) {
        pressure += 10;
        factors.push("Death overs chase");
    }

    pressure = clamp(pressure, 0, 100);

    let level: PressureIndex["level"];
    if (pressure >= 80) level = "extreme";
    else if (pressure >= 60) level = "high";
    else if (pressure >= 40) level = "moderate";
    else level = "low";

    return { value: Math.round(pressure), level, factors };
}

// ============================================================================
// MOMENTUM TRACKER
// ============================================================================

export function calculateMomentum(recentBalls: BallSummary[], windowSize = 12): Momentum {
    const window = recentBalls.slice(-windowSize);

    if (window.length < 3) {
        return { direction: "neutral", strength: 50, trend: "stable", lastNBalls: window.length };
    }

    let battingScore = 0;
    let bowlingScore = 0;

    window.forEach((ball, index) => {
        const recency = (index + 1) / window.length; // More recent balls weighted higher

        if (ball.isWicket) {
            bowlingScore += 25 * recency;
        } else if (ball.totalRuns === 0 && ball.isLegal) {
            bowlingScore += 5 * recency;
        } else if (ball.totalRuns >= 6) {
            battingScore += 20 * recency;
        } else if (ball.totalRuns >= 4) {
            battingScore += 12 * recency;
        } else if (ball.totalRuns >= 2) {
            battingScore += 5 * recency;
        } else if (ball.totalRuns === 1) {
            battingScore += 2 * recency;
        }
    });

    const total = battingScore + bowlingScore;
    const normalizedBatting = total > 0 ? (battingScore / total) * 100 : 50;

    // Calculate trend by comparing first half to second half
    const halfPoint = Math.floor(window.length / 2);
    const firstHalf = window.slice(0, halfPoint);
    const secondHalf = window.slice(halfPoint);

    const firstHalfRuns = firstHalf.reduce((sum, b) => sum + b.totalRuns, 0);
    const secondHalfRuns = secondHalf.reduce((sum, b) => sum + b.totalRuns, 0);
    const firstHalfWickets = firstHalf.filter(b => b.isWicket).length;
    const secondHalfWickets = secondHalf.filter(b => b.isWicket).length;

    let trend: Momentum["trend"] = "stable";
    if (secondHalfRuns > firstHalfRuns * 1.3 && secondHalfWickets <= firstHalfWickets) {
        trend = "rising";
    } else if (secondHalfRuns < firstHalfRuns * 0.7 || secondHalfWickets > firstHalfWickets) {
        trend = "falling";
    }

    let direction: Momentum["direction"];
    if (normalizedBatting > 60) direction = "batting";
    else if (normalizedBatting < 40) direction = "bowling";
    else direction = "neutral";

    return {
        direction,
        strength: Math.round(Math.abs(normalizedBatting - 50) * 2),
        trend,
        lastNBalls: window.length,
    };
}

// ============================================================================
// PROJECTED SCORE
// ============================================================================

export function calculateProjectedScore(
    runs: number,
    wickets: number,
    balls: number,
    totalOvers: number
): ProjectedScore {
    const totalBalls = totalOvers * 6;
    const ballsRemaining = Math.max(0, totalBalls - balls);

    if (balls === 0) {
        return { conservative: 0, predicted: 0, aggressive: 0, confidence: 0 };
    }

    const currentRate = runs / (balls / 6);

    // Wicket deduction factor: lose approximately 2-3 runs per over for each additional wicket
    const wicketPenalty = wickets * 0.3;

    // Phase adjustment
    const phase = getPhase(balls, totalOvers);
    let phaseMultiplier = 1;
    if (phase === "powerplay") phaseMultiplier = 0.9; // Usually accelerates later
    else if (phase === "death") phaseMultiplier = 1.15; // Death overs usually higher scoring

    const adjustedRate = Math.max(0, currentRate - wicketPenalty) * phaseMultiplier;

    const projected = runs + (adjustedRate * (ballsRemaining / 6));
    const conservative = runs + ((adjustedRate * 0.75) * (ballsRemaining / 6));
    const aggressive = runs + ((adjustedRate * 1.3) * (ballsRemaining / 6));

    // Confidence based on balls faced
    const confidence = clamp((balls / totalBalls) * 100, 10, 95);

    return {
        conservative: Math.round(conservative),
        predicted: Math.round(projected),
        aggressive: Math.round(aggressive),
        confidence: Math.round(confidence),
    };
}

// ============================================================================
// PHASE ANALYSIS
// ============================================================================

export function calculatePhaseAnalysis(
    balls: BallSummary[],
    totalOvers: number
): PhaseAnalysis {
    const phases = {
        powerplay: { runs: 0, wickets: 0, balls: 0 },
        middle: { runs: 0, wickets: 0, balls: 0 },
        death: { runs: 0, wickets: 0, balls: 0 },
    };

    let cumulativeBalls = 0;
    balls.forEach((ball) => {
        if (ball.isLegal) cumulativeBalls++;
        const phase = getPhase(cumulativeBalls, totalOvers);
        phases[phase].runs += ball.totalRuns;
        if (ball.isWicket) phases[phase].wickets++;
        if (ball.isLegal) phases[phase].balls++;
    });

    const formatRate = (runs: number, balls: number) =>
        balls > 0 ? (runs / (balls / 6)).toFixed(2) : "0.00";

    const totalBalls = balls.filter(b => b.isLegal).length;
    const currentPhase = getPhase(totalBalls, totalOvers);

    return {
        powerplay: {
            ...phases.powerplay,
            runRate: formatRate(phases.powerplay.runs, phases.powerplay.balls),
        },
        middle: {
            ...phases.middle,
            runRate: formatRate(phases.middle.runs, phases.middle.balls),
        },
        death: {
            ...phases.death,
            runRate: formatRate(phases.death.runs, phases.death.balls),
        },
        currentPhase,
    };
}

// ============================================================================
// PERFORMANCE METRICS
// ============================================================================

export function calculateDotBallPercent(balls: BallSummary[]): number {
    const legalBalls = balls.filter(b => b.isLegal);
    if (legalBalls.length === 0) return 0;
    const dots = legalBalls.filter(b => b.totalRuns === 0).length;
    return Math.round((dots / legalBalls.length) * 100);
}

export function calculateBoundaryPercent(balls: BallSummary[]): number {
    const legalBalls = balls.filter(b => b.isLegal);
    if (legalBalls.length === 0) return 0;
    const boundaries = legalBalls.filter(b => b.totalRuns >= 4).length;
    return Math.round((boundaries / legalBalls.length) * 100);
}

export function calculateScoringRate(runsPerOver: number[]): number[] {
    // Return cumulative runs after each over
    const cumulative: number[] = [];
    let total = 0;
    runsPerOver.forEach((runs) => {
        total += runs;
        cumulative.push(total);
    });
    return cumulative;
}

// ============================================================================
// MAIN ANALYTICS FUNCTION
// ============================================================================

export function computeLiveAnalytics(params: {
    runs: number;
    wickets: number;
    balls: number;
    target: number | null;
    totalOvers: number;
    isSecondInnings: boolean;
    recentBalls: BallSummary[];
    allBalls: BallSummary[];
    runsPerOver: number[];
    wicketsLimit?: number;
}): LiveAnalytics {
    const {
        runs,
        wickets,
        balls,
        target,
        totalOvers,
        isSecondInnings,
        recentBalls,
        allBalls,
        runsPerOver,
    } = params;

    const winProbability = calculateWinProbability(
        runs, wickets, balls, target, totalOvers, isSecondInnings, params.wicketsLimit
    );

    const pressureIndex = calculatePressureIndex(
        runs, wickets, balls, target, totalOvers, isSecondInnings, recentBalls
    );

    const momentum = calculateMomentum(recentBalls);
    const projectedScore = calculateProjectedScore(runs, wickets, balls, totalOvers);
    const phaseAnalysis = calculatePhaseAnalysis(allBalls, totalOvers);
    const dotBallPercent = calculateDotBallPercent(allBalls);
    const boundaryPercent = calculateBoundaryPercent(allBalls);
    const scoringRate = calculateScoringRate(runsPerOver);

    // Required rate calculations
    const totalBalls = totalOvers * 6;
    const ballsRemaining = Math.max(0, totalBalls - balls);
    const runsNeeded = target ? Math.max(0, target - runs) : null;
    const requiredRate = runsNeeded !== null && ballsRemaining > 0
        ? (runsNeeded / (ballsRemaining / 6)).toFixed(2)
        : null;
    const currentRate = balls > 0 ? (runs / (balls / 6)).toFixed(2) : "0.00";

    let rateDifference: string | null = null;
    if (requiredRate) {
        const diff = parseFloat(currentRate) - parseFloat(requiredRate);
        rateDifference = diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
    }

    return {
        winProbability,
        pressureIndex,
        momentum,
        projectedScore,
        phaseAnalysis,
        dotBallPercent,
        boundaryPercent,
        scoringRate,
        requiredRate,
        runRateComparison: {
            current: currentRate,
            required: requiredRate,
            difference: rateDifference,
        },
    };
}
