# IRON TIDE – Coastal Vanguard

IRON TIDE is a 2D coastal survival RTS built with **React, TypeScript, Vite, and a custom Canvas game engine**. Android packaging uses Capacitor 7. The project is not a Godot, Unity, or Unreal project.

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

## Validate and build

```bash
npm run lint
npm run build
```

## Android APK

```bash
npm run cap:add   # first time only
npm run apk:debug
```

The Android GitHub Actions workflow also builds a debug APK and attaches it as an artifact. It applies landscape orientation and generates the launcher icon from the custom Iron Tide branding assets.

## Game systems

- 10 coastal / modern military maps with unique terrain, sectors, roads, and spawn layouts.
- 12 zombie classes: Shambler, Sprinter, Leaper, Spitter, Riot, Brute, Crawler, Exploder, Tank, Screamer, Mutated, and Infected Marine.
- Infantry, vehicles, helicopters, naval support, defensive structures, weather, civilian evacuation, and sector capture.
- Mouse/keyboard and mobile touch controls.
- Custom illustrated IRON TIDE logo integrated into the boot/loading screen and title screen, plus matching PWA and Android launcher icon source assets.

## Performance

The engine uses bounded particle / rain pools, a spatial grid for nearby zombie queries, a low-lag graphics mode, and mobile-aware canvas sizing.


## Advanced Warfare Update

- Choose one of 20 campaign operations from the title screen. Missions track kills and captured sectors, grant requisition rewards, and unlock the next operation after victory. Free Operations is also available.
- Use the **Fog** button to toggle fog of war. Units, FOBs, and secured sectors reveal the battlefield; the minimap shares the same visibility.
- Use the **Formation** button to cycle Grid, Line, Column, and Circle. Select units, then issue a move/attack-move order to apply the active formation.
- The escort fleet now includes the PC-17 Breakwater gunboat. It joins naval salvos when a barrage is called.
- Existing build controls place defensive structures in valid FOB/supply zones. Unit, vehicle, air support, and construction actions remain simulation-driven.


## IRON TIDE 2.1 – Illustrated Branding & Surface Detail

- Replaced the placeholder title-screen lockup and boot emblem with the supplied illustrated IRON TIDE: Coastal Vanguard logo.
- Regenerated PWA, Apple touch, and Capacitor launcher artwork from the same logo so the installed app and game menus share one identity.
- Added deterministic, cached procedural ground grain and concrete expansion seams to the terrain texture. Texture detail is baked into the existing map cache rather than drawn every frame.
- Preserved the React + TypeScript + Vite + custom Canvas engine and existing coastal military art direction.

The 2.1 package focuses on branding and a safe graphics enhancement pass. The larger proposed systems (destructible buildings, spreading fire, ammo logistics, rescue missions, new vehicle classes, and additional weather/lighting simulation) are not represented as complete unless they already exist in the 2.0 simulation.

## 3.0 additions

- Adaptive procedural music (menu / calm / combat) with working Music and Sound volume sliders.
- 20 unique campaign briefings, harder milestone missions, and three rescue-objective missions.
- Spreading fire: explosions ignite fires that burn zombies, spread outward, and are put out faster by rain.
- Destructible buildings: artillery, barrages and airstrikes damage buildings until they collapse into rubble.
- New vehicles: LRV-9 Raider (`-`) and M109 Paladin Howitzer (`=`).
- Day/night cycle (8-minute loop) with warm dusk/dawn tint and light pools around FOBs, turrets and fires. The Night Visibility setting halves the dimming.
- Compact, translucent top-left HUD with a ▾ toggle for sector and campaign details.
- Redrawn avatars 2-8.

## Latest development update

See [UPDATE_NOTES_PART4.md](./UPDATE_NOTES_PART4.md) for the latest direct-control reload and bunker door work.

## Part 5 update
See `UPDATE_NOTES_PART5.md` for bunker hull collision, the open blast-door passage, regression coverage, and validation limitations.

## 4.0 additions

- Performance: zombie sprite cache, dynamic resolution (drops pixels before it ever drops graphics quality), cached light/fire glows.
- Tide cycle: two flank lanes flood at high tide and open at low tide (4-minute cycle).
- Oil Slick trap (X cycles wire > oil > laser > shock): slows zombies, bursts into fires when touched by flame or blasts.
- Optional wave bonus goals paid in coins when the next wave arrives.
- Adaptive waves every 3rd wave (counter-zombies based on what you kill with) and an Infected Commander every 4th wave with a 150-coin bounty.
- Building collapses pay salvage coins.
- Reinforcement Beacon strike (`]`): a helicopter drops a free squad of 4 (2 squad, 1 heavy, 1 sniper) at the marked spot after a short delay. 120 coins, 90 s cooldown.
- Demolition Charge (Build tab): arms after ~1.2s, then detonates when 3+ zombies are within range. Heavy blast: crushes zombies, ignites fires and collapses nearby buildings for salvage coins.
- Zombie nests (2 per map, beside the buildings farthest from your base): they keep spawning zombies until destroyed by artillery, fire, a collapsing building, or ground units that close in. 120-coin bounty each.
- Tactical map moved into a "Map" dock tab (no floating radar over the controls). The Map rail button / K key switches to that tab.
- Soldier art: role-specific weapons (M4A1 carbine with optic/foregrip/suppressor, M249 SAW with belt box and bipod, RPG-7 with warhead, suppressed sniper rifle with bipod), headsets, radios, holsters, gloves, team patches.
- Vehicles: camouflage patches, allied star, tactical number bar and antenna on Humvee, Raider, Howitzer, IFV, Tank.
- Zombies: exposed ribs, torn military-vest remnants, infection veins.
