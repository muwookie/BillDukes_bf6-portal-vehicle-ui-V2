# BillDukes BF6 Portal Vehicle UI V2

A vehicle deploy UI module for **Battlefield 6 Portal**.

The full module documentation, map setup requirements, configuration knobs,
and troubleshooting guide live in
[mods/VehicleUIuniversal/README.md](mods/VehicleUIuniversal/README.md).

## What's in this repo

```
mods/VehicleUIuniversal/    Source (TypeScript namespace bundle)
scripts/                    Bundler that concatenates the source into one .ts
dist/                       Pre-built bundle ready to upload to Portal
```

## Quick upload (no build needed)

1. Open [`dist/VehicleUIUniversal.portal.ts`](dist/VehicleUIUniversal.portal.ts).
2. Copy the entire file contents.
3. Paste into the **Script** slot of your BF6 Portal experience in the
   Rules Editor.
4. Save & launch.

## Rebuild from source

```powershell
node ./scripts/bundle-vehicle-ui-universal.js
# or
npm run bundle
```

Output: `dist/VehicleUIUniversal.portal.ts` (~211 KB, ASCII-only).

## Map setup

This is **NOT** a zero-config drop-in. Read
[mods/VehicleUIuniversal/README.md § Map Setup Requirements](mods/VehicleUIuniversal/README.md#map-setup-requirements)
before authoring your map. In short:

1. Don't share `mod.VehicleList` model names across teams (use NATO/PAX
   pairs).
2. Give every ground/heli spawner a unique ObjId; leave jet runways
   at ObjId `-1`.
3. Use one of the known player AI spawner ID lists for your HQs (so the
   jet HQ-anchor fallback can resolve).

## License

MIT.
