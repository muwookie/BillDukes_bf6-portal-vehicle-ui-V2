# Vehicle UI Universal

A vehicle deploy UI for **Battlefield 6 Portal** maps. Adds a row of
buttons to the deploy / death screen so players can spawn directly into
the vehicle of their choice as the pilot.

> **This is NOT a zero-config drop-in.** It auto-discovers vehicles at
> runtime, but **the map itself must be built to specific rules** for the
> UI to work correctly. See [Map Setup Requirements](#map-setup-requirements)
> below. Skip those rules and you will get blank buttons, players
> deployed on foot, or players seated in the wrong vehicle.

![Status](https://img.shields.io/badge/status-stable-green)
![Bundle](https://img.shields.io/badge/bundle-211KB-blue)
![Runtime](https://img.shields.io/badge/runtime-BF6%20Portal-orange)

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [What It Does NOT Do](#what-it-does-not-do)
3. [Map Setup Requirements](#map-setup-requirements)  ← read this first
4. [Build & Upload](#build--upload)
5. [Integration with Other Scripts / Rule Blocks](#integration-with-other-scripts--rule-blocks)
6. [Configuration Knobs](#configuration-knobs)
7. [How It Works](#how-it-works)
8. [Troubleshooting](#troubleshooting)
9. [File Layout](#file-layout)

---

## What It Does

When a player is on the deploy screen (or just died), this script renders
a horizontal row of vehicle buttons. Click one and the player is
deployed directly as the pilot of that vehicle.

- **Auto-discovers** vehicles at runtime by listening to
  `OnVehicleSpawned` -- no hand-written per-map vehicle table.
- **3-state buttons:**
  - **BLUE** -- vehicle exists, unoccupied, deploy is available
  - **GREEN** -- reserved for you (after you click)
  - **BLACK** -- not yet spawned, on cooldown, or pilot seat occupied
- **Per-player jet cooldown** (default 30 s) so jet buttons cannot be
  spammed.
- **Attack-heli pilot seating** (AH64, AH6M, Eurocopter): button puts
  you in seat 0 (pilot), not the gunner seat.
- **Soft per-spawn HP scaling** for tanks, IFVs, AA, Marauders.
- **Faction-anchor team classification** so the script can tell which
  observed vehicle belongs to which team without per-map config (see
  [How It Works](#how-it-works)).
- **HQ-anchor jet fallback** for the SDK quirk where
  `mod.CompareVehicleName(v, F16)` (and sometimes F22) returns false
  even when the jet is right there. The script uses team HQ centroid +
  jet-pad proximity to find unidentified jets.

## What It Does NOT Do

- **Not a game mode.** No tickets, no flags, no AI spawning, no win
  condition. Pair it with your own host script (Conquest, etc.) or
  with rule blocks.
- **Does not modify global vehicle balance** -- only spawn-time HP scale.
- **Does not handle objective-reward vehicles** that your rule blocks
  spawn (e.g. "capture E to get a tank"). Those vehicles spawn outside
  this script's flow and have no button. Don't list them in your map's
  spawner registry either or players will see ghost buttons that
  deploy them on foot.
- **Does not replace the in-world vehicle map icon.** Players can still
  walk up to a vehicle and enter it normally; this UI is just a faster
  alternative for the deploy screen.

---

## Map Setup Requirements

Build the map in the Godot SDK following these three rules. Without
them the script cannot do its job.

### Rule 1 -- Faction-correct vehicle layout (MANDATORY)

The script identifies vehicles by their `mod.VehicleList` enum value.
Identical models cannot be told apart at runtime, so **a model name may
appear on at most one team**. Same *role* per team is fine, same
*model* is not.

Use the BF6 NATO / PAX faction pairs:

| Role            | Team 1 (NATO)  | Team 2 (PAX)     |
| --------------- | -------------- | ---------------- |
| Light transport | `Flyer60`      | `Vector`         |
| Dirt bike       | `DirtBike`     | `DirtBike_Pax`   |
| Light heli      | `AH6M`         | `AH6M_Pax`       |
| Transport heli  | `UH60`         | `UH60_Pax`       |
| Light buggy     | `Marauder`     | `Marauder_Pax`   |
| MBT             | `Abrams`       | `Leopard`        |
| IFV             | `M2Bradley`    | `CV90`           |
| AA              | `Gepard`       | `Cheetah`        |
| Attack heli     | `AH64`         | `Eurocopter`     |
| Fighter jet     | `F22`          | `SU57`           |
| Strike jet      | `F16`          | `JAS39`          |

Models with no factional counterpart -- `RHIB`, `GolfCart`, `Quadbike` --
must be assigned to a single team only. Do not place them on both.

> **Note on team-1 / team-2 polarity:** the script does not care whether
> you call NATO "Team 1" or "Team 2" in your rule blocks. It detects
> team affinity from the position centroid of strong anchor vehicles
> (Abrams + M2Bradley + F22 vs Leopard + CV90 + SU57). What it *does*
> care about is that no model is shared.

**Quantity per team is unconstrained.** Five Abrams on T1 + five
Leopards on T2 is fine. The constraint is only on model overlap
between the two teams.

### Rule 2 -- Spawner ObjId convention

For a vehicle to appear as a deploy button, the script must be able to
get a stable handle for its spawner. That means the spawner needs an
`ObjId` in the Godot inspector.

| Vehicle kind        | ObjId requirement                        |
| ------------------- | ---------------------------------------- |
| Ground & helis      | Set ObjId to a unique integer per spawner. T1 ground tends to live in the 200s / 290s / 310s ranges in stock maps; T2 in the 200s / 290s / 310s opposite ends. The script does not care about specific numbers, only that the ID is unique and stable. |
| Jet runway spawners | **Leave ObjId at -1.** Jets self-spawn from the engine and the script uses synthetic registry IDs (232 / 243 for T1 jets, 233 / 247 for T2) plus HQ-anchor proximity to track them. Setting an ObjId on a jet spawner can hide it from the script's jet pipeline. |
| Capture-reward      | Leave OFF the deploy roster. Reward vehicles should not have a deploy button -- the player gets the vehicle by capturing the flag, not by clicking. |

If the spawner has no usable ObjId AND it is not a jet, the vehicle
will still be drivable (walk up + enter) but will NOT get a deploy
button.

### Rule 3 -- HQ AI-spawner IDs (RECOMMENDED for jet maps)

The jet click handler computes a "team HQ centroid" from the
**player AI spawner** ObjIds. The script probes these ID lists in
order and uses the first set that resolves:

- T1 known: `1090, 1091, 1092, 1093`
- T2 known: `1002, 1003, 1004, 1005`
- T1 fallback: `100, 110, 120, 130`
- T2 fallback: `101, 111, 121, 131`

If your map's player spawners use ObjIds outside both lists, the HQ
centroid resolution will fail and any jet whose model name doesn't
identify by `mod.CompareVehicleName` will not be deployable from the
button. Either rename your AI spawner IDs to match the known lists, or
extend `discoverAISpawners()` in [`modules/AutoDiscoveryModule.ts`](modules/AutoDiscoveryModule.ts).

### Map setup checklist

- [ ] Every Team 1 vehicle uses a NATO model name (left column above).
- [ ] Every Team 2 vehicle uses a PAX model name (right column above).
- [ ] No model appears on both teams.
- [ ] Each ground / heli spawner has a unique ObjId.
- [ ] Every jet runway spawner has ObjId `-1` (not set).
- [ ] Player AI spawner ObjIds match one of the known lists in Rule 3.
- [ ] Capture-reward vehicles are NOT included in the deploy roster.

---

## Build & Upload

```powershell
# One-time: install dev deps
npm install

# Bundle: concatenates the namespace into a single .ts ready for Portal
npm run bundle:vehicle-ui
# (or directly: node .\scripts\bundle-vehicle-ui-universal.js)
```

Output: [`dist/VehicleUIUniversal.portal.ts`](../../dist/VehicleUIUniversal.portal.ts)
(~211 KB, ASCII-only, zero non-ASCII bytes).

1. Open the bundle in any text editor.
2. Copy the entire file.
3. Paste into the **Script** slot of your BF6 Portal experience in the
   Rules Editor.
4. Save & launch.

The bundler aborts if it would emit any non-ASCII byte. Don't open the
output in Word / Notepad, both will inject smart quotes and break the
upload.

---

## Integration with Other Scripts / Rule Blocks

The bundle registers its own top-level Portal event handlers. If your
experience is rule-block-only (no host script), just paste the bundle
and you're done.

If you have your own host script that already exports `OnGameModeStarted`
/ `OnPlayerDeployed` / etc., you must embed and delegate.

### Embed-and-delegate pattern

1. Open `dist/VehicleUIUniversal.portal.ts`.
2. **Delete the bottom** `// ===== Module: main.script.ts =====` block --
   it's the section with the top-level `export function OnXxx(...)`
   handlers.
3. Paste the rest of the bundle at the **top** of your host script.
4. Add delegate calls into your existing handlers:

```typescript
export function OnGameModeStarted(): void {
    YourGameMode_Init();
    VehicleUIStandalone_Init();
}

export function OnPlayerDeployed(player: mod.Player): void {
    YourGameMode_OnPlayerDeployed(player);
    VehicleUIStandalone_OnPlayerDeployed(player);
}

export function OnPlayerUndeploy(player: mod.Player): void {
    VehicleUIStandalone_OnPlayerUndeployed(player);
}

export function OnPlayerDied(p: mod.Player, k: mod.Player, dt: mod.DeathType, w: mod.WeaponUnlock): void {
    YourGameMode_OnPlayerDied(p, k, dt, w);
    VehicleUIStandalone_OnPlayerDied(p);
}

export function OnVehicleSpawned(v: mod.Vehicle): void {
    VehicleUIStandalone_OnVehicleSpawned(v);
}

export function OnVehicleDestroyed(v: mod.Vehicle, d: mod.Player, w: mod.WeaponUnlock): void {
    VehicleUIStandalone_OnVehicleDestroyed(v);
}

export function OnPlayerEnterVehicle(p: mod.Player, v: mod.Vehicle): void {
    VehicleUIStandalone_OnPlayerEnterVehicle(p, v);
}

export function OnPlayerExitVehicle(p: mod.Player, v: mod.Vehicle): void {
    VehicleUIStandalone_OnPlayerExitVehicle(p, v);
}

export function OnPlayerUIButtonEvent(p: mod.Player, w: mod.UIWidget, e: mod.UIButtonEvent): void {
    VehicleUIStandalone_OnPlayerUIButtonEvent(p, w, e);
}
```

> The namespace is still called `VehicleUIStandalone` internally even
> in the universal fork -- renaming it would break embed-and-delegate
> for everyone who already wired it. The *bundle file* is named
> `VehicleUIUniversal.portal.ts`; the *runtime symbol* is
> `VehicleUIStandalone_*`.

### Triggering from a rule block

```javascript
// "Run JavaScript" rule action:
VehicleUIStandalone_OnPlayerDied(eventPlayer);
```

### Public API

```typescript
VehicleUIStandalone_Init(): void                      // call once on game-mode start, idempotent
VehicleUIStandalone_Shutdown(): void                  // optional, stops internal tick
VehicleUIStandalone_Tick(): void                      // optional, manual tick (auto-runs at 1 Hz)
VehicleUIStandalone_OnPlayerDeployed(player)
VehicleUIStandalone_OnPlayerUndeployed(player)
VehicleUIStandalone_OnPlayerDied(player)
VehicleUIStandalone_OnVehicleSpawned(vehicle)
VehicleUIStandalone_OnVehicleDestroyed(vehicle)
VehicleUIStandalone_OnPlayerEnterVehicle(player, vehicle)
VehicleUIStandalone_OnPlayerExitVehicle(player, vehicle)
VehicleUIStandalone_OnPlayerUIButtonEvent(player, widget, buttonEvent)
```

---

## Configuration Knobs

### [`config/StandaloneConfig.ts`](config/StandaloneConfig.ts) -- HP scaling

| Constant                    | Default | Purpose                            |
| --------------------------- | ------- | ---------------------------------- |
| `TANK_HEALTH_MULTIPLIER`    | `0.5`   | Spawn-time HP scale for tanks      |
| `IFV_HEALTH_MULTIPLIER`     | `0.6`   | Spawn-time HP scale for IFVs       |
| `AA_HEALTH_MULTIPLIER`      | `0.7`   | Spawn-time HP scale for AA         |
| `MARAUDER_HEALTH_MULTIPLIER`| `0.6`   | Spawn-time HP scale for Marauders  |

### [`modules/VehicleSpawnUIModule.ts`](modules/VehicleSpawnUIModule.ts) -- behaviour

| Constant                       | Default            | Purpose                                                          |
| ------------------------------ | ------------------ | ---------------------------------------------------------------- |
| `UI_PANEL_ANCHOR`              | `TopCenter`        | Where the button row anchors on screen                           |
| `UI_PANEL_X` / `UI_PANEL_Y`    | `0` / `170`        | Pixel offset from the anchor (Y=170 clears the deploy ticket bar)|
| `JET_COOLDOWN_SECONDS`         | `30.0`             | Per-player cooldown after force-spawning a jet                   |
| `SPAWNER_COOLDOWN_SECONDS`     | `30.0`             | Per-spawner cooldown after a vehicle is destroyed                |
| `HQ_EMPTY_DEPLOY_RADIUS`       | `60.0`             | If an empty vehicle drifts further than this from spawn, the BLUE button hides until a fresh one respawns |
| `ABANDONED_VEHICLE_DISTANCE`   | `5000.0`           | Sanity bound for "vehicle is gone"                               |
| `HQ_REPLACEMENT_RADIUS_SQ`     | `100 * 100`        | Radius for swapping a stale link to a fresh respawn near HQ      |

### [`modules/AutoDiscoveryModule.ts`](modules/AutoDiscoveryModule.ts) -- discovery

| Constant                        | Default  | Purpose                                              |
| ------------------------------- | -------- | ---------------------------------------------------- |
| `VEHICLE_SPAWNER_PROBE_START`   | `200`    | Lowest spawner ID the candidate pool collects        |
| `VEHICLE_SPAWNER_PROBE_END`     | `2100`   | Highest spawner ID the candidate pool collects       |
| `CAPTURE_REWARD_RADIUS_METERS`  | `50`     | A vehicle that spawns this close to a capture point is flagged as a capture reward and excluded from the deploy roster |

---

## How It Works

### Discovery is passive, not table-driven

There is no per-map vehicle table in the script. At init, the script
collects every spawner handle in the probed ID range as a "candidate
pool" but does NOT force-spawn anything. As `OnVehicleSpawned` fires,
each new vehicle is identified by:

- **Type** -- `mod.CompareVehicleName(v, mod.VehicleList.X)` for each X.
- **Team** -- by position centroid against strong faction anchors.
  Strong T1 anchors: Abrams, M2Bradley, F22, F16, AH64. Strong T2:
  Leopard, CV90, SU57, JAS39, Eurocopter. The first observed strong
  anchor seeds a centroid; later soft assets (AA, Marauder, light
  helis, transports, dirtbikes) are classified by which centroid they
  are closer to. This is why **Rule 1 (no shared models)** is
  mandatory: the centroid math falls apart if both teams have the
  same model.
- **Capture-reward flag** -- if the vehicle spawns within 50 m of a
  capture point, the script marks it as a reward and hides it from
  the deploy roster.

### Jets are special

`mod.CompareVehicleName(v, F16)` and `mod.CompareVehicleName(v, F22)`
return `false` on multiple SDK builds, even when the jet is right
there. Two safety nets:

1. **Synthetic phantom mirror.** Maps always pair jets 1:1
   (F22↔SU57, F16↔JAS39). When the script sees one side, it
   synthesizes a phantom catalog entry for the other side so the
   button appears even before the engine produces an observable
   vehicle.
2. **HQ-anchor elimination fallback.** When a player clicks a jet
   button and no name-matched candidate exists, the script scans
   `mod.AllVehicles()` for any unoccupied vehicle that:
   - matches NO known `mod.VehicleList` entry, AND
   - is within 400 m of an identified jet, OR within 1500 m of the
     team HQ centroid.
   That candidate is adopted as the jet and the player is seated.
   This is why **Rule 3 (known HQ AI spawner IDs)** matters.

### Phantom mirror pruning

If the real jet spawner shows up after the phantom was created (e.g.
the F22 wasn't observed at game start but spawned later), the phantom
is pruned and the spawner-set signature change forces a UI rebuild so
the deploy button now points at the real spawner.

### Tick loop (1 Hz)

- Re-sweep `mod.AllVehicles()` to catch type changes from despawn /
  respawn.
- Recompute button colors per player.
- Detect spawner-set changes and rebuild the panel if needed.

---

## Troubleshooting

### Buttons never appear

Check `PortalLog.txt` for `[VehicleUI] Built vehicle defs from
discovery: T1=N, T2=M`. If `N` or `M` is 0, no vehicles for that team
were observed. Common causes:
- The map's spawners have no usable ObjIds.
- The `OnVehicleSpawned` event is suppressed by your host script (the
  embed-and-delegate flow in [Integration](#integration-with-other-scripts--rule-blocks)
  must include the `OnVehicleSpawned` delegation).
- The map probe range (200..2100) does not cover your spawner IDs.

### F16 / F22 button is BLACK even though the jet is parked at HQ

`hasIdleMatchingJet` couldn't find it by name and the HQ centroid
fallback didn't either. Check:
- Player AI spawner ObjIds match one of the lists in **Rule 3** above.
  Look for `[Discovery] HQ centroids: T1=(...) T2=(...)` in
  `PortalLog.txt`.
- The jet is actually unoccupied (an AI pilot in the seat will keep
  the button BLACK).
- The jet is within 1500 m of the HQ centroid.

### Player clicks a jet button and ends up on foot

Look for `[VehicleUI] Jet fallback (F22): anchors=N` and
`Jet fallback: no unidentified vehicle near anchors for F22` in the
log. If `anchors=0`, fix the HQ AI spawner ObjIds. If
`anchors > 0` but no unidentified vehicle was found, the jet may have
been despawned just before the click; wait for the respawn and
re-click.

### Player clicks a jet button and gets seated in an Abrams

This was a real bug pre-2026-05-04. If you still see it, you're on an
old bundle -- rebuild and re-upload `dist/VehicleUIUniversal.portal.ts`.
The `waitForNewJetThenSeat` poll now requires a strict type match.

### Buttons stuck at "Unknown"

The label-correction tick should fix these within ~10 seconds of the
vehicle spawning. If not, the spawner is producing a vehicle type the
SDK does not expose to `mod.CompareVehicleName` reliably -- file the
spawner ID and observed in-game vehicle.

### Both teams have a Flyer / DirtBike, and one team's button never works

You broke **Rule 1**. Replace the duplicated model on Team 2 with its
PAX counterpart (Vector / DirtBike_Pax). The script cannot
distinguish two `Flyer60` instances by team.

### Portal Rules Editor rejects upload with "action needed"

The bundle has non-ASCII characters. Re-run `npm run bundle:vehicle-ui`
-- it refuses to write a non-ASCII bundle. If you edited any source
file, check for em-dashes, smart quotes, or degree symbols.

### Players can spam jet buttons

Increase `JET_COOLDOWN_SECONDS` in [`modules/VehicleSpawnUIModule.ts`](modules/VehicleSpawnUIModule.ts).

---

## File Layout

```
mods/VehicleUIuniversal/
├── README.md                        ← this file
├── tsconfig.json
├── main.script.ts                   ← entry point + Portal event handlers
├── config/
│   └── StandaloneConfig.ts          ← HP multipliers + small helpers
├── lib/
│   ├── callback-handler.ts
│   ├── events.ts
│   ├── logging.ts
│   ├── solid-ui.ts
│   └── ui-v8.ts
└── modules/
    ├── SafeSDKWrapper.ts            ← defensive wrappers around brittle SDK calls
    ├── AutoDiscoveryModule.ts       ← passive vehicle discovery + team classification
    └── VehicleSpawnUIModule.ts      ← UI panel + button click handler

scripts/
└── bundle-vehicle-ui-universal.js   ← namespace concatenator

dist/
└── VehicleUIUniversal.portal.ts     ← the file you upload to Portal
```

---

## Constraints (BF6 Portal Runtime)

- **ASCII-only.** The bundler verifies and aborts on non-ASCII bytes.
- **No `import` / `require`.** Single-file QuickJS module, namespace
  bundling.
- **One script per Portal experience.** Embed if you need other code.
- **No DOM, no Node APIs.** `mod.*` and `console.log` only.

## Compatibility

- Battlefield 6 Portal (current build).
- Tested on stock Conquest maps (Capstone, Downtown, Eastwood, Sand,
  Badlands Winter), Andy Capstone, FireStorm `ty_ger07`, and several
  custom community maps.
- ES2020 / TypeScript 5.x source.

## License

MIT (or whatever your host project uses). Derivative of the
ConquestV16 internal modules; the runtime namespace is
`VehicleUIStandalone` for backward compatibility with existing
embed-and-delegate sites.
