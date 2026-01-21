/**
 * Auto-Commentary System - World's Best Scoring Engine
 * Provides context-aware ball-by-ball commentary, milestone detection,
 * and match situation awareness.
 */

import type { BallSummary, BattingLine, BowlingLine } from "./types";

// ============================================================================
// TYPES
// ============================================================================

export type CommentaryType =
    | "ball"
    | "milestone"
    | "wicket"
    | "boundary"
    | "over_summary"
    | "match_situation"
    | "pressure"
    | "partnership";

export type CommentaryEntry = {
    type: CommentaryType;
    text: string;
    priority: "high" | "medium" | "low";
    timestamp: string;
    seq?: number;
    highlight?: boolean;
};

export type MilestoneType =
    | "fifty"
    | "hundred"
    | "double_hundred"
    | "triple_hundred"
    | "five_wickets"
    | "ten_wickets"
    | "century_partnership"
    | "team_fifty"
    | "team_hundred"
    | "team_150"
    | "team_200";

export type Milestone = {
    type: MilestoneType;
    playerId?: string;
    playerName?: string;
    value: number;
    commentary: string;
};

// ============================================================================
// COMMENTARY TEMPLATES
// ============================================================================

const WICKET_TEMPLATES = [
    "{bowler} strikes! {batter} has to go back to the pavilion!",
    "Gone! {batter} is out! What a moment for {bowler}!",
    "That's the wicket! {batter} departs, {bowler} is ecstatic!",
    "Breakthrough! {bowler} removes {batter}!",
    "OUT! {batter} falls to {bowler}! Huge wicket!",
];

const BOUNDARY_FOUR_TEMPLATES = [
    "FOUR! Beautifully placed by {batter}!",
    "That races away to the boundary! Four runs!",
    "FOUR! {batter} times that perfectly!",
    "Crashing through the covers for four!",
    "FOUR! Exquisite shot from {batter}!",
];

const BOUNDARY_SIX_TEMPLATES = [
    "SIX! That's massive from {batter}!",
    "Into the stands! {batter} goes big!",
    "SIX! {batter} has launched that into orbit!",
    "Maximum! What a hit from {batter}!",
    "That's gone all the way! SIX runs!",
];

const DOT_BALL_TEMPLATES = [
    "Good delivery from {bowler}, no run.",
    "Dot ball. {bowler} keeps it tight.",
    "Appeal, but not out. No run.",
    "{batter} defends solidly, but no run.",
    "Beaten! {bowler} nearly got the edge there.",
];

const SINGLE_TEMPLATES = [
    "Pushed for a single.",
    "Quick single taken.",
    "They rotate the strike.",
    "Nudged away for one.",
    "{batter} works it away for a single.",
];

const RUNS_TEMPLATES: Record<number, string[]> = {
    2: ["Two runs.", "Good running between the wickets.", "They come back for the second."],
    3: ["Three runs! Great running!", "They push hard for three.", "Excellent running, three to the total."],
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function fillTemplate(template: string, vars: Record<string, string>): string {
    let result = template;
    Object.entries(vars).forEach(([key, value]) => {
        result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
    });
    return result;
}

// ============================================================================
// BALL-BY-BALL COMMENTARY
// ============================================================================

export function generateBallCommentary(
    ball: BallSummary,
    batterName: string,
    bowlerName: string,
    dismissalType?: string
): CommentaryEntry {
    const timestamp = new Date().toISOString();
    const vars = { batter: batterName, bowler: bowlerName };

    if (ball.isWicket) {
        const dismissalText = dismissalType ? ` (${dismissalType})` : "";
        return {
            type: "wicket",
            text: fillTemplate(pickRandom(WICKET_TEMPLATES), vars) + dismissalText,
            priority: "high",
            timestamp,
            seq: ball.seq,
            highlight: true,
        };
    }

    if (ball.totalRuns >= 6) {
        return {
            type: "boundary",
            text: fillTemplate(pickRandom(BOUNDARY_SIX_TEMPLATES), vars),
            priority: "high",
            timestamp,
            seq: ball.seq,
            highlight: true,
        };
    }

    if (ball.totalRuns === 4) {
        return {
            type: "boundary",
            text: fillTemplate(pickRandom(BOUNDARY_FOUR_TEMPLATES), vars),
            priority: "medium",
            timestamp,
            seq: ball.seq,
            highlight: true,
        };
    }

    if (ball.totalRuns === 0 && ball.isLegal) {
        return {
            type: "ball",
            text: fillTemplate(pickRandom(DOT_BALL_TEMPLATES), vars),
            priority: "low",
            timestamp,
            seq: ball.seq,
        };
    }

    if (ball.totalRuns === 1) {
        return {
            type: "ball",
            text: fillTemplate(pickRandom(SINGLE_TEMPLATES), vars),
            priority: "low",
            timestamp,
            seq: ball.seq,
        };
    }

    const templates = RUNS_TEMPLATES[ball.totalRuns] || [`${ball.totalRuns} runs.`];
    return {
        type: "ball",
        text: pickRandom(templates),
        priority: "low",
        timestamp,
        seq: ball.seq,
    };
}

// ============================================================================
// MILESTONES
// ============================================================================

export function detectBattingMilestone(
    playerId: string,
    playerName: string,
    previousRuns: number,
    currentRuns: number
): Milestone | null {
    const milestones: [number, MilestoneType, string][] = [
        [50, "fifty", `FIFTY for ${playerName}! A well-crafted half-century! 🎉`],
        [100, "hundred", `CENTURY! ${playerName} reaches the magical three figures! 💯`],
        [200, "double_hundred", `DOUBLE HUNDRED! ${playerName} is unstoppable! 🔥`],
        [300, "triple_hundred", `TRIPLE CENTURY! ${playerName} writes history! ⭐`],
    ];

    for (const [threshold, type, commentary] of milestones) {
        if (previousRuns < threshold && currentRuns >= threshold) {
            return { type, playerId, playerName, value: currentRuns, commentary };
        }
    }

    return null;
}

export function detectBowlingMilestone(
    playerId: string,
    playerName: string,
    previousWickets: number,
    currentWickets: number
): Milestone | null {
    if (previousWickets < 5 && currentWickets >= 5) {
        return {
            type: "five_wickets",
            playerId,
            playerName,
            value: currentWickets,
            commentary: `FIVE WICKET HAUL! ${playerName} is on fire! 🔥`,
        };
    }

    return null;
}

export function detectTeamMilestone(
    previousRuns: number,
    currentRuns: number,
    teamName: string
): Milestone | null {
    const milestones: [number, MilestoneType, string][] = [
        [50, "team_fifty", `${teamName} brings up 50!`],
        [100, "team_hundred", `${teamName} reaches 100! The century is up!`],
        [150, "team_150", `${teamName} moves past 150!`],
        [200, "team_200", `${teamName} reaches 200! Building a big total!`],
    ];

    for (const [threshold, type, commentary] of milestones) {
        if (previousRuns < threshold && currentRuns >= threshold) {
            return { type, value: currentRuns, commentary };
        }
    }

    return null;
}

// ============================================================================
// OVER SUMMARY
// ============================================================================

export function generateOverSummary(
    overNumber: number,
    runsInOver: number,
    wicketsInOver: number,
    bowlerName: string,
    totalRuns: number,
    totalWickets: number
): CommentaryEntry {
    let summary = `End of over ${overNumber}: ${runsInOver} runs`;
    if (wicketsInOver > 0) {
        summary += `, ${wicketsInOver} wicket${wicketsInOver > 1 ? "s" : ""}`;
    }
    summary += `. ${bowlerName} finishes the over. Score: ${totalRuns}/${totalWickets}`;

    const priority = wicketsInOver > 0 || runsInOver >= 15 ? "high" :
        runsInOver >= 10 ? "medium" : "low";

    return {
        type: "over_summary",
        text: summary,
        priority,
        timestamp: new Date().toISOString(),
        highlight: wicketsInOver > 0,
    };
}

// ============================================================================
// MATCH SITUATION
// ============================================================================

export function generateMatchSituation(
    runs: number,
    wickets: number,
    balls: number,
    target: number | null,
    totalOvers: number,
    teamName: string
): CommentaryEntry {
    const ballsRemaining = totalOvers * 6 - balls;
    const overs = Math.floor(balls / 6);
    const ballsInOver = balls % 6;

    let text = `${teamName}: ${runs}/${wickets} (${overs}.${ballsInOver} overs)`;

    if (target) {
        const runsNeeded = Math.max(0, target - runs);
        if (runsNeeded > 0 && ballsRemaining > 0) {
            const rrr = (runsNeeded / (ballsRemaining / 6)).toFixed(2);
            text += `. Need ${runsNeeded} runs from ${ballsRemaining} balls. Required rate: ${rrr}`;
        } else if (runsNeeded <= 0) {
            text = `${teamName} wins! 🏆 Final score: ${runs}/${wickets}`;
        }
    }

    return {
        type: "match_situation",
        text,
        priority: "medium",
        timestamp: new Date().toISOString(),
    };
}

// ============================================================================
// PRESSURE COMMENTARY
// ============================================================================

export function generatePressureCommentary(
    pressureLevel: "low" | "moderate" | "high" | "extreme",
    factors: string[]
): CommentaryEntry | null {
    if (pressureLevel === "low") return null;

    const texts: Record<string, string[]> = {
        moderate: [
            "Pressure building here!",
            "The equation is getting tighter.",
            "This is getting interesting!",
        ],
        high: [
            "High pressure situation!",
            "The game is on a knife's edge!",
            "Crucial phase of the match!",
        ],
        extreme: [
            "MAXIMUM PRESSURE! This is crunch time!",
            "The tension is palpable! Every ball counts!",
            "Make or break moment! The crowd is on its feet!",
        ],
    };

    const factorText = factors.length > 0 ? ` (${factors.slice(0, 2).join(", ")})` : "";

    return {
        type: "pressure",
        text: pickRandom(texts[pressureLevel]) + factorText,
        priority: pressureLevel === "extreme" ? "high" : "medium",
        timestamp: new Date().toISOString(),
        highlight: pressureLevel === "extreme",
    };
}

// ============================================================================
// PARTNERSHIP COMMENTARY
// ============================================================================

export function generatePartnershipCommentary(
    runs: number,
    balls: number,
    batter1Name: string,
    batter2Name: string
): CommentaryEntry | null {
    const milestones = [50, 100, 150, 200];

    for (const milestone of milestones) {
        if (runs === milestone) {
            const sr = balls > 0 ? ((runs / balls) * 100).toFixed(1) : "0.0";
            return {
                type: "partnership",
                text: `${milestone}-run partnership! ${batter1Name} and ${batter2Name} have added ${runs} runs off ${balls} balls (SR: ${sr})`,
                priority: "high",
                timestamp: new Date().toISOString(),
                highlight: true,
            };
        }
    }

    return null;
}

// ============================================================================
// MAIN COMMENTARY GENERATOR
// ============================================================================

export function generateAutoCommentary(params: {
    ball: BallSummary;
    batterName: string;
    bowlerName: string;
    dismissalType?: string;
    previousBatterRuns: number;
    currentBatterRuns: number;
    previousBowlerWickets: number;
    currentBowlerWickets: number;
    previousTeamRuns: number;
    currentTeamRuns: number;
    teamName: string;
    batterId: string;
    bowlerId: string;
    pressureLevel?: "low" | "moderate" | "high" | "extreme";
    pressureFactors?: string[];
}): CommentaryEntry[] {
    const entries: CommentaryEntry[] = [];

    // Ball commentary
    entries.push(
        generateBallCommentary(
            params.ball,
            params.batterName,
            params.bowlerName,
            params.dismissalType
        )
    );

    // Batting milestone
    const battingMilestone = detectBattingMilestone(
        params.batterId,
        params.batterName,
        params.previousBatterRuns,
        params.currentBatterRuns
    );
    if (battingMilestone) {
        entries.push({
            type: "milestone",
            text: battingMilestone.commentary,
            priority: "high",
            timestamp: new Date().toISOString(),
            highlight: true,
        });
    }

    // Bowling milestone
    const bowlingMilestone = detectBowlingMilestone(
        params.bowlerId,
        params.bowlerName,
        params.previousBowlerWickets,
        params.currentBowlerWickets
    );
    if (bowlingMilestone) {
        entries.push({
            type: "milestone",
            text: bowlingMilestone.commentary,
            priority: "high",
            timestamp: new Date().toISOString(),
            highlight: true,
        });
    }

    // Team milestone
    const teamMilestone = detectTeamMilestone(
        params.previousTeamRuns,
        params.currentTeamRuns,
        params.teamName
    );
    if (teamMilestone) {
        entries.push({
            type: "milestone",
            text: teamMilestone.commentary,
            priority: "medium",
            timestamp: new Date().toISOString(),
        });
    }

    // Pressure commentary (occasionally)
    if (params.pressureLevel && params.pressureLevel !== "low" && Math.random() > 0.7) {
        const pressureEntry = generatePressureCommentary(
            params.pressureLevel,
            params.pressureFactors || []
        );
        if (pressureEntry) {
            entries.push(pressureEntry);
        }
    }

    return entries;
}
