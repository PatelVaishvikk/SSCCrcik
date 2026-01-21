/**
 * Shot Tracking Module - World's Best Scoring Engine
 * Provides wagon wheel data, hot zones, shot classification, and boundary analysis.
 */

import type { BallSummary } from "./types";

// ============================================================================
// TYPES
// ============================================================================

export type ShotZone =
    | "third_man"
    | "point"
    | "cover"
    | "mid_off"
    | "mid_on"
    | "mid_wicket"
    | "square_leg"
    | "fine_leg";

export type ShotType =
    | "straight_drive"
    | "cover_drive"
    | "on_drive"
    | "off_drive"
    | "square_cut"
    | "late_cut"
    | "pull"
    | "hook"
    | "sweep"
    | "reverse_sweep"
    | "flick"
    | "glance"
    | "edge"
    | "defensive"
    | "unknown";

export type WagonWheelEntry = {
    zone: ShotZone;
    runs: number;
    isBoundary: boolean;
    shotType?: ShotType;
    x?: number;
    y?: number;
};

export type WagonWheelSummary = {
    zones: Record<ShotZone, { runs: number; shots: number; boundaries: number }>;
    total: { runs: number; shots: number; boundaries: number };
};

export type HotZone = {
    zone: ShotZone;
    intensity: number; // 0-100
    runs: number;
    shots: number;
    averageRuns: number;
};

export type BoundaryAnalysis = {
    fours: number;
    sixes: number;
    total: number;
    byOver: number[];
    percentOfRuns: number;
    favoriteZones: ShotZone[];
};

export type ShotAnalysis = {
    wagonWheel: WagonWheelSummary;
    hotZones: HotZone[];
    boundaries: BoundaryAnalysis;
    shotTypes: Record<ShotType, { count: number; runs: number }>;
    scoringAreas: { offSide: number; onSide: number; straight: number };
};

// ============================================================================
// ZONE DETECTION
// ============================================================================

const ZONE_ANGLES: Record<ShotZone, [number, number]> = {
    third_man: [0, 45],
    point: [45, 90],
    cover: [90, 135],
    mid_off: [135, 180],
    mid_on: [180, 225],
    mid_wicket: [225, 270],
    square_leg: [270, 315],
    fine_leg: [315, 360],
};

export function getZoneFromCoords(x: number, y: number): ShotZone {
    // Assume x, y are normalized coordinates (-1 to 1) from pitch center
    // 0,0 is pitch center, positive x is off-side, positive y is straight
    const angle = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;

    for (const [zone, [start, end]] of Object.entries(ZONE_ANGLES)) {
        if (angle >= start && angle < end) {
            return zone as ShotZone;
        }
    }
    return "cover"; // Default
}

export function getZoneFromShotType(shotType: ShotType): ShotZone {
    const mapping: Record<ShotType, ShotZone> = {
        straight_drive: "mid_off",
        cover_drive: "cover",
        on_drive: "mid_on",
        off_drive: "mid_off",
        square_cut: "point",
        late_cut: "third_man",
        pull: "mid_wicket",
        hook: "fine_leg",
        sweep: "square_leg",
        reverse_sweep: "third_man",
        flick: "mid_wicket",
        glance: "fine_leg",
        edge: "third_man",
        defensive: "mid_off",
        unknown: "cover",
    };
    return mapping[shotType];
}

// ============================================================================
// SHOT TYPE CLASSIFICATION
// ============================================================================

export function classifyShotType(
    x?: number,
    y?: number,
    runs?: number,
    explicitType?: string
): ShotType {
    if (explicitType && isValidShotType(explicitType)) {
        return explicitType as ShotType;
    }

    if (x === undefined || y === undefined) {
        return "unknown";
    }

    // Simple heuristic based on coordinates
    const zone = getZoneFromCoords(x, y);

    const shotsByZone: Record<ShotZone, ShotType[]> = {
        third_man: ["late_cut", "edge", "glance"],
        point: ["square_cut", "late_cut"],
        cover: ["cover_drive", "off_drive"],
        mid_off: ["straight_drive", "off_drive", "defensive"],
        mid_on: ["on_drive", "flick"],
        mid_wicket: ["pull", "flick"],
        square_leg: ["sweep", "pull"],
        fine_leg: ["glance", "hook", "flick"],
    };

    const candidates = shotsByZone[zone] || ["unknown"];

    // Pick based on runs scored
    if (runs && runs >= 6) {
        // Big shots typically go over the top
        if (zone === "mid_wicket" || zone === "square_leg") return "pull";
        if (zone === "mid_off" || zone === "cover") return "straight_drive";
    }

    return candidates[0] || "unknown";
}

function isValidShotType(type: string): boolean {
    const validTypes: ShotType[] = [
        "straight_drive", "cover_drive", "on_drive", "off_drive",
        "square_cut", "late_cut", "pull", "hook", "sweep",
        "reverse_sweep", "flick", "glance", "edge", "defensive", "unknown"
    ];
    return validTypes.includes(type as ShotType);
}

// ============================================================================
// WAGON WHEEL
// ============================================================================

export function buildWagonWheel(balls: BallSummary[]): WagonWheelSummary {
    const zones: WagonWheelSummary["zones"] = {
        third_man: { runs: 0, shots: 0, boundaries: 0 },
        point: { runs: 0, shots: 0, boundaries: 0 },
        cover: { runs: 0, shots: 0, boundaries: 0 },
        mid_off: { runs: 0, shots: 0, boundaries: 0 },
        mid_on: { runs: 0, shots: 0, boundaries: 0 },
        mid_wicket: { runs: 0, shots: 0, boundaries: 0 },
        square_leg: { runs: 0, shots: 0, boundaries: 0 },
        fine_leg: { runs: 0, shots: 0, boundaries: 0 },
    };

    const total = { runs: 0, shots: 0, boundaries: 0 };

    balls.forEach((ball) => {
        if (ball.totalRuns === 0) return;

        const shotType = classifyShotType(ball.shotX, ball.shotY, ball.totalRuns, ball.shotType);
        const zone = ball.shotX !== undefined && ball.shotY !== undefined
            ? getZoneFromCoords(ball.shotX, ball.shotY)
            : getZoneFromShotType(shotType);

        zones[zone].runs += ball.totalRuns;
        zones[zone].shots += 1;
        total.runs += ball.totalRuns;
        total.shots += 1;

        if (ball.totalRuns >= 4) {
            zones[zone].boundaries += 1;
            total.boundaries += 1;
        }
    });

    return { zones, total };
}

// ============================================================================
// HOT ZONES
// ============================================================================

export function calculateHotZones(wagonWheel: WagonWheelSummary): HotZone[] {
    const maxRuns = Math.max(
        ...Object.values(wagonWheel.zones).map(z => z.runs),
        1
    );

    return Object.entries(wagonWheel.zones)
        .map(([zone, stats]) => ({
            zone: zone as ShotZone,
            intensity: Math.round((stats.runs / maxRuns) * 100),
            runs: stats.runs,
            shots: stats.shots,
            averageRuns: stats.shots > 0 ? Math.round((stats.runs / stats.shots) * 10) / 10 : 0,
        }))
        .sort((a, b) => b.intensity - a.intensity);
}

// ============================================================================
// BOUNDARY ANALYSIS
// ============================================================================

export function analyzeBoundaries(
    balls: BallSummary[],
    runsPerOver: number[],
    totalRuns: number
): BoundaryAnalysis {
    let fours = 0;
    let sixes = 0;
    const boundariesByOver: number[] = new Array(runsPerOver.length).fill(0);
    const zoneCount: Record<ShotZone, number> = {
        third_man: 0, point: 0, cover: 0, mid_off: 0,
        mid_on: 0, mid_wicket: 0, square_leg: 0, fine_leg: 0,
    };

    let currentOver = 0;
    let ballsInOver = 0;

    balls.forEach((ball) => {
        if (ball.isLegal) {
            ballsInOver++;
            if (ballsInOver > 6) {
                currentOver++;
                ballsInOver = 1;
            }
        }

        if (ball.totalRuns === 4) {
            fours++;
            if (currentOver < boundariesByOver.length) {
                boundariesByOver[currentOver]++;
            }
            const zone = ball.shotX !== undefined && ball.shotY !== undefined
                ? getZoneFromCoords(ball.shotX, ball.shotY)
                : "cover";
            zoneCount[zone]++;
        } else if (ball.totalRuns >= 6) {
            sixes++;
            if (currentOver < boundariesByOver.length) {
                boundariesByOver[currentOver]++;
            }
            const zone = ball.shotX !== undefined && ball.shotY !== undefined
                ? getZoneFromCoords(ball.shotX, ball.shotY)
                : "mid_wicket";
            zoneCount[zone]++;
        }
    });

    const boundaryRuns = (fours * 4) + (sixes * 6);
    const percentOfRuns = totalRuns > 0 ? Math.round((boundaryRuns / totalRuns) * 100) : 0;

    // Find top 3 favorite zones
    const sortedZones = Object.entries(zoneCount)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([zone]) => zone as ShotZone);

    return {
        fours,
        sixes,
        total: fours + sixes,
        byOver: boundariesByOver,
        percentOfRuns,
        favoriteZones: sortedZones,
    };
}

// ============================================================================
// SHOT TYPE ANALYSIS
// ============================================================================

export function analyzeShotTypes(balls: BallSummary[]): Record<ShotType, { count: number; runs: number }> {
    const stats: Record<ShotType, { count: number; runs: number }> = {
        straight_drive: { count: 0, runs: 0 },
        cover_drive: { count: 0, runs: 0 },
        on_drive: { count: 0, runs: 0 },
        off_drive: { count: 0, runs: 0 },
        square_cut: { count: 0, runs: 0 },
        late_cut: { count: 0, runs: 0 },
        pull: { count: 0, runs: 0 },
        hook: { count: 0, runs: 0 },
        sweep: { count: 0, runs: 0 },
        reverse_sweep: { count: 0, runs: 0 },
        flick: { count: 0, runs: 0 },
        glance: { count: 0, runs: 0 },
        edge: { count: 0, runs: 0 },
        defensive: { count: 0, runs: 0 },
        unknown: { count: 0, runs: 0 },
    };

    balls.forEach((ball) => {
        const shotType = classifyShotType(ball.shotX, ball.shotY, ball.totalRuns, ball.shotType);
        stats[shotType].count++;
        stats[shotType].runs += ball.totalRuns;
    });

    return stats;
}

// ============================================================================
// SCORING AREAS
// ============================================================================

export function calculateScoringAreas(wagonWheel: WagonWheelSummary): {
    offSide: number;
    onSide: number;
    straight: number;
} {
    const { zones } = wagonWheel;
    const total = wagonWheel.total.runs || 1;

    const offSide = zones.third_man.runs + zones.point.runs + zones.cover.runs;
    const onSide = zones.mid_wicket.runs + zones.square_leg.runs + zones.fine_leg.runs;
    const straight = zones.mid_off.runs + zones.mid_on.runs;

    return {
        offSide: Math.round((offSide / total) * 100),
        onSide: Math.round((onSide / total) * 100),
        straight: Math.round((straight / total) * 100),
    };
}

// ============================================================================
// MAIN SHOT ANALYSIS FUNCTION
// ============================================================================

export function computeShotAnalysis(
    balls: BallSummary[],
    runsPerOver: number[],
    totalRuns: number
): ShotAnalysis {
    const wagonWheel = buildWagonWheel(balls);
    const hotZones = calculateHotZones(wagonWheel);
    const boundaries = analyzeBoundaries(balls, runsPerOver, totalRuns);
    const shotTypes = analyzeShotTypes(balls);
    const scoringAreas = calculateScoringAreas(wagonWheel);

    return {
        wagonWheel,
        hotZones,
        boundaries,
        shotTypes,
        scoringAreas,
    };
}
