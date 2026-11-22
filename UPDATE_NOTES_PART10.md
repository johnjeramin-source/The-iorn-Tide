# Part 10 – Distance-Based Zombie Target LOD

## Implemented
- Zombie target acquisition now uses camera-distance tiers.
- Zombies within 900 world units refresh target selection every 2 simulation ticks (staggered by index).
- Zombies 900–2,200 units away refresh every 4 ticks.
- Zombies farther than 2,200 units refresh every 8 ticks.
- Dead/disabled cached targets still trigger immediate refresh.
- This LOD only reduces target-search frequency. Zombie movement, attacks, damage, collision, and rendering are not intentionally skipped, preserving visibility and combat behavior.

## Limitations
- This does not enable 10,000 simultaneously active zombies; the active caps remain governed by graphics quality.
- No 60 FPS guarantee without profiling on the target Android device.
