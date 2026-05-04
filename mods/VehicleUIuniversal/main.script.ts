/// <reference path="config/StandaloneConfig.ts" />
/// <reference path="modules/SafeSDKWrapper.ts" />
/// <reference path="modules/AutoDiscoveryModule.ts" />
/// <reference path="modules/VehicleSpawnUIModule.ts" />
/// <reference path="lib/logging.ts" />
/// <reference path="lib/callback-handler.ts" />
/// <reference path="lib/events.ts" />
/// <reference path="lib/solid-ui.ts" />
/// <reference path="lib/ui-v8.ts" />

/**
 * Vehicle UI Standalone - main entry point
 * =========================================
 *
 * Self-contained vehicle deploy UI for BF6 Portal experiences.
 *
 * What this script does:
 *  - Auto-discovers vehicle spawners on the loaded map (no per-map config)
 *  - Shows on-screen buttons (BLUE/GREEN/BLACK) when the local player is dead
 *  - Lets the player pick a vehicle and spawn directly into it as pilot
 *  - Tracks vehicle ownership / cooldowns (jets get a 30s personal cooldown)
 *  - Wires up the standard Portal lifecycle events (deploy, die, vehicle in/out)
 *
 * What this script does NOT do (intentionally):
 *  - Spawn AI bots, run a game mode, manage tickets, capture flags, etc.
 *  - Modify vehicle balance globally (only soft per-spawn HP multipliers)
 *
 * Drop in alongside your rule blocks - see README.md for integration.
 *
 * Public API (call from your own main script if you embed this):
 *  - VehicleUIStandalone_Init()                  // call once on game mode start
 *  - VehicleUIStandalone_Tick()                  // call ~1x/second
 *  - VehicleUIStandalone_OnPlayerDeployed(p)
 *  - VehicleUIStandalone_OnPlayerUndeployed(p)
 *  - VehicleUIStandalone_OnPlayerDied(p)
 *  - VehicleUIStandalone_OnVehicleSpawned(v)
 *  - VehicleUIStandalone_OnVehicleDestroyed(v)
 *  - VehicleUIStandalone_OnPlayerEnterVehicle(p, v)
 *  - VehicleUIStandalone_OnPlayerExitVehicle(p, v)
 *  - VehicleUIStandalone_OnPlayerUIButtonEvent(p, w, e)
 */

// Top-level state
let __vuiInitialized = false;
let __vuiRunning = false;
let __vuiRunToken = 0;
const __VUI_TICK_INTERVAL_SECONDS = 1.0;

// =============================================================================
// PUBLIC API (call these from a host main script if you are embedding)
// =============================================================================
function VehicleUIStandalone_Init(): void {
    if (__vuiInitialized) return;
    __vuiInitialized = true;

    VehicleUIStandalone.log("======================================================");
    VehicleUIStandalone.log("Vehicle UI Standalone - initializing");
    VehicleUIStandalone.log("======================================================");

    // Allow all air vehicles - jets need this or they get blocked by AirCombatVolume
    try {
        mod.SetAllVehiclesAllowedInSurroundingArea(true);
        mod.SetVehicleCategoryAllowedInSurroundingArea(mod.VehicleCategories.Air_All, true);
        mod.SetVehicleCategoryAllowedInSurroundingArea(mod.VehicleCategories.Air_Plane, true);
        mod.SetVehicleCategoryAllowedInSurroundingArea(mod.VehicleCategories.Air_Heli, true);
        mod.SetMaxVehicleHeightLimitScale(2);
    } catch (e) {
        VehicleUIStandalone.logError(`[Init] vehicle allow-list: ${e}`);
    }

    // Auto-discover vehicle spawners (probes spawner IDs 200-2100 on the map)
    VehicleUIStandalone.safeCall("AutoDiscovery_Init", () => VehicleUIStandalone.AutoDiscovery_Init());

    // Build the UI from whatever was discovered
    // Always attempt UI init. initVehicleSpawnUI() is idempotent: it returns
    // early if no vehicles observed yet, and the tick loop retries it so the
    // UI builds itself once the map's autospawn fires OnVehicleSpawned events.
    if (VehicleUIStandalone.discoveredVehicleSpawners.length > 0) {
        VehicleUIStandalone.log(`[VehicleUI] ${VehicleUIStandalone.discoveredVehicleSpawners.length} spawner(s) discovered at init`);
    } else {
        VehicleUIStandalone.log("[VehicleUI] No vehicles observed at init - waiting for OnVehicleSpawned events");
    }
    VehicleUIStandalone.safeCall("initVehicleSpawnUI", () => VehicleUIStandalone.initVehicleSpawnUI());

    // Start the periodic tick loop using the Portal async scheduler
    __vuiRunning = true;
    __vuiRunToken++;
    void VehicleUIStandalone_TickLoop(__vuiRunToken);
}

async function VehicleUIStandalone_TickLoop(token: number): Promise<void> {
    while (__vuiRunning && token === __vuiRunToken) {
        // Re-attempt UI build every tick. initVehicleSpawnUI() is cheap when
        // there are no new vehicles and idempotent once initialized.
        VehicleUIStandalone.safeCall("AutoDiscovery_ResweepLiveVehicles", () => VehicleUIStandalone.AutoDiscovery_ResweepLiveVehicles());
        VehicleUIStandalone.safeCall("initVehicleSpawnUI", () => VehicleUIStandalone.initVehicleSpawnUI());
        VehicleUIStandalone.safeCall("tickVehicleUI", () => VehicleUIStandalone.tickVehicleUI());
        VehicleUIStandalone.safeCall("vehicleUI_ApplyLabelCorrections", () => VehicleUIStandalone.vehicleUI_ApplyLabelCorrections());
        try {
            await mod.Wait(__VUI_TICK_INTERVAL_SECONDS);
        } catch (_e) {
            return;
        }
    }
}

function VehicleUIStandalone_Shutdown(): void {
    __vuiRunning = false;
    __vuiInitialized = false;
}

// Manual tick for hosts that prefer to drive ticks themselves (e.g. from a
// rule-block schedule). Safe to call repeatedly; internal scheduler will
// continue running in parallel and is idempotent.
function VehicleUIStandalone_Tick(): void {
    if (!__vuiInitialized) return;
    VehicleUIStandalone.safeCall("AutoDiscovery_ResweepLiveVehicles", () => VehicleUIStandalone.AutoDiscovery_ResweepLiveVehicles());
    VehicleUIStandalone.safeCall("initVehicleSpawnUI", () => VehicleUIStandalone.initVehicleSpawnUI());
    VehicleUIStandalone.safeCall("tickVehicleUI", () => VehicleUIStandalone.tickVehicleUI());
    VehicleUIStandalone.safeCall("vehicleUI_ApplyLabelCorrections", () => VehicleUIStandalone.vehicleUI_ApplyLabelCorrections());
}

function VehicleUIStandalone_OnPlayerDeployed(player: mod.Player): void {
    if (!player) return;
    Events.OnPlayerDeployed.trigger(player);
}

function VehicleUIStandalone_OnPlayerUndeployed(player: mod.Player): void {
    if (!player) return;
    Events.OnPlayerUndeploy.trigger(player);
}

function VehicleUIStandalone_OnPlayerDied(player: mod.Player): void {
    if (!player) return;
    // Other args (killer, deathType, weapon) aren't used by our handlers, so
    // we can pass null/undefined; the subscriber only inspects `player`.
    Events.OnPlayerDied.trigger(player, null, null, null);
}

function VehicleUIStandalone_OnVehicleSpawned(vehicle: mod.Vehicle): void {
    if (!vehicle) return;
    Events.OnVehicleSpawned.trigger(vehicle);
}

function VehicleUIStandalone_OnVehicleDestroyed(vehicle: mod.Vehicle): void {
    if (!vehicle) return;
    Events.OnVehicleDestroyed.trigger(vehicle);
}

function VehicleUIStandalone_OnPlayerEnterVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
    if (!player || !vehicle) return;
    Events.OnPlayerEnterVehicle.trigger(player, vehicle);
}

function VehicleUIStandalone_OnPlayerExitVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
    if (!player || !vehicle) return;
    Events.OnPlayerExitVehicle.trigger(player, vehicle);
}

function VehicleUIStandalone_OnPlayerUIButtonEvent(player: mod.Player, widget: mod.UIWidget, buttonEvent: mod.UIButtonEvent): void {
    if (!player || !widget) return;
    Events.OnPlayerUIButtonEvent.trigger(player, widget, buttonEvent);
}

// =============================================================================
// EVENTS WIRING (Events.X.subscribe pattern - matches bf6-portal-utils convention)
// All actual handler logic runs through the Events channel, decoupling the
// top-level Portal export shims below from the individual modules.
// =============================================================================
Events.OnGameModeStarted.subscribe(() => VehicleUIStandalone_Init());

Events.OnPlayerDeployed.subscribe((player: mod.Player) => {
    if (!player) return;
    VehicleUIStandalone.markPlayerDeployed(player);
    if (!__vuiInitialized) return;
    const isAI = VehicleUIStandalone.isAISoldier(player);
    VehicleUIStandalone.safeCall("vehicleUI_OnPlayerDeployed", () => VehicleUIStandalone.vehicleUI_OnPlayerDeployed(player));
    if (!isAI) {
        VehicleUIStandalone.safeCall("onPlayerDeployedHideVehicleUI", () => VehicleUIStandalone.onPlayerDeployedHideVehicleUI(player));
    }
});

Events.OnPlayerUndeploy.subscribe((player: mod.Player) => {
    if (!player) return;
    if (__vuiInitialized) {
        VehicleUIStandalone.safeCall("vehicleUI_OnPlayerUndeployed", () => VehicleUIStandalone.vehicleUI_OnPlayerUndeployed(player));
    }
    VehicleUIStandalone.markPlayerUndeployed(player);
});

Events.OnPlayerDied.subscribe((player: mod.Player) => {
    if (!__vuiInitialized || !player) return;
    if (VehicleUIStandalone.isAISoldier(player)) return;
    VehicleUIStandalone.safeCall("onPlayerDiedShowUI", () => VehicleUIStandalone.onPlayerDiedShowUI(player));
});

Events.OnVehicleSpawned.subscribe((vehicle: mod.Vehicle) => {
    if (!__vuiInitialized || !vehicle) return;
    // Zero-config probe pipeline: bind probed spawner to its produced vehicle.
    VehicleUIStandalone.safeCall("AutoDiscovery_OnVehicleSpawned", () => VehicleUIStandalone.AutoDiscovery_OnVehicleSpawned(vehicle));
    VehicleUIStandalone.safeCall("vehicleUI_OnVehicleSpawned", () => VehicleUIStandalone.vehicleUI_OnVehicleSpawned(vehicle));
});

Events.OnVehicleDestroyed.subscribe((vehicle: mod.Vehicle) => {
    if (!__vuiInitialized || !vehicle) return;
    VehicleUIStandalone.safeCall("vehicleUI_OnVehicleDestroyed", () => VehicleUIStandalone.vehicleUI_OnVehicleDestroyed(vehicle));
});

Events.OnPlayerEnterVehicle.subscribe((player: mod.Player, vehicle: mod.Vehicle) => {
    if (!__vuiInitialized || !player || !vehicle) return;
    VehicleUIStandalone.safeCall("vehicleUI_OnPlayerEnterVehicle", () => VehicleUIStandalone.vehicleUI_OnPlayerEnterVehicle(player, vehicle));
});

Events.OnPlayerExitVehicle.subscribe((player: mod.Player, vehicle: mod.Vehicle) => {
    if (!__vuiInitialized || !player || !vehicle) return;
    VehicleUIStandalone.safeCall("vehicleUI_OnPlayerExitVehicle", () => VehicleUIStandalone.vehicleUI_OnPlayerExitVehicle(player, vehicle));
});

Events.OnPlayerUIButtonEvent.subscribe((player: mod.Player, widget: mod.UIWidget, buttonEvent: mod.UIButtonEvent) => {
    if (!__vuiInitialized || !player || !widget) return;
    VehicleUIStandalone.safeCall("vehicleUI_HandleButtonEvent", () => VehicleUIStandalone.vehicleUI_HandleButtonEvent(player, widget, buttonEvent));
});

// =============================================================================
// TOP-LEVEL PORTAL EVENT HANDLERS
// (These are auto-invoked by the Portal runtime if no host script claims them.)
// They are now thin shims: each just triggers the corresponding Events channel
// so subscribers above run. A host script can either call these shims or call
// `Events.OnXxx.trigger(...)` directly -- both routes converge on the same
// subscriber chain.
// =============================================================================
export function OnGameModeStarted(): void {
    Events.OnGameModeStarted.trigger();
}

export function OnPlayerDeployed(player: mod.Player): void {
    Events.OnPlayerDeployed.trigger(player);
}

export function OnPlayerUndeploy(player: mod.Player): void {
    Events.OnPlayerUndeploy.trigger(player);
}

export function OnPlayerDied(player: mod.Player, killer: mod.Player, deathType: mod.DeathType, weapon: mod.WeaponUnlock): void {
    Events.OnPlayerDied.trigger(player, killer, deathType, weapon);
}

export function OnVehicleSpawned(vehicle: mod.Vehicle): void {
    Events.OnVehicleSpawned.trigger(vehicle);
}

export function OnVehicleDestroyed(vehicle: mod.Vehicle, destroyer: mod.Player, weapon: mod.WeaponUnlock): void {
    Events.OnVehicleDestroyed.trigger(vehicle, destroyer, weapon);
}

export function OnPlayerEnterVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
    Events.OnPlayerEnterVehicle.trigger(player, vehicle);
}

export function OnPlayerExitVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
    Events.OnPlayerExitVehicle.trigger(player, vehicle);
}

export function OnPlayerUIButtonEvent(player: mod.Player, widget: mod.UIWidget, buttonEvent: mod.UIButtonEvent): void {
    Events.OnPlayerUIButtonEvent.trigger(player, widget, buttonEvent);
}
