/// <reference path="../config/StandaloneConfig.ts" />

/**
 * SafeSDKWrapper - Safe wrappers for Portal SDK calls that may throw
 * 
 * The Portal server runtime can throw InvalidValue or other errors when:
 * - Calling GetSoldierState on players that are dead, mandown, or not deployed
 * - Calling GetPlayerFromVehicleSeat with invalid seat numbers or vehicle types
 * - Calling GetVehicleFromPlayer on players in transition states
 * 
 * This module wraps these calls to return sensible defaults instead of throwing.
 * 
 * IMPORTANT: Only uses functions that exist in code/mod/index.d.ts
 */

namespace VehicleUIStandalone {
    // Returns true only if player exists, is in world, and alive.
    export function isActivePlayer(player: mod.Player): boolean {
        if (!player) return false;
        try {
            if (!mod.IsPlayerValid(player)) return false;
        } catch (_e) {
            return false;
        }
        return safeGetSoldierStateBool(player, mod.SoldierStateBool.IsAlive);
    }

    /**
     * Safe wrapper for GetSoldierState<T> calls
     * Returns defaultValue if the call throws
     */
    export function safeGetSoldierState<T>(
        player: mod.Player,
        stateKey: T,
        defaultValue: any = null
    ): any {
        if (!player) return defaultValue;
        // Avoid SoldierState calls for undeployed players to prevent PlayerNotDeployed spam.
        if (!hasSoldier(player)) return defaultValue;
        try {
            const result = mod.GetSoldierState(player, stateKey as any);
            return result !== undefined ? result : defaultValue;
        } catch (_e) {
            // Player is likely dead, mandown, or not deployed - return default
            return defaultValue;
        }
    }

    /**
     * Safe wrapper for GetSoldierState<bool> - returns false on error
     */
    export function safeGetSoldierStateBool(
        player: mod.Player,
        stateKey: mod.SoldierStateBool
    ): boolean {
        return safeGetSoldierState(player, stateKey, false) === true;
    }

    /**
     * Safe wrapper for GetSoldierState<Vector>
     */
    export function safeGetSoldierStateVector(
        player: mod.Player,
        stateKey: mod.SoldierStateVector
    ): mod.Vector {
        const result = safeGetSoldierState(player, stateKey, null);
        return result ?? mod.CreateVector(0, 0, 0);
    }

    /**
     * Safe wrapper for GetVehicleFromPlayer
     * Returns null if player is not in vehicle or call throws
     */
    export function safeGetVehicleFromPlayer(player: mod.Player): mod.Vehicle | null {
        if (!player) return null;
        
        // Validate player is in a valid state for this call
        if (!safeGetSoldierStateBool(player, mod.SoldierStateBool.IsAlive)) {
            return null; // Dead/mandown players throw on GetVehicleFromPlayer
        }
        
        // CRITICAL: Must check IsInVehicle before GetVehicleFromPlayer to avoid InvalidValue
        if (!safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle)) {
            return null;
        }
        
        try {
            const vehicle = mod.GetVehicleFromPlayer(player);
            return vehicle ?? null;
        } catch (_e) {
            return null;
        }
    }

    /**
     * Safe wrapper for GetPlayerFromVehicleSeat
     * Returns null if seat is empty or call throws
     */
    export function safeGetPlayerFromVehicleSeat(
        vehicle: mod.Vehicle,
        seatNumber: number
    ): mod.Player | null {
        if (!vehicle) return null;
        
        try {
            // Check if seat is occupied before calling GetPlayerFromVehicleSeat
            // Some vehicle types throw on GetPlayerFromVehicleSeat for any seat
            if (!mod.IsVehicleSeatOccupied(vehicle, seatNumber)) {
                return null;
            }
            
            const player = mod.GetPlayerFromVehicleSeat(vehicle, seatNumber);
            return player ?? null;
        } catch (_e) {
            // Vehicle type doesn't support this seat, or other error
            return null;
        }
    }

    /**
     * Safe wrapper for GetPlayerVehicleSeat
     * Returns -1 if player is not in vehicle or call throws
     */
    export function safeGetPlayerVehicleSeat(player: mod.Player): number {
        if (!player) return -1;
        
        try {
            const seat = mod.GetPlayerVehicleSeat(player);
            return typeof seat === "number" ? seat : -1;
        } catch (_e) {
            return -1;
        }
    }

    /**
     * Safe wrapper for IsVehicleSeatOccupied
     * Returns false on any error
     */
    export function safeIsVehicleSeatOccupied(
        vehicle: mod.Vehicle,
        seatNumber: number
    ): boolean {
        if (!vehicle) return false;
        
        try {
            return mod.IsVehicleSeatOccupied(vehicle, seatNumber) === true;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Safe wrapper for ForcePlayerToSeat
     * Silently fails if player is dead, already in vehicle, or seat is invalid
     */
    export function safeForcePlayerToSeat(
        player: mod.Player,
        vehicle: mod.Vehicle,
        seatNumber: number
    ): boolean {
        if (!player || !vehicle) return false;
        
        // Validate player state before seating
        if (!safeGetSoldierStateBool(player, mod.SoldierStateBool.IsAlive)) {
            return false; // Can't seat dead player
        }
        
        try {
            mod.ForcePlayerToSeat(player, vehicle, seatNumber);
            return true;
        } catch (_e) {
            // Seat occupied, invalid vehicle type, or other error
            return false;
        }
    }

    export function safeForcePlayerExitVehicle(
        player: mod.Player,
        vehicle?: mod.Vehicle
    ): boolean {
        if (!player) return false;

        try {
            if (vehicle) mod.ForcePlayerExitVehicle(player, vehicle);
            else mod.ForcePlayerExitVehicle(player);
            return true;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Safe wrapper for SpawnAIFromAISpawner with error handling
     * NOTE: Portal SDK SpawnAIFromAISpawner returns void, not Player
     * We return true/false to indicate success/failure
     */
    export function safeSpawnAIFromAISpawner(
        spawner: mod.Spawner,
        nameMessage: mod.Message,
        team: mod.Team
    ): boolean {
        if (!spawner || !team) return false;
        
        try {
            mod.SpawnAIFromAISpawner(spawner, nameMessage, team);
            return true; // Assume success if no exception
        } catch (_e) {
            // Quota exceeded or other spawn error
            return false;
        }
    }

    /**
     * Safe wrapper for CompareVehicleName
     * Returns false on any error
     */
    export function safeCompareVehicleName(
        vehicle: mod.Vehicle,
        vehicleType: mod.VehicleList
    ): boolean {
        if (!vehicle) return false;
        
        try {
            return mod.CompareVehicleName(vehicle, vehicleType) === true;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Safe wrapper for DealDamage (vehicle overload)
     * Silently fails if call throws
     */
    export function safeDealDamageToVehicle(
        vehicle: mod.Vehicle,
        damageAmount: number
    ): boolean {
        if (!vehicle || damageAmount <= 0) return false;
        
        try {
            mod.DealDamage(vehicle, damageAmount);
            return true;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Safe wrapper for DealDamage (player overload)
     * Silently fails if call throws
     */
    export function safeDealDamageToPlayer(
        player: mod.Player,
        damageAmount: number
    ): boolean {
        if (!player || damageAmount <= 0) return false;
        
        try {
            mod.DealDamage(player, damageAmount);
            return true;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Check if player has a deployed soldier (using SoldierStateBool)
     * Portal SDK has no GetSoldier function, so we check IsAlive state
     */
    export function safeHasSoldier(player: mod.Player): boolean {
        if (!player) return false;
        
        try {
            // If we can get any soldier state without error, player has soldier
            const isAlive = mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive);
            return isAlive !== undefined;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Safe wrapper for AIValidatedMoveToBehavior
     * Silently fails if player is not alive or call throws
     */
    export function safeAIMoveTo(
        player: mod.Player,
        position: mod.Vector
    ): boolean {
        if (!player || !position) return false;
        
        try {
            mod.AIValidatedMoveToBehavior(player, position);
            return true;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Safe wrapper for GetVehicleSpawner
     */
    export function safeGetVehicleSpawner(spawnerId: number): mod.VehicleSpawner | null {
        if (spawnerId < 0) return null;
        
        try {
            const spawner = mod.GetVehicleSpawner(spawnerId);
            return spawner ?? null;
        } catch (_e) {
            return null;
        }
    }

    /**
     * Safe wrapper for GetSpawner
     */
    export function safeGetSpawner(spawnerId: number): mod.Spawner | null {
        if (spawnerId < 0) return null;
        
        try {
            const spawner = mod.GetSpawner(spawnerId);
            return spawner ?? null;
        } catch (_e) {
            return null;
        }
    }

    /**
     * Safe wrapper for GetVehicleState (Vector only - that's what SDK provides)
     */
    export function safeGetVehicleStateVector(
        vehicle: mod.Vehicle,
        stateKey: mod.VehicleStateVector
    ): mod.Vector | null {
        if (!vehicle) return null;
        
        try {
            return mod.GetVehicleState(vehicle, stateKey);
        } catch (_e) {
            return null;
        }
    }
}
