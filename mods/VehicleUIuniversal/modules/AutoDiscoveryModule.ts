/// <reference path="../config/StandaloneConfig.ts" />

// AutoDiscoveryModule - True Zero-Config Passive Observation
// =============================================================================
// MISSION: Discover every team+vehicle-type combo at runtime WITHOUT any
// per-map hint tables. Drop the bundle on any map and the UI populates from
// what the map naturally spawns.
//
// STRATEGY: Passive observation.
//   1. Init: Collect every VehicleSpawner handle (phantom handles included)
//            into a candidate pool. DO NOT modify autospawn -- trust the map.
//   2. Observe `OnVehicleSpawned` events. For each new vehicle, identify its
//            (team, type, position). If this (team, type) is new, create a
//            UI catalog entry and snap it onto the next unused candidate
//            spawner handle.
//   3. Capture-reward spawners are detected by vehicle position -- if an
//            observed vehicle spawns within 50 m of a capture point, its
//            entry is flagged as a capture reward.
//   4. Click-to-spawn: use the bound candidate handle; if it fails, the UI
//            module iterates `_GetAlternateSpawners` for fallbacks.
// =============================================================================

namespace VehicleUIStandalone {
    const LETTER_MAP = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const NAME_MAP = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet"];

    const VEHICLE_SPAWNER_PROBE_START = 200;
    const VEHICLE_SPAWNER_PROBE_END = 2100;
    const CAPTURE_REWARD_RADIUS_METERS = 50;

    function isJetType(vt: mod.VehicleList): boolean {
        return vt === mod.VehicleList.F16 || vt === mod.VehicleList.F22 ||
               vt === mod.VehicleList.JAS39 || vt === mod.VehicleList.SU57;
    }

    const ALL_VEHICLE_TYPES: { type: mod.VehicleList; label: string; category: 'Ground' | 'Air' }[] = [
        { type: mod.VehicleList.Abrams,       label: "Abrams",  category: 'Ground' },
        { type: mod.VehicleList.Leopard,      label: "Leopard", category: 'Ground' },
        { type: mod.VehicleList.M2Bradley,    label: "Bradley", category: 'Ground' },
        { type: mod.VehicleList.CV90,         label: "CV90",    category: 'Ground' },
        { type: mod.VehicleList.Vector,       label: "Vector",  category: 'Ground' },
        { type: mod.VehicleList.Cheetah,      label: "AA",      category: 'Ground' },
        { type: mod.VehicleList.Gepard,       label: "Gepard",  category: 'Ground' },
        { type: mod.VehicleList.Marauder,     label: "Marauder",category: 'Ground' },
        { type: mod.VehicleList.Marauder_Pax, label: "Mardr",   category: 'Ground' },
        { type: mod.VehicleList.Flyer60,      label: "Flyer",   category: 'Ground' },
        { type: mod.VehicleList.Quadbike,     label: "Quad",    category: 'Ground' },
        { type: mod.VehicleList.GolfCart,     label: "Cart",    category: 'Ground' },
        { type: mod.VehicleList.RHIB,         label: "RHIB",    category: 'Ground' },
        { type: mod.VehicleList.DirtBike,     label: "DirtBke", category: 'Ground' },
        { type: mod.VehicleList.DirtBike_Pax, label: "DirtPax", category: 'Ground' },
        { type: mod.VehicleList.F16,          label: "F16",     category: 'Air'    },
        { type: mod.VehicleList.F22,          label: "F22",     category: 'Air'    },
        { type: mod.VehicleList.JAS39,        label: "JAS39",   category: 'Air'    },
        { type: mod.VehicleList.SU57,         label: "SU57",    category: 'Air'    },
        { type: mod.VehicleList.AH64,         label: "AH64",    category: 'Air'    },
        { type: mod.VehicleList.AH6M,         label: "AH6M",    category: 'Air'    },
        { type: mod.VehicleList.AH6M_Pax,     label: "AH6Px",   category: 'Air'    },
        { type: mod.VehicleList.Eurocopter,   label: "ATK",     category: 'Air'    },
        { type: mod.VehicleList.UH60,         label: "UH60",    category: 'Air'    },
        { type: mod.VehicleList.UH60_Pax,     label: "UH60P",   category: 'Air'    },
    ];

    const FACTION_PAIRS: mod.VehicleList[][] = [
        [mod.VehicleList.Abrams,    mod.VehicleList.Leopard],
        [mod.VehicleList.M2Bradley, mod.VehicleList.CV90],
        [mod.VehicleList.Cheetah,   mod.VehicleList.Gepard],
        [mod.VehicleList.Marauder,  mod.VehicleList.Marauder_Pax],
        [mod.VehicleList.AH6M,      mod.VehicleList.AH6M_Pax],
        [mod.VehicleList.UH60,      mod.VehicleList.UH60_Pax],
        [mod.VehicleList.DirtBike,  mod.VehicleList.DirtBike_Pax],
        [mod.VehicleList.F22,       mod.VehicleList.SU57],
        [mod.VehicleList.F16,       mod.VehicleList.JAS39],
        [mod.VehicleList.AH64,      mod.VehicleList.Eurocopter],
    ];

    // STRONG anchors: vehicles whose nation is unambiguous on every map
    // (main battle tanks, jets, attack helis, IFVs). Used to seed centroids.
    // Soft assets (AA, Marauder, light helis, transports) are classified by
    // position so that per-map quirks (e.g. Gepard on T1, Cheetah on T2) win.
    const STRONG_T1_ANCHORS: mod.VehicleList[] = [
        mod.VehicleList.Abrams,
        mod.VehicleList.M2Bradley,
        mod.VehicleList.F22,
        mod.VehicleList.F16,
        mod.VehicleList.AH64,
    ];
    const STRONG_T2_ANCHORS: mod.VehicleList[] = [
        mod.VehicleList.Leopard,
        mod.VehicleList.CV90,
        mod.VehicleList.SU57,
        mod.VehicleList.JAS39,
        mod.VehicleList.Eurocopter,
    ];

    function getStrongAnchorTeam(vt: mod.VehicleList): number {
        if (STRONG_T1_ANCHORS.indexOf(vt) >= 0) return 1;
        if (STRONG_T2_ANCHORS.indexOf(vt) >= 0) return 2;
        return 0;
    }

    function getFactionMatchTypes(vt: mod.VehicleList): mod.VehicleList[] {
        // Each cataloged def matches ONLY its own type. We deliberately do NOT
        // expand to FACTION_PAIRS counterparts: maps may legitimately mix
        // factions per team (e.g. T1=Gepard, T2=Cheetah), and treating them
        // as equivalent causes the matcher to cross-pair vehicles to the wrong
        // spawner def -- which then mislabels buttons and teleports players
        // to the opposing team's vehicle.
        return [vt];
    }

    export function isFactionAppropriate(vt: mod.VehicleList, teamId: number): boolean {
        for (const pair of FACTION_PAIRS) {
            const idx = pair.indexOf(vt);
            if (idx === -1) continue;
            return (idx === 0 && teamId === 1) || (idx === 1 && teamId === 2);
        }
        return true;
    }

    // =========================================================================
    // PUBLIC TYPES
    // =========================================================================
    export interface DiscoveredVehicleSpawner {
        spawnerId: number;
        spawner: mod.VehicleSpawner;
        position: mod.Vector | null;
        vehicleType: mod.VehicleList | null;
        matchTypes?: mod.VehicleList[];
        label: string;
        category: 'Ground' | 'Air';
        teamId: number;
        objectiveLetter: string | null;
        needsForceSpawn: boolean;
    }

    export interface DiscoveredAISpawner {
        spawnerId: number;
        spawner: mod.Spawner;
    }

    export let discoveredVehicleSpawners: DiscoveredVehicleSpawner[] = [];
    export const confirmedSpawnerIds = new Set<number>();
    export const spawnerTeamCache: Map<number, number> = new Map();

    // =========================================================================
    // INTERNAL STATE
    // =========================================================================
    let discoveryComplete = false;
    let labelCorrectionsNeeded = false;
    let firstObservationTime = -1;
    const DISCOVERY_SETTLE_SECONDS = 8.0;

    interface CandidateSpawner { spawnerId: number; spawner: mod.VehicleSpawner; used: boolean; }
    let candidateSpawners: CandidateSpawner[] = [];

    let autoSpawnProbeActive = false; // backward-compat flag (no-op)

    // =========================================================================
    // LOGGING
    // =========================================================================
    function logD(msg: string): void {
        try { (typeof log === 'function') && log(msg); } catch (_e) {}
    }
    function logV(msg: string): void {
        try { (typeof logDebug === 'function') && logDebug(msg); } catch (_e) {}
    }

    // =========================================================================
    // OBJECTIVE DISCOVERY
    // =========================================================================
    export function discoverObjectives(): void {
        const allCPs = mod.AllCapturePoints();
        const count = mod.CountOf(allCPs);
        if (count === 0) {
            logD("[Discovery] WARNING: No capture points found on this map!");
            return;
        }

        const cpData: { cp: mod.CapturePoint; objId: number; x: number; y: number; z: number }[] = [];
        for (let i = 0; i < count; i++) {
            const cp = mod.ValueInArray(allCPs, i) as mod.CapturePoint;
            if (!cp) continue;
            const objId = mod.GetObjId(cp);
            try {
                const pos = mod.GetObjectPosition(cp as unknown as mod.Object);
                if (pos) {
                    cpData.push({
                        cp, objId,
                        x: mod.XComponentOf(pos),
                        y: mod.YComponentOf(pos),
                        z: mod.ZComponentOf(pos),
                    });
                }
            } catch (e) {
                logD(`[Discovery] CP objId=${objId} pos error: ${e}`);
            }
        }
        if (cpData.length === 0) { logD("[Discovery] WARNING: No CP positions"); return; }

        cpData.sort((a, b) => a.objId - b.objId);

        OBJECTIVES = [];
        for (let i = 0; i < cpData.length && i < LETTER_MAP.length; i++) {
            const d = cpData[i];
            OBJECTIVES.push({
                id: LETTER_MAP[i],
                name: NAME_MAP[i] || ("CP" + i),
                objId: d.objId, x: d.x, y: d.y, z: d.z,
            });
            logD(`[Discovery] Objective ${LETTER_MAP[i]} objId=${d.objId} pos=(${d.x.toFixed(0)},${d.y.toFixed(0)},${d.z.toFixed(0)})`);
        }
        logD(`[Discovery] ${OBJECTIVES.length} objectives discovered`);
    }

    // =========================================================================
    // AI HQ SPAWNER DISCOVERY
    // =========================================================================
    function probeSpawner(id: number): boolean {
        try {
            const s = mod.GetSpawner(id);
            return s !== null && s !== undefined;
        } catch (_e) { return false; }
    }

    export function discoverAISpawners(): void {
        const KNOWN_T1_HQ = [1090, 1091, 1092, 1093];
        const KNOWN_T2_HQ = [1002, 1003, 1004, 1005];
        const BASE_T1_HQ  = [100, 110, 120, 130];
        const BASE_T2_HQ  = [101, 111, 121, 131];

        const t1: number[] = [];
        const t2: number[] = [];
        for (const id of KNOWN_T1_HQ) if (probeSpawner(id)) t1.push(id);
        for (const id of KNOWN_T2_HQ) if (probeSpawner(id)) t2.push(id);
        if (t1.length === 0) for (const id of BASE_T1_HQ) if (probeSpawner(id)) t1.push(id);
        if (t2.length === 0) for (const id of BASE_T2_HQ) if (probeSpawner(id)) t2.push(id);

        if (t1.length > 0 && t2.length > 0) {
            TEAM1_AI_SPAWNER_IDS = t1;
            TEAM2_AI_SPAWNER_IDS = t2;
            logD(`[Discovery] AI Spawners T1=[${t1.join(",")}] T2=[${t2.join(",")}]`);
            return;
        }

        const found: number[] = [];
        for (let id = 900; id <= 1100; id++) if (probeSpawner(id)) found.push(id);
        const t1F: number[] = [];
        const t2F: number[] = [];
        for (let i = 0; i < found.length && (t1F.length < 4 || t2F.length < 4); i++) {
            if (i % 2 === 0 && t1F.length < 4) t1F.push(found[i]);
            else if (t2F.length < 4) t2F.push(found[i]);
        }
        TEAM1_AI_SPAWNER_IDS = t1.length > 0 ? t1 : t1F;
        TEAM2_AI_SPAWNER_IDS = t2.length > 0 ? t2 : t2F;
        logD(`[Discovery] AI Spawners (fallback) T1=[${TEAM1_AI_SPAWNER_IDS.join(",")}] T2=[${TEAM2_AI_SPAWNER_IDS.join(",")}]`);
    }

    // =========================================================================
    // VEHICLE SPAWNER CANDIDATE COLLECTION
    // =========================================================================
    export function discoverVehicleSpawners(): void {
        candidateSpawners = [];
        for (let id = VEHICLE_SPAWNER_PROBE_START; id <= VEHICLE_SPAWNER_PROBE_END; id++) {
            try {
                const spawner = mod.GetVehicleSpawner(id);
                if (spawner) candidateSpawners.push({ spawnerId: id, spawner, used: false });
            } catch (_e) {}
        }
        logD(`[Discovery] Collected ${candidateSpawners.length} candidate spawner handles`);
    }

    // =========================================================================
    // OBSERVATION
    // =========================================================================
    function identifyVehicleType(v: mod.Vehicle): { type: mod.VehicleList; label: string; category: 'Ground' | 'Air' } | null {
        for (const vt of ALL_VEHICLE_TYPES) {
            try {
                if (mod.CompareVehicleName(v, vt.type)) return vt;
            } catch (_e) {}
        }
        return null;
    }

    function getVehicleTeamId(v: mod.Vehicle): number {
        try {
            const team = mod.GetVehicleTeam(v);
            if (team) {
                const t1 = mod.GetTeam(1);
                const t2 = mod.GetTeam(2);
                if (team === t1) return 1;
                if (team === t2) return 2;
            }
        } catch (_e) {}
        return 0;
    }

    // Cached HQ centroids for team inference when GetVehicleTeam returns null.
    let _hqT1: { x: number; y: number; z: number } | null = null;
    let _hqT2: { x: number; y: number; z: number } | null = null;
    let _hqResolved = false;
    const observedVehicleObjIds = new Set<number>();

    function getHQCentroid(ids: number[]): { x: number; y: number; z: number } | null {
        let n = 0, sx = 0, sy = 0, sz = 0;
        for (const id of ids) {
            try {
                const sp = mod.GetSpawner(id);
                if (!sp) continue;
                const pos = mod.GetObjectPosition(sp as unknown as mod.Object);
                if (!pos) continue;
                const x = mod.XComponentOf(pos);
                const y = mod.YComponentOf(pos);
                const z = mod.ZComponentOf(pos);
                if (x === 0 && y === 0 && z === 0) continue; // SDK returned null position
                sx += x; sy += y; sz += z;
                n++;
            } catch (_e) {}
        }
        if (n === 0) return null;
        return { x: sx / n, y: sy / n, z: sz / n };
    }

    function resolveHQCentroids(): void {
        if (_hqResolved) return;
        _hqResolved = true;
        _hqT1 = getHQCentroid(TEAM1_AI_SPAWNER_IDS);
        _hqT2 = getHQCentroid(TEAM2_AI_SPAWNER_IDS);
        if (_hqT1 && _hqT2) {
            logD(`[Discovery] HQ centroids: T1=(${_hqT1.x.toFixed(0)},${_hqT1.z.toFixed(0)}) T2=(${_hqT2.x.toFixed(0)},${_hqT2.z.toFixed(0)})`);
        } else {
            logD(`[Discovery] HQ centroids unavailable (Spawner positions return null) - mirroring will fill the other team`);
        }
    }

    /** Public accessor: returns the cached HQ centroid for a team (1 or 2)
     *  as a {x,y,z} record, or null if not yet resolved. Used by the
     *  VehicleSpawnUI F16 elimination fallback to spatially gate which
     *  unidentified vehicle to adopt for a given team's F16 button. */
    export function AutoDiscovery_GetTeamHQCentroid(teamId: number): { x: number; y: number; z: number } | null {
        if (!_hqResolved) resolveHQCentroids();
        if (teamId === 1) return _hqT1;
        if (teamId === 2) return _hqT2;
        return null;
    }

    function inferTeamFromPosition(pos: mod.Vector | null): number {
        if (!pos) return 0;
        if (!_hqResolved) resolveHQCentroids();
        if (!_hqT1 || !_hqT2) return 0;
        const px = mod.XComponentOf(pos);
        const py = mod.YComponentOf(pos);
        const pz = mod.ZComponentOf(pos);
        const d1 = (px - _hqT1.x) * (px - _hqT1.x) + (py - _hqT1.y) * (py - _hqT1.y) + (pz - _hqT1.z) * (pz - _hqT1.z);
        const d2 = (px - _hqT2.x) * (px - _hqT2.x) + (py - _hqT2.y) * (py - _hqT2.y) + (pz - _hqT2.z) * (pz - _hqT2.z);
        return d1 < d2 ? 1 : 2;
    }

    function distSqVector(v: mod.Vector, x: number, y: number, z: number): number {
        try {
            const vx = mod.XComponentOf(v) - x;
            const vy = mod.YComponentOf(v) - y;
            const vz = mod.ZComponentOf(v) - z;
            return vx * vx + vy * vy + vz * vz;
        } catch (_e) { return Infinity; }
    }

    function nearestObjectiveLetter(pos: mod.Vector): string | null {
        const radiusSq = CAPTURE_REWARD_RADIUS_METERS * CAPTURE_REWARD_RADIUS_METERS;
        let bestLetter: string | null = null;
        let bestDist = radiusSq;
        for (const obj of OBJECTIVES) {
            const d = distSqVector(pos, obj.x, obj.y, obj.z);
            if (d < bestDist) { bestDist = d; bestLetter = obj.id; }
        }
        return bestLetter;
    }

    function takeCandidate(): CandidateSpawner | null {
        for (const c of candidateSpawners) {
            if (!c.used) { c.used = true; return c; }
        }
        return null;
    }

    // -------------------------------------------------------------------------
    // FACTION-ANCHORED CLASSIFICATION
    //
    // mod.GetVehicleTeam returns a default team for ALL uncrewed vehicles
    // (typically T2), so it cannot be trusted at init or for empty vehicles.
    // Position-based fallback also fails because GetObjectPosition on AI
    // Spawners returns (0,0,0) on most maps.
    //
    // Solution: vehicle TYPES in FACTION_PAIRS are intrinsically team-aligned
    // (Abrams=T1, Leopard=T2, F22=T1, SU57=T2, ...). Use those as labeled
    // anchors to compute team centroids, then assign neutral types
    // (Vector / Flyer / Quad / RHIB / GolfCart / DirtBike etc.) by nearest
    // centroid distance.
    // -------------------------------------------------------------------------
    interface PendingObservation {
        objId: number;
        vehicleType: mod.VehicleList;
        meta: { type: mod.VehicleList; label: string; category: 'Ground' | 'Air' };
        pos: { x: number; y: number; z: number } | null;
        objLetter: string | null;
    }
    const _pending: PendingObservation[] = [];
    let _centT1: { x: number; y: number; z: number } | null = null;
    let _centT2: { x: number; y: number; z: number } | null = null;

    function _vecPos(v: mod.Vector | null): { x: number; y: number; z: number } | null {
        if (!v) return null;
        try {
            return { x: mod.XComponentOf(v), y: mod.YComponentOf(v), z: mod.ZComponentOf(v) };
        } catch (_e) { return null; }
    }

    function _classifyByCentroid(pos: { x: number; y: number; z: number } | null): number {
        if (!pos || !_centT1 || !_centT2) return 0;
        const d1 = (pos.x - _centT1.x) * (pos.x - _centT1.x) + (pos.z - _centT1.z) * (pos.z - _centT1.z);
        const d2 = (pos.x - _centT2.x) * (pos.x - _centT2.x) + (pos.z - _centT2.z) * (pos.z - _centT2.z);
        return d1 < d2 ? 1 : 2;
    }

    function _addCatalogEntry(p: PendingObservation, teamId: number): void {
        const cand = takeCandidate();
        if (!cand) {
            logD(`[Discovery] WARNING: No candidate handle for ${p.meta.label} T${teamId}`);
            return;
        }
        const matchTypes = getFactionMatchTypes(p.vehicleType);
        let posVec: mod.Vector | null = null;
        if (p.pos) {
            try { posVec = mod.CreateVector(p.pos.x, p.pos.y, p.pos.z); } catch (_e) {}
        }
        const entry: DiscoveredVehicleSpawner = {
            spawnerId: cand.spawnerId,
            spawner: cand.spawner,
            position: posVec,
            vehicleType: p.vehicleType,
            matchTypes: matchTypes,
            label: p.meta.label,
            category: p.meta.category,
            teamId: teamId,
            objectiveLetter: p.objLetter,
            needsForceSpawn: p.objLetter !== null || isJetType(p.vehicleType),
        };
        discoveredVehicleSpawners.push(entry);
        confirmedSpawnerIds.add(cand.spawnerId);
        spawnerTeamCache.set(cand.spawnerId, teamId);
        logD(`[Discovery] Cataloged ${p.meta.label} T${teamId}${p.objLetter ? ' [obj ' + p.objLetter + ']' : ''}`);
    }

    /** Build/refresh team centroids from already-observed faction-anchored vehicles. */
    function _refreshCentroids(): void {
        let n1 = 0, sx1 = 0, sy1 = 0, sz1 = 0;
        let n2 = 0, sx2 = 0, sy2 = 0, sz2 = 0;
        for (const p of _pending) {
            if (!p.pos) continue;
            const ft = getStrongAnchorTeam(p.vehicleType);
            if (ft === 1) { n1++; sx1 += p.pos.x; sy1 += p.pos.y; sz1 += p.pos.z; }
            else if (ft === 2) { n2++; sx2 += p.pos.x; sy2 += p.pos.y; sz2 += p.pos.z; }
        }
        for (const ds of discoveredVehicleSpawners) {
            if (!ds.vehicleType || !ds.position) continue;
            const ft = getStrongAnchorTeam(ds.vehicleType);
            const pos = _vecPos(ds.position);
            if (!pos) continue;
            if (ft === 1 && ds.teamId === 1) { n1++; sx1 += pos.x; sy1 += pos.y; sz1 += pos.z; }
            else if (ft === 2 && ds.teamId === 2) { n2++; sx2 += pos.x; sy2 += pos.y; sz2 += pos.z; }
        }
        _centT1 = n1 > 0 ? { x: sx1 / n1, y: sy1 / n1, z: sz1 / n1 } : null;
        _centT2 = n2 > 0 ? { x: sx2 / n2, y: sy2 / n2, z: sz2 / n2 } : null;
    }

    /** Classify and catalog every pending observation that we now have enough info for. */
    function _flushPending(): number {
        _refreshCentroids();
        const haveBothCentroids = _centT1 !== null && _centT2 !== null;
        let flushed = 0;
        for (let i = _pending.length - 1; i >= 0; i--) {
            const p = _pending[i];
            const ft = getStrongAnchorTeam(p.vehicleType);
            // Strong anchors classify themselves -- no centroid needed.
            // Neutrals require both centroids to be present.
            let teamId = 0;
            if (ft !== 0) teamId = ft;
            else if (haveBothCentroids) teamId = _classifyByCentroid(p.pos);
            if (teamId === 0) continue;
            _pending.splice(i, 1);
            _addCatalogEntry(p, teamId);
            flushed++;
        }
        if (flushed > 0) _refreshCentroids();
        return flushed;
    }

    /**
     * Called from main.script.ts when OnVehicleSpawned fires.
     * Buffers the observation and runs faction-anchored classification.
     */
    let _syntheticObjIdCounter = -1000000;
    const _noObjIdFingerprints = new Set<string>();
    export function AutoDiscovery_OnVehicleSpawned(vehicle: mod.Vehicle): void {
        // Some spawners in the .tscn don't declare an ObjId field (e.g. F16,
        // F22, AH64 on many maps). GetObjId returns -1 for those. To dedupe
        // across re-sweeps we fingerprint by (vehicle type + rounded position),
        // which is stable for a given spawn.
        let vObjId = -1;
        try { vObjId = mod.GetObjId(vehicle); } catch (_e) {}

        // Identify type early so we can fingerprint no-ObjId vehicles.
        const meta = identifyVehicleType(vehicle);
        if (!meta) {
            // Diagnostic: log unidentified vehicles so creators can spot SDK
            // gaps (e.g. a vehicle type whose CompareVehicleName never returns
            // true on this map / patch).
            if (vObjId >= 0 && !observedVehicleObjIds.has(vObjId)) {
                observedVehicleObjIds.add(vObjId);
                logD(`[Discovery] WARNING: vehicle ${vObjId} did not match any known VehicleList entry`);
            } else if (vObjId < 0) {
                logD(`[Discovery] WARNING: no-ObjId vehicle did not match any known VehicleList entry`);
            }
            return;
        }

        let posVec: mod.Vector | null = null;
        try { posVec = mod.GetVehicleState(vehicle, mod.VehicleStateVector.VehiclePosition) as mod.Vector; } catch (_e) {}
        const pos = _vecPos(posVec);

        if (vObjId < 0) {
            // Fingerprint: type + rounded x/z (1m grid). If we've already seen
            // a vehicle of this type at this location, drop it.
            if (pos) {
                const fp = `${meta.type}@${Math.round(pos.x)},${Math.round(pos.z)}`;
                if (_noObjIdFingerprints.has(fp)) return;
                _noObjIdFingerprints.add(fp);
            }
            vObjId = _syntheticObjIdCounter--;
        }
        if (observedVehicleObjIds.has(vObjId)) return;
        observedVehicleObjIds.add(vObjId);

        // objectiveLetter is only meaningful at init: a reward vehicle that
        // spawns AFTER discovery completes implies the objective was just
        // captured, so the vehicle should appear as a normal entry (not be
        // hidden as a locked reward).
        const objLetter = (posVec && !discoveryComplete) ? nearestObjectiveLetter(posVec) : null;

        _pending.push({ objId: vObjId, vehicleType: meta.type, meta, pos, objLetter });
        _flushPending();
    }

    function getFactionCounterpart(vt: mod.VehicleList): mod.VehicleList | null {
        for (const pair of FACTION_PAIRS) {
            if (pair[0] === vt) return pair[1];
            if (pair[1] === vt) return pair[0];
        }
        return null;
    }

    function findVehicleMeta(vt: mod.VehicleList): { type: mod.VehicleList; label: string; category: 'Ground' | 'Air' } | null {
        for (const m of ALL_VEHICLE_TYPES) if (m.type === vt) return m;
        return null;
    }

    /** Faction-anchor classification correctly catalogs both teams from
     *  direct observation for ground vehicles, so we no longer mirror those
     *  (mirroring caused Cheetah/Gepard cross-team pairing).
     *
     *  JETS are a special case: the SDK's `mod.CompareVehicleName(v, F16)`
     *  appears to never return true on this build, so the F16 vehicle is
     *  observed but never identified by name. The map's faction layout is
     *  always paired 1:1 (F22<->SU57, F16<->JAS39), so if we observe one
     *  side of the jet pair we can safely synthesize the other side using
     *  a phantom-handle candidate. Ground vehicles are NOT mirrored. */
    export function AutoDiscovery_MirrorFactionPairs(): number {
        let added = 0;

        // STEP 1: Prune phantom mirror jet entries that have been superseded
        // by a real same-team same-type observation. The mirror runs early
        // (before the real spawner has been observed) and creates a phantom
        // entry; once the real spawner shows up, both entries claim the same
        // jet, but only the real one's vehicle gets bound. The phantom stays
        // BLUE (jet buttons are always shown as available), and clicking it
        // tries to ForceVehicleSpawnerSpawn on a phantom handle -- silent
        // fail -> player deploys on foot.
        for (let i = discoveredVehicleSpawners.length - 1; i >= 0; i--) {
            const ds = discoveredVehicleSpawners[i];
            if (!ds.needsForceSpawn) continue;       // only phantoms
            if (!ds.vehicleType) continue;
            if (!isJetType(ds.vehicleType)) continue;
            const realExists = discoveredVehicleSpawners.some((d, j) =>
                j !== i &&
                !d.needsForceSpawn &&
                d.teamId === ds.teamId &&
                d.vehicleType === ds.vehicleType
            );
            if (realExists) {
                logD(`[Discovery] Pruned phantom mirror ${ds.label} T${ds.teamId} (real spawner ${i !== -1 ? 'now' : ''} cataloged)`);
                discoveredVehicleSpawners.splice(i, 1);
                confirmedSpawnerIds.delete(ds.spawnerId);
                spawnerTeamCache.delete(ds.spawnerId);
            }
        }

        // STEP 2: Synthesize phantom mirror entries for jet types that are
        // missing on the opposite team. Maps are always paired 1:1
        // (F22<->SU57, F16<->JAS39), so observing one side guarantees the
        // other side exists in the world even if SDK CompareVehicleName
        // can't identify it.
        const snapshot = discoveredVehicleSpawners.slice();
        for (const ds of snapshot) {
            if (!ds.vehicleType) continue;
            if (!isJetType(ds.vehicleType)) continue; // jets only
            const otherTeam = ds.teamId === 1 ? 2 : ds.teamId === 2 ? 1 : 0;
            if (otherTeam === 0) continue;
            const counterType = getFactionCounterpart(ds.vehicleType);
            if (!counterType || !isJetType(counterType)) continue;
            // Skip if other team already has this jet type (real OR phantom).
            const dup = discoveredVehicleSpawners.some(d =>
                d.teamId === otherTeam && d.vehicleType === counterType
            );
            if (dup) continue;
            const meta = findVehicleMeta(counterType);
            if (!meta) continue;
            const cand = takeCandidate();
            if (!cand) continue;
            const mirrored: DiscoveredVehicleSpawner = {
                spawnerId: cand.spawnerId,
                spawner: cand.spawner,
                position: null,
                vehicleType: counterType,
                matchTypes: [counterType],
                label: meta.label,
                category: meta.category,
                teamId: otherTeam,
                objectiveLetter: ds.objectiveLetter,
                needsForceSpawn: true, // phantom handle, force-spawn fallback
            };
            discoveredVehicleSpawners.push(mirrored);
            confirmedSpawnerIds.add(cand.spawnerId);
            spawnerTeamCache.set(cand.spawnerId, otherTeam);
            added++;
            logD(`[Discovery] Mirrored JET ${meta.label} T${otherTeam} (counterpart of ${ds.label} T${ds.teamId})`);
        }
        return added;
    }

    function _legacyMirrorFactionPairs_DISABLED(): number {
        let added = 0;
        const snapshot = discoveredVehicleSpawners.slice();
        for (const ds of snapshot) {
            if (!ds.vehicleType) continue;
            const otherTeam = ds.teamId === 1 ? 2 : ds.teamId === 2 ? 1 : 0;
            if (otherTeam === 0) continue;
            const counterType = getFactionCounterpart(ds.vehicleType) || ds.vehicleType;
            // Skip if other team already has this type (or its faction match)
            const matchTypes = getFactionMatchTypes(counterType);
            const dup = discoveredVehicleSpawners.some(d =>
                d.teamId === otherTeam && d.vehicleType !== null &&
                (d.vehicleType === counterType || matchTypes.indexOf(d.vehicleType) >= 0)
            );
            if (dup) continue;
            const meta = findVehicleMeta(counterType);
            if (!meta) continue;
            const cand = takeCandidate();
            if (!cand) continue;
            const mirrored: DiscoveredVehicleSpawner = {
                spawnerId: cand.spawnerId,
                spawner: cand.spawner,
                position: null,
                vehicleType: counterType,
                matchTypes: matchTypes,
                label: meta.label,
                category: meta.category,
                teamId: otherTeam,
                objectiveLetter: ds.objectiveLetter,
                needsForceSpawn: true, // phantom handle, always needs force-spawn fallback
            };
            discoveredVehicleSpawners.push(mirrored);
            confirmedSpawnerIds.add(cand.spawnerId);
            spawnerTeamCache.set(cand.spawnerId, otherTeam);
            added++;
            logD(`[Discovery] Mirrored ${meta.label} T${otherTeam} (counterpart of ${ds.label} T${ds.teamId})`);
        }
        return added;
    }

    // =========================================================================
    // PUBLIC API (preserves names used by VehicleSpawnUIModule)
    // =========================================================================

    export function AutoDiscovery_DetectVehicleLayout(): void {
        // No-op in passive observation mode -- trust the map's autospawn.
    }

    export function AutoDiscovery_IdentifyVehicles(): number {
        if (discoveryComplete) return 0;
        const now = mod.GetMatchTimeElapsed();
        if (firstObservationTime < 0 && discoveredVehicleSpawners.length > 0) {
            firstObservationTime = now;
        }
        if (firstObservationTime >= 0 && (now - firstObservationTime) >= DISCOVERY_SETTLE_SECONDS) {
            discoveryComplete = true;
            logD(`[Discovery] OBSERVATION SETTLED: ${discoveredVehicleSpawners.length} (team, type) entries`);
        } else if (now > 15 && discoveredVehicleSpawners.length === 0) {
            discoveryComplete = true;
            logD(`[Discovery] WARNING: 15s elapsed with no observations`);
        }
        return discoveredVehicleSpawners.length;
    }

    export function getIdentifiedVehicleCount(): number {
        let c = 0;
        for (const ds of discoveredVehicleSpawners) if (ds.vehicleType !== null) c++;
        return c;
    }

    export function AutoDiscovery_IsComplete(): boolean { return discoveryComplete; }

    export function AutoDiscovery_HasPendingLabelCorrections(): boolean {
        if (labelCorrectionsNeeded) { labelCorrectionsNeeded = false; return true; }
        return false;
    }

    export function AutoDiscovery_UpdateSpawnerActualType(spawnerId: number, vehicle: mod.Vehicle): void {
        const ds = discoveredVehicleSpawners.find(d => d.spawnerId === spawnerId);
        if (!ds || !ds.vehicleType) return;
        const id = identifyVehicleType(vehicle);
        if (!id) return;
        if (id.type === ds.vehicleType) return;
        if (ds.teamId !== 0 && !isFactionAppropriate(id.type, ds.teamId)) {
            logV(`[Discovery] Blocked cross-faction correction spawner ${spawnerId}`);
            return;
        }
        if (isJetType(id.type)) return;
        logD(`[Discovery] Corrected spawner ${spawnerId}: ${ds.label} -> ${id.label}`);
        ds.vehicleType = id.type;
        ds.label = id.label;
        ds.category = id.category;
        labelCorrectionsNeeded = true;
    }

    export function AutoDiscovery_ConfirmSpawner(spawnerId: number, teamId: number): void {
        confirmedSpawnerIds.add(spawnerId);
        const ds = discoveredVehicleSpawners.find(d => d.spawnerId === spawnerId);
        if (ds && ds.teamId === 0 && (teamId === 1 || teamId === 2)) {
            ds.teamId = teamId;
            spawnerTeamCache.set(spawnerId, teamId);
        }
    }

    export function AutoDiscovery_GetAlternateSpawners(currentSpawnerId: number, teamId: number): number[] {
        const alts: number[] = [];
        for (const ds of discoveredVehicleSpawners) {
            if (ds.spawnerId === currentSpawnerId) continue;
            if (ds.teamId !== teamId) continue;
            alts.push(ds.spawnerId);
        }
        for (const c of candidateSpawners) {
            if (c.used) continue;
            if (c.spawnerId === currentSpawnerId) continue;
            alts.push(c.spawnerId);
        }
        return alts;
    }

    export function getDiscoveredVehiclesForTeam(teamId: number): DiscoveredVehicleSpawner[] {
        return discoveredVehicleSpawners.filter(v => v.teamId === teamId && v.vehicleType !== null);
    }

    export function AutoDiscovery_EnableAutoSpawnProbe(): void { autoSpawnProbeActive = false; }
    export function AutoDiscovery_FinalizeAutoSpawnProbe(): void { autoSpawnProbeActive = false; }
    export function AutoDiscovery_IsAutoSpawnProbeActive(): boolean { return autoSpawnProbeActive; }

    // =========================================================================
    // CAPTURE-REWARD SPAWNER MANAGEMENT
    // =========================================================================
    interface PendingDisable { spawnerId: number; label: string; enabledAt: number; }
    const captureRewardsGiven: Set<number> = new Set();
    const pendingAutoSpawnDisables: PendingDisable[] = [];
    const REWARD_DISABLE_DELAY_SECONDS = 30.0;

    const REWARD_VEHICLE_POOL: { type: mod.VehicleList; label: string }[] = [
        { type: mod.VehicleList.Marauder, label: "Marauder" },
        { type: mod.VehicleList.Vector,   label: "Vector"   },
        { type: mod.VehicleList.Flyer60,  label: "Flyer"    },
        { type: mod.VehicleList.AH6M,     label: "AH6M"     },
        { type: mod.VehicleList.UH60,     label: "UH60"     },
    ];

    export function AutoDiscovery_DisableObjectiveSpawners(): void {
        let count = 0;
        captureRewardsGiven.clear();
        pendingAutoSpawnDisables.length = 0;
        for (const ds of discoveredVehicleSpawners) {
            if (!ds.objectiveLetter) continue;
            try { mod.SetVehicleSpawnerAutoSpawn(ds.spawner, false); count++; } catch (_e) {}
        }
        if (count > 0) logD(`[Discovery] Disabled ${count} capture-reward spawner(s)`);
    }

    export function AutoDiscovery_OnObjectiveCaptured(objId: number, capturingTeamId: number): void {
        const obj = OBJECTIVES.find(o => o.objId === objId);
        if (!obj) return;
        const letter = obj.id;
        const rewards = discoveredVehicleSpawners.filter(ds => ds.objectiveLetter === letter);
        for (const ds of rewards) {
            if (captureRewardsGiven.has(ds.spawnerId)) continue;
            captureRewardsGiven.add(ds.spawnerId);
            const pick = REWARD_VEHICLE_POOL[Math.floor(Math.random() * REWARD_VEHICLE_POOL.length)];
            try {
                mod.SetVehicleSpawnerVehicleType(ds.spawner, pick.type);
                mod.SetVehicleSpawnerAutoSpawn(ds.spawner, true);
                logD(`[CaptureReward] obj ${letter} captured by T${capturingTeamId} -> ${pick.label}`);
            } catch (e) {
                logD(`[CaptureReward] enable failed spawner ${ds.spawnerId}: ${e}`);
                continue;
            }
            pendingAutoSpawnDisables.push({
                spawnerId: ds.spawnerId,
                label: `${pick.label} at obj ${letter}`,
                enabledAt: mod.GetMatchTimeElapsed(),
            });
        }
    }

    export function AutoDiscovery_TickCaptureRewards(): void {
        if (pendingAutoSpawnDisables.length === 0) return;
        const t = mod.GetMatchTimeElapsed();
        for (let i = pendingAutoSpawnDisables.length - 1; i >= 0; i--) {
            const p = pendingAutoSpawnDisables[i];
            if (t - p.enabledAt < REWARD_DISABLE_DELAY_SECONDS) continue;
            pendingAutoSpawnDisables.splice(i, 1);
            try {
                const sp = mod.GetVehicleSpawner(p.spawnerId);
                mod.SetVehicleSpawnerAutoSpawn(sp, false);
                logD(`[CaptureReward] disabled ${p.label}`);
            } catch (e) {
                logD(`[CaptureReward] disable error spawner ${p.spawnerId}: ${e}`);
            }
        }
    }

    // =========================================================================
    // MASTER ENTRY POINT
    // =========================================================================
    export function AutoDiscovery_Init(): void {
        if (discoveryComplete) return;

        logD("=".repeat(50));
        logD("[Discovery] Zero-Config Passive-Observation Discovery starting...");

        try {
            mod.SetVehicleCategoryAllowedInSurroundingArea(mod.VehicleCategories.Air_Plane, true);
        } catch (_e) {}

        discoverObjectives();
        discoverAISpawners();

        const t1Obj: number[] = [];
        const t2Obj: number[] = [];
        for (let i = 1; i <= 10; i++) {
            if (probeSpawner(4100 + i)) t1Obj.push(4100 + i);
            if (probeSpawner(4200 + i)) t2Obj.push(4200 + i);
        }
        TEAM1_OBJ_SPAWNER_IDS = t1Obj;
        TEAM2_OBJ_SPAWNER_IDS = t2Obj;
        if (t1Obj.length > 0 || t2Obj.length > 0) {
            logD(`[Discovery] Objective Spawners T1=[${t1Obj.join(",")}] T2=[${t2Obj.join(",")}]`);
        }

        discoverVehicleSpawners();

        // Sweep AllVehicles() to catch vehicles already alive when mod started
        try {
            const all = mod.AllVehicles();
            const n = mod.CountOf(all);
            for (let i = 0; i < n; i++) {
                const v = mod.ValueInArray(all, i) as mod.Vehicle;
                if (v) AutoDiscovery_OnVehicleSpawned(v);
            }
            logD(`[Discovery] Init sweep: ${n} pre-existing vehicles`);
        } catch (_e) {}

        logD("[Discovery] Init done -- passive observation active");
        logD("=".repeat(50));
    }

    /**
     * Re-sweep mod.AllVehicles() to pick up any vehicle that wasn't alive at
     * init time (e.g. F16 spawners that auto-spawn after a short delay, or
     * spawners with no ObjId that the engine creates lazily). Safe to call
     * repeatedly from the tick loop -- observedVehicleObjIds dedupes.
     */
    export function AutoDiscovery_ResweepLiveVehicles(): number {
        let added = 0;
        try {
            const all = mod.AllVehicles();
            const n = mod.CountOf(all);
            const before = discoveredVehicleSpawners.length;
            for (let i = 0; i < n; i++) {
                const v = mod.ValueInArray(all, i) as mod.Vehicle;
                if (v) AutoDiscovery_OnVehicleSpawned(v);
            }
            added = discoveredVehicleSpawners.length - before;
        } catch (_e) {}
        return added;
    }
}
