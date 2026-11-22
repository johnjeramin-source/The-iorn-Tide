# Part 9 – Horde Simulation Optimization

## Implemented
- Zombie target acquisition now queries the existing player-unit spatial grid rather than scanning every unit for every zombie.
- The grid is rebuilt once per simulation tick and contains only living, active units.
- A 2,600-world-unit search radius retains long-range target acquisition while reducing work on sparse maps.
- Existing quality-based active zombie caps and staggered target refresh cadence are preserved.
- This is an optimization for CPU work; it does not claim 10,000 simultaneously simulated zombies or guarantee 60 FPS.

## Validation
- Source change is localized to zombie target selection.
- Full typecheck, browser build, Android APK build, and device FPS benchmark were not run in this environment.
