/// <reference path="../config/StandaloneConfig.ts" />
/// <reference path="AutoDiscoveryModule.ts" />
/// <reference path="../lib/callback-handler.ts" />
/// <reference path="../lib/events.ts" />
/// <reference path="../lib/ui-v8.ts" />

/**
 * VehicleSpawnUIModule - Universal (V15)
 * 
 * Vehicle deploy UI that uses auto-discovered spawners from AutoDiscoveryModule.
 * No per-map vehicle configs. Builds UI dynamically from discovered vehicle spawners.
 *
 * Button colors (3 states):
 *   BLUE    = Vehicle available (empty/spawned) -> deploy as pilot
 *   GREEN   = Vehicle occupied but has spare seats -> deploy as passenger
 *   BLACK   = Unavailable (cooldown/full/jet cooldown) -> unclickable
 */

namespace VehicleUIStandalone {
    let vehicleUIInitialized = false;

    const playerPanels: Map<number, UI.UIContainer> = new Map();
    // Tracks which team each cached panel was built for. If a player's team
    // changes (or wasn't known at first creation), the panel is rebuilt.
    const playerPanelTeam: Map<number, number> = new Map();
    const playerButtons: Map<number, Map<number, UI.UITextButton>> = new Map();
    const playerButtonStateSetters: Map<number, Map<number, SolidUI.Setter<ButtonVisualState>>> = new Map();
    const playerPanelDisposers: Map<number, () => void> = new Map();
    const playerUIVisible: Set<number> = new Set();

    interface ButtonVisualState {
        enabled: boolean;
        baseColor: mod.Vector;
    }

    const suppressUIUntilByPlayerId: Map<number, number> = new Map();
    const pendingDeploySeat: Map<number, { vehicleObjId: number; seatIndex: number; label: string; seatGen: number; claimRequestedPilot: boolean }> = new Map();

    interface PendingSpawnRequest {
        spawnerId: number;
        teamId: number;
        vehicleType: mod.VehicleList;
        matchTypes: mod.VehicleList[];
        label: string;
        seatGen: number;
        time: number;
    }
    const pendingSpawnRequestsByPlayerId: Map<number, PendingSpawnRequest> = new Map();
    const assignedSpawnedVehicleIdByPlayerId: Map<number, number> = new Map();
    const MAX_SPAWN_ASSIGN_SECONDS = 8.0;
    const ATTACK_HELI_SPAWN_WAIT_SECONDS = 45.0;
    const playerSeatGeneration: Map<number, number> = new Map();

    let lastButtonClickTime = 0;
    const BUTTON_DEBOUNCE_SECONDS = 1.0;

    // ========================================================================
    // UI POSITION CONFIG  (VehicleUIuniversal)
    // Tuned to sit BELOW the top game-UI bar so it works for players who keep
    // the default in-game HUD visible (no auto-hide).
    //
    // Coordinate system:
    //   - Anchor = mod.UIAnchor enum, controls which screen edge x/y are from.
    //   - x is HORIZONTAL offset from anchor (TopCenter -> 0 means centered).
    //   - y is VERTICAL offset from anchor (positive = downward from top).
    //
    // To move the strip elsewhere, change ONLY UI_PANEL_ANCHOR / UI_PANEL_X /
    // UI_PANEL_Y. Example presets:
    //   Below top-HUD (default):     TopCenter,    x=0,    y=110
    //   Just under top-HUD edge:     TopCenter,    x=0,    y=80
    //   Bottom-left near deploy:     BottomLeft,   x=20,   y=-90
    //   Bottom-right above weapons:  BottomRight,  x=-20,  y=-110
    //   Top-right tucked corner:     TopRight,     x=-20,  y=110
    // ========================================================================
    const UI_PANEL_ANCHOR = mod.UIAnchor.TopCenter;
    const UI_PANEL_X = 0;
    const UI_PANEL_Y = 170;   // moved further down to clear ticket bar AND A-E flag row in deploy screen
    const BUTTON_SIZE = 50;
    const BUTTON_GAP = 6;
    const ROW_HEIGHT = BUTTON_SIZE + 10; // unused - single row only
    const BUTTONS_PER_ROW = 999;        // all buttons in one row, no wrapping
    const MAX_BUTTONS = 999;            // cap how many vehicle buttons show per team (999 = no limit)

    // ========================================================================
    // CLICK DIAGNOSTICS (VehicleUIuniversal)
    // When true, every button click pops an on-screen toast describing what
    // happened (or which silent gate rejected the click). Use for testing on
    // platforms with no log access (Xbox / PlayStation). Flip to false for
    // release builds.
    // ========================================================================
    const CLICK_DIAGNOSTICS = true;

    function clickToast(player: mod.Player, msg: string): void {
        if (!CLICK_DIAGNOSTICS) return;
        try {
            mod.DisplayCustomNotificationMessage(
                mod.Message("{0}", "[VUI] " + msg),
                mod.CustomNotificationSlots.MessageText1,
                3.0,
                player
            );
        } catch (_e) {}
    }

    type VehicleCategory = 'Ground' | 'Air';

    interface VehicleDef {
        type: mod.VehicleList;
        label: string;
        spawnerId: number;
        category: VehicleCategory;
        matchTypes?: mod.VehicleList[];
    }

    // =========================================================================
    // DYNAMIC VEHICLE CONFIG (from AutoDiscoveryModule)
    // =========================================================================

    let team1Vehicles: VehicleDef[] = [];
    let team2Vehicles: VehicleDef[] = [];
    let _lastBuildSig: string = "";

    function buildVehicleDefsFromDiscovery(): void {
        // Ensure both teams have buttons even when only one team's vehicles
        // were observed -- mirror via FACTION_PAIRS counterparts.
        try { AutoDiscovery_MirrorFactionPairs(); } catch (_e) {}

        team1Vehicles = [];
        team2Vehicles = [];

        // Pre-compute which VehicleList types are physically present on this
        // map RIGHT NOW. SPAWNER_VEHICLE_TYPE_HINTS unconditionally pre-assigns
        // jet types to engine-baked spawner IDs (232/233/243/247) which return
        // valid handles on EVERY map -- including maps with zero jets. Without
        // this filter, a phantom F22/SU57/JAS39 button appears on every map.
        // Likewise any hinted ground spawner whose vehicle simply isn't on the
        // map should be hidden. Confirmed spawners (already produced a vehicle
        // at runtime) bypass the filter so a force-spawned vehicle that died
        // doesn't make its button vanish mid-match.
        // Build the set of unique VehicleList references referenced by any def.
        // VehicleList opaque values stringify identically, so we cannot use
        // String/template-literal keys -- use === reference comparison (array).
        const probeTypes: mod.VehicleList[] = [];
        for (const vs of discoveredVehicleSpawners) {
            const types = vs.matchTypes ?? (vs.vehicleType ? [vs.vehicleType] : []);
            for (const t of types) {
                let dup = false;
                for (let i = 0; i < probeTypes.length; i++) { if (probeTypes[i] === t) { dup = true; break; } }
                if (!dup) probeTypes.push(t);
            }
        }
        // Mark which probeTypes are physically present in the world right now.
        const liveTypeFlags: boolean[] = new Array(probeTypes.length).fill(false);
        try {
            const allV = mod.AllVehicles();
            if (allV) {
                const c = mod.CountOf(allV);
                for (let i = 0; i < c; i++) {
                    const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                    if (!v) continue;
                    for (let p = 0; p < probeTypes.length; p++) {
                        if (liveTypeFlags[p]) continue;
                        try { if (mod.CompareVehicleName(v, probeTypes[p])) liveTypeFlags[p] = true; } catch (_e) {}
                    }
                }
            }
        } catch (_e) {}
        const isTypeLive = (t: mod.VehicleList): boolean => {
            for (let i = 0; i < probeTypes.length; i++) { if (probeTypes[i] === t) return liveTypeFlags[i]; }
            return false;
        };

        let droppedPhantom = 0;
        for (const vs of discoveredVehicleSpawners) {
            if (vs.vehicleType === null) continue;
            // Capture-reward entries: HIDDEN until the objective is captured.
            // Per design, reward vehicles only spawn (and only become buttons)
            // after capture. They will be re-discovered via OnVehicleSpawned at
            // that point and added to the UI on the next rebuild.
            if (vs.objectiveLetter) continue;

            // Phantom-spawner filter: drop if no matching vehicle exists in the
            // world AND the spawner has never produced one. Confirmed spawners
            // are always kept so legitimately-empty post-death buttons stay.
            if (!confirmedSpawnerIds.has(vs.spawnerId)) {
                const types = vs.matchTypes ?? [vs.vehicleType];
                let anyLive = false;
                for (const t of types) { if (isTypeLive(t)) { anyLive = true; break; } }
                if (!anyLive) { droppedPhantom++; continue; }
            }

            const def: VehicleDef = {
                type: vs.vehicleType,
                label: vs.label,
                spawnerId: vs.spawnerId,
                category: vs.category,
                matchTypes: vs.matchTypes,
            };

            if (vs.teamId === 1) team1Vehicles.push(def);
            else if (vs.teamId === 2) team2Vehicles.push(def);
        }

        // Spawner team is fixed per spawner ID (from SPAWNER_TEAM_HINTS),
        // so no faction swap needed - T1 players use T1 spawners regardless of faction.

        const sig = `T1=${team1Vehicles.length}|T2=${team2Vehicles.length}|drop=${droppedPhantom}`;
        if (sig !== _lastBuildSig) {
            _lastBuildSig = sig;
            log(`[VehicleUI] Built vehicle defs from discovery: T1=${team1Vehicles.length}, T2=${team2Vehicles.length}${droppedPhantom > 0 ? ` (dropped ${droppedPhantom} phantom hints)` : ''}`);
        }
    }

    /** Stable signature of the *spawner ID set* across both teams. Used by
     *  initVehicleSpawnUI() to detect when discovery has added or REPLACED
     *  spawners (e.g. a phantom mirror jet entry got pruned and a real
     *  spawner took its slot). Counting alone misses replacements -- the
     *  net length doesn't change, so the UI never rebuilds and the phantom
     *  button keeps pointing at a dead spawner. */
    function currentSpawnerSetSignature(): string {
        const t1 = team1Vehicles.map(v => v.spawnerId).sort((a, b) => a - b).join(',');
        const t2 = team2Vehicles.map(v => v.spawnerId).sort((a, b) => a - b).join(',');
        return `T1[${t1}]|T2[${t2}]`;
    }

    function getTeam1Vehicles(): VehicleDef[] { return team1Vehicles; }
    function getTeam2Vehicles(): VehicleDef[] { return team2Vehicles; }

    // =========================================================================
    // JET COOLDOWN
    // =========================================================================
    const jetCooldownByPlayerId: Map<number, number> = new Map();
    const JET_COOLDOWN_SECONDS = 30.0;
    const JET_VEHICLE_TYPES: mod.VehicleList[] = [mod.VehicleList.F22, mod.VehicleList.F16, mod.VehicleList.JAS39, mod.VehicleList.SU57];

    // Every VehicleList entry the SDK knows about. Used by the F16 elimination
    // fallback to confirm "this candidate matches NO known type" before
    // adopting it as an unidentified jet. Stationary emplacements like
    // BGM71TOW or GDF009 are NOT in mod.VehicleList, so they will fail every
    // CompareVehicleName check and would otherwise be misclassified as F16
    // without an additional spatial gate (jet runway proximity).
    const ALL_KNOWN_VEHICLE_TYPES: mod.VehicleList[] = [
        mod.VehicleList.Abrams, mod.VehicleList.AH64, mod.VehicleList.AH6M, mod.VehicleList.AH6M_Pax,
        mod.VehicleList.Cheetah, mod.VehicleList.CV90, mod.VehicleList.DirtBike, mod.VehicleList.DirtBike_Pax,
        mod.VehicleList.Eurocopter, mod.VehicleList.F16, mod.VehicleList.F22, mod.VehicleList.Flyer60,
        mod.VehicleList.Gepard, mod.VehicleList.GolfCart, mod.VehicleList.JAS39, mod.VehicleList.Leopard,
        mod.VehicleList.M2Bradley, mod.VehicleList.Marauder, mod.VehicleList.Marauder_Pax,
        mod.VehicleList.Quadbike, mod.VehicleList.RHIB, mod.VehicleList.SU57, mod.VehicleList.UH60,
        mod.VehicleList.UH60_Pax, mod.VehicleList.Vector,
    ];

    // Screen effect applied to a player from the moment they click a vehicle
    // button until they're seated. Masks the camera fly-through that
    // ForcePlayerToSeat does when teleporting from HQ to the vehicle.
    // Options (BF6 SDK): mod.ScreenEffects.Saturated | Stealth | VL7
    const SEAT_TRANSITION_SCREEN_EFFECT: mod.ScreenEffects = mod.ScreenEffects.Stealth;

    function isJetVehicle(vehicleType: mod.VehicleList): boolean { return JET_VEHICLE_TYPES.includes(vehicleType); }
    function isAttackHeliVehicleType(vt: mod.VehicleList): boolean { return vt === mod.VehicleList.AH6M || vt === mod.VehicleList.AH6M_Pax || vt === mod.VehicleList.AH64 || vt === mod.VehicleList.Eurocopter; }
    function includesAttackHeli(vts: mod.VehicleList[]): boolean { for (const vt of vts) { if (isAttackHeliVehicleType(vt)) return true; } return false; }
    function getJetCooldownRemaining(pid: number): number { const e = jetCooldownByPlayerId.get(pid); if (!e) return 0; const r = e - mod.GetMatchTimeElapsed(); return r > 0 ? r : 0; }
    function setJetCooldown(pid: number): void { jetCooldownByPlayerId.set(pid, mod.GetMatchTimeElapsed() + JET_COOLDOWN_SECONDS); }

    // Returns true if there's an unoccupied jet of one of the matchTypes already
    // sitting in the world that this player could adopt. Used to bypass the
    // 30s cooldown when there's no need to ForceSpawn a new jet, AND to drive
    // the BLUE/BLACK button color so the UI matches what a click can actually
    // achieve.
    //
    // For jet types we add an elimination-fallback path: when no vehicle matches
    // by name (the SDK's CompareVehicleName(v, F16/F22/etc.) sometimes returns
    // false on certain maps), we look for unidentified vehicles within proximity
    // of the team's HQ centroid or another identified jet -- the same heuristic
    // the click handler uses to seat the player. This keeps the button BLUE
    // when the click would actually succeed.
    function hasIdleMatchingJet(matchTypes: mod.VehicleList[], teamId: number = 0): boolean {
        const wantsJet = matchTypes.some(t => JET_VEHICLE_TYPES.includes(t));
        try {
            const allV = mod.AllVehicles();
            if (!allV) return false;
            const vc = mod.CountOf(allV);

            // Pass 1: name-match (works when CompareVehicleName behaves)
            for (let i = 0; i < vc; i++) {
                const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                if (!v) continue;
                if (!matchesAnyVehicleType(v, matchTypes)) continue;
                let vid = 0;
                try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                if (vid === 0) continue;
                if (reservedVehicleIds.has(vid)) continue;
                let occ = true;
                try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                if (!occ) return true;
            }

            // Pass 2 (jets only): elimination + HQ/jet-anchor proximity.
            if (!wantsJet || teamId === 0) return false;

            const jetAnchors: { x: number; y: number; z: number }[] = [];
            for (let i = 0; i < vc; i++) {
                const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                if (!v) continue;
                let isAnyKnownJet = false;
                try {
                    isAnyKnownJet =
                        mod.CompareVehicleName(v, mod.VehicleList.F22) ||
                        mod.CompareVehicleName(v, mod.VehicleList.F16) ||
                        mod.CompareVehicleName(v, mod.VehicleList.JAS39) ||
                        mod.CompareVehicleName(v, mod.VehicleList.SU57);
                } catch (_e) {}
                if (!isAnyKnownJet) continue;
                const p = getVehiclePosition(v);
                if (!p) continue;
                jetAnchors.push({
                    x: mod.XComponentOf(p),
                    y: mod.YComponentOf(p),
                    z: mod.ZComponentOf(p),
                });
            }
            const hq = AutoDiscovery_GetTeamHQCentroid(teamId);
            if (hq) jetAnchors.push(hq);
            if (jetAnchors.length === 0) return false;

            const TIGHT_SQ = 400.0 * 400.0;
            const HQ_SQ = 1500.0 * 1500.0;
            for (let i = 0; i < vc; i++) {
                const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                if (!v) continue;
                let occ = true;
                try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                if (occ) continue;
                let isAnyKnown = false;
                try {
                    for (const def of ALL_KNOWN_VEHICLE_TYPES) {
                        if (mod.CompareVehicleName(v, def)) { isAnyKnown = true; break; }
                    }
                } catch (_e) {}
                if (isAnyKnown) continue;
                let vid = 0;
                try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                if (vid === 0) continue;
                if (reservedVehicleIds.has(vid)) continue;
                const p = getVehiclePosition(v);
                if (!p) continue;
                const px = mod.XComponentOf(p);
                const py = mod.YComponentOf(p);
                const pz = mod.ZComponentOf(p);
                for (let ai = 0; ai < jetAnchors.length; ai++) {
                    const a = jetAnchors[ai];
                    const dx = px - a.x, dy = py - a.y, dz = pz - a.z;
                    const distSq = dx * dx + dy * dy + dz * dz;
                    const isHqAnchor = (hq !== null && ai === jetAnchors.length - 1);
                    const limit = isHqAnchor ? HQ_SQ : TIGHT_SQ;
                    if (distSq <= limit) return true;
                }
            }
        } catch (_e) {}
        return false;
    }

    function showVehicleRequestNotification(message: string): void {
        try { mod.DisplayCustomNotificationMessage(mod.Message("{0}", message), mod.CustomNotificationSlots.MessageText1, 1.5); } catch (_e) {}
    }

    // =========================================================================
    // VEHICLE STATE TRACKING
    // =========================================================================
    type VehicleAvailability = 'empty' | 'full' | 'cooldown' | 'no_vehicle';

    interface SpawnerState {
        spawnerId: number;
        vehicleDef: VehicleDef;
        availability: VehicleAvailability;
        vehicleObjId: number | null;
        cooldownStartTime: number;
        cooldownDuration: number;
        firstEmptySeat: number;
        totalSeats: number;
        occupiedSeats: number;
    }

    const spawnerStateMap: Map<number, SpawnerState> = new Map();
    const vehicleIdToSpawnerId: Map<number, number> = new Map();
    const SPAWNER_COOLDOWN_SECONDS = 30.0;
    let lastUIStatusUpdateTime = 0;
    const UI_STATUS_UPDATE_INTERVAL = 0.5;
    const badVehicleIds: Set<number> = new Set();
    let lastBadVehicleClearTime = 0;
    const BAD_VEHICLE_CLEAR_INTERVAL = 300.0;
    const vehicleInitialPosition: Map<number, mod.Vector> = new Map();
    // HQ deploy gate: if a tracked vehicle is empty AND further than this from
    // its spawn point, the BLUE "deploy as pilot" button hides (BLACK) and
    // solo deploy is blocked. The vehicle/spawner link is NOT severed -- if
    // someone climbs in (-> has_seats / GREEN passenger button) or the vehicle
    // returns to HQ, tracking resumes naturally.
    // Air vehicles are exempt (jets/helis fly far from HQ in normal play and
    // are always meant to be deployable from HQ when empty).
    const HQ_EMPTY_DEPLOY_RADIUS = 60.0;
    // Hard unlink distance (vehicle considered orphaned, e.g. teleported far
    // away by other scripts). OnVehicleDestroyed handles real destruction.
    const ABANDONED_VEHICLE_DISTANCE = 5000.0;

    function getVehiclePosition(vehicle: mod.Vehicle): mod.Vector | null {
        try { return mod.GetVehicleState(vehicle, mod.VehicleStateVector.VehiclePosition); } catch (_e) { return null; }
    }

    function getVehicleDistanceFromSpawn(vehicle: mod.Vehicle, vehicleObjId: number): number {
        const initialPos = vehicleInitialPosition.get(vehicleObjId);
        if (!initialPos) return -1;
        try {
            const currentPos = getVehiclePosition(vehicle);
            if (!currentPos) return -1;
            const dx = mod.XComponentOf(currentPos) - mod.XComponentOf(initialPos);
            const dy = mod.YComponentOf(currentPos) - mod.YComponentOf(initialPos);
            const dz = mod.ZComponentOf(currentPos) - mod.ZComponentOf(initialPos);
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        } catch (_e) { return -1; }
    }

    function getSpawnerSearchDistance(spawnerId: number): number {
        const state = spawnerStateMap.get(spawnerId);
        return state?.vehicleDef.category === 'Air' ? 150.0 : 80.0;
    }

    function initSpawnerStateTracking(): void {
        spawnerStateMap.clear();
        vehicleIdToSpawnerId.clear();
        vehicleInitialPosition.clear();
        const allDefs = [...getTeam1Vehicles(), ...getTeam2Vehicles()];
        for (const def of allDefs) {
            if (!spawnerStateMap.has(def.spawnerId)) {
                spawnerStateMap.set(def.spawnerId, {
                    spawnerId: def.spawnerId,
                    vehicleDef: def,
                    availability: 'no_vehicle',
                    vehicleObjId: null,
                    cooldownStartTime: 0,
                    cooldownDuration: SPAWNER_COOLDOWN_SECONDS,
                    firstEmptySeat: -1,
                    totalSeats: 0,
                    occupiedSeats: 0,
                });
            }
        }
    }

    // Distance threshold (squared) for "near HQ" when looking for a fresher
    // replacement vehicle. Slightly larger than HQ_EMPTY_DEPLOY_RADIUS so a
    // vehicle that respawned at the rack but hasn't been driven yet still
    // qualifies regardless of small placement variance.
    const HQ_REPLACEMENT_RADIUS_SQ = 100.0 * 100.0;

    /** When the linked vehicle is empty and far from its HQ initial position,
     *  see if the map already auto-respawned a fresh same-type unoccupied
     *  vehicle near that HQ position. If so, swap state.vehicleObjId to it
     *  and re-record the initial position. Returns true if a swap occurred.
     *
     *  Without this, the spawner state stays glued to the abandoned far-away
     *  vehicle forever and the button stays BLACK even though a brand new
     *  vehicle of the same type is sitting at HQ. */
    function trySwapToFresherVehicle(state: SpawnerState, oldVid: number): boolean {
        const oldInitPos = vehicleInitialPosition.get(oldVid);
        if (!oldInitPos) return false;
        const matchTypes = state.vehicleDef.matchTypes ?? [state.vehicleDef.type];
        let bestVid = 0;
        let bestVehicle: mod.Vehicle | null = null;
        let bestDistSq = HQ_REPLACEMENT_RADIUS_SQ;
        try {
            const all = mod.AllVehicles();
            if (!all) return false;
            const count = mod.CountOf(all);
            for (let i = 0; i < count; i++) {
                const v = mod.ValueInArray(all, i) as mod.Vehicle;
                if (!v) continue;
                let vid = 0;
                try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                if (vid === 0 || vid === oldVid) continue;
                // Skip vehicles already linked to another spawner.
                if (vehicleIdToSpawnerId.has(vid)) continue;
                if (reservedVehicleIds.has(vid)) continue;
                let occ = true;
                try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                if (occ) continue;
                if (!matchesAnyVehicleType(v, matchTypes)) continue;
                const pos = getVehiclePosition(v);
                if (!pos) continue;
                const dx = mod.XComponentOf(pos) - mod.XComponentOf(oldInitPos);
                const dy = mod.YComponentOf(pos) - mod.YComponentOf(oldInitPos);
                const dz = mod.ZComponentOf(pos) - mod.ZComponentOf(oldInitPos);
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq < bestDistSq) {
                    bestDistSq = distSq;
                    bestVid = vid;
                    bestVehicle = v;
                }
            }
        } catch (_e) { return false; }
        if (!bestVehicle || bestVid === 0) return false;
        // Detach from old vehicle.
        vehicleIdToSpawnerId.delete(oldVid);
        vehicleInitialPosition.delete(oldVid);
        // Attach to fresher one.
        state.vehicleObjId = bestVid;
        vehicleIdToSpawnerId.set(bestVid, getSpawnerIdForState(state));
        const initPos = getVehiclePosition(bestVehicle);
        if (initPos) vehicleInitialPosition.set(bestVid, initPos);
        log(`[VehicleUI] Swapped ${state.vehicleDef.label} link: abandoned ${oldVid} -> fresh ${bestVid} (dist=${Math.sqrt(bestDistSq).toFixed(1)}m)`);
        return true;
    }

    /** Reverse-lookup of spawnerId given a SpawnerState. We don't keep this
     *  cached on the state itself to avoid duplicating the map key. */
    function getSpawnerIdForState(state: SpawnerState): number {
        for (const [id, s] of spawnerStateMap) if (s === state) return id;
        return -1;
    }

    function probeVehicleSeats(state: SpawnerState): void {
        if (state.vehicleObjId === null) {
            state.availability = state.availability === 'cooldown' ? 'cooldown' : 'no_vehicle';
            state.firstEmptySeat = -1; state.totalSeats = 0; state.occupiedSeats = 0;
            return;
        }
        const vehicle = findVehicleById(state.vehicleObjId);
        if (!vehicle) {
            vehicleIdToSpawnerId.delete(state.vehicleObjId);
            vehicleInitialPosition.delete(state.vehicleObjId);
            state.vehicleObjId = null; state.availability = 'no_vehicle';
            state.firstEmptySeat = -1; state.totalSeats = 0; state.occupiedSeats = 0;
            return;
        }
        let seatCount = 1;
        try { seatCount = mod.GetVehicleSeatCount(vehicle); } catch (_e) {}
        // Jets are single-seat vehicles but Portal may report extra seats (ejection etc.)
        if (isJetVehicle(state.vehicleDef.type)) seatCount = 1;
        state.totalSeats = seatCount;
        let occupiedCount = 0; let firstEmpty = -1;
        let seatCheckErrors = 0;
        for (let s = 0; s < seatCount; s++) {
            try {
                if (mod.IsVehicleSeatOccupied(vehicle, s)) occupiedCount++;
                else if (firstEmpty === -1) firstEmpty = s;
            } catch (_e) { seatCheckErrors++; }
        }
        // If ALL seat checks threw, fall back to IsVehicleOccupied
        if (seatCheckErrors === seatCount && occupiedCount === 0) {
            try { if (mod.IsVehicleOccupied(vehicle)) { occupiedCount = 1; firstEmpty = -1; } } catch (_e) {}
        }
        state.occupiedSeats = occupiedCount;
        state.firstEmptySeat = firstEmpty;

        if (occupiedCount === 0) {
            // Hard-unlink only if extremely far (orphaned/teleported).
            const isAir = state.vehicleDef.category === 'Air';
            if (!isAir) {
                const dist = getVehicleDistanceFromSpawn(vehicle, state.vehicleObjId!);
                if (dist >= 0 && dist > ABANDONED_VEHICLE_DISTANCE) {
                    vehicleIdToSpawnerId.delete(state.vehicleObjId!);
                    vehicleInitialPosition.delete(state.vehicleObjId!);
                    state.vehicleObjId = null; state.availability = 'no_vehicle';
                    state.firstEmptySeat = -1; state.totalSeats = 0; state.occupiedSeats = 0;
                    return;
                }
                // Empty + away from HQ -> previously kept the link and showed
                // BLACK, expecting the vehicle to return. In practice the map
                // auto-respawns a fresh vehicle of the same type at HQ, but the
                // spawner state was stuck on the abandoned far-away one and the
                // new one never got adopted. Look for a closer unoccupied
                // matching vehicle near the linked vehicle's initial (HQ)
                // position and swap the link to it. If none is found, fall
                // through to no_vehicle so the button stays BLACK.
                if (dist >= 0 && dist > HQ_EMPTY_DEPLOY_RADIUS) {
                    const swapped = trySwapToFresherVehicle(state, state.vehicleObjId!);
                    if (swapped) {
                        // re-probe seat occupancy on the new vehicle
                        probeVehicleSeats(state);
                        return;
                    }
                    state.availability = 'no_vehicle';
                    return;
                }
            }
            state.availability = 'empty';
        } else if (firstEmpty !== -1) {
            // Pilot seat empty -> 'empty' (BLUE), pilot seat occupied -> 'full'.
            // We deliberately do NOT expose a 'spare seat / passenger' state:
            // players who want to enter an occupied vehicle as a passenger can
            // click the vehicle's icon on the map / approach it on foot.
            let seat0Occupied = false;
            try { seat0Occupied = mod.IsVehicleSeatOccupied(vehicle, 0); } catch (_e) {}
            state.availability = seat0Occupied ? 'full' : 'empty';
        } else {
            state.availability = 'full';
        }
    }

    function matchVehicleToSpawner(vehicle: mod.Vehicle, vehicleObjId: number, lenient: boolean = false): void {
        // NOTE: We deliberately DO NOT call mod.GetVehicleTeam() here.
        // It throws InvalidValue on freshly-spawned / transitioning / recycled
        // vehicles, and the engine logs every native exception even when JS
        // catches it -- which spammed PortalLog with thousands of stacks.
        // Cross-team safety is enforced below via the spawner's known team
        // combined with the per-faction CompareVehicleName check.
        let vehicleTeamNorm = 0;
        if (!badVehicleIds.has(vehicleObjId)) {
            try {
                const checkId = mod.GetObjId(vehicle);
                if (checkId !== vehicleObjId) { badVehicleIds.add(vehicleObjId); return; }
            } catch (_e) { badVehicleIds.add(vehicleObjId); return; }
        }

        // Lenient matching requires known vehicle team to prevent cross-team
        // false positives (vehicle team is often 0 at spawn time).
        if (lenient && vehicleTeamNorm === 0) lenient = false;

        for (const [spawnerId, state] of spawnerStateMap) {
            if (state.vehicleObjId !== null) continue;
            const spawnerTeamId = getSpawnerTeamId(spawnerId);
            if (vehicleTeamNorm !== 0 && vehicleTeamNorm !== spawnerTeamId) continue;

            const matchTypes = state.vehicleDef.matchTypes ?? [state.vehicleDef.type];
            const isStrictTypeMatch = matchesAnyVehicleType(vehicle, matchTypes);
            if (!isStrictTypeMatch) {
                if (!lenient) continue;
                const vehicleIsAir = isAirVehicleType(vehicle);
                const spawnerIsAir = state.vehicleDef.category === 'Air';
                if (vehicleIsAir !== spawnerIsAir) continue;
            }

            // matchTypes is now always a single type (no FACTION_PAIRS
            // expansion), so a successful strict CompareVehicleName plus the
            // spawner's known team is sufficient. The old FACTION_PAIRS-based
            // isFactionAppropriate gate was rejecting legitimate matches when
            // a map placed a vehicle on the "wrong" nominal-faction side
            // (e.g. Gepard on T1, Cheetah on T2 -- both legal map setups).

            state.vehicleObjId = vehicleObjId;
            vehicleIdToSpawnerId.set(vehicleObjId, spawnerId);
            const initPos = getVehiclePosition(vehicle);
            if (initPos) vehicleInitialPosition.set(vehicleObjId, initPos);
            probeVehicleSeats(state);
            // Only auto-correct label on strict type matches - lenient
            // (category-only) matches must NOT corrupt spawner labels.
            if (isStrictTypeMatch) {
                AutoDiscovery_UpdateSpawnerActualType(spawnerId, vehicle);
            }
            log(`[VehicleUI] Tracked ${state.vehicleDef.label} vehicle ${vehicleObjId} -> spawner ${spawnerId}${isStrictTypeMatch ? '' : ' (lenient)'}`);
            return;
        }
    }

    function getSpawnerTeamId(spawnerId: number): number {
        // Sentinel: when a creator leaves ObjId unset on a spawner we record it
        // as -1. Returning 1 here (the first def we'd otherwise match) would
        // bypass the seatPlayerDirectly faction-fallback team check and let a
        // T1 click adopt a T2-faction vehicle of the same type. Return 0 so
        // the faction fallback is forced to evaluate the actual vehicle type.
        if (spawnerId < 0) return 0;
        for (const def of getTeam1Vehicles()) { if (def.spawnerId === spawnerId) return 1; }
        for (const def of getTeam2Vehicles()) { if (def.spawnerId === spawnerId) return 2; }
        return 0;
    }

    function reprobeVehicle(vehicleObjId: number): void {
        const spawnerId = vehicleIdToSpawnerId.get(vehicleObjId);
        if (spawnerId === undefined) return;
        const state = spawnerStateMap.get(spawnerId);
        if (state) probeVehicleSeats(state);
    }

    function scanExistingVehicles(): void {
        try {
            const allVehicles = mod.AllVehicles();
            if (!allVehicles) return;
            const count = mod.CountOf(allVehicles);
            const now = mod.GetMatchTimeElapsed();
            if (now - lastBadVehicleClearTime > BAD_VEHICLE_CLEAR_INTERVAL) { badVehicleIds.clear(); lastBadVehicleClearTime = now; }

            // Validate existing matches -- only check vehicle still exists.
            // Team was validated at match time via type + faction; re-querying
            // GetVehicleTeam every tick throws InvalidValue on recycled vehicles.
            for (const [vId, spawnerId] of vehicleIdToSpawnerId.entries()) {
                const state = spawnerStateMap.get(spawnerId);
                if (!state) continue;
                // For bad vehicles (GetVehicleTeam threw previously), retry.
                // If still bad, keep the existing type-based match -- don't detach.
                // Pre-spawned vehicles (e.g. Badlands jets) may throw temporarily
                // but are still valid and correctly type-matched.
                if (badVehicleIds.has(vId)) {
                    const retryV = findVehicleById(vId);
                    if (!retryV) {
                        vehicleIdToSpawnerId.delete(vId);
                        vehicleInitialPosition.delete(vId);
                        state.vehicleObjId = null;
                        state.availability = 'no_vehicle';
                    }
                    // Vehicle still exists - keep match, skip further checks
                    continue;
                }
                const vehicle = findVehicleById(vId);
                if (!vehicle) {
                    vehicleIdToSpawnerId.delete(vId);
                    vehicleInitialPosition.delete(vId);
                    state.vehicleObjId = null;
                    state.availability = 'no_vehicle';
                    continue;
                }
                // Liveness check - GetObjId throws on stale handles
                try { mod.GetObjId(vehicle); } catch (_e) {
                    badVehicleIds.add(vId);
                    // Keep existing match - don't detach type-matched vehicles
                }
            }

            for (let i = 0; i < count; i++) {
                const vehicle = mod.ValueInArray(allVehicles, i) as mod.Vehicle;
                if (!vehicle) continue;
                try {
                    const vId = mod.GetObjId(vehicle);
                    if (vehicleIdToSpawnerId.has(vId)) continue;
                    // Don't skip bad vehicles - matchVehicleToSpawner handles
                    // unknown-team vehicles via type-only matching (team=0).
                    // Pre-spawned jets on Badlands need this to get tracked.
                    matchVehicleToSpawner(vehicle, vId, false);
                } catch (_e) {}
            }

        } catch (_e) {}
    }

    // =========================================================================
    // DEPLOY SCREEN DETECTION
    // =========================================================================
    const lastDeathTimeByPlayerId: Map<number, number> = new Map();
    const DEATHCAM_BLOCK_SECONDS = 3.0;
    const hasEverDeployedByPlayerId: Set<number> = new Set();
    const knownHumanPlayers: Set<number> = new Set();
    const knownAIPlayers: Set<number> = new Set();
    let tentativeHumanPlayerId: number | null = null;

    function isPlayerHumanCached(player: mod.Player): boolean {
        const playerId = mod.GetObjId(player);
        if (knownHumanPlayers.has(playerId)) return true;
        if (knownAIPlayers.has(playerId)) return false;
        const cachedAI = aiStatusByPlayerId[playerId];
        if (cachedAI === true) { knownAIPlayers.add(playerId); if (tentativeHumanPlayerId === playerId) tentativeHumanPlayerId = null; return false; }
        if (cachedAI === false) { knownHumanPlayers.add(playerId); return true; }
        try {
            // hasSoldier() now also calls IsPlayerValid, so a stale handle
            // will return false here and we skip the GetSoldierState call.
            if (hasSoldier(player)) {
                const isAI = safeGetSoldierStateBool(player, mod.SoldierStateBool.IsAISoldier);
                if (isAI) { knownAIPlayers.add(playerId); if (tentativeHumanPlayerId === playerId) tentativeHumanPlayerId = null; return false; }
                knownHumanPlayers.add(playerId); return true;
            }
        } catch (_e) {}
        if (tentativeHumanPlayerId === playerId) return true;
        if (tentativeHumanPlayerId === null) { tentativeHumanPlayerId = playerId; return true; }
        return false;
    }

    function isPlayerOnDeployScreen(player: mod.Player): boolean {
        try {
            const playerId = mod.GetObjId(player);
            const matchTime = mod.GetMatchTimeElapsed();
            const lastDeathTime = lastDeathTimeByPlayerId.get(playerId);
            if (lastDeathTime !== undefined && matchTime - lastDeathTime < DEATHCAM_BLOCK_SECONDS) return false;
            if (hasSoldier(player)) return false;
            const playerIsAlive = safeGetSoldierStateBool(player, mod.SoldierStateBool.IsAlive);
            const isInVehicle = safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle);
            const isManDown = safeGetSoldierStateBool(player, mod.SoldierStateBool.IsManDown);
            if (playerIsAlive || isInVehicle || isManDown) return false;
            return true;
        } catch (_e) { return false; }
    }

    function isPanelAlive(playerId: number): boolean {
        const panel = playerPanels.get(playerId);
        if (!panel || panel.deleted) return false;
        try { mod.GetUIWidgetName(panel.uiWidget); return true; } catch (_e) { return false; }
    }

    function destroyStalePanel(playerId: number): void {
        const dispose = playerPanelDisposers.get(playerId);
        if (dispose) try { dispose(); } catch (_e) {}
        const panel = playerPanels.get(playerId);
        if (panel) try { panel.delete(); } catch (_e) {}
        playerPanelDisposers.delete(playerId); playerPanels.delete(playerId);
        playerButtons.delete(playerId); playerButtonStateSetters.delete(playerId);
        playerPanelTeam.delete(playerId);
        playerUIVisible.delete(playerId);
    }

    // =========================================================================
    // UI CREATION
    // =========================================================================

    function createPlayerUI(player: mod.Player): void {
        const playerId = mod.GetObjId(player);
        if (playerPanels.has(playerId)) destroyStalePanel(playerId);

        const teamId = getPlayerTeamId(player);
        // Don't build a panel for an unassigned team -- the player would see
        // the wrong team's vehicles. Wait until team is 1 or 2 (next tick).
        if (teamId !== 1 && teamId !== 2) return;
        const allVehicles = teamId === 1 ? getTeam1Vehicles() : getTeam2Vehicles();
        const vehicles = MAX_BUTTONS < allVehicles.length ? allVehicles.slice(0, MAX_BUTTONS) : allVehicles;
        if (vehicles.length === 0) return;

        const buttonMap = new Map<number, UI.UITextButton>();
        const buttonStateSetters = new Map<number, SolidUI.Setter<ButtonVisualState>>();
        const childrenParams: UI.UIContainer.ChildParams<UI.UITextButton.Params>[] = [];

        const numButtons = vehicles.length;
        // Strip width is informational only -- the container itself is a
        // ZERO-SIZE origin point (see panel construction below). Each button
        // anchors itself at TopCenter with a pre-centered x so the engine's
        // hit-test rectangle lands in the same place as the visual.
        const stripWidth = numButtons > 0 ? numButtons * (BUTTON_SIZE + BUTTON_GAP) - BUTTON_GAP : BUTTON_SIZE;
        const stripHeight = BUTTON_SIZE + 4;
        const stride = BUTTON_SIZE + BUTTON_GAP;

        for (let i = 0; i < vehicles.length; i++) {
            const vehicle = vehicles[i];
            // Centered layout in TopCenter space:
            //   button center offset from screen-top-center = (i - (n-1)/2) * stride
            //   button x (top-left corner relative to TopCenter anchor) = centerOffset - BUTTON_SIZE/2
            // Using TopCenter on the BUTTON itself (not just the parent)
            // ensures the engine's hit-test rectangle matches the visual,
            // because both quantities are computed from the same screen anchor.
            const btnX = (i - (numButtons - 1) / 2) * stride - BUTTON_SIZE / 2;
            const btnY = 0;
            const matchTypes = vehicle.matchTypes ?? [vehicle.type];
            const spawnerId = vehicle.spawnerId;
            const vehicleType = vehicle.type;
            const vehicleLabel = vehicle.label;

            childrenParams.push({
                type: UI.UITextButton,
                x: btnX, y: btnY,
                width: BUTTON_SIZE, height: BUTTON_SIZE,
                anchor: mod.UIAnchor.TopCenter,
                visible: true, enabled: true,
                baseColor: mod.CreateVector(0.0, 0.4, 0.9),
                hoverColor: mod.CreateVector(0.5, 0.85, 1.0),
                pressedColor: mod.CreateVector(0.3, 1.0, 0.5),
                // Controller focus uses the SAME cyan as KBM hover so the
                // visual language is consistent across input devices.
                focusedColor: mod.CreateVector(0.5, 0.85, 1.0),
                bgColor: mod.CreateVector(0.0, 0.3, 0.4),
                bgAlpha: 0.9,
                onClick: async (clickPlayer: mod.Player) => {
                    handleVehicleClick(clickPlayer, teamId, spawnerId, vehicleType, matchTypes, vehicleLabel);
                },
                message: mod.Message("{0}", vehicleLabel),
                textSize: 9,
                textColor: UI.COLORS.WHITE,
                textAlpha: 1.0,
            });
        }

        try {
            const panel = new UI.UIContainer({
                // ORIGIN-POINT container: zero size, sits at TopCenter (0, 170).
                // Each child button anchors itself independently at TopCenter
                // with absolute screen-space x. This makes the engine compute
                // visual rect and input hit-test rect from the SAME anchor
                // frame, eliminating the controller "sweet spot" drift bug
                // where hit regions sat far left of the visible buttons.
                x: UI_PANEL_X, y: UI_PANEL_Y,
                width: 0, height: 0,
                anchor: UI_PANEL_ANCHOR,
                visible: false, bgAlpha: 0.0,
                depth: mod.UIDepth.AboveGameUI,
                receiver: player,
                // Join the engine's input/focus chain so controller d-pad
                // can navigate into the buttons.
                uiInputModeWhenVisible: true,
                childrenParams,
            });
            // Touch stripWidth/stripHeight to silence unused-var lint --
            // they remain in scope for future debug overlays / hit-region viz.
            void stripWidth; void stripHeight;

            playerPanels.set(playerId, panel);
            playerPanelTeam.set(playerId, teamId);
            for (let i = 0; i < vehicles.length && i < panel.children.length; i++) {
                const child = panel.children[i];
                if (child instanceof UI.UITextButton) buttonMap.set(vehicles[i].spawnerId, child);
            }
            playerButtons.set(playerId, buttonMap);

            // Button colors are updated directly in updateButtonStatusForPlayer().
            // No SolidUI reactive effects -- their async flush was reverting direct
            // updates back to stale signal values, causing buttons to appear
            // highlighted (BLUE) while the actual spawner state was cooldown/full.
            updateButtonStatusForPlayer(playerId, teamId);
        } catch (e) {
            log(`[VehicleUI] Failed to create UI for player ${playerId}: ${e}`);
        }
    }

    // =========================================================================
    // CLICK HANDLER
    // =========================================================================

    function handleVehicleClick(player: mod.Player, teamId: number, spawnerId: number, vehicleType: mod.VehicleList, matchTypes: mod.VehicleList[], vehicleLabel: string): void {
        const playerId = mod.GetObjId(player);
        clickToast(player, `click ${vehicleLabel} (sp${spawnerId} T${teamId})`);
        const matchTime = mod.GetMatchTimeElapsed();
        const pendingRequest = pendingSpawnRequestsByPlayerId.get(playerId);
        if (pendingRequest && matchTime - pendingRequest.time <= MAX_SPAWN_ASSIGN_SECONDS) {
            clickToast(player, `bail: spawn already pending`);
            return;
        }
        if (pendingDeploySeat.has(playerId) || assignedSpawnedVehicleIdByPlayerId.has(playerId)) {
            clickToast(player, `bail: deploy already in flight`);
            return;
        }

        const currentTime = now(true);
        if (currentTime - lastButtonClickTime < BUTTON_DEBOUNCE_SECONDS) {
            clickToast(player, `bail: debounce`);
            return;
        }
        lastButtonClickTime = currentTime;

        if (getPlayerTeamId(player) !== teamId) {
            clickToast(player, `bail: wrong team (you=T${getPlayerTeamId(player)})`);
            return;
        }
        if (isJetVehicle(vehicleType)) {
            const cooldown = getJetCooldownRemaining(playerId);
            // Only enforce cooldown if there's no idle jet to adopt - if one is
            // sitting on the runway we'd just FAST-PATH into it (no spawn needed).
            if (cooldown > 0 && !hasIdleMatchingJet(matchTypes, teamId)) {
                try { mod.DisplayCustomNotificationMessage(mod.Message("{0}", `Jet cooldown: ${Math.ceil(cooldown)}s`), mod.CustomNotificationSlots.MessageText1, 3.0, player); } catch (_e) {}
                return;
            }
        }
        if (!isPlayerOnDeployScreen(player)) {
            clickToast(player, `bail: not on deploy screen`);
            return;
        }
        scanExistingVehicles();

        const state = spawnerStateMap.get(spawnerId);
        const availability = state?.availability ?? 'no_vehicle';
        // Jets: Portal-managed instant respawn - never block clicks on stale cooldown.
        // The FAST PATH below will find the live respawned jet, or fall through to spawn.
        if (isJetVehicle(vehicleType)) {
            if (availability === 'cooldown' && state) {
                state.availability = 'no_vehicle';
                state.vehicleObjId = null;
            }
        } else {
            if (availability === 'cooldown' || availability === 'full') {
                clickToast(player, `bail: ${availability}`);
                return;
            }
        }

        const gen = (playerSeatGeneration.get(playerId) ?? 0) + 1;
        playerSeatGeneration.set(playerId, gen);

        pendingSpawnRequestsByPlayerId.delete(playerId);
        assignedSpawnedVehicleIdByPlayerId.delete(playerId);

        // SENTINEL FALLBACK: when a creator leaves a spawner's ObjId unset (-1)
        // every sentinel-keyed lookup collapses (one shared state record, false
        // team result). Bypass spawner-state and resolve purely from world
        // truth: AllVehicles + strict type + GetVehicleTeam (with faction
        // fallback). Force-spawn is impossible without a real spawner, so we
        // can only adopt an already-existing vehicle here.
        if (spawnerId < 0) {
            handleSentinelClick(player, playerId, teamId, vehicleType, matchTypes, vehicleLabel, gen);
            return;
        }

        if (availability === 'no_vehicle') {
            // Before spawning, check if there's already an unoccupied matching vehicle in the world
            // that scanExistingVehicles failed to link to this spawner (common with jets on runway).
            // For jet buttons we still only consider faction-pair types (e.g. F16 + JAS39),
            // never an unrelated jet -- otherwise the F16 button would seat into an F22.
            // Selection priority for jets:
            //   0 = same spawner, 1 = untracked (likely the unidentified F16 variant)
            const isJetClick = isJetVehicle(vehicleType);
            type JetCand = { vid: number; v: mod.Vehicle; priority: number };
            const jetCandidates: JetCand[] = [];
            try {
                const allV = mod.AllVehicles();
                if (allV) {
                    const vc = mod.CountOf(allV);
                    for (let i = 0; i < vc; i++) {
                        const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                        if (!v) continue;
                        let occ = true;
                        try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                        if (occ) continue;
                        // For jets, accept any faction-pair match (F22 button can take JAS39 etc.).
                        // For ground/heli, REQUIRE exact type match -- otherwise a Gepard click
                        // would adopt an unbound enemy Cheetah (same FACTION_PAIRS row) and
                        // teleport the player into the enemy AA at their HQ.
                        const isJetClick2 = isJetVehicle(vehicleType);
                        if (isJetClick2) {
                            if (!matchesAnyVehicleType(v, matchTypes)) continue;
                        } else {
                            if (!mod.CompareVehicleName(v, vehicleType)) continue;
                        }
                        let vid = 0;
                        try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                        if (vid === 0) continue;
                        if (reservedVehicleIds.has(vid)) continue;
                        const trackedTo = vehicleIdToSpawnerId.get(vid);

                        if (isJetClick) {
                            let priority = -1;
                            if (trackedTo === spawnerId) priority = 0;
                            else if (trackedTo === undefined) priority = 1;
                            // skip jets tracked to another spawner -- wrong jet
                            if (priority < 0) continue;
                            jetCandidates.push({ vid, v, priority });
                            continue;
                        }

                        // Non-jets: strict spawner binding.
                        // Untracked vehicles of the exact type are also accepted, but only
                        // if they're physically near this spawner (prevents adopting an
                        // identical-type vehicle that belongs to the enemy HQ).
                        if (trackedTo !== undefined && trackedTo !== spawnerId) continue;
                        if (trackedTo === undefined) {
                            try {
                                const sp = getVehicleSpawnerById(spawnerId);
                                if (sp) {
                                    const spPos = mod.GetObjectPosition(sp as unknown as mod.Object);
                                    const vPos = getVehiclePosition(v);
                                    if (spPos && vPos) {
                                        const dx = mod.XComponentOf(spPos) - mod.XComponentOf(vPos);
                                        const dz = mod.ZComponentOf(spPos) - mod.ZComponentOf(vPos);
                                        const distSq = dx * dx + dz * dz;
                                        // Spawners are typically within 30m of their vehicle
                                        if (distSq > 50 * 50) continue;
                                    }
                                }
                            } catch (_e) {}
                        }
                        if (state) {
                            state.vehicleObjId = vid; state.availability = 'empty';
                            vehicleIdToSpawnerId.set(vid, spawnerId);
                        }
                        log(`[VehicleUI] Player ${playerId} clicked ${vehicleLabel} (found existing vehicle ${vid} -> direct seat)`);
                        reserveVehicleForHuman(vid, playerId);
                        deployAndSeatPlayer(player, playerId, vid, 0, vehicleLabel, gen, true);
                        return;
                    }
                }
                if (isJetClick && jetCandidates.length > 0) {
                    jetCandidates.sort((a, b) => a.priority - b.priority);
                    const best = jetCandidates[0];
                    const vid = best.vid; const v = best.v;
                    const trackedTo = vehicleIdToSpawnerId.get(vid);
                    if (state && trackedTo === undefined) {
                        state.vehicleObjId = vid; state.availability = 'empty';
                        vehicleIdToSpawnerId.set(vid, spawnerId);
                    }
                    log(`[VehicleUI] Player ${playerId} clicked ${vehicleLabel} (found jet ${vid} priority ${best.priority} -> direct seat)`);
                    // No setJetCooldown here -- adopting an idle jet shouldn't
                    // burn the spawn cooldown. Only force-spawning does.
                    reserveVehicleForHuman(vid, playerId);
                    deployAndSeatPlayer(player, playerId, vid, 0, vehicleLabel, gen, true);
                    return;
                }

                // JET IDENTIFICATION FALLBACK: when the jet sweep above finds
                // nothing, mod.CompareVehicleName for one or more jet types
                // may be broken on this SDK build (originally observed for
                // F16; later maps showed F22 affected too). Detect candidate
                // jets by elimination + spatial proximity:
                //   1. Candidate matches NO known VehicleList entry.
                //   2. Candidate is within proximity of either:
                //        a) another identified jet (F22/F16/JAS39/SU57) -- if
                //           any single jet type still resolves by name, OR
                //        b) the player's TEAM HQ centroid -- works on maps
                //           where every jet type fails CompareVehicleName.
                // We accept ANY jet click here (not only F16) because the
                // failure mode varies by map.
                if (isJetClick && jetCandidates.length === 0) {
                    try {
                        const allV2 = mod.AllVehicles();
                        if (!allV2) { /* nothing */ }
                        else {
                            const vc2 = mod.CountOf(allV2);
                            const jetAnchors: { x: number; y: number; z: number }[] = [];
                            for (let i = 0; i < vc2; i++) {
                                const v = mod.ValueInArray(allV2, i) as mod.Vehicle;
                                if (!v) continue;
                                let isAnyKnownJet = false;
                                try {
                                    isAnyKnownJet =
                                        mod.CompareVehicleName(v, mod.VehicleList.F22) ||
                                        mod.CompareVehicleName(v, mod.VehicleList.F16) ||
                                        mod.CompareVehicleName(v, mod.VehicleList.JAS39) ||
                                        mod.CompareVehicleName(v, mod.VehicleList.SU57);
                                } catch (_e) {}
                                if (!isAnyKnownJet) continue;
                                const p = getVehiclePosition(v);
                                if (!p) continue;
                                jetAnchors.push({
                                    x: mod.XComponentOf(p),
                                    y: mod.YComponentOf(p),
                                    z: mod.ZComponentOf(p),
                                });
                            }
                            // HQ centroid as additional anchor (covers maps
                            // where no jet type identifies by name and there
                            // is therefore no live-jet anchor).
                            const hq = AutoDiscovery_GetTeamHQCentroid(teamId);
                            if (hq) jetAnchors.push(hq);

                            // 400m: tight runway-cluster gate.
                            // 1500m: HQ -> jet pad gate. Some maps (FireStorm
                            // Ty_Ger) place the runway well outside the HQ
                            // polygon's tighter deploy radius but still in
                            // the same logical HQ area.
                            const F16_PROXIMITY_TIGHT_SQ = 400.0 * 400.0;
                            const F16_PROXIMITY_HQ_SQ = 1500.0 * 1500.0;
                            log(`[VehicleUI] Jet fallback (${vehicleLabel}): anchors=${jetAnchors.length} (jets+HQ)`);
                            if (jetAnchors.length === 0) {
                                log(`[VehicleUI] Jet fallback: no anchors, skipping (will deploy on foot)`);
                            } else {
                                for (let i = 0; i < vc2; i++) {
                                    const v = mod.ValueInArray(allV2, i) as mod.Vehicle;
                                    if (!v) continue;
                                    let occ = true;
                                    try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                                    if (occ) continue;
                                    let isAnyKnown = false;
                                    try {
                                        for (const def of ALL_KNOWN_VEHICLE_TYPES) {
                                            if (mod.CompareVehicleName(v, def)) { isAnyKnown = true; break; }
                                        }
                                    } catch (_e) {}
                                    if (isAnyKnown) continue;
                                    const p = getVehiclePosition(v);
                                    if (!p) continue;
                                    const px = mod.XComponentOf(p);
                                    const py = mod.YComponentOf(p);
                                    const pz = mod.ZComponentOf(p);
                                    let nearAnchor = false;
                                    for (let ai = 0; ai < jetAnchors.length; ai++) {
                                        const a = jetAnchors[ai];
                                        const dx = px - a.x, dy = py - a.y, dz = pz - a.z;
                                        const distSq = dx * dx + dy * dy + dz * dz;
                                        const isHqAnchor = (hq !== null && ai === jetAnchors.length - 1);
                                        const limit = isHqAnchor ? F16_PROXIMITY_HQ_SQ : F16_PROXIMITY_TIGHT_SQ;
                                        if (distSq <= limit) { nearAnchor = true; break; }
                                    }
                                    if (!nearAnchor) continue;
                                    let vid = 0;
                                    try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                                    if (vid === 0) continue;
                                    if (reservedVehicleIds.has(vid)) continue;
                                    const trackedTo = vehicleIdToSpawnerId.get(vid);
                                    if (trackedTo !== undefined && trackedTo !== spawnerId) continue;
                                    if (state && trackedTo === undefined) {
                                        state.vehicleObjId = vid; state.availability = 'empty';
                                        vehicleIdToSpawnerId.set(vid, spawnerId);
                                    }
                                    log(`[VehicleUI] Player ${playerId} clicked ${vehicleLabel} (jet elimination fallback found unidentified jet ${vid} -> direct seat)`);
                                    reserveVehicleForHuman(vid, playerId);
                                    deployAndSeatPlayer(player, playerId, vid, 0, vehicleLabel, gen, true);
                                    return;
                                }
                                log(`[VehicleUI] Jet fallback: no unidentified vehicle near anchors for ${vehicleLabel}`);
                            }
                        }
                    } catch (_e) {}
                }
            } catch (_e) {}

            log(`[VehicleUI] Player ${playerId} clicked ${vehicleLabel} (no_vehicle -> force spawn)`);
            clickToast(player, `spawning ${vehicleLabel}...`);
            pendingSpawnRequestsByPlayerId.set(playerId, { spawnerId, teamId, vehicleType, matchTypes, label: vehicleLabel, seatGen: gen, time: matchTime });
            beginDeployFlow(player, playerId);

            if (isJetVehicle(vehicleType)) {
                // JETS: Deploy player first, wait until alive, THEN spawn jet and seat immediately.
                // This prevents the jet from crashing due to gravity while waiting for player respawn.
                // Jet cooldown is set AFTER successful seating, not here.
                try { mod.EnablePlayerDeploy(player, true); mod.SetRedeployTime(player, 0); mod.DeployPlayer(player); } catch (_e) { clearSuppressState(playerId); return; }
                waitForAliveThenSpawnJetAndSeat(player, playerId, spawnerId, vehicleType, matchTypes, vehicleLabel, gen, teamId, 0);
            } else {
                // NON-JETS: Original flow - force spawn then find vehicle
                // Don't override vehicle type - let spawner use its native type
                // from the map to prevent misidentified types causing OOB deaths
                try {
                    const spawner = getVehicleSpawnerById(spawnerId);
                    if (!spawner) {
                        clickToast(player, `bail: spawner ${spawnerId} not found`);
                        return;
                    }
                    mod.ForceVehicleSpawnerSpawn(spawner);
                } catch (e) {
                    clickToast(player, `force-spawn threw: ${e}`);
                    clearSuppressState(playerId); showPlayerUI(player); return;
                }
                try { mod.EnablePlayerDeploy(player, true); mod.SetRedeployTime(player, 0); mod.DeployPlayer(player); } catch (_e) { clearSuppressState(playerId); return; }
                waitForSpawnedVehicleThenDeploy(player, playerId, matchTypes, new Set(), spawnerId, vehicleLabel, gen, teamId, 0);
            }
            return;
        }

        log(`[VehicleUI] Player ${playerId} clicked ${vehicleLabel} (${availability})`);

        if (availability === 'empty' && state?.vehicleObjId !== null) {
            // Re-verify vehicle still exists before deploying
            const verifyV = findVehicleById(state!.vehicleObjId!);
            if (!verifyV) {
                clickToast(player, `bail: vehicle gone (empty)`);
                log(`[VehicleUI] ${vehicleLabel} vehicle ${state!.vehicleObjId} gone before deploy`);
                state!.vehicleObjId = null; state!.availability = 'no_vehicle';
                showPlayerUI(player);
                return;
            }
            clickToast(player, `seating pilot into ${vehicleLabel}`);
            reserveVehicleForHuman(state!.vehicleObjId!, playerId);
            deployAndSeatPlayer(player, playerId, state!.vehicleObjId!, 0, vehicleLabel, gen, true);
        } else {
            clickToast(player, `${vehicleLabel} unavailable (state=${availability})`);
            showVehicleRequestNotification(`${vehicleLabel} unavailable`);
            showPlayerUI(player);
        }
    }

    // =========================================================================
    // DEPLOY FLOWS
    // =========================================================================

    function clearSuppressState(playerId: number): void {
        suppressUIUntilByPlayerId.delete(playerId);
        pendingDeploySeat.delete(playerId);
        pendingSpawnRequestsByPlayerId.delete(playerId);
        assignedSpawnedVehicleIdByPlayerId.delete(playerId);
        clearReservationsForPlayer(playerId);
        clearJetClaimsForPlayer(playerId);
    }

    function isCurrentSeatGeneration(playerId: number, seatGen: number): boolean {
        return (playerSeatGeneration.get(playerId) ?? 0) === seatGen;
    }

    function clearSuppressStateIfCurrent(playerId: number, seatGen?: number): void {
        if (seatGen !== undefined && !isCurrentSeatGeneration(playerId, seatGen)) return;
        clearSuppressState(playerId);
    }

    function beginDeployFlow(player: mod.Player, playerId: number): void {
        suppressUIUntilByPlayerId.set(playerId, mod.GetMatchTimeElapsed() + (MAX_SPAWN_ASSIGN_SECONDS + 2.0));
        hidePlayerUI(player);
    }

    // Reservations
    const reservedVehicleIds: Map<number, { playerId: number; expiresAt: number }> = new Map();
    const RESERVATION_DURATION = 12.0;

    function reserveVehicleForHuman(vehicleObjId: number, playerId: number): void {
        reservedVehicleIds.set(vehicleObjId, { playerId, expiresAt: mod.GetMatchTimeElapsed() + RESERVATION_DURATION });
    }

    function clearReservationsForPlayer(playerId: number): void {
        for (const [key, res] of reservedVehicleIds.entries()) { if (res.playerId === playerId) reservedVehicleIds.delete(key); }
    }

    // =========================================================================
    // PERSISTENT HUMAN JET CLAIMS
    // When the short poll window expires and the jet still hasn't appeared in
    // AllVehicles, we register a claim on the spawner rather than giving up.
    // VehicleDirector checks this before seating an AI pilot, and will seat
    // the human player instead when the jet eventually shows up (~40s later).
    // =========================================================================
    interface HumanJetClaim {
        player: mod.Player;
        playerId: number;
        teamId: number;
        label: string;
        seatGen: number;
        expiresAt: number;
    }
    const humanJetClaimsBySpawnerId: Map<number, HumanJetClaim> = new Map();
    const HUMAN_JET_CLAIM_DURATION = 90.0;

    export function vehicleUI_GetHumanJetClaim(spawnerId: number): HumanJetClaim | null {
        const claim = humanJetClaimsBySpawnerId.get(spawnerId);
        if (!claim) return null;
        if (mod.GetMatchTimeElapsed() > claim.expiresAt) { humanJetClaimsBySpawnerId.delete(spawnerId); return null; }
        return claim;
    }

    // Consume (remove) the claim and seat the human in the given vehicle.
    // Called by VehicleDirector when it finds the jet. Returns true if seated.
    export function vehicleUI_SeatHumanForSpawner(spawnerId: number, vehicle: mod.Vehicle, vehicleObjId: number): boolean {
        const claim = humanJetClaimsBySpawnerId.get(spawnerId);
        if (!claim) return false;
        if (mod.GetMatchTimeElapsed() > claim.expiresAt) { humanJetClaimsBySpawnerId.delete(spawnerId); return false; }
        if (!isCurrentSeatGeneration(claim.playerId, claim.seatGen)) { humanJetClaimsBySpawnerId.delete(spawnerId); return false; }
        let humanAlive = false;
        try { humanAlive = hasSoldier(claim.player) && isAlive(claim.player); } catch (_e) {}
        let humanInVehicle = false;
        try { humanInVehicle = safeGetSoldierStateBool(claim.player, mod.SoldierStateBool.IsInVehicle); } catch (_e) {}
        humanJetClaimsBySpawnerId.delete(spawnerId);
        if (!humanAlive || humanInVehicle) {
            log(`[VehicleUI] Jet claim for player ${claim.playerId} expired (alive=${humanAlive}, inVehicle=${humanInVehicle})`);
            showPlayerUI(claim.player);
            return false;
        }
        // Link vehicle into spawner tracking so UI state stays consistent
        const state = spawnerStateMap.get(spawnerId);
        if (state && state.vehicleObjId === null) {
            state.vehicleObjId = vehicleObjId;
            vehicleIdToSpawnerId.set(vehicleObjId, spawnerId);
            const initPos = getVehiclePosition(vehicle);
            if (initPos) vehicleInitialPosition.set(vehicleObjId, initPos);
        }
        AutoDiscovery_ConfirmSpawner(spawnerId, claim.teamId);
        reserveVehicleForHuman(vehicleObjId, claim.playerId);
        setJetCooldown(claim.playerId); // Cooldown only on successful jet seat
        seatPlayerDirectly(claim.player, vehicle, 0, claim.label, 0, true, claim.seatGen);
        log(`[VehicleUI] VDir-triggered seat: player ${claim.playerId} -> ${claim.label} vId=${vehicleObjId}`);
        return true;
    }

    function clearJetClaimsForPlayer(playerId: number): void {
        for (const [sid, claim] of humanJetClaimsBySpawnerId.entries()) {
            if (claim.playerId === playerId) humanJetClaimsBySpawnerId.delete(sid);
        }
    }

    export function vehicleUI_IsVehicleReservedForHuman(vehicle: mod.Vehicle): boolean {
        try {
            const vid = mod.GetObjId(vehicle);
            const res = reservedVehicleIds.get(vid);
            if (!res) return false;
            if (mod.GetMatchTimeElapsed() > res.expiresAt) { reservedVehicleIds.delete(vid); return false; }
            return true;
        } catch (_e) { return false; }
    }

    /** Returns the spawner-tracked team for a vehicle, or 0 if unknown.
     *  VehicleDirector uses this as the primary team source (more reliable than GetVehicleTeam). */
    export function vehicleUI_GetVehicleTeamId(vehicleObjId: number): number {
        const spawnerId = vehicleIdToSpawnerId.get(vehicleObjId);
        if (spawnerId !== undefined) return getSpawnerTeamId(spawnerId);
        return 0;
    }

    /** Returns true if no tracked vehicle exists for this spawner (destroyed or never spawned). */
    export function vehicleUI_IsSpawnerVehicleGone(spawnerId: number): boolean {
        const state = spawnerStateMap.get(spawnerId);
        if (!state) return true;
        return state.vehicleObjId === null;
    }

    /**
     * Called by VehicleDirector when it seats a bot into a vehicle found via
     * fallback (enum-shifted). Forces VehicleUI to track this vehicle to the
     * spawner so button status updates correctly (BLACK when occupied, etc.).
     */
    export function vehicleUI_ForceTrackVehicle(spawnerId: number, vehicleObjId: number, vehicle: mod.Vehicle): void {
        if (vehicleIdToSpawnerId.has(vehicleObjId)) return; // already tracked
        const state = spawnerStateMap.get(spawnerId);
        if (!state) return;
        state.vehicleObjId = vehicleObjId;
        vehicleIdToSpawnerId.set(vehicleObjId, spawnerId);
        const initPos = getVehiclePosition(vehicle);
        if (initPos) vehicleInitialPosition.set(vehicleObjId, initPos);
        probeVehicleSeats(state);
        log(`[VehicleUI] Force-tracked vehicle ${vehicleObjId} -> spawner ${spawnerId} (${state.vehicleDef.label}, from VDir)`);
    }

    function deployAndSeatPlayer(player: mod.Player, playerId: number, vehicleObjId: number, seatIndex: number, label: string, seatGen: number, claimRequestedPilot: boolean): void {
        beginDeployFlow(player, playerId);
        try { mod.EnablePlayerDeploy(player, true); mod.SetRedeployTime(player, 0); mod.DeployPlayer(player); } catch (_e) {
            log(`[VehicleUI] DeployPlayer failed for player ${playerId} -> ${label}`);
            clearSuppressState(playerId);
            showPlayerUI(player);
            return;
        }
        pendingDeploySeat.set(playerId, { vehicleObjId, seatIndex, label, seatGen, claimRequestedPilot });
        waitForAliveAndSeat(player, playerId, vehicleObjId, seatIndex, label, seatGen, claimRequestedPilot, 0);
    }

    function waitForSpawnedVehicleThenDeploy(player: mod.Player, playerId: number, matchTypes: mod.VehicleList[], preSpawnIds: Set<number>, spawnerId: number, label: string, seatGen: number, teamId: number, retryCount: number): void {
        const maxRetries = includesAttackHeli(matchTypes) ? Math.floor(ATTACK_HELI_SPAWN_WAIT_SECONDS / 0.1) : 60;
        if (!isCurrentSeatGeneration(playerId, seatGen)) return;

        const assignedVehicleId = assignedSpawnedVehicleIdByPlayerId.get(playerId);
        if (assignedVehicleId !== undefined) {
            const av = findVehicleById(assignedVehicleId);
            if (av) {
                assignedSpawnedVehicleIdByPlayerId.delete(playerId);
                pendingSpawnRequestsByPlayerId.delete(playerId);
                AutoDiscovery_ConfirmSpawner(spawnerId, teamId);
                reserveVehicleForHuman(assignedVehicleId, playerId);
                if (hasSoldier(player) && isAlive(player)) seatPlayerDirectly(player, av, 0, label, 0, true, seatGen);
                else deployAndSeatPlayer(player, playerId, assignedVehicleId, 0, label, seatGen, true);
                return;
            }
            assignedSpawnedVehicleIdByPlayerId.delete(playerId);
        }

        const trackedVehicle = findTrackedVehicleForSpawner(spawnerId, matchTypes, teamId);
        if (trackedVehicle) {
            const tid = mod.GetObjId(trackedVehicle);
            pendingSpawnRequestsByPlayerId.delete(playerId);
            AutoDiscovery_ConfirmSpawner(spawnerId, teamId);
            reserveVehicleForHuman(tid, playerId);
            if (hasSoldier(player) && isAlive(player)) seatPlayerDirectly(player, trackedVehicle, 0, label, 0, true, seatGen);
            else deployAndSeatPlayer(player, playerId, tid, 0, label, seatGen, true);
            return;
        }

        // Fallback: find any NEW unoccupied vehicle not in the pre-spawn snapshot.
        // This handles enum shift where CompareVehicleName fails for the spawned type,
        // which causes findTrackedVehicleForSpawner to return null even though the
        // vehicle IS there. Mirror VehicleDirector's findNewEmptyVehicle approach.
        if (preSpawnIds.size > 0) {
            try {
                const allV = mod.AllVehicles();
                if (allV) {
                    const c = mod.CountOf(allV);
                    for (let i = 0; i < c; i++) {
                        const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                        if (!v) continue;
                        let vid = 0;
                        try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                        if (preSpawnIds.has(vid)) continue;
                        let occ = true;
                        try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                        if (occ) continue;
                        // New unoccupied vehicle - confirm it belongs to our team via spawner
                        const sid = vehicleIdToSpawnerId.get(vid);
                        if (sid !== undefined && getSpawnerTeamId(sid) !== 0 && getSpawnerTeamId(sid) !== teamId) continue;
                        // Verify vehicle type matches request (prevent grabbing wrong type like Flyer for AH64)
                        if (!matchesAnyVehicleType(v, matchTypes)) continue;
                        log(`[VehicleUI] Non-jet fallback: found new vehicle ${vid} for ${label} (enum-shift)`);
                        pendingSpawnRequestsByPlayerId.delete(playerId);
                        AutoDiscovery_ConfirmSpawner(spawnerId, teamId);
                        reserveVehicleForHuman(vid, playerId);
                        if (hasSoldier(player) && isAlive(player)) seatPlayerDirectly(player, v, 0, label, 0, true, seatGen);
                        else deployAndSeatPlayer(player, playerId, vid, 0, label, seatGen, true);
                        return;
                    }
                }
            } catch (_e) {}
        }

        if (retryCount < maxRetries) {
            mod.Wait(0.1).then(() => waitForSpawnedVehicleThenDeploy(player, playerId, matchTypes, preSpawnIds, spawnerId, label, seatGen, teamId, retryCount + 1));
            return;
        }

        // Primary spawner failed (phantom). Try alternate spawners.
        {
            const triedSpawners = preSpawnIds.size > 0 ? preSpawnIds : new Set<number>();
            triedSpawners.add(spawnerId);
            const alternates = AutoDiscovery_GetAlternateSpawners(spawnerId, teamId);
            for (const altId of alternates) {
                if (triedSpawners.has(altId)) continue;
                triedSpawners.add(altId);
                log(`[VehicleUI] Spawner ${spawnerId} failed, trying alternate ${altId}`);
                try {
                    const altSpawner = getVehicleSpawnerById(altId);
                    if (!altSpawner) continue;
                    try { mod.SetVehicleSpawnerVehicleType(altSpawner, matchTypes[0]); } catch (_e) {}
                    mod.ForceVehicleSpawnerSpawn(altSpawner);
                    // Update pending request with new spawner
                    const req = pendingSpawnRequestsByPlayerId.get(playerId);
                    if (req) req.spawnerId = altId;
                    waitForSpawnedVehicleThenDeploy(player, playerId, matchTypes, triedSpawners, altId, label, seatGen, teamId, 0);
                    return;
                } catch (_e) {}
            }
            log(`[VehicleUI] All alternate spawners exhausted for ${label} T${teamId}`);
        }

        clearSuppressStateIfCurrent(playerId, seatGen);
        showPlayerUI(player);
    }

    // JET-SPECIFIC FLOW: Wait for player to be alive, THEN force-spawn jet and seat immediately.
    // Minimizes time jet is unsupported (no pilot = gravity crash).
    function waitForAliveThenSpawnJetAndSeat(player: mod.Player, playerId: number, spawnerId: number, vehicleType: mod.VehicleList, matchTypes: mod.VehicleList[], label: string, seatGen: number, teamId: number, retryCount: number): void {
        if (!isCurrentSeatGeneration(playerId, seatGen)) return;
        try { if (safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle)) { clearSuppressStateIfCurrent(playerId, seatGen); return; } } catch (_e) {}

        let alive = false;
        try { if (hasSoldier(player)) alive = isAlive(player); } catch (_e) {}

        if (!alive) {
            // Player not alive yet - keep waiting (up to 8 seconds)
            if (retryCount >= 80) {
                log(`[VehicleUI] Jet flow: Player ${playerId} never deployed - aborting`);
                clearSuppressStateIfCurrent(playerId, seatGen);
                showPlayerUI(player);
                return;
            }
            mod.Wait(0.1).then(() => waitForAliveThenSpawnJetAndSeat(player, playerId, spawnerId, vehicleType, matchTypes, label, seatGen, teamId, retryCount + 1));
            return;
        }

        // Player is alive! Now find existing jet or force-spawn and seat ASAP
        log(`[VehicleUI] Jet flow: Player ${playerId} alive after ${retryCount} ticks - looking for ${label}`);

        // ---- FAST PATH: Find an existing jet of the right type and seat the player ----
        // Jets are force-spawned at startup and AI pilots are seated by VehicleDirector.
        // On player click: prefer an unoccupied jet, otherwise kick an AI pilot out and
        // take the seat (player click always wins over AI seat).
        //
        // Jet selection priority (so F16 button never grabs F22, etc.):
        //   0 = same spawner, 1 = untracked (likely the F16 the SDK couldn't enum-match)
        // Jets tracked to a different spawner are skipped entirely.
        let aiOccupiedJet: mod.Vehicle | null = null;
        let aiOccupiedJetId = 0;
        let aiOccupiedJetPilot: mod.Player | null = null;

        type JetCandidate = { v: mod.Vehicle; vid: number; priority: number };
        const unoccupiedCandidates: JetCandidate[] = [];
        // Only match faction-pair types (e.g. F16 + JAS39) -- never an unrelated jet.
        try {
            const allV = mod.AllVehicles();
            if (allV) {
                const c = mod.CountOf(allV);
                for (let i = 0; i < c; i++) {
                    const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                    if (!v) continue;
                    if (!matchesAnyVehicleType(v, matchTypes)) continue;
                    let vid = 0;
                    try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                    if (vid === 0) continue;
                    if (reservedVehicleIds.has(vid)) continue;

                    let occ = true;
                    try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}

                    const trackedTo = vehicleIdToSpawnerId.get(vid);
                    let priority = -1;
                    if (trackedTo === spawnerId) priority = 0;
                    else if (trackedTo === undefined) priority = 1;
                    // skip jets tracked to a different spawner
                    if (priority < 0) continue;

                    if (!occ) {
                        unoccupiedCandidates.push({ v, vid, priority });
                    } else if (!aiOccupiedJet) {
                        try {
                            const pilot = mod.GetPlayerFromVehicleSeat(v, 0) as mod.Player | null;
                            if (pilot && isAISoldier(pilot)) {
                                aiOccupiedJet = v;
                                aiOccupiedJetId = vid;
                                aiOccupiedJetPilot = pilot;
                            }
                        } catch (_e) {}
                    }
                }
            }
        } catch (_e) {}

        // Pick the best unoccupied jet
        if (unoccupiedCandidates.length > 0) {
            unoccupiedCandidates.sort((a, b) => a.priority - b.priority);
            const best = unoccupiedCandidates[0];
            const v = best.v; const vid = best.vid;
            log(`[VehicleUI] Jet flow: Found existing ${label} vehicle ${vid} (priority ${best.priority}) - seating player ${playerId}`);
            const st = spawnerStateMap.get(spawnerId);
            const trackedTo = vehicleIdToSpawnerId.get(vid);
            if (trackedTo === undefined && st && st.vehicleObjId === null) {
                st.vehicleObjId = vid;
                vehicleIdToSpawnerId.set(vid, spawnerId);
                const initPos = getVehiclePosition(v);
                if (initPos) vehicleInitialPosition.set(vid, initPos);
            }
            AutoDiscovery_ConfirmSpawner(spawnerId, teamId);
            reserveVehicleForHuman(vid, playerId);
            pendingSpawnRequestsByPlayerId.delete(playerId);
            // No setJetCooldown -- found an existing live jet, no spawn cost.
            seatPlayerDirectly(player, v, 0, label, 0, true, seatGen);
            return;
        }

        // FAST PATH 2: Kick AI pilot and take their seat
        if (aiOccupiedJet && aiOccupiedJetPilot && aiOccupiedJetId !== 0) {
            log(`[VehicleUI] Jet flow: All ${label} occupied by AI - kicking AI pilot from vehicle ${aiOccupiedJetId} for player ${playerId}`);
            safeForcePlayerExitVehicle(aiOccupiedJetPilot, aiOccupiedJet);
            const st = spawnerStateMap.get(spawnerId);
            if (st && st.vehicleObjId === null) {
                st.vehicleObjId = aiOccupiedJetId;
                vehicleIdToSpawnerId.set(aiOccupiedJetId, spawnerId);
                const initPos = getVehiclePosition(aiOccupiedJet);
                if (initPos) vehicleInitialPosition.set(aiOccupiedJetId, initPos);
            }
            AutoDiscovery_ConfirmSpawner(spawnerId, teamId);
            reserveVehicleForHuman(aiOccupiedJetId, playerId);
            pendingSpawnRequestsByPlayerId.delete(playerId);
            // No setJetCooldown -- kicked AI from existing jet, no spawn cost.
            seatPlayerDirectly(player, aiOccupiedJet, 0, label, 0, true, seatGen);
            return;
        }

        log(`[VehicleUI] Jet flow: No existing ${label} found - trying force-spawn path`);

        // ---- SLOW PATH: Snapshot + ForceSpawn + poll ----
        // This path handles spawners with real ObjIds (non-phantom).
        // For phantom jet spawners, ForceSpawn is a no-op and the poll
        // will time out, then fall back to the claim system.

        // Snapshot vehicle IDs BEFORE force-spawn so we can find the new one
        const preSpawnIds = new Set<number>();
        try {
            const allV = mod.AllVehicles();
            if (allV) {
                const c = mod.CountOf(allV);
                for (let i = 0; i < c; i++) {
                    try { preSpawnIds.add(mod.GetObjId(mod.ValueInArray(allV, i) as mod.Vehicle)); } catch (_e) {}
                }
            }
        } catch (_e) {}
        log(`[VehicleUI] Jet flow: Pre-spawn snapshot has ${preSpawnIds.size} vehicles`);

        // Use AutoDiscovery's cached spawner reference (same as VehicleDirector)
        // rather than a fresh GetVehicleSpawner call which may return a different handle.
        let spawnerRef: mod.VehicleSpawner | null = null;
        const ds = discoveredVehicleSpawners.find(d => d.spawnerId === spawnerId);
        if (ds) {
            spawnerRef = ds.spawner;
        } else {
            spawnerRef = getVehicleSpawnerById(spawnerId);
        }

        if (!spawnerRef) {
            log(`[VehicleUI] Jet flow: No spawner found for ${spawnerId}`);
            clearSuppressStateIfCurrent(playerId, seatGen);
            return;
        }

        try {
            mod.SetVehicleSpawnerVehicleType(spawnerRef, vehicleType);
            log(`[VehicleUI] Jet flow: Set spawner ${spawnerId} type OK`);
        } catch (e) {
            log(`[VehicleUI] Jet flow: SetVehicleType failed (continuing): ${e}`);
        }
        try {
            mod.ForceVehicleSpawnerSpawn(spawnerRef);
            log(`[VehicleUI] Jet flow: ForceVehicleSpawnerSpawn OK on ${spawnerId}`);
        } catch (e) {
            log(`[VehicleUI] Jet flow: Force-spawn failed: ${e}`);
            clearSuppressStateIfCurrent(playerId, seatGen);
            showPlayerUI(player);
            return;
        }

        // Poll for the new jet by comparing vehicle snapshots (same technique
        // as VehicleDirector). Accept ANY new unoccupied vehicle -- due to
        // Portal enum shift, CompareVehicleName may not match the expected type.
        waitForNewJetThenSeat(player, playerId, spawnerId, matchTypes, label, seatGen, teamId, preSpawnIds, 0);
    }

    /** Poll AllVehicles for a new vehicle not in the pre-spawn snapshot, then seat the player.
     *  Only accepts type-matched vehicles to prevent seating in wrong vehicle (e.g. dirtbike
     *  when expecting a jet). Enum shift is not a real issue per DICE confirmation. */
    function waitForNewJetThenSeat(player: mod.Player, playerId: number, spawnerId: number, matchTypes: mod.VehicleList[], label: string, seatGen: number, teamId: number, preSpawnIds: Set<number>, attempt: number): void {
        if (!isCurrentSeatGeneration(playerId, seatGen)) return;
        try { if (safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle)) { clearSuppressStateIfCurrent(playerId, seatGen); return; } } catch (_e) {}

        // Scan for new vehicle not in snapshot (type match first, then any-new fallback)
        let newJet: mod.Vehicle | null = null;
        let newJetId = 0;
        let matchMethod = "none";
        try {
            const allV = mod.AllVehicles();
            if (allV) {
                const c = mod.CountOf(allV);
                for (let i = 0; i < c; i++) {
                    const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                    if (!v) continue;
                    let vid = 0;
                    try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                    if (preSpawnIds.has(vid)) continue;
                    // New vehicle found - MUST be a type match. We previously
                    // had an "any new unoccupied" fallback here, but it was
                    // dangerous: when a jet click hit a phantom mirror spawner,
                    // ForceSpawn was a no-op, and any unrelated vehicle Portal
                    // happened to spawn during the polling window (e.g. an
                    // Abrams from another spawner) was adopted -- player
                    // ended up seated in an Abrams from a jet button click.
                    if (matchesAnyVehicleType(v, matchTypes)) {
                        newJet = v;
                        newJetId = vid;
                        matchMethod = "type";
                        break;
                    }
                }
                if (attempt === 0 || attempt === 10 || attempt === 30 || attempt === 50) {
                    log(`[VehicleUI] Jet flow poll #${attempt}: ${c} total vehicles, snapshot=${preSpawnIds.size}, match=${matchMethod}`);
                }
            }
        } catch (_e) {}

        if (newJet) {
            log(`[VehicleUI] Jet flow: Found new ${label} vehicle ${newJetId} (${matchMethod}) after ${attempt} attempts`);
            // Link to spawner for tracking
            const state = spawnerStateMap.get(spawnerId);
            if (state && state.vehicleObjId === null) {
                state.vehicleObjId = newJetId;
                vehicleIdToSpawnerId.set(newJetId, spawnerId);
                const initPos = getVehiclePosition(newJet);
                if (initPos) vehicleInitialPosition.set(newJetId, initPos);
            }
            AutoDiscovery_ConfirmSpawner(spawnerId, teamId);
            reserveVehicleForHuman(newJetId, playerId);
            pendingSpawnRequestsByPlayerId.delete(playerId);
            setJetCooldown(playerId); // Cooldown only on successful jet seat
            seatPlayerDirectly(player, newJet, 0, label, 0, true, seatGen);
            return;
        }

        if (attempt >= 60) { // 6 seconds max -- jet not in AllVehicles yet
            // Before registering a claim, try one last scan ignoring the snapshot.
            // This catches autospawned vehicles that were already in the snapshot
            // (ForceSpawn was a no-op because the vehicle already existed).
            try {
                const allV = mod.AllVehicles();
                if (allV) {
                    const c = mod.CountOf(allV);
                    for (let i = 0; i < c; i++) {
                        const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                        if (!v) continue;
                        let occ = true;
                        try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                        if (occ) continue;
                        if (!matchesAnyVehicleType(v, matchTypes)) continue;
                        let vid = 0;
                        try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                        if (vid === 0) continue;
                        const trackedTo = vehicleIdToSpawnerId.get(vid);
                        if (trackedTo !== undefined && trackedTo !== spawnerId) continue;
                        if (reservedVehicleIds.has(vid)) continue;
                        // Found existing autospawned vehicle - seat directly
                        log(`[VehicleUI] Jet flow: Found existing ${label} vehicle ${vid} (autospawn fallback)`);
                        const st = spawnerStateMap.get(spawnerId);
                        if (st && st.vehicleObjId === null) {
                            st.vehicleObjId = vid;
                            vehicleIdToSpawnerId.set(vid, spawnerId);
                        }
                        reserveVehicleForHuman(vid, playerId);
                        pendingSpawnRequestsByPlayerId.delete(playerId);
                        setJetCooldown(playerId); // Cooldown only on successful jet seat
                        seatPlayerDirectly(player, v, 0, label, 0, true, seatGen);
                        return;
                    }
                }
            } catch (_e) {}

            // Don't give up: register a persistent claim on the spawner.
            // VehicleDirector will seat us when the jet eventually appears (~40s).
            let stillAlive = false;
            try { stillAlive = hasSoldier(player) && isAlive(player); } catch (_e) {}
            let inVehicle = false;
            try { inVehicle = safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle); } catch (_e) {}
            const pTeamId = teamId;
            if (stillAlive && !inVehicle && isCurrentSeatGeneration(playerId, seatGen)) {
                humanJetClaimsBySpawnerId.set(spawnerId, {
                    player, playerId, teamId: pTeamId, label, seatGen,
                    expiresAt: mod.GetMatchTimeElapsed() + HUMAN_JET_CLAIM_DURATION
                });
                log(`[VehicleUI] Jet flow: Registered human claim spawner ${spawnerId} player ${playerId} - VDir will seat when jet appears`);
                clearSuppressStateIfCurrent(playerId, seatGen);
                // Do NOT show UI here - VDir will complete the seating
                return;
            }
            log(`[VehicleUI] Jet flow: Could not find new ${label} after ${attempt} attempts - aborting`);
            clearSuppressStateIfCurrent(playerId, seatGen);
            showPlayerUI(player);
            return;
        }

        mod.Wait(0.1).then(() => waitForNewJetThenSeat(player, playerId, spawnerId, matchTypes, label, seatGen, teamId, preSpawnIds, attempt + 1));
    }

    function waitForAliveAndSeat(player: mod.Player, playerId: number, vehicleObjId: number, seatIndex: number, label: string, seatGen: number, claimRequestedPilot: boolean, retryCount: number): void {
        if (!isCurrentSeatGeneration(playerId, seatGen)) return;
        try { if (safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle)) { clearSuppressStateIfCurrent(playerId, seatGen); return; } } catch (_e) {}

        let alive = false;
        try { if (hasSoldier(player)) alive = isAlive(player); } catch (_e) {}

        if (!alive) {
            if (retryCount >= 6 && isPlayerOnDeployScreen(player)) { clearSuppressStateIfCurrent(playerId, seatGen); showPlayerUI(player); return; }
            if (retryCount < 80) { mod.Wait(0.1).then(() => waitForAliveAndSeat(player, playerId, vehicleObjId, seatIndex, label, seatGen, claimRequestedPilot, retryCount + 1)); return; }
            clearSuppressStateIfCurrent(playerId, seatGen); showPlayerUI(player); return;
        }

        const vehicle = findVehicleById(vehicleObjId);
        if (!vehicle) {
            log(`[VehicleUI] Vehicle ${vehicleObjId} gone before seating player ${playerId}`);
            clearSuppressStateIfCurrent(playerId, seatGen);
            try { mod.DisplayCustomNotificationMessage(mod.Message("{0}", `${label} no longer available`), mod.CustomNotificationSlots.MessageText1, 3.0, player); } catch (_e) {}
            return;
        }
        seatPlayerDirectly(player, vehicle, seatIndex, label, 0, claimRequestedPilot, seatGen);
    }

    function seatPlayerDirectly(player: mod.Player, vehicle: mod.Vehicle, seatIndex: number, label: string, retryCount: number = 0, claimRequestedPilot: boolean = false, seatGen?: number): void {
        const playerId = mod.GetObjId(player);
        if (seatGen !== undefined && !isCurrentSeatGeneration(playerId, seatGen)) return;

        // If the player is already in ANY vehicle, cancel - don't yank them out
        try {
            if (safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle)) {
                clearSuppressStateIfCurrent(playerId, seatGen);
                return;
            }
        } catch (_e) {}

        // Team safety check - use vehicle team (engine truth) as primary,
        // spawner team as secondary, faction as final fallback.
        try {
            const playerTeam = getPlayerTeamId(player);
            let vehicleTeam = 0;
            // First try GetVehicleTeam (engine-authoritative when set)
            try {
                const vTeam = mod.GetVehicleTeam(vehicle);
                if (vTeam) {
                    const t1 = mod.GetTeam(1); const t2 = mod.GetTeam(2);
                    if (t1 && mod.GetObjId(vTeam) === mod.GetObjId(t1)) vehicleTeam = 1;
                    else if (t2 && mod.GetObjId(vTeam) === mod.GetObjId(t2)) vehicleTeam = 2;
                }
            } catch (_e) {}
            // Fallback to spawner team
            if (vehicleTeam === 0) {
                try {
                    const vid = mod.GetObjId(vehicle);
                    const sid = vehicleIdToSpawnerId.get(vid);
                    if (sid !== undefined) vehicleTeam = getSpawnerTeamId(sid);
                } catch (_e) {}
            }
            // Final fallback: vehicle FACTION (e.g. Abrams=T2, Leopard=T1)
            // For maps with neutral spawners + neutral GetVehicleTeam, this
            // prevents a T1 player from deploying into a T2-faction vehicle.
            if (vehicleTeam === 0) {
                try {
                    for (const vt of [
                        mod.VehicleList.Leopard, mod.VehicleList.Abrams,
                        mod.VehicleList.M2Bradley, mod.VehicleList.CV90,
                        mod.VehicleList.Cheetah, mod.VehicleList.Gepard,
                        mod.VehicleList.Marauder, mod.VehicleList.Marauder_Pax,
                        mod.VehicleList.AH6M, mod.VehicleList.AH6M_Pax,
                        mod.VehicleList.UH60, mod.VehicleList.UH60_Pax,
                        mod.VehicleList.DirtBike, mod.VehicleList.DirtBike_Pax,
                        mod.VehicleList.F22, mod.VehicleList.SU57,
                        mod.VehicleList.F16, mod.VehicleList.JAS39,
                        mod.VehicleList.AH64, mod.VehicleList.Eurocopter,
                    ]) {
                        if (mod.CompareVehicleName(vehicle, vt)) {
                            if (isFactionAppropriate(vt, 1)) { vehicleTeam = 1; break; }
                            if (isFactionAppropriate(vt, 2)) { vehicleTeam = 2; break; }
                        }
                    }
                } catch (_e) {}
            }
            if (vehicleTeam !== 0 && playerTeam !== 0 && vehicleTeam !== playerTeam) {
                clickToast(player, `bail: vehicle is T${vehicleTeam}, you are T${playerTeam}`);
                clearSuppressStateIfCurrent(playerId, seatGen); showPlayerUI(player); return;
            }
        } catch (_e) {}

        let targetSeat = seatIndex;
        if (targetSeat === 0 && claimRequestedPilot) {
            try {
                if (mod.IsVehicleSeatOccupied(vehicle, 0)) {
                    const currentPilot = safeGetPlayerFromVehicleSeat(vehicle, 0);
                    if (currentPilot && isAISoldier(currentPilot)) {
                        safeForcePlayerExitVehicle(currentPilot, vehicle);
                    } else {
                        // Seat 0 just got taken by a human between probe + click.
                        // Abort instead of silently dumping the player into a
                        // passenger seat (would surprise the user who pressed
                        // a BLUE "deploy as pilot" button).
                        clearSuppressStateIfCurrent(playerId, seatGen);
                        showPlayerUI(player);
                        try { mod.DisplayCustomNotificationMessage(mod.Message("{0}", `${label} just taken`), mod.CustomNotificationSlots.MessageText1, 2.5, player); } catch (_e) {}
                        return;
                    }
                }
            } catch (_e) {}
        }

        // Mask the seat transition with a screen effect. ForcePlayerToSeat
        // teleports the player into the seat by itself; we do NOT pre-teleport
        // the player to the vehicle position, because the player's collision
        // capsule lands inside the chassis and shoves/rotates the vehicle
        // (light ground vehicles got pushed several meters, jets ended up
        // ~90 degrees off the runway heading). Skipping the pre-seat teleport
        // for ALL vehicle classes is the safe option; the visible camera
        // transition is the lesser evil and is masked by the screen effect.
        let screenEffectOn = false;
        try { mod.EnableScreenEffect(player, SEAT_TRANSITION_SCREEN_EFFECT, true); screenEffectOn = true; } catch (_e) {}

        try { mod.ForcePlayerToSeat(player, vehicle, targetSeat); } catch (_e) {}

        mod.Wait(0.25).then(() => {
            const inVehicle = safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle);
            if (inVehicle) {
                if (screenEffectOn) { try { mod.EnableScreenEffect(player, SEAT_TRANSITION_SCREEN_EFFECT, false); } catch (_e) {} screenEffectOn = false; }
                clearSuppressStateIfCurrent(playerId, seatGen);
                if (claimRequestedPilot && targetSeat === 0) {
                    // Apply vehicle health multiplier
                    try {
                        const isTank = mod.CompareVehicleName(vehicle, mod.VehicleList.Abrams) || mod.CompareVehicleName(vehicle, mod.VehicleList.Leopard);
                        const isIFV = mod.CompareVehicleName(vehicle, mod.VehicleList.M2Bradley) || mod.CompareVehicleName(vehicle, mod.VehicleList.CV90);
                        const isAA = mod.CompareVehicleName(vehicle, mod.VehicleList.Cheetah) || mod.CompareVehicleName(vehicle, mod.VehicleList.Gepard);
                        const isMarauder = mod.CompareVehicleName(vehicle, mod.VehicleList.Marauder) || mod.CompareVehicleName(vehicle, mod.VehicleList.Marauder_Pax);
                        if (isTank) mod.SetVehicleMaxHealthMultiplier(vehicle, TANK_HEALTH_MULTIPLIER);
                        else if (isIFV) mod.SetVehicleMaxHealthMultiplier(vehicle, IFV_HEALTH_MULTIPLIER);
                        else if (isAA) mod.SetVehicleMaxHealthMultiplier(vehicle, AA_HEALTH_MULTIPLIER);
                        else if (isMarauder) mod.SetVehicleMaxHealthMultiplier(vehicle, MARAUDER_HEALTH_MULTIPLIER);
                    } catch (_e) {}
                    // Purge AI occupants
                    try {
                        const sc = mod.GetVehicleSeatCount(vehicle);
                        for (let s = 1; s < sc; s++) {
                            const occ = safeGetPlayerFromVehicleSeat(vehicle, s);
                            if (occ && isAISoldier(occ)) safeForcePlayerExitVehicle(occ, vehicle);
                        }
                    } catch (_e) {}
                }
                return;
            }
            if (retryCount < 4) seatPlayerDirectly(player, vehicle, targetSeat, label, retryCount + 1, claimRequestedPilot, seatGen);
            else {
                if (screenEffectOn) { try { mod.EnableScreenEffect(player, SEAT_TRANSITION_SCREEN_EFFECT, false); } catch (_e) {} screenEffectOn = false; }
                log(`[VehicleUI] Seating failed after retries for player ${playerId} -> ${label}`);
                clearSuppressStateIfCurrent(playerId, seatGen);
                showPlayerUI(player);
                try { mod.DisplayCustomNotificationMessage(mod.Message("{0}", `Failed to enter ${label}`), mod.CustomNotificationSlots.MessageText1, 3.0, player); } catch (_e) {}
            }
        });
    }

    // =========================================================================
    // SHOW/HIDE
    // =========================================================================

    function showPlayerUI(player: mod.Player): void {
        const pid = mod.GetObjId(player);
        if (!isPlayerOnDeployScreen(player)) { playerUIVisible.delete(pid); return; }
        const panel = playerPanels.get(pid);
        if (!panel) return;
        try { panel.show(); playerUIVisible.add(pid); } catch (_e) { destroyStalePanel(pid); }
    }

    function hidePlayerUI(player: mod.Player): void {
        const pid = mod.GetObjId(player);
        const panel = playerPanels.get(pid);
        if (panel) panel.hide();
        playerUIVisible.delete(pid);
    }

    // =========================================================================
    // VEHICLE HELPERS
    // =========================================================================

    function getVehicleSpawnerById(spawnerId: number): mod.VehicleSpawner | null {
        try { return mod.GetVehicleSpawner(spawnerId); } catch (_e) { return null; }
    }

    function findVehicleById(vehicleId: number): mod.Vehicle | null {
        try {
            const allVehicles = mod.AllVehicles();
            if (!allVehicles) return null;
            const count = mod.CountOf(allVehicles);
            for (let i = 0; i < count; i++) {
                const v = mod.ValueInArray(allVehicles, i) as mod.Vehicle;
                if (!v) continue;
                try { if (mod.GetObjId(v) === vehicleId) return v; } catch (_e) {}
            }
        } catch (_e) {}
        return null;
    }

    // Resolves a click against an unset-ObjId spawner (sentinel = -1) by
    // walking AllVehicles directly. Strict type for ground/heli; matchTypes
    // (faction-pair) for jets. Team gate: GetVehicleTeam (engine truth) with
    // faction inference fallback. Picks the first eligible unoccupied,
    // non-reserved vehicle. Force-spawn is impossible without a real spawner
    // handle, so this can only adopt vehicles already present in the world.
    function handleSentinelClick(player: mod.Player, playerId: number, teamId: number, vehicleType: mod.VehicleList, matchTypes: mod.VehicleList[], vehicleLabel: string, gen: number): void {
        const isJetClick = isJetVehicle(vehicleType);
        let chosen: mod.Vehicle | null = null;
        let chosenId = 0;
        try {
            const allV = mod.AllVehicles();
            if (allV) {
                const c = mod.CountOf(allV);
                for (let i = 0; i < c; i++) {
                    const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                    if (!v) continue;
                    let occ = true;
                    try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                    if (occ) continue;
                    if (isJetClick) {
                        if (!matchesAnyVehicleType(v, matchTypes)) continue;
                    } else {
                        if (!mod.CompareVehicleName(v, vehicleType)) continue;
                    }
                    let vid = 0;
                    try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                    if (!vid) continue;
                    if (reservedVehicleIds.has(vid)) continue;

                    // Team gate
                    let vehicleTeam = 0;
                    try {
                        const vTeam = mod.GetVehicleTeam(v);
                        if (vTeam) {
                            const t1 = mod.GetTeam(1); const t2 = mod.GetTeam(2);
                            if (t1 && mod.GetObjId(vTeam) === mod.GetObjId(t1)) vehicleTeam = 1;
                            else if (t2 && mod.GetObjId(vTeam) === mod.GetObjId(t2)) vehicleTeam = 2;
                        }
                    } catch (_e) {}
                    if (vehicleTeam === 0) {
                        // Faction inference based on the world vehicle's actual type
                        const types = isJetClick ? matchTypes : [vehicleType];
                        for (const vt of types) {
                            if (!mod.CompareVehicleName(v, vt)) continue;
                            if (isFactionAppropriate(vt, 1)) { vehicleTeam = 1; break; }
                            if (isFactionAppropriate(vt, 2)) { vehicleTeam = 2; break; }
                        }
                    }
                    if (vehicleTeam !== 0 && vehicleTeam !== teamId) continue;

                    chosen = v; chosenId = vid;
                    break;
                }
            }
        } catch (_e) {}

        if (!chosen || !chosenId) {
            clickToast(player, `no live ${vehicleLabel} (sentinel - set ObjId on its spawner)`);
            try { mod.DisplayCustomNotificationMessage(mod.Message("{0}", `No ${vehicleLabel} available`), mod.CustomNotificationSlots.MessageText1, 3.0, player); } catch (_e) {}
            return;
        }

        log(`[VehicleUI] Sentinel click: T${teamId} player ${playerId} -> ${vehicleLabel} vehicle ${chosenId}`);
        reserveVehicleForHuman(chosenId, playerId);
        deployAndSeatPlayer(player, playerId, chosenId, 0, vehicleLabel, gen, true);
    }

    function findTrackedVehicleForSpawner(spawnerId: number, vehicleTypes: mod.VehicleList[], teamId: number): mod.Vehicle | null {
        const state = spawnerStateMap.get(spawnerId);
        if (!state || state.vehicleObjId === null) return null;
        const vehicle = findVehicleById(state.vehicleObjId);
        if (!vehicle || !matchesAnyVehicleType(vehicle, vehicleTypes)) return null;
        // Trust the spawner's team assignment -- the vehicle was already
        // matched to this spawner via type + faction at discovery time.
        // Neutral vehicles (GetVehicleTeam returns 0) belong to the spawner's
        // team. Calling GetVehicleTeam here causes InvalidValue on stale handles.
        const spawnerTeam = getSpawnerTeamId(spawnerId);
        if (spawnerTeam !== 0 && spawnerTeam !== teamId) return null;
        return vehicle;
    }

    function matchesAnyVehicleType(vehicle: mod.Vehicle, vehicleTypes: mod.VehicleList[]): boolean {
        for (const vt of vehicleTypes) { try { if (mod.CompareVehicleName(vehicle, vt)) return true; } catch (_e) {} }
        return false;
    }

    function isAirVehicleType(vehicle: mod.Vehicle): boolean {
        try {
            return mod.CompareVehicleName(vehicle, mod.VehicleList.UH60) || mod.CompareVehicleName(vehicle, mod.VehicleList.UH60_Pax) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.AH64) || mod.CompareVehicleName(vehicle, mod.VehicleList.AH6M) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.AH6M_Pax) || mod.CompareVehicleName(vehicle, mod.VehicleList.Eurocopter) || mod.CompareVehicleName(vehicle, mod.VehicleList.F22) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.F16) || mod.CompareVehicleName(vehicle, mod.VehicleList.JAS39) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.SU57);
        } catch (_e) { return false; }
    }

    /** Light ground vehicles whose chassis gets shoved by the player's
     *  collision capsule when teleported on top of them. We skip the pre-seat
     *  player teleport for these (the engine's own ForcePlayerToSeat camera
     *  transition is the lesser evil compared to the vehicle being knocked
     *  out of position / rotated). Heavy chassis (Abrams, Leopard, Bradley,
     *  CV90, Cheetah, Gepard) are unaffected and still benefit from the
     *  pre-seat teleport hiding the long camera fly-through. */
    function isLightGroundVehicleType(vehicle: mod.Vehicle): boolean {
        try {
            return mod.CompareVehicleName(vehicle, mod.VehicleList.Marauder) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.Marauder_Pax) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.Vector) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.Flyer60) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.Quadbike) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.GolfCart) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.RHIB) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.DirtBike) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.DirtBike_Pax);
        } catch (_e) { return false; }
    }

    // =========================================================================
    // BUTTON STATUS
    // =========================================================================
    const COLOR_BLUE = mod.CreateVector(0.0, 0.4, 0.9);
    const COLOR_GREEN = mod.CreateVector(0.2, 0.8, 0.3);
    const COLOR_BLACK = mod.CreateVector(0.1, 0.1, 0.1);

    function updateButtonStatusForPlayer(playerId: number, teamId: number): void {
        const buttons = playerButtons.get(playerId);
        if (!buttons) return;
        const vehicles = teamId === 1 ? getTeam1Vehicles() : getTeam2Vehicles();

        for (const vehicle of vehicles) {
            const button = buttons.get(vehicle.spawnerId);
            if (!button) continue;
            try {
                let buttonEnabled = true;
                let baseColor = COLOR_BLUE;
                if (isJetVehicle(vehicle.type) && getJetCooldownRemaining(playerId) > 0
                    && !hasIdleMatchingJet(vehicle.matchTypes ?? [vehicle.type], teamId)) {
                    buttonEnabled = false; baseColor = COLOR_BLACK;
                    button.setEnabled(buttonEnabled).setBaseColor(baseColor);
                    continue;
                }
                const state = spawnerStateMap.get(vehicle.spawnerId);
                const jetClick = isJetVehicle(vehicle.type);
                if (state) {
                    probeVehicleSeats(state);
                    // BLACK: vehicle not yet spawned, on cooldown, or full.
                    // Clicking BLUE while no_vehicle would deploy the player
                    // on foot until the spawner produces a vehicle - bad UX.
                    // JETS: previously stayed BLUE unconditionally because the
                    // SDK couldn't always identify F16/F22 by name and the
                    // spawner state would be stuck at no_vehicle even when a
                    // jet was physically present. We now consult
                    // hasIdleMatchingJet() to decide: if a free same-type jet
                    // exists in the world, BLUE; otherwise BLACK so the player
                    // doesn't click into an on-foot deploy.
                    if (state.availability === 'full') {
                        // Pilot seat occupied -> BLACK / disabled. Passengers must
                        // approach on foot or use the map vehicle icon; we do not
                        // expose a passenger button in this UI.
                        buttonEnabled = false; baseColor = COLOR_BLACK;
                    } else if (state.availability === 'no_vehicle' || state.availability === 'cooldown') {
                        if (jetClick && hasIdleMatchingJet(vehicle.matchTypes ?? [vehicle.type], teamId)) {
                            // jet name-match couldn't bind to spawner but the
                            // jet is physically present and idle -> stay BLUE
                        } else {
                            buttonEnabled = false; baseColor = COLOR_BLACK;
                        }
                    }
                } else if (jetClick) {
                    // No spawner state but we may still have a live idle jet
                    // we could adopt; otherwise BLACK.
                    if (!hasIdleMatchingJet(vehicle.matchTypes ?? [vehicle.type], teamId)) {
                        buttonEnabled = false; baseColor = COLOR_BLACK;
                    }
                } else {
                    // No state record yet -> spawner not initialized, treat as unavailable
                    buttonEnabled = false; baseColor = COLOR_BLACK;
                }
                button.setEnabled(buttonEnabled).setBaseColor(baseColor);
            } catch (_e) {}
        }
    }

    /**
     * Update button labels in-place when AutoDiscovery corrects a spawner type.
     * Avoids full panel rebuild - just changes button text for each player.
     */
    const _lastButtonLabel = new Map<number, string>();
    export function vehicleUI_ApplyLabelCorrections(): void {
        if (!vehicleUIInitialized) return;
        const team1 = getTeam1Vehicles();
        const team2 = getTeam2Vehicles();
        const allDefs = [...team1, ...team2];
        let corrected = 0;

        for (const def of allDefs) {
            const prev = _lastButtonLabel.get(def.spawnerId);
            if (prev === def.label) continue;
            _lastButtonLabel.set(def.spawnerId, def.label);
            for (const [_pid, buttons] of playerButtons) {
                const button = buttons.get(def.spawnerId);
                if (!button) continue;
                try {
                    button.setMessage(mod.Message("{0}", def.label));
                    corrected++;
                } catch (_e) {}
            }
        }
        if (corrected > 0) log(`[VehicleUI] Label corrections applied in-place (${corrected} buttons updated)`);
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

    function assignSpawnedVehicleToPendingPlayer(vehicle: mod.Vehicle, vehicleObjId: number): void {
        if (pendingSpawnRequestsByPlayerId.size === 0) return;
        const now = mod.GetMatchTimeElapsed();
        for (const [pid, req] of pendingSpawnRequestsByPlayerId.entries()) {
            if (now - req.time > MAX_SPAWN_ASSIGN_SECONDS) { pendingSpawnRequestsByPlayerId.delete(pid); continue; }
        }
        // Primary: match via spawner tracking (vehicle already linked to spawner)
        const matchedSpawnerId = vehicleIdToSpawnerId.get(vehicleObjId);
        if (matchedSpawnerId !== undefined) {
            for (const [pid, req] of pendingSpawnRequestsByPlayerId.entries()) {
                if (req.spawnerId === matchedSpawnerId) {
                    reserveVehicleForHuman(vehicleObjId, pid);
                    assignedSpawnedVehicleIdByPlayerId.set(pid, vehicleObjId);
                    pendingSpawnRequestsByPlayerId.delete(pid);
                    return;
                }
            }
        }
        // Fallback: vehicle not tracked to spawner yet (common for jets where
        // GetVehicleTeam throws at spawn time). Match by vehicle type instead.
        for (const [pid, req] of pendingSpawnRequestsByPlayerId.entries()) {
            const reqMatchTypes = req.matchTypes ?? [req.vehicleType];
            if (matchesAnyVehicleType(vehicle, reqMatchTypes)) {
                // Also link the vehicle to the spawner for future tracking
                const state = spawnerStateMap.get(req.spawnerId);
                if (state && state.vehicleObjId === null) {
                    state.vehicleObjId = vehicleObjId;
                    vehicleIdToSpawnerId.set(vehicleObjId, req.spawnerId);
                    const initPos = getVehiclePosition(vehicle);
                    if (initPos) vehicleInitialPosition.set(vehicleObjId, initPos);
                }
                reserveVehicleForHuman(vehicleObjId, pid);
                assignedSpawnedVehicleIdByPlayerId.set(pid, vehicleObjId);
                pendingSpawnRequestsByPlayerId.delete(pid);
                log(`[VehicleUI] Assigned ${req.label} vehicle ${vehicleObjId} to player ${pid} (type fallback)`);
                return;
            }
        }
    }

    export function vehicleUI_OnVehicleSpawned(vehicle: mod.Vehicle): void {
        if (!vehicleUIInitialized) return;
        try {
            const vid = mod.GetObjId(vehicle);

            // Learn spawner team from force-spawn results
            // If we have a pending force-spawn request and a vehicle just appeared,
            // check if the vehicle's team matches what we expected. Cache the
            // spawner's actual team for better future spawner assignment.
            if (pendingSpawnRequestsByPlayerId.size > 0) {
                let vehicleTeamNorm = 0;
                try {
                    const vTeam = mod.GetVehicleTeam(vehicle);
                    if (vTeam) {
                        const t1 = mod.GetTeam(1);
                        const t2 = mod.GetTeam(2);
                        if (t1 && mod.GetObjId(vTeam) === mod.GetObjId(t1)) vehicleTeamNorm = 1;
                        else if (t2 && mod.GetObjId(vTeam) === mod.GetObjId(t2)) vehicleTeamNorm = 2;
                    }
                } catch (_e) {}
                if (vehicleTeamNorm !== 0) {
                    for (const [_pid, req] of pendingSpawnRequestsByPlayerId) {
                        // If vehicle type matches the request, this vehicle is likely from that spawner
                        const matchTypes = [req.vehicleType];
                        if (matchesAnyVehicleType(vehicle, matchTypes)) {
                            spawnerTeamCache.set(req.spawnerId, vehicleTeamNorm);
                            if (vehicleTeamNorm !== req.teamId) {
                                log(`[VehicleUI] Learned spawner ${req.spawnerId} is T${vehicleTeamNorm} (expected T${req.teamId})`);
                            }
                            break;
                        }
                    }
                }
            }

            // Strict matching only - vehicle team is often 0 at spawn time,
            // lenient matching would assign to wrong spawner and corrupt labels.
            matchVehicleToSpawner(vehicle, vid, false);
            assignSpawnedVehicleToPendingPlayer(vehicle, vid);
        } catch (_e) {}
    }

    export function vehicleUI_OnVehicleDestroyed(vehicle: mod.Vehicle): void {
        if (!vehicleUIInitialized) return;
        try {
            const vid = mod.GetObjId(vehicle);
            const spawnerId = vehicleIdToSpawnerId.get(vid);
            if (spawnerId !== undefined) {
                const state = spawnerStateMap.get(spawnerId);
                if (state) {
                    state.vehicleObjId = null;
                    // Jets are Portal-managed and may respawn instantly (map respawn time = 0).
                    // Skip script cooldown so the next click can FAST PATH to the new jet.
                    if (isJetVehicle(state.vehicleDef.type)) {
                        state.availability = 'no_vehicle';
                    } else {
                        state.availability = 'cooldown';
                        state.cooldownStartTime = mod.GetMatchTimeElapsed();
                        state.cooldownDuration = SPAWNER_COOLDOWN_SECONDS;
                    }
                }
                vehicleIdToSpawnerId.delete(vid);
                vehicleInitialPosition.delete(vid);
            }
        } catch (_e) {}
    }

    export function vehicleUI_OnPlayerEnterVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
        if (!vehicleUIInitialized) return;
        let vehicleObjId = 0;
        try {
            vehicleObjId = mod.GetObjId(vehicle);
            reprobeVehicle(vehicleObjId);
        } catch (_e) {}

        try {
            const playerTeamId = getPlayerTeamId(player);
            if (playerTeamId === 0) return;

            const matchedSpawnerId = vehicleIdToSpawnerId.get(vehicleObjId);
            if (matchedSpawnerId === undefined) return;

            const expectedTeamId = getSpawnerTeamId(matchedSpawnerId);
            if (expectedTeamId === 0 || expectedTeamId === playerTeamId) return;

            const playerId = mod.GetObjId(player);
            log(`[VehicleUI] Wrong-team vehicle entry blocked: player ${playerId} T${playerTeamId} entered spawner ${matchedSpawnerId} T${expectedTeamId}`);

            try { mod.ForcePlayerExitVehicle(player); } catch (_e) {}
        } catch (_e) {}
    }

    export function vehicleUI_OnPlayerExitVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
        if (!vehicleUIInitialized) return;
        try { reprobeVehicle(mod.GetObjId(vehicle)); } catch (_e) {}
    }

    export function vehicleUI_OnPlayerDeployed(player: mod.Player): void {
        if (!vehicleUIInitialized) return;
        if (!isPlayerHumanCached(player)) return;
        const pid = mod.GetObjId(player);
        hasEverDeployedByPlayerId.add(pid);
        const pending = pendingDeploySeat.get(pid);
        if (pending && isCurrentSeatGeneration(pid, pending.seatGen)) {
            pendingDeploySeat.delete(pid);
            const vehicle = findVehicleById(pending.vehicleObjId);
            if (vehicle) {
                seatPlayerDirectly(player, vehicle, pending.seatIndex, pending.label, 0, pending.claimRequestedPilot, pending.seatGen);
                return;
            }
        }
    }

    export function vehicleUI_OnPlayerUndeployed(player: mod.Player): void {
        if (!vehicleUIInitialized) return;
        if (!isPlayerHumanCached(player)) return;
        try {
            const pid = mod.GetObjId(player);
            clearJetClaimsForPlayer(pid);
        } catch (_e) {}
    }

    export function vehicleUI_HandleButtonEvent(player: mod.Player, widget: mod.UIWidget, buttonEvent: mod.UIButtonEvent): void {
        // UI v8 handles button events internally via onClick callbacks
    }

    export function onPlayerDeployedHideVehicleUI(player: mod.Player): void {
        hidePlayerUI(player);
    }

    export function onPlayerDiedShowUI(player: mod.Player): void {
        const pid = mod.GetObjId(player);
        lastDeathTimeByPlayerId.set(pid, mod.GetMatchTimeElapsed());
    }

    // =========================================================================
    // TICK
    // =========================================================================

    export function tickVehicleUI(): void {
        if (!vehicleUIInitialized) return;
        const matchTime = mod.GetMatchTimeElapsed();

        // Cooldown expiry
        for (const [_sid, state] of spawnerStateMap) {
            if (state.availability === 'cooldown') {
                if (matchTime - state.cooldownStartTime >= state.cooldownDuration) {
                    state.availability = 'no_vehicle';
                    state.vehicleObjId = null;
                }
            }
        }

        // Periodic vehicle scan
        if (matchTime - lastUIStatusUpdateTime >= UI_STATUS_UPDATE_INTERVAL) {
            lastUIStatusUpdateTime = matchTime;
            scanExistingVehicles();

            // Prune expired reservations
            for (const [key, res] of reservedVehicleIds.entries()) { if (matchTime > res.expiresAt) reservedVehicleIds.delete(key); }

            // Update suppress timeouts
            for (const [pid, expiry] of suppressUIUntilByPlayerId.entries()) {
                if (matchTime > expiry) suppressUIUntilByPlayerId.delete(pid);
            }
        }

        // Show/hide UI for human players
        try {
            const allPlayers = mod.AllPlayers();
            if (!allPlayers) return;
            const count = mod.CountOf(allPlayers);
            for (let i = 0; i < count; i++) {
                const player = mod.ValueInArray(allPlayers, i) as mod.Player;
                if (!player) continue;
                if (!isPlayerHumanCached(player)) continue;

                const pid = mod.GetObjId(player);
                const suppressed = suppressUIUntilByPlayerId.has(pid);
                const onDeployScreen = isPlayerOnDeployScreen(player);

                if (onDeployScreen && !suppressed) {
                    const teamId = getPlayerTeamId(player);
                    // Skip if team not yet assigned -- panel would default
                    // to wrong team list. Player will get UI next tick once
                    // engine assigns them.
                    if (teamId !== 1 && teamId !== 2) continue;
                    // Rebuild panel if player switched teams (or first build had stale team).
                    const cachedTeam = playerPanelTeam.get(pid);
                    if (cachedTeam !== undefined && cachedTeam !== teamId) {
                        destroyStalePanel(pid);
                    }
                    if (!playerPanels.has(pid) || !isPanelAlive(pid)) {
                        createPlayerUI(player);
                    }
                    if (!playerUIVisible.has(pid)) showPlayerUI(player);
                    updateButtonStatusForPlayer(pid, teamId);
                } else if (playerUIVisible.has(pid)) {
                    hidePlayerUI(player);
                }
            }
        } catch (_e) {}
    }

    // =========================================================================
    // INIT
    // =========================================================================

    export function initVehicleSpawnUI(forceRebuild: boolean = false): void {
        // Rebuild vehicle defs from latest discovery data
        const prevT1 = team1Vehicles.length;
        const prevT2 = team2Vehicles.length;
        const prevSig = currentSpawnerSetSignature();
        buildVehicleDefsFromDiscovery();

        if (team1Vehicles.length === 0 && team2Vehicles.length === 0) {
            if (!vehicleUIInitialized) {
                log(`[VehicleUI] No vehicles discovered yet - waiting for map to spawn vehicles`);
            }
            return;
        }

        const newSig = currentSpawnerSetSignature();
        // Skip if no new vehicles since last init (unless forced for label corrections).
        // Compare ID sets, not just counts -- a phantom mirror replaced by a real
        // spawner has identical count but different IDs and MUST trigger rebuild.
        if (vehicleUIInitialized && !forceRebuild && newSig === prevSig &&
            team1Vehicles.length === prevT1 && team2Vehicles.length === prevT2) {
            return;
        }
        if (vehicleUIInitialized && newSig !== prevSig) {
            log(`[VehicleUI] Spawner set changed -> rebuild (was ${prevSig} now ${newSig})`);
        }

        // New vehicles found - rebuild UI panels for all players
        if (vehicleUIInitialized) {
            // Delete old Portal UI widgets before losing references
            for (const [_pid, panel] of playerPanels) {
                try { panel.hide(); panel.delete(); } catch (_e) {}
            }
            for (const [_pid, disposer] of playerPanelDisposers) {
                try { disposer(); } catch (_e) {}
            }
            playerPanels.clear();
            playerButtons.clear();
            playerButtonStateSetters.clear();
            playerPanelDisposers.clear();
            playerUIVisible.clear();
            log(`[VehicleUI] Rebuilt UI with new vehicles`);
        }

        initSpawnerStateTracking();
        scanExistingVehicles();
        vehicleUIInitialized = true;
        log(`[VehicleUI] Initialized with ${team1Vehicles.length + team2Vehicles.length} vehicles (T1=${team1Vehicles.length}, T2=${team2Vehicles.length})`);
    }
}
