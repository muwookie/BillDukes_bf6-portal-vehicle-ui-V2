/**
 * StandaloneConfig - minimal helpers for VehicleUI Standalone
 *
 * Trimmed copy of ConquestConfig.ts containing ONLY the helpers that
 * VehicleSpawnUIModule, AutoDiscoveryModule, and SafeSDKWrapper need.
 *
 * Namespace VehicleUIStandalone (renamed from ConquestV8 to avoid collisions
 * if a host mod also uses ConquestV8).
 */

namespace VehicleUIStandalone {
    // =========================================================================
    // PLAYER REGISTRY (deploy state + AI status cache)
    // =========================================================================
    const deployedPlayerIds: Set<number> = new Set();
    export const aiStatusByPlayerId: { [playerId: number]: boolean } = {};

    export function markPlayerDeployed(player: mod.Player): void {
        if (!player) return;
        try {
            const pid = mod.GetObjId(player);
            deployedPlayerIds.add(pid);
        } catch (_e) {}
    }

    export function markPlayerUndeployed(player: mod.Player): void {
        if (!player) return;
        try {
            const pid = mod.GetObjId(player);
            deployedPlayerIds.delete(pid);
            delete aiStatusByPlayerId[pid];
        } catch (_e) {}
    }

    function pruneAiStatusCache(): void {
        try {
            const all = mod.AllPlayers();
            const count = mod.CountOf(all);
            const activeIds: Set<number> = new Set();
            for (let i = 0; i < count; i++) {
                const p = mod.ValueInArray(all, i) as mod.Player;
                if (!p) continue;
                try { activeIds.add(mod.GetObjId(p)); } catch (_e) {}
            }
            for (const key of Object.keys(aiStatusByPlayerId)) {
                const id = Number(key);
                if (!activeIds.has(id)) delete aiStatusByPlayerId[id];
            }
        } catch (_e) {}
    }

    // =========================================================================
    // LOGGING
    // =========================================================================
    let _logCount = 0;
    const LOG_CAP = 5000;
    const LOG_THROTTLE_INTERVAL = 50;

    export function log(msg: string): void {
        _logCount++;
        if (_logCount > LOG_CAP && _logCount % LOG_THROTTLE_INTERVAL !== 0) return;
        console.log(msg);
    }

    export function logError(msg: string): void {
        console.log(`[VehicleUI][ERROR] ${msg}`);
    }

    // Stub - debug logging disabled in standalone build
    export function logDebug(_msg: string): void { /* no-op */ }

    // =========================================================================
    // VEHICLE HEALTH MULTIPLIERS (used by VehicleSpawnUIModule for spawn-time tweaks)
    // Tweak these to adjust vehicle survivability when spawned via the UI.
    // =========================================================================
    export const TANK_HEALTH_MULTIPLIER = 0.5;
    export const IFV_HEALTH_MULTIPLIER = 0.6;
    export const AA_HEALTH_MULTIPLIER = 0.7;
    export const MARAUDER_HEALTH_MULTIPLIER = 0.6;

    // =========================================================================
    // STUB STATE - AutoDiscoveryModule's objective/AI-spawner discovery is
    // included for completeness but unused in standalone (no Conquest mode here).
    // These arrays remain empty; vehicle discovery does NOT depend on them.
    // =========================================================================
    export type Objective = {
        id: string;
        name: string;
        objId: number;
        x: number;
        y: number;
        z: number;
        waypointPathId?: number;
    };
    export let OBJECTIVES: Objective[] = [];
    export let TEAM1_AI_SPAWNER_IDS: number[] = [];
    export let TEAM2_AI_SPAWNER_IDS: number[] = [];
    export let TEAM1_OBJ_SPAWNER_IDS: number[] = [];
    export let TEAM2_OBJ_SPAWNER_IDS: number[] = [];

    export function safeCall(label: string, fn: () => void): void {
        try {
            fn();
        } catch (e) {
            logError(`[safeCall:${label}] ${e}`);
        }
    }

    // =========================================================================
    // PLAYER STATE HELPERS
    // =========================================================================
    export function isAISoldier(player: mod.Player): boolean {
        if (!player) return false;
        pruneAiStatusCache();
        let pid = -1;
        try { pid = mod.GetObjId(player); } catch (_e) { return false; }
        if (!deployedPlayerIds.has(pid)) return aiStatusByPlayerId[pid] ?? false;
        try {
            const isAI = mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier);
            aiStatusByPlayerId[pid] = isAI;
            return isAI;
        } catch (_e) {
            markPlayerUndeployed(player);
            return aiStatusByPlayerId[pid] ?? false;
        }
    }

    export function isAlive(player: mod.Player): boolean {
        if (!hasSoldier(player)) return false;
        try {
            return mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive);
        } catch (_e) {
            try { markPlayerUndeployed(player); } catch (_e2) {}
            return false;
        }
    }

    export function hasSoldier(player: mod.Player): boolean {
        if (!player) return false;
        try {
            // IsPlayerValid catches the case where the player handle is
            // stale (player left the server but still in deployedPlayerIds).
            // Without this gate, downstream GetSoldierState calls throw
            // InvalidPlayer -- and the engine logs every native exception
            // even when JS catches it.
            if (!mod.IsPlayerValid(player)) {
                try {
                    const pid2 = mod.GetObjId(player);
                    deployedPlayerIds.delete(pid2);
                } catch (_e2) {}
                return false;
            }
            const pid = mod.GetObjId(player);
            return deployedPlayerIds.has(pid);
        } catch (_e) { return false; }
    }

    export function getPlayerTeamId(player: mod.Player): number {
        try {
            const playerTeam = mod.GetTeam(player);
            if (!playerTeam) return 0;
            const team1 = mod.GetTeam(1);
            const team2 = mod.GetTeam(2);
            if (team1 && mod.GetObjId(playerTeam) === mod.GetObjId(team1)) return 1;
            if (team2 && mod.GetObjId(playerTeam) === mod.GetObjId(team2)) return 2;
            return 0;
        } catch (e) { return 0; }
    }

    export function now(useMatchTime: boolean = false): number {
        return useMatchTime ? mod.GetMatchTimeElapsed() : mod.GetMatchTimeElapsed();
    }
}
