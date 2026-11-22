import {
  DEFAULT_ZOOM,
  MAPS,
  MAX_ZOOM,
  MIN_ZOOM,
  OPS_VIEW_ZOOM_THRESHOLD,
  SCENARIOS,
  STRIKE_SPECS,
  STRUCTURE_SPECS,
  WALL_TIERS,
  FENCE_FX,
  UNIT_SPECS,
  WEATHER_CYCLE,
  WEATHER_LABELS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZOMBIE_SPECS,
} from './data';
import {
  SpatialGrid,
  hasLineOfSight,
  pushOutOfBuildings,
  pushOutOfBunker,
  pushOutOfWalls,
  pushOutOfWater,
  resolveCircleOBB,
  resolveCircleRect,
} from './spatial';
import {
  GamePhase,
  FormationKind,
  GameWorld,
  HudSnapshot,
  InputState,
  MapId,
  NavalShip,
  Nest,
  Particle,
  PlayerUnit,
  PlayerUnitKind,
  Projectile,
  RainDrop,
  ScenarioId,
  StrikeKind,
  Structure,
  WeatherKind,
  Zombie,
  ZombieKind,
  PlaceableKind,
} from './types';
import { getCampaignMission } from './campaign';

const MAX_PARTICLES = 560;
const MAX_ZOMBIES = 1200;
// Keep the live entity budget bounded; total kill count can grow without limit.
const ZOMBIE_CAPS = { low: 600, medium: 900, high: MAX_ZOMBIES } as const;
const separationNeighbors = new Int32Array(24);
const nearbyZombieIndices = new Int32Array(96);

export function getZombieCapForQuality(quality: 'low' | 'medium' | 'high'): number {
  return ZOMBIE_CAPS[quality];
}
const MAX_CRATERS = 110;
const CRATER_LIFE = 7; // seconds before a scorch mark fully fades away
const MAX_BLOOD = 220;
const MAX_RAINDROPS = 180;

const zombieGrid = new SpatialGrid(WORLD_WIDTH, WORLD_HEIGHT, 72);
const playerUnitGrid = new SpatialGrid(WORLD_WIDTH, WORLD_HEIGHT, 72);
let assistSearchX = 0;
let assistSearchY = 0;
let assistBestIndex = -1;
let assistBestDistanceSq = 0;

function considerAssistZombie(index: number): void {
  const zombie = activeAssistWorld?.zombies[index];
  if (!zombie || zombie.hp <= 0 || zombie.koTimer > 0) return;
  const dx = zombie.x - assistSearchX;
  const dy = zombie.y - assistSearchY;
  const distanceSq = dx * dx + dy * dy;
  if (distanceSq < assistBestDistanceSq) { assistBestDistanceSq = distanceSq; assistBestIndex = index; }
}
let activeAssistWorld: GameWorld | null = null;

function createParticlePool(): Particle[] {
  return Array.from({ length: MAX_PARTICLES }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    size: 2,
    life: 0,
    maxLife: 1,
    color: '#ffffff',
    kind: 'spark',
  }));
}

function createRainPool(): RainDrop[] {
  return Array.from({ length: MAX_RAINDROPS }, () => ({
    x: Math.random() * 1600,
    y: Math.random() * 1000,
    len: 14 + Math.random() * 18,
    speed: 680 + Math.random() * 340,
  }));
}

function createNavalFleet(carrierX: number, carrierY: number): NavalShip[] {
  return [
    {
      id: 'bb64',
      name: 'USS Ironside',
      hullCode: 'BB-64',
      kind: 'battleship',
      x: carrierX + 190,
      y: carrierY - 460,
      length: 340,
      beam: 58,
      turretAngle: 0,
      recoil: 0,
      muzzleFlash: 0,
    },
    {
      id: 'ddg88',
      name: 'USS Tempest',
      hullCode: 'DDG-88',
      kind: 'destroyer',
      x: carrierX + 215,
      y: carrierY + 460,
      length: 230,
      beam: 40,
      turretAngle: 0,
      recoil: 0,
      muzzleFlash: 0,
    },
    {
      id: 'pc17',
      name: 'USS Breakwater',
      hullCode: 'PC-17',
      kind: 'gunboat',
      x: carrierX + 360,
      y: carrierY + 80,
      length: 142,
      beam: 27,
      turretAngle: 0,
      recoil: 0,
      muzzleFlash: 0,
    },
  ];
}

export function spawnParticle(
  world: GameWorld,
  x: number,
  y: number,
  vx: number,
  vy: number,
  size: number,
  maxLife: number,
  color: string,
  kind: Particle['kind'],
  z = 0,
  vz = 0,
): void {
  const particleLimit = world.graphicsQuality === 'low' ? 180 : world.graphicsQuality === 'medium' ? 340 : MAX_PARTICLES;
  const particleIndex = world.particleCursor % particleLimit;
  const p = world.particles[particleIndex];
  world.particleCursor = (particleIndex + 1) % particleLimit;
  p.active = true;
  p.x = x;
  p.y = y;
  p.z = z;
  p.vx = vx;
  p.vy = vy;
  p.vz = vz;
  p.size = size;
  p.life = maxLife;
  p.maxLife = maxLife;
  p.color = color;
  p.kind = kind;
}

function addBloodDecal(world: GameWorld, x: number, y: number, r: number): void {
  const angle = Math.random() * Math.PI * 2;
  const alpha = 0.45 + Math.random() * 0.25;
  const variant = Math.floor(Math.random() * 3);
  const bloodLimit = world.graphicsQuality === 'low' ? 55 : world.graphicsQuality === 'medium' ? 130 : MAX_BLOOD;
  if (world.bloodDecals.length < bloodLimit) {
    world.bloodDecals.push({ x, y, r, angle, alpha, variant });
  } else {
    const decalIndex = world.bloodCursor % bloodLimit;
    const decal = world.bloodDecals[decalIndex];
    decal.x = x; decal.y = y; decal.r = r; decal.angle = angle; decal.alpha = alpha; decal.variant = variant;
    world.bloodCursor = (decalIndex + 1) % bloodLimit;
  }
}

function addTrauma(world: GameWorld, amount: number): void {
  if (world.lowLagMode) return;
  world.camera.trauma = Math.min(
    0.55,
    Math.max(world.camera.trauma, amount * 0.7) + amount * 0.12,
  );
}

function setAlert(world: GameWorld, message: string, duration = 3.0): void {
  world.alertMessage = message;
  world.alertTimer = duration;
}

function spawnProjectile(
  world: GameWorld,
  fromPlayer: boolean,
  x: number,
  y: number,
  prevX: number,
  prevY: number,
  vx: number,
  vy: number,
  life: number,
  damage: number,
  splashRadius: number,
  kind: Projectile['kind'],
): void {
  const cap = world.graphicsQuality === 'low' ? 120 : world.graphicsQuality === 'medium' ? 240 : 360;
  let projectile: Projectile | undefined;
  if (world.projectiles.length < cap) {
    projectile = { active: true, fromPlayer, x, y, prevX, prevY, vx, vy, life, maxLife: life, damage, splashRadius, kind };
    world.projectiles.push(projectile);
    return;
  }
  for (let offset = 0; offset < world.projectiles.length; offset++) {
    const index = (world.projectileCursor + offset) % world.projectiles.length;
    const candidate = world.projectiles[index];
    if (!candidate.active) { projectile = candidate; world.projectileCursor = (index + 1) % world.projectiles.length; break; }
  }
  if (!projectile) return;
  projectile.active = true; projectile.fromPlayer = fromPlayer;
  projectile.x = x; projectile.y = y; projectile.prevX = prevX; projectile.prevY = prevY;
  projectile.vx = vx; projectile.vy = vy; projectile.life = life; projectile.maxLife = life;
  projectile.damage = damage; projectile.splashRadius = splashRadius; projectile.kind = kind;
}

export function createPlayerUnit(
  world: GameWorld,
  kind: PlayerUnitKind,
  x: number,
  y: number,
): PlayerUnit {
  const spec = UNIT_SPECS[kind];
  const unit: PlayerUnit = {
    id: world.nextId++,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    turretAngle: 0,
    hp: spec.maxHp,
    maxHp: spec.maxHp,
    ammo: spec.maxAmmo,
    maxAmmo: spec.maxAmmo,
    ...(spec.isVehicle ? { fuel: 100, maxFuel: 100 } : {}),
    radius: spec.radius,
    selected: false,
    targetX: null,
    targetY: null,
    attackMove: false,
    fireCooldown: 0,
    secondaryCooldown: 0,
    recoil: 0,
    hitFlash: 0,
    gaitPhase: 0,
    resupplyPulse: 0,
    kills: 0,
    koTimer: 0,
  };
  world.units.push(unit);
  return unit;
}

export function spawnZombie(
  world: GameWorld,
  kind: ZombieKind,
  x: number,
  y: number,
): Zombie | null {
  const spec = ZOMBIE_SPECS[kind];
  const cap = getZombieCapForQuality(world.graphicsQuality);
  if (world.zombies.length >= cap) {
    // Preserve incoming wave pressure without allocating another entity: reinforce
    // the nearest living zombie into an elite. This path only runs at the cap.
    let nearest: Zombie | null = null;
    let nearestSq = Infinity;
    for (let i = 0; i < world.zombies.length; i++) {
      const candidate = world.zombies[i];
      if (candidate.hp <= 0 || candidate.koTimer > 0) continue;
      const dx = candidate.x - x; const dy = candidate.y - y;
      const dSq = dx * dx + dy * dy;
      if (dSq < nearestSq) { nearestSq = dSq; nearest = candidate; }
    }
    if (nearest) {
      const bonusHp = Math.max(1, spec.hp * 0.35);
      nearest.maxHp += bonusHp;
      nearest.hp = Math.min(nearest.maxHp, nearest.hp + bonusHp);
      nearest.damage = Math.max(nearest.damage, spec.damage) * 1.04;
      nearest.elite = true;
      return nearest;
    }
    return null;
  }
  const bPushed = pushOutOfBuildings(x, y, spec.radius + 2, world.buildings);
  const wPushed = pushOutOfWater(
    bPushed.x,
    bPushed.y,
    spec.radius + 2,
    world.waterChannels,
    world.bridges,
  );
  const zombie: Zombie = {
    id: world.nextId++,
    kind,
    variant: Math.floor(Math.random() * 4),
    x: Math.max(world.coastlineX + 24, Math.min(WORLD_WIDTH - 24, wPushed.x)),
    y: Math.max(24, Math.min(WORLD_HEIGHT - 24, wPushed.y)),
    vx: 0,
    vy: 0,
    angle: Math.PI,
    hp: spec.hp,
    maxHp: spec.hp,
    radius: spec.radius,
    speed: spec.speed * (0.92 + Math.random() * 0.16),
    damage: spec.damage,
    attackCooldown: 0,
    telegraphTimer: 0,
    telegraphKind: null,
    leapTimer: 0,
    hitFlash: 0,
    gaitPhase: Math.random() * Math.PI * 2,
    koTimer: 0,
    flankDir: Math.random() < 0.5 ? -1 : 1,
    targetKind: null,
    elite: false,
  };
  world.zombies.push(zombie);
  world.activeZombieCount++;
  return zombie;
}

export function spawnInitialHorde(world: GameWorld, count: number): void {
  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    let kind: ZombieKind = 'shambler';
    if (roll > 0.992) kind = 'juggernaut';
    else if (roll > 0.985) kind = 'tank';
    else if (roll > 0.965) kind = 'brute';
    else if (roll > 0.945) kind = 'mutated';
    else if (roll > 0.925) kind = 'infected_marine';
    else if (roll > 0.905) kind = 'stalker';
    else if (roll > 0.89) kind = 'screamer';
    else if (roll > 0.885) kind = 'exploder';
    else if (roll > 0.865) kind = 'crawler';
    else if (roll > 0.83) kind = 'riot_zombie';
    else if (roll > 0.78) kind = 'spitter';
    else if (roll > 0.70) kind = 'leaper';
    else if (roll > 0.50) kind = 'sprinter';

    const x = 1220 + Math.random() * (WORLD_WIDTH - 1300);
    const y = 120 + Math.random() * (WORLD_HEIGHT - 240);
    spawnZombie(world, kind, x, y);
  }
}

export function createWorld(
  scenarioId: ScenarioId = 'harbor_break',
  phase: GamePhase = 'title',
  mapId: MapId = 'port_la',
  campaignMissionId: number | null = null,
  endlessMode = false,
): GameWorld {
  const scenario = SCENARIOS[scenarioId];
  const map = MAPS[mapId];
  const initWeather: WeatherKind = map.defaultWeather;

  const world: GameWorld = {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    coastlineX: map.coastlineX,
    carrierPos: { ...map.carrierPos },
    fobPos: { ...map.fobPos },
    navalFleet: createNavalFleet(map.carrierPos.x, map.carrierPos.y),
    carrierIntegrity: 100,
    phase,
    outcome: null,
    mapId,
    scenarioId,
    endlessMode,
    elapsedSec: 0,
    hitstopTimer: 0,
    req: Math.min(MAX_COINS, scenario.startingReq),
    kills: 0,
    unitsLost: 0,
    waveBonus: null,
    damageTally: { bullet: 0, explosive: 0 },
    bossId: null,
    nextId: 1,
    waveNumber: 1,
    waveTimer: scenario.waveInterval,
    alertMessage:
      phase === 'playing'
        ? `${map.name.toUpperCase()} · ${WEATHER_LABELS[initWeather].toUpperCase()}`
        : null,
    alertTimer: phase === 'playing' ? 3.8 : 0,
    defeatDelayTimer: 0,
    directControlUnitId: null,
    placementMode: null,
    placementAngle: Math.PI * 0.5, // vertical street blocker by default
    wallTier: 2,
    civilians: [],
    bunkerSaved: 0,
    bunkerCap: map.civilianCap ?? 24,
    civiliansLost: 0,
    strikeCooldowns: {
      barrage: 0,
      airstrike: 0,
      supplydrop: 0,
      reinforce: 0,
    },
    weather: {
      kind: initWeather,
      targetKind: initWeather,
      intensity: initWeather === 'clear' ? 0 : 0.85,
      nextChangeIn: 36,
      lightningFlash: 0,
      lightningTimer: 5.5,
      windX: initWeather === 'storm' ? -240 : -110,
    },
    rainDrops: createRainPool(),
    buildings: map.createBuildings().map((b) => { const hp = Math.max(400, Math.round((b.w * b.h) / 35)); return { ...b, hp, maxHp: hp, damageFlash: 0 }; }),
    waterChannels: [...map.waterChannels],
    staticWater: map.waterChannels,
    tidalFlats: [
      { x: 1380, y: 200, w: 150, h: 560 },
      { x: 1380, y: 1640, w: 150, h: 560 },
    ],
    tide: 0,
    tideFlooded: false,
    bridges: map.bridges,
    roads: map.roads,
    sectors: map.createSectors(),
    units: [],
    structures: [],
    zombies: [],
    projectiles: [],
    projectileCursor: 0,
    pendingStrikes: [],
    supplyCrates: [],
    craters: [],
    fires: [],
    rubble: [],
    nests: [],
    nestsDestroyed: 0,
    bloodDecals: [],
    bloodCursor: 0,
    craterCursor: 0,
    particles: createParticlePool(),
    particleCursor: 0,
    camera: {
      x: 820,
      y: map.fobPos.y,
      zoom: DEFAULT_ZOOM,
      targetX: 820,
      targetY: map.fobPos.y,
      targetZoom: DEFAULT_ZOOM,
      trauma: 0,
      shakeX: 0,
      shakeY: 0,
    },
    events: [],
    lowLagMode: false,
    formation: 'grid',
    fogEnabled: true,
    fogExplored: new Array(40 * 24).fill(false),
    fogVisible: new Array(40 * 24).fill(false),
    fogUpdateTimer: 0,
    campaignMissionId,
    campaignReward: getCampaignMission(campaignMissionId)?.reward ?? 0,
    autoBattleAssist: false,
    rallyPoint: null,
    controlGroups: [[], [], [], [], []],
    minimapPings: [],
    tutorialSeen: false,
    damageNumbersEnabled: true,
    damageNumbers: Array.from({ length: 64 }, () => ({ x: 0, y: 0, value: 0, label: '', life: 0, active: false })),
    damageNumberCursor: 0,
    graphicsQuality: 'medium',
    adaptiveQuality: true,
    debugPerformance: false,
    simulationTick: 0,
    activeZombieCount: 0,
    preferredGraphicsQuality: 'medium',
  };

  // Civilians waiting in each sector to be rescued and escorted to the bunker (more than the bunker can hold)
  {
    const perSector = Math.ceil((world.bunkerCap * 1.2) / Math.max(1, world.sectors.length));
    for (const sec of world.sectors) {
      for (let k = 0; k < perSector; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = sec.radius * (0.2 + Math.random() * 0.7);
        world.civilians.push({
          id: world.nextId++,
          x: sec.x + Math.cos(a) * r,
          y: sec.y + Math.sin(a) * r,
          hp: 40,
          state: 'waiting',
        });
      }
    }
  }

  // Beachhead Landing FOB
  world.structures.push({
    id: world.nextId++,
    kind: 'fob',
    x: map.fobPos.x,
    y: map.fobPos.y,
    w: 128,
    h: 96,
    angle: 0,
    hp: 3200,
    maxHp: 3200,
    ammo: 999,
    maxAmmo: 999,
    fireCooldown: 0,
    recoil: 0,
    hitFlash: 0,
    gateOpen: 0,
    doorLocked: true,
  });

  // Defensive pier sentries at the beachhead
  world.structures.push({
    id: world.nextId++,
    kind: 'turret',
    x: map.fobPos.x + 108,
    y: map.fobPos.y - 68,
    w: 32,
    h: 32,
    angle: 0,
    hp: STRUCTURE_SPECS.turret.maxHp,
    maxHp: STRUCTURE_SPECS.turret.maxHp,
    ammo: STRUCTURE_SPECS.turret.maxAmmo,
    maxAmmo: STRUCTURE_SPECS.turret.maxAmmo,
    fireCooldown: 0,
    recoil: 0,
    hitFlash: 0,
  });

  world.structures.push({
    id: world.nextId++,
    kind: 'turret',
    x: map.fobPos.x + 108,
    y: map.fobPos.y + 68,
    w: 32,
    h: 32,
    angle: 0,
    hp: STRUCTURE_SPECS.turret.maxHp,
    maxHp: STRUCTURE_SPECS.turret.maxHp,
    ammo: STRUCTURE_SPECS.turret.maxAmmo,
    maxAmmo: STRUCTURE_SPECS.turret.maxAmmo,
    fireCooldown: 0,
    recoil: 0,
    hitFlash: 0,
  });

  for (const u of scenario.startingUnits) {
    const created = createPlayerUnit(
      world,
      u.kind,
      map.fobPos.x + u.offsetX,
      map.fobPos.y + u.offsetY,
    );
    if (u.kind === 'tank' || u.kind === 'ifv') created.selected = true;
  }

  spawnInitialHorde(world, scenario.initialHordeCount);
  world.activeZombieCount = world.zombies.length;

  placeNests(world);
  return world;
}

export function startScenario(
  _world: GameWorld,
  scenarioId: ScenarioId,
  mapId: MapId = 'port_la',
  campaignMissionId: number | null = null,
  endlessMode = false,
): GameWorld {
  return createWorld(scenarioId, 'playing', mapId, campaignMissionId, endlessMode);
}

export function rotatePlacement(world: GameWorld, stepRadians = Math.PI / 4): number {
  world.placementAngle = (world.placementAngle + stepRadians) % (Math.PI * 2);
  return world.placementAngle;
}

export function cycleWallTier(world: GameWorld): void {
  world.wallTier = (world.wallTier + 1) % WALL_TIERS.length;
  const t = WALL_TIERS[world.wallTier];
  setAlert(world, `${t.name.toUpperCase()} · ${Math.round(STRUCTURE_SPECS.wall.cost * t.costMul)} COINS`, 1.6);
}

export function cycleWeather(world: GameWorld, explicit?: WeatherKind): WeatherKind {
  const idx = WEATHER_CYCLE.indexOf(world.weather.kind);
  const next = explicit ?? WEATHER_CYCLE[(idx + 1) % WEATHER_CYCLE.length];
  world.weather.kind = next;
  world.weather.targetKind = next;
  world.weather.intensity = next === 'clear' ? 0 : next === 'storm' ? 1 : 0.8;
  world.weather.windX = next === 'storm' ? -250 : -110;
  world.weather.nextChangeIn = 40;
  setAlert(world, `WEATHER SHIFT: ${WEATHER_LABELS[next].toUpperCase()}`, 2.4);
  return next;
}

export function toggleLowLagMode(world: GameWorld, explicit?: boolean): boolean {
  const next = explicit ?? !world.lowLagMode;
  world.lowLagMode = next;
  if (next) {
    world.camera.trauma = 0;
    world.camera.shakeX = 0;
    world.camera.shakeY = 0;
    world.hitstopTimer = 0;
  }
  setAlert(
    world,
    next ? 'ANTI-LAG SMOOTH MODE: ON (SHAKE OFF)' : 'ANTI-LAG SMOOTH MODE: STANDARD FX',
    2.4,
  );
  return next;
}

export const MAX_COINS = 2500;

function addCoins(world: GameWorld, amount: number): void {
  world.req = Math.min(MAX_COINS, Math.max(0, world.req + amount));
}

export function deployUnit(
  world: GameWorld,
  kind: PlayerUnitKind,
): { ok: boolean; reason?: string; unit?: PlayerUnit } {
  if (world.phase !== 'playing') return { ok: false, reason: 'Not active' };
  const spec = UNIT_SPECS[kind];
  if (world.req < spec.cost) {
    setAlert(world, `NEED ${spec.cost} COINS FOR ${spec.shortName.toUpperCase()}`, 2.0);
    return { ok: false, reason: 'Insufficient coins' };
  }

  world.req -= spec.cost;
  const jitterY = (Math.random() - 0.5) * 110;
  // Ground units must appear OUTSIDE the bunker hull; spawning inside it trapped them behind the locked blast door.
  const hull = world.structures.find((st) => st.kind === 'fob' && st.hp > 0);
  const spawnX = spec.isAir
    ? world.carrierPos.x + 60
    : hull
      ? hull.x + hull.w / 2 + 34
      : world.coastlineX + 62;
  const spawnY = world.fobPos.y + jitterY;
  const unit = createPlayerUnit(world, kind, spawnX, spawnY);
  unit.targetX = world.rallyPoint?.x ?? (spec.isAir ? world.coastlineX + 310 : world.fobPos.x + 170 + (Math.random() - 0.5) * 60);
  unit.targetY = world.rallyPoint?.y ?? (world.fobPos.y + jitterY);
  unit.attackMove = true;

  if (!world.units.some((u) => u.selected && u.koTimer <= 0)) {
    unit.selected = true;
  }

  world.events.push({ type: 'build', intensity: 0.7 });
  world.events.push({ type: 'voice_deploy', intensity: 0.75 });
  if (spec.isAir) {
    world.events.push({ type: 'heli_blades', intensity: 0.8 });
  } else if (spec.isVehicle) {
    world.events.push({ type: 'vehicle_engine', intensity: 0.75 });
  }
  setAlert(world, `${spec.name.toUpperCase()} DEPLOYED`, 2.2);
  return { ok: true, unit };
}

export function setAutoBattleAssist(world: GameWorld, enabled: boolean): void {
  world.autoBattleAssist = enabled;
  setAlert(world, enabled ? 'AUTO-BATTLE ASSIST ONLINE' : 'AUTO-BATTLE ASSIST OFF', 1.8);
}

export function addMinimapPing(world: GameWorld, x: number, y: number, kind: 'danger' | 'rally' = 'danger'): void {
  world.minimapPings.push({ x, y, kind, life: 4 });
  if (world.minimapPings.length > 8) world.minimapPings.shift();
}

export function setRallyPoint(world: GameWorld, x: number, y: number): void {
  world.rallyPoint = { x: Math.max(world.coastlineX + 30, Math.min(world.width - 30, x)), y: Math.max(30, Math.min(world.height - 30, y)) };
  addMinimapPing(world, world.rallyPoint.x, world.rallyPoint.y, 'rally');
  setAlert(world, 'RALLY POINT UPDATED', 1.6);
}

export function saveControlGroup(world: GameWorld, group: number): void {
  if (group < 1 || group > 5) return;
  const ids = world.controlGroups[group - 1];
  ids.length = 0;
  for (const unit of world.units) if (unit.selected && unit.hp > 0 && unit.koTimer <= 0) ids.push(unit.id);
}

export function selectControlGroup(world: GameWorld, group: number): number {
  if (group < 1 || group > 5) return 0;
  const ids = world.controlGroups[group - 1];
  let selected = 0;
  for (const unit of world.units) {
    unit.selected = ids.includes(unit.id) && unit.hp > 0 && unit.koTimer <= 0;
    if (unit.selected) selected++;
  }
  return selected;
}

export function repairSelectedVehicles(world: GameWorld): { repaired: number; cost: number; reason?: string } {
  const selectedVehicles = world.units.filter((unit) =>
    unit.selected && unit.hp > 0 && unit.koTimer <= 0 && UNIT_SPECS[unit.kind].isVehicle && unit.hp < unit.maxHp,
  );
  if (selectedVehicles.length === 0) return { repaired: 0, cost: 0, reason: 'Select a damaged vehicle first' };

  const inServiceRange = selectedVehicles.filter((unit) => isNearSupplyOrFob(world, unit.x, unit.y));
  if (inServiceRange.length === 0) return { repaired: 0, cost: 0, reason: 'Move vehicles near the FOB or a supply truck' };

  // Repair a controlled portion per service order so field repairs do not erase combat attrition.
  const plans = inServiceRange.map((unit) => {
    const amount = Math.min(unit.maxHp - unit.hp, Math.max(1, Math.ceil(unit.maxHp * 0.3)));
    return { unit, amount, cost: Math.ceil(amount * 0.6) };
  });
  const totalCost = plans.reduce((sum, plan) => sum + plan.cost, 0);
  if (world.req < totalCost) return { repaired: 0, cost: 0, reason: `Need ${totalCost} COINS for vehicle repairs` };

  world.req -= totalCost;
  for (const plan of plans) plan.unit.hp = Math.min(plan.unit.maxHp, plan.unit.hp + plan.amount);
  const repaired = plans.length;
  setAlert(world, `FIELD REPAIR COMPLETE · ${repaired} VEHICLE${repaired === 1 ? '' : 'S'} · ${totalCost} COINS`, 2.4);
  world.events.push({ type: 'supply', intensity: 0.55 });
  return { repaired, cost: totalCost };
}

export function isNearSupplyOrFob(world: GameWorld, x: number, y: number): boolean {
  for (const s of world.structures) {
    if (s.hp > 0 && s.kind === 'fob') {
      if (Math.hypot(s.x - x, s.y - y) <= 360) return true;
    }
  }
  for (const u of world.units) {
    if (u.hp > 0 && u.koTimer <= 0 && u.kind === 'truck') {
      if (Math.hypot(u.x - x, u.y - y) <= 245) return true;
    }
  }
  return false;
}

export function canPlaceStructureAt(
  world: GameWorld,
  kind: PlaceableKind,
  x: number,
  y: number,
  angle = world.placementAngle,
): { ok: boolean; reason?: string } {
  if (x < world.coastlineX + 25 || x > world.width - 40 || y < 40 || y > world.height - 40) {
    return { ok: false, reason: 'Must place on city terrain' };
  }
  if (!isNearSupplyOrFob(world, x, y)) {
    return { ok: false, reason: 'Must build within FOB or Supply Truck zone' };
  }
  const spec = STRUCTURE_SPECS[kind];
  for (const b of world.buildings) {
    if (
      resolveCircleRect(
        x,
        y,
        Math.max(spec.w, spec.h) * 0.4,
        b.x,
        b.y,
        b.w,
        b.h,
      )
    ) {
      return { ok: false, reason: 'Blocked by building' };
    }
  }
  for (const f of world.tidalFlats) {
    if (resolveCircleRect(x, y, 22, f.x, f.y, f.w, f.h)) return { ok: false, reason: 'Cannot build on tidal flat' };
  }
  for (const w of world.waterChannels) {
    const pushed = resolveCircleRect(x, y, 22, w.x, w.y, w.w, w.h);
    if (pushed) {
      const onBridge = world.bridges.some(
        (br) => x >= br.x && x <= br.x + br.w && y >= br.y && y <= br.y + br.h,
      );
      if (!onBridge) return { ok: false, reason: 'Cannot build in deep canal' };
    }
  }
  const isBarrier = kind === 'wall' || kind === 'gate' || kind === 'wire' || kind === 'oil' || kind === 'laser' || kind === 'electric';
  for (const s of world.structures) {
    if (s.hp <= 0) continue;
    const existingBarrier = s.kind === 'wall' || s.kind === 'gate';
    const minSpacing = existingBarrier && isBarrier ? 32 : 38;
    if (Math.hypot(s.x - x, s.y - y) < minSpacing) {
      return { ok: false, reason: 'Too close to existing structure' };
    }
    if (existingBarrier && resolveCircleOBB(x, y, 16, s.x, s.y, s.w, s.h, s.angle)) {
      return { ok: false, reason: 'Overlaps barricade' };
    }
  }
  void angle;
  return { ok: true };
}

export function placeStructureOrStrike(
  world: GameWorld,
  x: number,
  y: number,
): boolean {
  if (!world.placementMode || world.phase !== 'playing') return false;
  const mode = world.placementMode.kind;

  if (
    mode === 'wall' ||
    mode === 'gate' ||
    mode === 'wire' ||
    mode === 'oil' ||
    mode === 'charge' ||
    mode === 'laser' ||
    mode === 'electric' ||
    mode === 'turret' ||
    mode === 'autocannon' ||
    mode === 'rocket_turret'
  ) {
    const spec = STRUCTURE_SPECS[mode];
    const tier = mode === 'wall' ? WALL_TIERS[world.wallTier] ?? WALL_TIERS[2] : null;
    const cost = tier ? Math.round(spec.cost * tier.costMul) : spec.cost;
    const hpVal = tier ? Math.round(spec.maxHp * tier.hpMul) : spec.maxHp;
    if (world.req < cost) {
      setAlert(world, `NEED ${cost} COINS FOR ${(tier?.name ?? spec.name).toUpperCase()}`, 2.0);
      world.placementMode = null;
      return false;
    }
    const check = canPlaceStructureAt(world, mode, x, y, world.placementAngle);
    if (!check.ok) {
      setAlert(world, (check.reason ?? 'INVALID LOCATION').toUpperCase(), 2.0);
      return false;
    }
    world.req -= cost;
    const isBarrier = mode === 'wall' || mode === 'gate' || mode === 'wire' || mode === 'oil' || mode === 'laser' || mode === 'electric';
    const ammoVal = isBarrier ? 0 : STRUCTURE_SPECS[mode].maxAmmo;
    world.structures.push({
      id: world.nextId++,
      kind: mode,
      x,
      y,
      w: spec.w,
      h: spec.h,
      angle: isBarrier ? world.placementAngle : 0,
      hp: hpVal,
      maxHp: hpVal,
      tier: mode === 'wall' ? world.wallTier : undefined,
      ammo: ammoVal,
      maxAmmo: ammoVal,
      fireCooldown: mode === 'charge' ? 1.2 : 0,
      recoil: 0,
      hitFlash: 0,
      gateOpen: mode === 'gate' ? 0 : undefined,
    });
    world.events.push({ type: 'build', intensity: 0.8 });
    world.placementMode = null;
    return true;
  }

  const strikeSpec = STRIKE_SPECS[mode];
  if (world.strikeCooldowns[mode] > 0) {
    setAlert(world, `${strikeSpec.name.toUpperCase()} ON COOLDOWN`, 1.8);
    world.placementMode = null;
    return false;
  }
  if (world.req < strikeSpec.cost) {
    setAlert(world, `NEED ${strikeSpec.cost} COINS FOR ${strikeSpec.name.toUpperCase()}`, 2.0);
    world.placementMode = null;
    return false;
  }

  world.req -= strikeSpec.cost;
  world.strikeCooldowns[mode] = strikeSpec.cooldown;
  world.pendingStrikes.push({
    id: world.nextId++,
    kind: mode,
    x,
    y,
    timer: mode === 'supplydrop' ? 1.05 : mode === 'reinforce' ? 2.2 : 1.25,
    duration: mode === 'supplydrop' ? 1.05 : mode === 'reinforce' ? 2.2 : 1.25,
    shellsRemaining: mode === 'barrage' ? 8 : mode === 'airstrike' ? 16 : 1,
    subTimer: 0,
    angle: Math.atan2(y - world.carrierPos.y, x - world.carrierPos.x),
  });
  world.events.push({ type: 'order', intensity: 1 });
  world.events.push({ type: 'voice_order', intensity: 0.9 });
  if (mode === 'barrage') {
    for (const ship of world.navalFleet) {
      ship.turretAngle = Math.atan2(y - ship.y, x - ship.x);
      ship.recoil = ship.kind === 'battleship' ? 9 : 6;
      ship.muzzleFlash = 0.4;
    }
    world.events.push({ type: 'naval_salvo', intensity: 1 });
  }
  setAlert(world, `${strikeSpec.name.toUpperCase()} INBOUND`, 2.4);
  world.placementMode = null;
  return true;
}

export function issueMoveOrder(
  world: GameWorld,
  worldX: number,
  worldY: number,
  attackMove = true,
): number {
  const selected = world.units.filter((u) => u.selected && u.hp > 0 && u.koTimer <= 0);
  if (selected.length === 0) return 0;

  const cols = Math.ceil(Math.sqrt(selected.length));
  const spacing = 48;
  let hasVehicle = false;
  let hasHeli = false;

  selected.forEach((u, idx) => {
    const spec = UNIT_SPECS[u.kind];
    if (spec.isAir) hasHeli = true;
    else if (spec.isVehicle) hasVehicle = true;

    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const centered = idx - (selected.length - 1) * 0.5;
    let offsetX = (col - (cols - 1) * 0.5) * spacing;
    let offsetY = (row - (Math.ceil(selected.length / cols) - 1) * 0.5) * spacing;
    if (world.formation === 'line') { offsetX = centered * spacing; offsetY = 0; }
    if (world.formation === 'column') { offsetX = 0; offsetY = centered * spacing; }
    if (world.formation === 'circle') {
      const angle = (idx / Math.max(1, selected.length)) * Math.PI * 2;
      const radius = Math.max(52, selected.length * 9);
      offsetX = Math.cos(angle) * radius;
      offsetY = Math.sin(angle) * radius;
    }
    const minX = spec.isAir ? 140 : world.coastlineX + 26;
    let tx = Math.max(minX, Math.min(world.width - 30, worldX + offsetX));
    let ty = Math.max(30, Math.min(world.height - 30, worldY + offsetY));
    if (!spec.isAir) {
      const bPush = pushOutOfBuildings(tx, ty, u.radius + 4, world.buildings);
      const bunkerPush = pushOutOfBunker(bPush.x, bPush.y, u.radius + 4, world.structures);
      const wallPush = pushOutOfWalls(bunkerPush.x, bunkerPush.y, u.radius + 4, world.structures, false);
      const wPush = pushOutOfWater(wallPush.x, wallPush.y, u.radius + 4, world.waterChannels, world.bridges);
      tx = wPush.x;
      ty = wPush.y;
    }
    u.targetX = tx;
    u.targetY = ty;
    u.attackMove = attackMove;
  });

  spawnParticle(world, worldX, worldY, 0, 0, 26, 0.45, '#38bdf8', 'ring');
  world.events.push({ type: 'order', intensity: 0.6 });
  world.events.push({ type: 'voice_order', intensity: 0.7 });
  if (hasHeli) world.events.push({ type: 'heli_blades', intensity: 0.6 });
  else if (hasVehicle) world.events.push({ type: 'vehicle_engine', intensity: 0.6 });
  return selected.length;
}

export function setFormation(world: GameWorld, formation: FormationKind): FormationKind {
  world.formation = formation;
  setAlert(world, `FORMATION: ${formation.toUpperCase()}`, 1.6);
  return formation;
}

export function toggleFogOfWar(world: GameWorld, enabled?: boolean): boolean {
  world.fogEnabled = enabled ?? !world.fogEnabled;
  setAlert(world, world.fogEnabled ? 'FOG OF WAR: ENABLED' : 'FOG OF WAR: DISABLED', 1.6);
  return world.fogEnabled;
}

function updateFogOfWar(world: GameWorld, dt: number): void {
  if (!world.fogEnabled) return;
  world.fogUpdateTimer -= dt;
  if (world.fogUpdateTimer > 0) return;
  world.fogUpdateTimer = world.lowLagMode ? 0.45 : 0.24;
  world.fogVisible.fill(false);
  const cols = 40;
  const rows = 24;
  const reveal = (x: number, y: number, radius: number) => {
    const minX = Math.max(0, Math.floor((x - radius) / 100));
    const maxX = Math.min(cols - 1, Math.floor((x + radius) / 100));
    const minY = Math.max(0, Math.floor((y - radius) / 100));
    const maxY = Math.min(rows - 1, Math.floor((y + radius) / 100));
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const cx = gx * 100 + 50;
        const cy = gy * 100 + 50;
        if (Math.hypot(cx - x, cy - y) <= radius + 70) {
          const index = gy * cols + gx;
          world.fogVisible[index] = true;
          world.fogExplored[index] = true;
        }
      }
    }
  };
  for (const unit of world.units) if (unit.hp > 0 && unit.koTimer <= 0) reveal(unit.x, unit.y, UNIT_SPECS[unit.kind].isAir ? 560 : 430);
  for (const structure of world.structures) if (structure.hp > 0 && structure.kind === 'fob') reveal(structure.x, structure.y, 300);
  for (const sector of world.sectors) if (sector.owner === 'player') reveal(sector.x, sector.y, sector.radius + 90);
}

function rebuildPlayerUnitGrid(world: GameWorld): void {
  playerUnitGrid.clear();
  for (let i = 0; i < world.units.length; i++) {
    const unit = world.units[i];
    if (unit.hp > 0 && unit.koTimer <= 0) playerUnitGrid.insert(i, unit.x, unit.y);
  }
}

export function selectUnitsInRect(
  world: GameWorld,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  additive = false,
): number {
  rebuildPlayerUnitGrid(world);
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const isClick = maxX - minX < 10 && maxY - minY < 10;

  if (!additive) {
    for (let i = 0; i < world.units.length; i++) world.units[i].selected = false;
  }

  if (isClick) {
    const cx = (x1 + x2) * 0.5;
    const cy = (y1 + y2) * 0.5;
    let bestIndex = -1;
    let bestDistSq = 72 * 72;
    playerUnitGrid.queryRadius(cx, cy, 72, (idx) => {
      const unit = world.units[idx];
      if (!unit || unit.hp <= 0 || unit.koTimer > 0) return;
      const dx = unit.x - cx;
      const dy = unit.y - cy;
      const distSq = dx * dx + dy * dy;
      const hitRadius = Math.max(42, unit.radius + 24);
      if (distSq <= hitRadius * hitRadius && distSq < bestDistSq) {
        bestIndex = idx;
        bestDistSq = distSq;
      }
    });
    if (bestIndex >= 0) world.units[bestIndex].selected = true;
  } else {
    playerUnitGrid.queryRect(minX, minY, maxX, maxY, (idx) => {
      const unit = world.units[idx];
      if (unit && unit.hp > 0 && unit.koTimer <= 0 &&
          unit.x >= minX && unit.x <= maxX && unit.y >= minY && unit.y <= maxY) {
        unit.selected = true;
      }
    });
  }
  let selected = 0;
  for (let i = 0; i < world.units.length; i++) {
    const unit = world.units[i];
    if (unit.selected && unit.koTimer <= 0) selected++;
  }
  return selected;
}

export function selectUnitAtPoint(world: GameWorld, x: number, y: number): PlayerUnit | null {
  rebuildPlayerUnitGrid(world);
  let bestIndex = -1;
  let bestDistSq = Number.POSITIVE_INFINITY;
  playerUnitGrid.queryRadius(x, y, 72, (idx) => {
    const unit = world.units[idx];
    if (!unit || unit.hp <= 0 || unit.koTimer > 0) return;
    const dx = unit.x - x;
    const dy = unit.y - y;
    const distSq = dx * dx + dy * dy;
    const radius = unit.radius + 18;
    if (distSq <= radius * radius && distSq < bestDistSq) {
      bestIndex = idx;
      bestDistSq = distSq;
    }
  });
  if (bestIndex < 0) return null;
  const best = world.units[bestIndex];
  const selectedId = best.id;
  for (let i = 0; i < world.units.length; i++) world.units[i].selected = world.units[i].id === selectedId;
  return best;
}

export function toggleBunkerDoor(world: GameWorld): boolean {
  const bunker = world.structures.find((s) => s.kind === 'fob' && s.hp > 0);
  if (!bunker) return false;
  if (bunker.doorLocked) {
    bunker.doorLocked = false;
    bunker.gateOpen = 0;
    setAlert(world, 'BUNKER DOOR UNLOCKED', 1.8);
  } else if ((bunker.gateOpen ?? 0) < 0.5) {
    bunker.gateOpen = 1;
    setAlert(world, 'BUNKER BLAST DOOR OPEN', 1.8);
    world.events.push({ type: 'gate_open', intensity: 0.8 });
  } else {
    bunker.gateOpen = 0;
    bunker.doorLocked = true;
    setAlert(world, 'BUNKER DOOR SEALED & LOCKED', 1.8);
    world.events.push({ type: 'gate_close', intensity: 0.65 });
  }
  return true;
}

export function requestDirectReload(world: GameWorld): boolean {
  if (world.directControlUnitId === null) return false;
  const unit = world.units.find((u) => u.id === world.directControlUnitId && u.hp > 0 && u.koTimer <= 0);
  if (!unit || unit.ammo >= unit.maxAmmo || (unit.reloadTimer ?? 0) > 0) return false;
  const spec = UNIT_SPECS[unit.kind];
  const reloadSeconds = spec.isAir ? 2.8 : spec.isVehicle ? 3.2 : unit.kind === 'sniper' || unit.kind === 'rpg' ? 2.2 : 1.65;
  unit.reloadTimer = reloadSeconds;
  unit.fireCooldown = Math.max(unit.fireCooldown, reloadSeconds);
  setAlert(world, `RELOADING ${UNIT_SPECS[unit.kind].shortName.toUpperCase()}`, reloadSeconds);
  world.events.push({ type: 'voice_order', intensity: 0.35 });
  return true;
}

export function toggleDirectControl(world: GameWorld, explicitUnitId?: number): number | null {
  if (world.directControlUnitId !== null && explicitUnitId === undefined) {
    world.directControlUnitId = null;
    setAlert(world, 'COMMANDER VIEW RESTORED', 1.8);
    return null;
  }

  const target =
    (explicitUnitId !== undefined
      ? world.units.find((u) => u.id === explicitUnitId && u.hp > 0 && u.koTimer <= 0)
      : undefined) ||
    world.units.find((u) => u.selected && u.hp > 0 && u.koTimer <= 0 && u.kind !== 'truck') ||
    world.units.find((u) => u.selected && u.hp > 0 && u.koTimer <= 0) ||
    world.units.find((u) => u.hp > 0 && u.koTimer <= 0);

  if (!target) return null;

  for (const u of world.units) u.selected = u.id === target.id;
  world.directControlUnitId = target.id;
  target.targetX = null;
  target.targetY = null;
  if (world.camera.targetZoom < 0.88) {
    world.camera.targetZoom = 1.02;
  }
  world.events.push({ type: 'voice_order', intensity: 0.7 });
  setAlert(world, `DIRECT CONTROL: ${UNIT_SPECS[target.kind].name.toUpperCase()}`, 2.4);
  return target.id;
}

export function adjustCameraZoom(
  world: GameWorld,
  deltaFactor: number,
  focusWorldX?: number,
  focusWorldY?: number,
): void {
  const prevZoom = world.camera.targetZoom;
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom * deltaFactor));
  world.camera.targetZoom = nextZoom;

  if (focusWorldX !== undefined && focusWorldY !== undefined && world.directControlUnitId === null) {
    const ratio = 1 - prevZoom / nextZoom;
    world.camera.targetX += (focusWorldX - world.camera.targetX) * ratio * 0.35;
    world.camera.targetY += (focusWorldY - world.camera.targetY) * ratio * 0.35;
    clampCameraTarget(world);
  }
}

export function clampCameraTarget(world: GameWorld): void {
  world.camera.targetX = Math.max(120, Math.min(world.width - 120, world.camera.targetX));
  world.camera.targetY = Math.max(120, Math.min(world.height - 120, world.camera.targetY));
}

function addCrater(world: GameWorld, x: number, y: number, radius: number): void {
  const craterLimit = world.graphicsQuality === 'low' ? 24 : world.graphicsQuality === 'medium' ? 60 : MAX_CRATERS;
  if (world.craters.length < craterLimit) {
    world.craters.push({ x, y, radius, alpha: 0.78, life: CRATER_LIFE });
  } else {
    const crater = world.craters[world.craterCursor % craterLimit];
    crater.x = x; crater.y = y; crater.radius = radius; crater.alpha = 0.78; crater.life = CRATER_LIFE;
    world.craterCursor = (world.craterCursor + 1) % craterLimit;
  }
}

export function recordDamageNumber(world: GameWorld, x: number, y: number, amount: number): void {
  if (!world.damageNumbersEnabled || world.lowLagMode || world.damageNumbers.length === 0 || world.graphicsQuality === 'low') return;
  const numberLimit = world.graphicsQuality === 'medium' ? 36 : world.damageNumbers.length;
  const number = world.damageNumbers[world.damageNumberCursor % numberLimit];
  world.damageNumberCursor = (world.damageNumberCursor + 1) % numberLimit;
  number.x = x; number.y = y; number.value = Math.round(amount); number.label = String(number.value); number.life = 0.85; number.active = true;
}

function damageZombie(
  world: GameWorld,
  z: Zombie,
  amount: number,
  knockX: number,
  knockY: number,
  attackerUnit?: PlayerUnit,
  damageKind: Projectile['kind'] | 'crush' = 'bullet',
): void {
  if (z.koTimer > 0 || z.hp <= 0) return;

  // Riot gear zombies absorb lighter small-arms fire unless hit by heavy ordnance or high-caliber sniper/shells
  let effectiveDmg = amount;
  if (z.kind === 'riot_zombie' && (damageKind === 'bullet' || damageKind === 'heavy_bullet') && amount < 90) {
    effectiveDmg *= 0.45;
  }

  z.hp -= effectiveDmg;
  if (damageKind === 'bullet' || damageKind === 'heavy_bullet') world.damageTally.bullet += effectiveDmg;
  else if (damageKind === 'rocket' || damageKind === 'shell') world.damageTally.explosive += effectiveDmg;
  recordDamageNumber(world, z.x, z.y - z.radius, effectiveDmg);
  z.hitFlash = 0.08;
  z.x += knockX;
  z.y += knockY;

  for (let i = 0; i < 3; i++) {
    spawnParticle(
      world,
      z.x,
      z.y,
      knockX * 28 + (Math.random() - 0.5) * 95,
      knockY * 28 + (Math.random() - 0.5) * 95,
      2.5 + Math.random() * 2.2,
      0.3 + Math.random() * 0.2,
      z.kind === 'spitter' ? '#4ade80' : z.kind === 'exploder' ? '#fb923c' : z.kind === 'screamer' ? '#c084fc' : '#991b1b',
      'blood',
    );
  }

  if (Math.random() < 0.35) {
    addBloodDecal(world, z.x, z.y, z.radius * (0.7 + Math.random() * 0.45));
  }

  if (z.hp <= 0) {
    z.hp = 0;
    z.koTimer = 0.32;
    z.vx = knockX * 14;
    z.vy = knockY * 14;
    addBloodDecal(world, z.x, z.y, z.radius * (1.1 + Math.random() * 0.65));
    world.kills += 1;
    if (world.bossId !== null && z.id === world.bossId) {
      world.bossId = null;
      addCoins(world, 150);
      setAlert(world, 'COMMANDER DOWN · +150 COINS', 3);
    }
    addCoins(world,
      (z.kind === 'tank'
        ? 32
        : z.kind === 'brute'
          ? 20
          : z.kind === 'exploder'
            ? 12
            : z.kind === 'mutated'
              ? 11
              : z.kind === 'infected_marine'
                ? 9
                : z.kind === 'riot_zombie'
          ? 10
          : z.kind === 'spitter'
            ? 8
            : z.kind === 'leaper'
              ? 7
              : 4));
    if (attackerUnit) attackerUnit.kills += 1;
  }
}

const FIRE_CAP = { low: 6, medium: 12, high: 20 } as const;

export function igniteFire(world: GameWorld, x: number, y: number, radius: number, gen = 0, lifeScale = 1): void {
  const r = Math.max(24, Math.min(54, radius));
  for (const f of world.fires) {
    const dx = f.x - x;
    const dy = f.y - y;
    if (dx * dx + dy * dy < (f.radius * 0.6) * (f.radius * 0.6)) {
      f.life = Math.max(f.life, f.maxLife * 0.8); // refresh instead of stacking
      return;
    }
  }
  if (world.fires.length >= FIRE_CAP[world.graphicsQuality]) return;
  const life = (7 + Math.random() * 4) * lifeScale;
  world.fires.push({ x, y, radius: r, life, maxLife: life, tick: 0.3, gen });
}

export const TIDE_PERIOD_SEC = 240;

export function tideAt(elapsedSec: number): number {
  return 0.5 - 0.5 * Math.cos((elapsedSec / TIDE_PERIOD_SEC) * Math.PI * 2); // starts at low tide
}

function updateTide(world: GameWorld): void {
  world.tide = tideAt(world.elapsedSec);
  const flooded = world.tide > 0.6;
  if (flooded === world.tideFlooded) return;
  world.tideFlooded = flooded;
  world.waterChannels = flooded ? [...world.staticWater, ...world.tidalFlats] : [...world.staticWater];
  setAlert(world, flooded ? 'HIGH TIDE · FLANK LANES FLOODED' : 'LOW TIDE · FLANK LANES OPEN', 3);
}

const NEST_HP = 900;
const NEST_BOUNTY = 120;

// Nests sit beside the buildings farthest from the FOB and keep feeding the horde until destroyed.
function placeNests(world: GameWorld): void {
  const fob = world.fobPos;
  const candidates = world.buildings
    .map((b) => ({ b, d: Math.hypot(b.x + b.w / 2 - fob.x, b.y + b.h / 2 - fob.y) }))
    .filter((c) => c.d > 900)
    .sort((a, b) => b.d - a.d);
  const picked: { x: number; y: number }[] = [];
  for (const c of candidates) {
    const x = c.b.x + c.b.w + 34;
    const y = c.b.y + c.b.h / 2;
    if (picked.every((p) => Math.hypot(p.x - x, p.y - y) > 700)) picked.push({ x, y });
    if (picked.length >= 2) break;
  }
  world.nests = picked.map((p) => ({ id: world.nextId++, x: p.x, y: p.y, hp: NEST_HP, maxHp: NEST_HP, spawnTimer: 8 + Math.random() * 6, pulse: Math.random() * 6 }));
}

function damageNest(world: GameWorld, nest: Nest, amount: number): void {
  nest.hp -= amount;
  if (nest.hp > 0) return;
  const idx = world.nests.indexOf(nest);
  if (idx >= 0) world.nests.splice(idx, 1);
  world.nestsDestroyed += 1;
  addCoins(world, NEST_BOUNTY);
  addCrater(world, nest.x, nest.y, 40);
  spawnParticle(world, nest.x, nest.y, 0, 0, 90, 0.6, '#a855f7', 'ring');
  world.events.push({ type: 'artillery_impact', intensity: 0.8 });
  setAlert(world, `NEST DESTROYED · +${NEST_BOUNTY} COINS`, 3);
}

function updateNests(world: GameWorld, dt: number): void {
  for (let i = world.nests.length - 1; i >= 0; i--) {
    const n = world.nests[i];
    n.pulse += dt;
    // Fire burns nests
    for (const f of world.fires) {
      if (Math.hypot(f.x - n.x, f.y - n.y) <= f.radius + 30) { damageNest(world, n, 12 * dt); break; }
    }
    if (n.hp <= 0) continue;
    // Player ground units that close in on a nest tear at it
    for (const u of world.units) {
      const spec = UNIT_SPECS[u.kind];
      if (u.hp <= 0 || u.koTimer > 0 || spec.isAir) continue;
      if (Math.hypot(u.x - n.x, u.y - n.y) <= 110) damageNest(world, n, Math.min(60, spec.damage * spec.fireRate * 0.3) * dt);
      if (n.hp <= 0) break;
    }
    if (n.hp <= 0) continue;
    n.spawnTimer -= dt;
    if (n.spawnTimer <= 0) {
      n.spawnTimer = Math.max(7, 15 - world.waveNumber * 0.5);
      const count = 3 + Math.min(4, Math.floor(world.waveNumber / 3));
      for (let k = 0; k < count; k++) {
        const kind: ZombieKind = world.waveNumber >= 4 && Math.random() < 0.25 ? 'sprinter' : 'shambler';
        spawnZombie(world, kind, n.x + (Math.random() - 0.5) * 70, n.y + (Math.random() - 0.5) * 70);
      }
      spawnParticle(world, n.x, n.y, 0, 0, 40, 0.4, '#a855f7', 'ring');
    }
  }
}

function updateFires(world: GameWorld, dt: number): void {
  if (world.fires.length === 0) return;
  const wet = world.weatherKind === 'rain' || world.weatherKind === 'storm';
  for (let i = world.fires.length - 1; i >= 0; i--) {
    const f = world.fires[i];
    f.life -= dt * (wet ? 3 : 1);
    if (f.life <= 0) {
      world.fires.splice(i, 1);
      continue;
    }
    f.tick -= dt;
    if (f.tick <= 0) {
      f.tick = 0.5;
      zombieGrid.queryRadius(f.x, f.y, f.radius + 16, (idx) => {
        const z = world.zombies[idx];
        if (!z || z.koTimer > 0 || z.hp <= 0) return;
        const dx = z.x - f.x;
        const dy = z.y - f.y;
        const r = f.radius + z.radius;
        if (dx * dx + dy * dy <= r * r) damageZombie(world, z, 5, 0, 0, undefined, 'rocket');
      });
    }
    if (!world.lowLagMode && Math.random() < dt * 7) {
      spawnParticle(world, f.x + (Math.random() - 0.5) * f.radius, f.y + (Math.random() - 0.5) * f.radius * 0.6,
        (Math.random() - 0.5) * 10, -18 - Math.random() * 18, 2 + Math.random() * 3, 0.5 + Math.random() * 0.4,
        Math.random() < 0.5 ? '#f97316' : '#fde047', 'spark');
    }
    // Spread outward while still strong; rain stops it and shortens burn time
    if (!wet && f.gen < 3 && f.life / f.maxLife > 0.4 && Math.random() < dt * 0.12) {
      const a = Math.random() * Math.PI * 2;
      igniteFire(world, f.x + Math.cos(a) * f.radius * 1.1, f.y + Math.sin(a) * f.radius * 1.1, f.radius * 0.85, f.gen + 1, 0.8);
    }
  }
}

function collapseBuilding(world: GameWorld, index: number): void {
  const b = world.buildings[index];
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  world.buildings.splice(index, 1);
  for (const n of [...world.nests]) {
    if (n.x >= b.x - 60 && n.x <= b.x + b.w + 60 && n.y >= b.y - 60 && n.y <= b.y + b.h + 60) damageNest(world, n, 450); // collapse buries it
  }
  world.rubble.push({ x: b.x, y: b.y, w: b.w, h: b.h, seed: Math.floor(Math.random() * 1e6) });
  if (world.rubble.length > 40) world.rubble.shift();

  // Crush anything left inside the footprint
  zombieGrid.queryRadius(cx, cy, Math.hypot(b.w, b.h) / 2 + 24, (idx) => {
    const z = world.zombies[idx];
    if (!z || z.koTimer > 0 || z.hp <= 0) return;
    if (z.x >= b.x - 8 && z.x <= b.x + b.w + 8 && z.y >= b.y - 8 && z.y <= b.y + b.h + 8) {
      damageZombie(world, z, 90, 0, 0, undefined, 'artillery');
    }
  });

  const dust = world.lowLagMode ? 8 : 22;
  for (let i = 0; i < dust; i++) {
    spawnParticle(world, b.x + Math.random() * b.w, b.y + Math.random() * b.h,
      (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 8 + Math.random() * 10, 0.9 + Math.random() * 0.8, '#64748b', 'smoke');
  }
  if (b.kind === 'depot' || b.kind === 'warehouse' || b.kind === 'tank_silo') {
    igniteFire(world, cx, cy, Math.min(b.w, b.h) * 0.3);
  }
  addTrauma(world, 0.3);
  world.events.push({ type: 'artillery_impact', intensity: 1 });
  const salvage = 20 + Math.round((b.w * b.h) / 2500);
  addCoins(world, salvage);
  setAlert(world, `STRUCTURE COLLAPSED · SALVAGE +${salvage}`, 2.5);
}

function damageBuildings(world: GameWorld, x: number, y: number, radius: number, damage: number, heavy: boolean): void {
  if (damage < 60) return; // small blasts (unit deaths, turrets) never level buildings
  for (let i = world.buildings.length - 1; i >= 0; i--) {
    const b = world.buildings[i];
    if (b.hp === undefined) continue;
    const nx = Math.max(b.x, Math.min(x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(y, b.y + b.h));
    const d = Math.hypot(nx - x, ny - y);
    if (d > radius) continue;
    const falloff = Math.max(0.4, 1 - d / (radius + 10));
    b.hp -= damage * (heavy ? 1.5 : 0.8) * falloff;
    b.damageFlash = 0.3;
    if (b.hp <= 0) collapseBuilding(world, i);
  }
}

function oilIsBurning(world: GameWorld, oil: Structure): boolean {
  for (const fire of world.fires) {
    const dx = fire.x - oil.x;
    const dy = fire.y - oil.y;
    const r = fire.radius + Math.max(oil.w, oil.h) * 0.5;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

// An oil slick touched by fire (or an explosion) goes up along its whole length.
function igniteOilSlick(world: GameWorld, oil: Structure): void {
  oil.hp = 0;
  const cs = Math.cos(oil.angle);
  const sn = Math.sin(oil.angle);
  for (let k = -1; k <= 1; k++) {
    igniteFire(world, oil.x + cs * k * oil.w * 0.32, oil.y + sn * k * oil.w * 0.32, 34, 1, 1.4);
  }
  spawnParticle(world, oil.x, oil.y, 0, 0, 60, 0.4, '#fb923c', 'ring');
  setAlert(world, 'OIL SLICK IGNITED', 1.5);
}

function triggerSplashExplosion(
  world: GameWorld,
  x: number,
  y: number,
  radius: number,
  damage: number,
  heavy = false,
  attackerUnit?: PlayerUnit,
): void {
  addCrater(world, x, y, radius * 0.52);
  if (heavy || Math.random() < 0.3) igniteFire(world, x, y, radius * 0.45);
  spawnParticle(world, x, y, 0, 0, radius, 0.36, '#fb923c', 'ring');

  const burstCount = world.lowLagMode ? (heavy ? 10 : 5) : heavy ? 20 : 12;
  for (let i = 0; i < burstCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 50 + Math.random() * (heavy ? 240 : 150);
    spawnParticle(
      world,
      x,
      y,
      Math.cos(a) * sp,
      Math.sin(a) * sp,
      heavy ? 5 + Math.random() * 5 : 3 + Math.random() * 4,
      0.32 + Math.random() * 0.35,
      i % 3 === 0 ? '#fde047' : i % 3 === 1 ? '#f97316' : '#475569',
      i % 3 === 2 ? 'smoke' : 'spark',
    );
  }

  const maxR = radius + 24;
  zombieGrid.queryRadius(x, y, maxR, (idx) => {
    const z = world.zombies[idx];
    if (!z || z.koTimer > 0 || z.hp <= 0) return;
    const dx = z.x - x;
    const dy = z.y - y;
    const hitR = radius + z.radius;
    const dSq = dx * dx + dy * dy;
    if (dSq <= hitR * hitR) {
      const dist = Math.sqrt(dSq);
      const falloff = Math.max(0.35, 1 - dist / (hitR + 10));
      const nx = dist > 0.1 ? dx / dist : Math.cos(Math.random() * 6.28);
      const ny = dist > 0.1 ? dy / dist : Math.sin(Math.random() * 6.28);
      damageZombie(
        world,
        z,
        damage * falloff,
        nx * (heavy ? 18 : 10),
        ny * (heavy ? 18 : 10),
        attackerUnit,
        heavy ? 'artillery' : 'rocket',
      );
    }
  });

  damageBuildings(world, x, y, radius, damage, heavy);
  if (damage >= 60) {
    for (const n of [...world.nests]) {
      if (Math.hypot(n.x - x, n.y - y) <= radius + 24) damageNest(world, n, damage * (heavy ? 1.2 : 0.5));
    }
  }
  for (const st of world.structures) {
    if (st.kind === 'oil' && st.hp > 0 && Math.hypot(st.x - x, st.y - y) <= radius + st.w * 0.5) igniteOilSlick(world, st);
  }

  if (heavy) {
    addTrauma(world, 0.18);
    world.events.push({ type: 'artillery_impact', intensity: 1 });
  } else {
    addTrauma(world, 0.07);
    world.events.push({ type: 'explosion', intensity: 0.75 });
  }
}

function fireWeaponFromUnit(
  world: GameWorld,
  unit: PlayerUnit,
  aimAngle: number,
  targetX?: number,
  targetY?: number,
): void {
  const spec = UNIT_SPECS[unit.kind];
  if (unit.ammo <= 0 || spec.fireRate <= 0 || (unit.reloadTimer ?? 0) > 0) return;

  unit.ammo = Math.max(0, unit.ammo - 1);
  unit.fireCooldown = 1 / spec.fireRate;
  unit.turretAngle = aimAngle;
  unit.recoil =
    unit.kind === 'tank' || unit.kind === 'howitzer'
      ? 8
      : unit.kind === 'rpg' || unit.kind === 'sniper'
        ? 6
        : unit.kind === 'ifv'
          ? 4.5
          : 3.0;

  const muzzleDist = unit.radius + 7;
  const mx = unit.x + Math.cos(aimAngle) * muzzleDist;
  const my = unit.y + Math.sin(aimAngle) * muzzleDist;

  spawnParticle(
    world,
    mx,
    my,
    Math.cos(aimAngle) * 70,
    Math.sin(aimAngle) * 70,
    unit.kind === 'tank' || unit.kind === 'howitzer' ? 7 : unit.kind === 'rpg' || unit.kind === 'ifv' ? 5 : 3.5,
    0.11,
    '#fef08a',
    'spark',
  );
  if (unit.kind !== 'rpg' && !world.lowLagMode) {
    spawnParticle(
      world,
      unit.x,
      unit.y,
      Math.cos(aimAngle + 1.6) * 38,
      Math.sin(aimAngle + 1.6) * 38,
      2,
      0.38,
      '#facc15',
      'casing',
    );
  }

  const speed =
    unit.kind === 'sniper'
      ? 1240
      : unit.kind === 'tank' || unit.kind === 'howitzer'
        ? 820
        : unit.kind === 'ifv'
          ? 790
          : unit.kind === 'rpg'
            ? 560
            : unit.kind === 'chopper' || unit.kind === 'hind' || unit.kind === 'drone'
              ? 760
              : 900;
  const spread =
    unit.kind === 'sniper'
      ? 0.006
      : unit.kind === 'tank' || unit.kind === 'howitzer'
        ? 0.018
        : unit.kind === 'heavy' || unit.kind === 'blackhawk' || unit.kind === 'littlebird' || unit.kind === 'chinook'
          ? 0.075
          : unit.kind === 'rpg'
            ? 0.028
            : 0.04;
  const finalAngle = aimAngle + (Math.random() - 0.5) * spread;
  const distToTarget =
    targetX !== undefined && targetY !== undefined
      ? Math.hypot(targetX - mx, targetY - my)
      : spec.range;
  const maxLife = Math.min(spec.range / speed + 0.08, Math.max(0.2, distToTarget / speed + 0.05));

  const pKind: Projectile['kind'] =
    unit.kind === 'tank' || unit.kind === 'ifv' || unit.kind === 'howitzer'
      ? 'shell'
      : unit.kind === 'chopper' || unit.kind === 'rpg' || unit.kind === 'hind' || unit.kind === 'drone'
        ? 'rocket'
        : unit.kind === 'heavy' || unit.kind === 'humvee' || unit.kind === 'raider' || unit.kind === 'blackhawk' || unit.kind === 'sniper' || unit.kind === 'littlebird' || unit.kind === 'chinook'
          ? 'heavy_bullet'
          : 'bullet';

  spawnProjectile(world, true, mx, my, mx, my, Math.cos(finalAngle) * speed, Math.sin(finalAngle) * speed, maxLife, spec.damage, spec.splashRadius, pKind);

  if (unit.kind === 'tank' || unit.kind === 'howitzer' || unit.kind === 'sniper') {
    if (unit.kind === 'tank' || unit.kind === 'howitzer') {
      addTrauma(world, 0.04);
    }
    world.events.push({ type: 'cannon', intensity: unit.kind === 'tank' || unit.kind === 'howitzer' ? 0.9 : 0.55 });
  } else if (unit.kind === 'chopper' || unit.kind === 'rpg' || unit.kind === 'hind' || unit.kind === 'drone') {
    world.events.push({ type: 'rocket', intensity: 0.6 });
  } else if (unit.kind === 'heavy' || unit.kind === 'humvee' || unit.kind === 'raider' || unit.kind === 'ifv' || unit.kind === 'blackhawk' || unit.kind === 'littlebird' || unit.kind === 'chinook') {
    world.events.push({ type: 'heavy_gun', intensity: 0.45 });
  } else {
    world.events.push({ type: 'rifle', intensity: 0.4 });
  }
}

function spawnWave(world: GameWorld): void {
  const scenario = SCENARIOS[world.scenarioId];
  const map = MAPS[world.mapId];
  const waveSize = Math.round((24 + world.waveNumber * 13) * scenario.hordeScaleMultiplier);
  for (let i = 0; i < waveSize; i++) {
    const sp = map.spawnPoints[i % map.spawnPoints.length];
    const roll = Math.random();
    let kind: ZombieKind = 'shambler';
    if (world.waveNumber >= 5 && roll > 0.988) kind = 'juggernaut';
    else if (world.waveNumber >= 4 && roll > 0.985) kind = 'tank';
    else if (world.waveNumber >= 3 && roll > 0.965) kind = 'brute';
    else if (world.waveNumber >= 3 && roll > 0.945) kind = 'mutated';
    else if (world.waveNumber >= 2 && roll > 0.925) kind = 'infected_marine';
    else if (world.waveNumber >= 2 && roll > 0.905) kind = 'screamer';
    else if (world.waveNumber >= 2 && roll > 0.885) kind = 'exploder';
    else if (roll > 0.865) kind = 'crawler';
    else if (roll > 0.82) kind = 'riot_zombie';
    else if (roll > 0.75) kind = 'spitter';
    else if (roll > 0.64) kind = 'leaper';
    else if (roll > 0.42) kind = 'sprinter';

    spawnZombie(
      world,
      kind,
      sp.x + (Math.random() - 0.5) * 90,
      sp.y + (Math.random() - 0.5) * 90,
    );
  }

  settleWaveBonus(world);
  spawnAdaptiveAndCommander(world);
  world.waveNumber += 1;
  world.waveTimer = scenario.waveInterval;
  world.events.push({ type: 'zombie_groan', intensity: 0.8 });
  if (world.waveNumber >= 3) {
    world.events.push({ type: 'brute_roar', intensity: 0.8 });
  }
  setAlert(world, `HORDE WAVE ${world.waveNumber - 1} ADVANCING`, 3.0);
  startWaveBonus(world);
}

// Optional per-wave bonus goal. Pays coins when the next wave arrives; never penalises failure.
// Every 3rd wave the infected adapt to what the player relies on; every 4th wave a Commander arrives.
function spawnAdaptiveAndCommander(world: GameWorld): void {
  const upcoming = world.waveNumber + 1;
  const points = MAPS[world.mapId].spawnPoints;
  const sp = points[Math.floor(Math.random() * points.length)];
  if (upcoming >= 4 && upcoming % 4 === 0 && world.bossId === null) {
    const boss = spawnZombie(world, 'brute', sp.x, sp.y);
    if (boss) {
      boss.elite = true;
      boss.maxHp *= 3;
      boss.hp = boss.maxHp;
      world.bossId = boss.id;
      setAlert(world, 'INFECTED COMMANDER INBOUND', 3);
    }
  }
  if (upcoming >= 3 && upcoming % 3 === 0) {
    const { bullet, explosive } = world.damageTally;
    const total = bullet + explosive;
    if (total > 300) {
      const counter: ZombieKind = bullet / total > 0.65 ? 'riot_zombie' : explosive / total > 0.65 ? 'sprinter' : 'brute';
      const n = 3 + Math.floor(upcoming / 3);
      for (let i = 0; i < n; i++) spawnZombie(world, counter, sp.x + (Math.random() - 0.5) * 120, sp.y + (Math.random() - 0.5) * 120);
      setAlert(world, bullet / total > 0.65 ? 'INFECTED ADAPTING · ARMOURED' : explosive / total > 0.65 ? 'INFECTED ADAPTING · FAST' : 'INFECTED ADAPTING', 3);
    }
    world.damageTally.bullet = 0;
    world.damageTally.explosive = 0;
  }
}

function settleWaveBonus(world: GameWorld): void {
  const b = world.waveBonus;
  if (!b) return;
  const done = b.kind === 'kills' ? world.kills - b.startKills >= b.target : world.unitsLost === b.startLost;
  world.waveBonus = null;
  if (done) {
    world.req = Math.min(MAX_COINS, world.req + b.reward);
    world.events.push({ type: 'build', intensity: 0.8 });
    setAlert(world, `WAVE BONUS COMPLETE · +${b.reward} COINS`, 3.0);
  }
}

function startWaveBonus(world: GameWorld): void {
  const wave = world.waveNumber;
  if (wave < 2) return;
  if (wave % 2 === 0) {
    const target = 12 + wave * 3;
    world.waveBonus = { kind: 'kills', target, startKills: world.kills, startLost: world.unitsLost, reward: 60 + wave * 12 };
    setAlert(world, `WAVE ${wave - 1} · BONUS: KILL ${target} (+${world.waveBonus.reward})`, 3.5);
  } else {
    world.waveBonus = { kind: 'no_losses', target: 0, startKills: world.kills, startLost: world.unitsLost, reward: 80 + wave * 12 };
    setAlert(world, `WAVE ${wave - 1} · BONUS: LOSE NO UNITS (+${world.waveBonus.reward})`, 3.5);
  }
}

function updateWeather(world: GameWorld, dt: number): void {
  const w = world.weather;
  w.lightningFlash = Math.max(0, w.lightningFlash - dt * 3.4);

  if (world.phase === 'playing') {
    w.nextChangeIn -= dt;
    if (w.nextChangeIn <= 0) {
      cycleWeather(world);
    }
  }

  if (w.kind === 'storm') {
    w.lightningTimer -= dt;
    if (w.lightningTimer <= 0) {
      w.lightningFlash = 0.85;
      w.lightningTimer = 4.5 + Math.random() * 7;
      if (world.phase === 'playing') {
        world.events.push({ type: 'thunder', intensity: 0.8 });
      }
    }
  }

  if (w.kind === 'rain' || w.kind === 'storm') {
    const speedMult = w.kind === 'storm' ? 1.35 : 1.0;
    for (let i = 0; i < world.rainDrops.length; i++) {
      const r = world.rainDrops[i];
      r.x += w.windX * dt;
      r.y += r.speed * speedMult * dt;
      if (r.y > 1050) {
        r.y = -40;
        r.x = Math.random() * 1700;
      }
      if (r.x < -120) r.x += 1720;
    }
  }
}

export function stepWorld(
  world: GameWorld,
  rawDt: number,
  input?: InputState,
  viewportWidth = 1440,
  viewportHeight = 900,
): void {
  const dt = Math.min(rawDt, 0.05);
  world.events.length = 0;
  world.simulationTick++;

  if (world.phase === 'paused' || world.phase === 'gameover') {
    return;
  }

  updateWeather(world, dt);

  for (const ship of world.navalFleet) {
    ship.recoil = Math.max(0, ship.recoil - dt * 16);
    ship.muzzleFlash = Math.max(0, ship.muzzleFlash - dt * 2.5);
  }

  if (world.phase === 'title') {
    world.elapsedSec += dt;
    world.camera.targetX = 680 + Math.sin(world.elapsedSec * 0.14) * 180;
    world.camera.targetY = 1140 + Math.cos(world.elapsedSec * 0.11) * 140;
    world.camera.targetZoom = 0.72 + Math.sin(world.elapsedSec * 0.18) * 0.05;
    updateCameraAndParticles(world, dt);

    for (const u of world.units) {
      if (UNIT_SPECS[u.kind].isAir) {
        const patrolAngle = world.elapsedSec * 0.55 + (u.kind === 'blackhawk' ? Math.PI : 0);
        u.x = 620 + Math.cos(patrolAngle) * 240;
        u.y = 1160 + Math.sin(patrolAngle) * 170;
        u.angle = patrolAngle + Math.PI * 0.5;
        u.turretAngle = u.angle;
      }
    }
    for (let i = 0; i < Math.min(40, world.zombies.length); i++) {
      const z = world.zombies[i];
      z.gaitPhase += dt * 4;
      z.x += Math.cos(z.angle) * 10 * dt;
      z.y += Math.sin(z.angle) * 10 * dt;
      const pushed = pushOutOfBuildings(z.x, z.y, z.radius, world.buildings);
      z.x = Math.max(world.coastlineX + 350, Math.min(world.width - 40, pushed.x));
      z.y = Math.max(60, Math.min(world.height - 60, pushed.y));
    }
    return;
  }

  if (world.hitstopTimer > 0) {
    world.hitstopTimer = Math.max(0, world.hitstopTimer - dt);
    updateCameraAndParticles(world, dt);
    return;
  }

  world.elapsedSec += dt;
  updateFogOfWar(world, dt);
  const scenario = SCENARIOS[world.scenarioId];

  const ownedSectors = world.sectors.filter((s) => s.owner === 'player').length;
  addCoins(world, (scenario.reqIncomePerSec + ownedSectors * 4.5) * dt);

  if (world.alertTimer > 0) {
    world.alertTimer -= dt;
    if (world.alertTimer <= 0) world.alertMessage = null;
  }
  world.strikeCooldowns.barrage = Math.max(0, world.strikeCooldowns.barrage - dt);
  world.strikeCooldowns.airstrike = Math.max(0, world.strikeCooldowns.airstrike - dt);
  world.strikeCooldowns.supplydrop = Math.max(0, world.strikeCooldowns.supplydrop - dt);
  world.strikeCooldowns.reinforce = Math.max(0, world.strikeCooldowns.reinforce - dt);

  world.waveTimer -= dt;
  if (world.waveTimer <= 0) {
    spawnWave(world);
  }

  const controlledUnit =
    world.directControlUnitId !== null
      ? world.units.find(
          (u) => u.id === world.directControlUnitId && u.hp > 0 && u.koTimer <= 0,
        ) ?? null
      : null;

  if (world.directControlUnitId !== null && !controlledUnit) {
    world.directControlUnitId = null;
  }

  if (controlledUnit) {
    world.camera.targetX = controlledUnit.x;
    world.camera.targetY = controlledUnit.y;
  } else if (input) {
    const panSpeed = (680 / Math.max(0.32, world.camera.zoom)) * dt;
    if (input.keysHeld.has('KeyW') || input.keysHeld.has('ArrowUp')) world.camera.targetY -= panSpeed;
    if (input.keysHeld.has('KeyS') || input.keysHeld.has('ArrowDown')) world.camera.targetY += panSpeed;
    if (input.keysHeld.has('KeyA') || input.keysHeld.has('ArrowLeft')) world.camera.targetX -= panSpeed;
    if (input.keysHeld.has('KeyD') || input.keysHeld.has('ArrowRight')) world.camera.targetX += panSpeed;
    clampCameraTarget(world);
  }

  playerUnitGrid.clear();
  for (let i = 0; i < world.units.length; i++) {
    const unit = world.units[i];
    if (unit.hp > 0 && unit.koTimer <= 0) playerUnitGrid.insert(i, unit.x, unit.y);
  }

  zombieGrid.clear();
  let activeZombieCount = 0;
  for (let i = 0; i < world.zombies.length; i++) {
    const z = world.zombies[i];
    if (z.koTimer <= 0 && z.hp > 0) {
      zombieGrid.insert(i, z.x, z.y);
      activeZombieCount++;
    }
  }
  world.activeZombieCount = activeZombieCount;

  for (let i = world.minimapPings.length - 1; i >= 0; i--) {
    world.minimapPings[i].life -= dt;
    if (world.minimapPings[i].life <= 0) world.minimapPings.splice(i, 1);
  }
  if (!world.lowLagMode && world.damageNumbersEnabled) {
    for (let i = 0; i < world.damageNumbers.length; i++) {
      const number = world.damageNumbers[i];
      if (!number.active) continue;
      number.life -= dt; number.y -= 24 * dt;
      if (number.life <= 0) number.active = false;
    }
  }

  if (world.autoBattleAssist) {
    for (let i = 0; i < world.units.length; i++) {
      const unit = world.units[i];
      if (unit.hp <= 0 || unit.koTimer > 0 || world.directControlUnitId === unit.id) continue;
      const spec = UNIT_SPECS[unit.kind];
      if (unit.hp / Math.max(1, unit.maxHp) <= 0.22) {
        unit.targetX = world.fobPos.x + 90;
        unit.targetY = world.fobPos.y;
        unit.attackMove = false;
        continue;
      }
      if (unit.targetX !== null && unit.targetY !== null) continue;
      assistSearchX = unit.x;
      assistSearchY = unit.y;
      assistBestIndex = -1;
      assistBestDistanceSq = spec.range * spec.range;
      activeAssistWorld = world;
      zombieGrid.queryRadius(unit.x, unit.y, spec.range, considerAssistZombie);
      if (assistBestIndex >= 0) {
        const target = world.zombies[assistBestIndex];
        unit.targetX = target.x;
        unit.targetY = target.y;
        unit.attackMove = true;
      }
    }
  }

  // 1. Update Supply Crates
  for (let i = world.supplyCrates.length - 1; i >= 0; i--) {
    const c = world.supplyCrates[i];
    c.life -= dt;
    let consumed = false;
    for (const u of world.units) {
      if (u.hp <= 0 || u.koTimer > 0) continue;
      if (Math.hypot(u.x - c.x, u.y - c.y) <= 135) {
        if (u.ammo < u.maxAmmo || u.hp < u.maxHp) {
          u.ammo = Math.min(u.maxAmmo, u.ammo + c.ammoAmount);
          u.hp = Math.min(u.maxHp, u.hp + c.healAmount);
          u.resupplyPulse = 0.6;
          consumed = true;
        }
      }
    }
    if (consumed) {
      world.events.push({ type: 'supply', intensity: 0.7 });
      world.supplyCrates.splice(i, 1);
    } else if (c.life <= 0) {
      world.supplyCrates.splice(i, 1);
    }
  }

  // 2. Update Player Units (Medic, Blackhawk medevac/ammo aura, smart targeting + kiting)
  for (let i = world.units.length - 1; i >= 0; i--) {
    const u = world.units[i];
    if (u.koTimer > 0) {
      u.koTimer -= dt;
      if (u.koTimer <= 0) {
        world.units.splice(i, 1);
      }
      continue;
    }

    const spec = UNIT_SPECS[u.kind];
    u.fireCooldown = Math.max(0, u.fireCooldown - dt);
    if ((u.reloadTimer ?? 0) > 0) {
      u.reloadTimer = Math.max(0, (u.reloadTimer ?? 0) - dt);
      if (u.reloadTimer === 0) {
        u.ammo = u.maxAmmo;
        if (world.directControlUnitId === u.id) setAlert(world, 'RELOAD COMPLETE', 1.1);
      }
    }
    u.secondaryCooldown = Math.max(0, u.secondaryCooldown - dt);
    u.recoil = Math.max(0, u.recoil - dt * 26);
    u.hitFlash = Math.max(0, u.hitFlash - dt);
    u.resupplyPulse = Math.max(0, u.resupplyPulse - dt);

    // Medic healing aura for infantry
    if (u.kind === 'medic') {
      for (const ally of world.units) {
        if (
          ally.hp > 0 &&
          ally.koTimer <= 0 &&
          !UNIT_SPECS[ally.kind].isVehicle
        ) {
          if (Math.hypot(ally.x - u.x, ally.y - u.y) <= 165 && ally.hp < ally.maxHp) {
            ally.hp = Math.min(ally.maxHp, ally.hp + 15 * dt);
            ally.resupplyPulse = Math.max(ally.resupplyPulse, 0.15);
          }
        }
      }
    }

    // UH-60 Blackhawk hover medevac & ammo drop aura for nearby ground units
    if (u.kind === 'blackhawk' || u.kind === 'chinook') {
      const auraR = u.kind === 'chinook' ? 230 : 165;
      const healRate = u.kind === 'chinook' ? 16 : 10;
      for (const ally of world.units) {
        if (ally.id !== u.id && ally.hp > 0 && ally.koTimer <= 0 && !UNIT_SPECS[ally.kind].isAir) {
          if (Math.hypot(ally.x - u.x, ally.y - u.y) <= auraR) {
            if (ally.hp < ally.maxHp) {
              ally.hp = Math.min(ally.maxHp, ally.hp + healRate * dt);
              ally.resupplyPulse = Math.max(ally.resupplyPulse, 0.15);
            }
            if (ally.ammo < ally.maxAmmo) {
              ally.ammo = Math.min(ally.maxAmmo, ally.ammo + Math.max(4, ally.maxAmmo * 0.1) * dt);
            }
          }
        }
      }
    }

    // Resupply aura from FOBs & Supply Trucks
    if (u.kind !== 'truck') {
      let nearSupply = false;
      for (const s of world.structures) {
        if (s.hp > 0 && s.kind === 'fob' && Math.hypot(s.x - u.x, s.y - u.y) <= 220) {
          nearSupply = true;
          break;
        }
      }
      if (!nearSupply) {
        for (const t of world.units) {
          if (t.id !== u.id && t.kind === 'truck' && t.hp > 0 && t.koTimer <= 0 && t.ammo > 0) {
            if (Math.hypot(t.x - u.x, t.y - u.y) <= UNIT_SPECS.truck.range) {
              nearSupply = true;
              t.ammo = Math.max(0, t.ammo - 6 * dt);
              break;
            }
          }
        }
      }
      if (nearSupply) {
        if (u.ammo < u.maxAmmo) {
          u.ammo = Math.min(u.maxAmmo, u.ammo + Math.max(8, u.maxAmmo * 0.22) * dt);
          u.resupplyPulse = 0.25;
        }
        if (u.hp < u.maxHp) {
          u.hp = Math.min(u.maxHp, u.hp + 16 * dt);
        }
      }
    } else {
      for (const s of world.structures) {
        if (s.hp > 0 && s.kind === 'fob' && Math.hypot(s.x - u.x, s.y - u.y) <= 195) {
          u.ammo = Math.min(u.maxAmmo, u.ammo + 65 * dt);
          u.hp = Math.min(u.maxHp, u.hp + 20 * dt);
        }
      }
    }

    const isDirect = controlledUnit?.id === u.id;
    let moveX = 0;
    let moveY = 0;

    if (isDirect && input) {
      let ix = input.virtualMoveX;
      let iy = input.virtualMoveY;
      if (input.keysHeld.has('KeyW') || input.keysHeld.has('ArrowUp')) iy -= 1;
      if (input.keysHeld.has('KeyS') || input.keysHeld.has('ArrowDown')) iy += 1;
      if (input.keysHeld.has('KeyA') || input.keysHeld.has('ArrowLeft')) ix -= 1;
      if (input.keysHeld.has('KeyD') || input.keysHeld.has('ArrowRight')) ix += 1;
      const len = Math.hypot(ix, iy);
      const boost = input.keysHeld.has('ShiftLeft') || input.keysHeld.has('ShiftRight') ? 1.28 : 1;
      if (len > 0.01) {
        const clampedLen = Math.max(1, len);
        moveX = (ix / clampedLen) * spec.speed * boost;
        moveY = (iy / clampedLen) * spec.speed * boost;
      }

      const aimAngle =
        input.virtualFiring && len > 0.1
          ? Math.atan2(iy, ix)
          : Math.atan2(input.mouseWorldY - u.y, input.mouseWorldX - u.x);
      u.turretAngle = aimAngle;
      if (spec.isAir || len < 0.01) {
        u.angle = aimAngle;
      }

      const wantsFire = input.mouseDownLeft || input.keysHeld.has('Space') || input.virtualFiring;
      if (wantsFire && u.fireCooldown <= 0 && u.ammo > 0) {
        fireWeaponFromUnit(world, u, aimAngle, input.mouseWorldX, input.mouseWorldY);
      }
    } else {
      if (u.targetX !== null && u.targetY !== null) {
        const dx = u.targetX - u.x;
        const dy = u.targetY - u.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= 12) {
          u.targetX = null;
          u.targetY = null;
        } else {
          moveX = (dx / dist) * spec.speed;
          moveY = (dy / dist) * spec.speed;
        }
      }

      // Smart target prioritization + gentle infantry kiting when melee zombies get dangerously close
      if (spec.fireRate > 0 && u.ammo > 0) {
        let bestZ: Zombie | null = null;
        let bestThreatScore = Infinity;
        let nearestMeleeZ: Zombie | null = null;
        let nearestMeleeDistSq = 56 * 56;
        const rangeSq = spec.range * spec.range;

        zombieGrid.queryRadius(u.x, u.y, spec.range, (zIdx) => {
          const z = world.zombies[zIdx];
          if (!z || z.hp <= 0 || z.koTimer > 0) return;
          const dx = z.x - u.x;
          const dy = z.y - u.y;
          const dSq = dx * dx + dy * dy;
          if (dSq > rangeSq) return;

          if (dSq < nearestMeleeDistSq && z.kind !== 'spitter') {
            nearestMeleeDistSq = dSq;
            nearestMeleeZ = z;
          }

          let priorityBonus = 0;
          if (u.kind === 'rpg' || u.kind === 'sniper' || u.kind === 'tank') {
            if (z.kind === 'brute' || z.kind === 'tank' || z.kind === 'riot_zombie' || z.kind === 'spitter' || z.kind === 'exploder') priorityBonus = -95;
          } else if (z.kind === 'spitter' || z.kind === 'sprinter') {
            priorityBonus = -45;
          }
          const d = Math.sqrt(dSq);
          const score = d + priorityBonus;
          if (score >= bestThreatScore) return;

          if (spec.isAir || hasLineOfSight(u.x, u.y, z.x, z.y, world.buildings)) {
            bestThreatScore = score;
            bestZ = z;
          }
        });

        // Gentle tactical kite step for un-ordered infantry if non-spitter zombie closes into melee range
        if (
          !spec.isVehicle &&
          !spec.isAir &&
          u.targetX === null &&
          u.targetY === null &&
          nearestMeleeZ !== null
        ) {
          const nz = nearestMeleeZ as Zombie;
          const kx = u.x - nz.x;
          const ky = u.y - nz.y;
          const kLen = Math.hypot(kx, ky) || 1;
          moveX += (kx / kLen) * spec.speed * 0.55;
          moveY += (ky / kLen) * spec.speed * 0.55;
        }

        if (bestZ) {
          const targetZ = bestZ as Zombie;
          const aimAngle = Math.atan2(targetZ.y - u.y, targetZ.x - u.x);
          u.turretAngle = aimAngle;
          if (u.fireCooldown <= 0) {
            fireWeaponFromUnit(world, u, aimAngle, targetZ.x, targetZ.y);
          }
        }
      }
    }

    for (let j = 0; j < world.units.length; j++) {
      if (i === j) continue;
      const other = world.units[j];
      if (other.koTimer > 0 || !!UNIT_SPECS[other.kind].isAir !== !!spec.isAir) continue;
      const dx = u.x - other.x;
      const dy = u.y - other.y;
      const minSep = u.radius + other.radius + 4;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01 && dist < minSep) {
        const push = ((minSep - dist) / minSep) * 110;
        moveX += (dx / dist) * push;
        moveY += (dy / dist) * push;
      }
    }

    // Collision-aware steering: when a direct order points into a building, wall,
    // gate or water, probe nearby headings and choose the clearest route toward the goal.
    if (!isDirect && u.targetX !== null && u.targetY !== null && !spec.isAir) {
      const goalX = u.targetX - u.x;
      const goalY = u.targetY - u.y;
      const goalLen = Math.hypot(goalX, goalY) || 1;
      const desired = Math.atan2(goalY, goalX);
      const probe = Math.max(18, Math.min(34, spec.speed * 0.28));
      const turns = [0, 0.42, -0.42, 0.82, -0.82, 1.25, -1.25, 1.75, -1.75, 2.35, -2.35, Math.PI];
      let bestHeading = desired;
      let bestScore = -Infinity;
      let foundClear = false;
      for (const turn of turns) {
        const heading = desired + turn;
        const px = u.x + Math.cos(heading) * probe;
        const py = u.y + Math.sin(heading) * probe;
        const b = pushOutOfBuildings(px, py, u.radius, world.buildings);
        const w = pushOutOfWalls(b.x, b.y, u.radius, world.structures, false);
        const water = pushOutOfWater(w.x, w.y, u.radius, world.waterChannels, world.bridges);
        const blocked = Math.hypot(water.x - px, water.y - py) > 2.5;
        if (blocked) continue;
        const progress = Math.cos(heading - desired);
        const score = progress - Math.abs(turn) * 0.035;
        if (score > bestScore) {
          bestScore = score;
          bestHeading = heading;
          foundClear = true;
        }
      }
      if (foundClear) {
        moveX = Math.cos(bestHeading) * spec.speed;
        moveY = Math.sin(bestHeading) * spec.speed;
      } else {
        moveX = 0;
        moveY = 0;
      }
    }

    u.vx = moveX;
    u.vy = moveY;
    u.x += moveX * dt;
    u.y += moveY * dt;

    const speedNow = Math.hypot(moveX, moveY);
    if (spec.isVehicle) {
      // Fuel is distance-based so frame-rate changes do not alter consumption.
      const vehicle = u;
      const maxFuel = vehicle.maxFuel ?? 100;
      const fuel = vehicle.fuel ?? maxFuel;
      if (isNearSupplyOrFob(world, vehicle.x, vehicle.y)) {
        vehicle.fuel = Math.min(maxFuel, fuel + 8 * dt);
      } else {
        const travelled = speedNow * dt;
        vehicle.fuel = Math.max(0, fuel - travelled * 0.012);
        if (vehicle.fuel <= 0.001) {
          vehicle.fuel = 0;
          vehicle.vx = 0;
          vehicle.vy = 0;
          // Prevent further movement orders until the vehicle is refuelled.
          vehicle.x -= moveX * dt;
          vehicle.y -= moveY * dt;
        }
      }
    }
    if (speedNow > 8) {
      u.gaitPhase += speedNow * dt * 0.14;
      if (!isDirect || !spec.isAir) {
        const targetBodyAngle = Math.atan2(moveY, moveX);
        let diff = targetBodyAngle - u.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        u.angle += diff * Math.min(1, dt * 8);
      }
    }

    const minX = spec.isAir ? 100 : world.coastlineX + u.radius + 6;
    u.x = Math.max(minX, Math.min(world.width - u.radius - 10, u.x));
    u.y = Math.max(u.radius + 10, Math.min(world.height - u.radius - 10, u.y));

    if (!spec.isAir) {
      const bPushed = pushOutOfBuildings(u.x, u.y, u.radius, world.buildings);
      const bunkerPushed = pushOutOfBunker(bPushed.x, bPushed.y, u.radius, world.structures);
      const wPushed = pushOutOfWalls(bunkerPushed.x, bunkerPushed.y, u.radius, world.structures, false);
      const waterPushed = pushOutOfWater(
        wPushed.x,
        wPushed.y,
        u.radius,
        world.waterChannels,
        world.bridges,
      );
      u.x = waterPushed.x;
      u.y = waterPushed.y;

      if ((u.kind === 'tank' || u.kind === 'ifv') && speedNow > 30) {
        zombieGrid.queryRadius(u.x, u.y, u.radius + 16, (zIdx) => {
          const z = world.zombies[zIdx];
          if (!z || z.hp <= 0 || z.koTimer > 0 || z.kind === 'brute') return;
          if (Math.hypot(z.x - u.x, z.y - u.y) <= u.radius + z.radius) {
            damageZombie(world, z, 999, (z.x - u.x) * 0.5, (z.y - u.y) * 0.5, u, 'crush');
          }
        });
      }
    }
  }

  // 3. Update Structures (Blast Gates + Twin-MG Turret + 40mm Flak + Hydra Rocket Pod)
  for (let i = world.structures.length - 1; i >= 0; i--) {
    const s = world.structures[i];
    if (s.hp <= 0) {
      triggerSplashExplosion(world, s.x, s.y, 65, 45, false);
      world.structures.splice(i, 1);
      continue;
    }
    s.hitFlash = Math.max(0, s.hitFlash - dt);
    s.recoil = Math.max(0, s.recoil - dt * 22);

    // Armored Blast Gate auto-opens for nearby friendly ground units while blocking zombies
    if (s.kind === 'gate') {
      let friendlyNear = false;
      for (const u of world.units) {
        // Newly purchased ground units leave the FOB with an active exit order.
        // Keep the gate open for the whole queued passage, then close it after the last unit clears.
        if (
          u.hp > 0 && u.koTimer <= 0 && !UNIT_SPECS[u.kind].isAir &&
          Math.hypot(u.x - s.x, u.y - s.y) <= 132
        ) {
          friendlyNear = true;
          break;
        }
      }
      const cur = s.gateOpen ?? 0;
      const target = friendlyNear ? 1 : 0;
      const next = cur + (target - cur) * Math.min(1, dt * 8);
      if (cur < 0.9 && next >= 0.9) world.events.push({ type: 'gate_open', intensity: 0.8 });
      if (cur > 0.1 && next <= 0.1) world.events.push({ type: 'gate_close', intensity: 0.65 });
      s.gateOpen = next;
      continue;
    }

    // Demolition charge: arms after 1.2s, then blows when 3+ zombies are close. Wrecks nearby buildings.
    if (s.kind === 'charge') {
      s.fireCooldown = Math.max(0, s.fireCooldown - dt);
      if (s.fireCooldown > 0) continue;
      let near = 0;
      zombieGrid.queryRadius(s.x, s.y, 95, (idx) => {
        const z = world.zombies[idx];
        if (z && z.koTimer <= 0 && z.hp > 0 && Math.hypot(z.x - s.x, z.y - s.y) <= 95) near += 1;
      });
      if (near >= 3) {
        world.structures.splice(i, 1);
        triggerSplashExplosion(world, s.x, s.y, 150, 320, true);
        setAlert(world, 'DEMOLITION CHARGE DETONATED', 2);
      }
      continue;
    }

    if (s.kind === 'turret' || s.kind === 'autocannon' || s.kind === 'rocket_turret') {
      const tSpec = STRUCTURE_SPECS[s.kind];
      s.fireCooldown = Math.max(0, s.fireCooldown - dt);
      if (isNearSupplyOrFob(world, s.x, s.y) && s.ammo < s.maxAmmo) {
        s.ammo = Math.min(s.maxAmmo, s.ammo + 18 * dt);
      }
      if (s.ammo > 0 && s.fireCooldown <= 0) {
        let bestZ: Zombie | null = null;
        let bestD: number = tSpec.range;
        zombieGrid.queryRadius(s.x, s.y, tSpec.range, (zIdx) => {
          const z = world.zombies[zIdx];
          if (!z || z.hp <= 0 || z.koTimer > 0) return;
          const d = Math.hypot(z.x - s.x, z.y - s.y);
          if (d < bestD && (s.kind === 'rocket_turret' || hasLineOfSight(s.x, s.y, z.x, z.y, world.buildings))) {
            bestD = d;
            bestZ = z;
          }
        });
        if (bestZ) {
          const tz = bestZ as Zombie;
          const ang = Math.atan2(tz.y - s.y, tz.x - s.x);
          s.angle = ang;
          s.ammo -= 1;
          s.fireCooldown = 1 / tSpec.fireRate;
          s.recoil = s.kind === 'turret' ? 2.5 : 6.5;
          const mx = s.x + Math.cos(ang) * 20;
          const my = s.y + Math.sin(ang) * 20;
          spawnParticle(
            world,
            mx,
            my,
            Math.cos(ang) * 60,
            Math.sin(ang) * 60,
            s.kind === 'turret' ? 3 : 5,
            0.1,
            '#fef08a',
            'spark',
          );
          const pSpeed = s.kind === 'rocket_turret' ? 620 : s.kind === 'autocannon' ? 760 : 880;
          const pKind: Projectile['kind'] =
            s.kind === 'rocket_turret'
              ? 'rocket'
              : s.kind === 'autocannon'
                ? 'shell'
                : 'heavy_bullet';
          const projectileLife = tSpec.range / pSpeed + 0.08;
          spawnProjectile(world, true, mx, my, mx, my, Math.cos(ang) * pSpeed, Math.sin(ang) * pSpeed, projectileLife, tSpec.damage, tSpec.splashRadius, pKind);
          world.events.push({
            type: s.kind === 'rocket_turret' ? 'rocket' : s.kind === 'autocannon' ? 'cannon' : 'heavy_gun',
            intensity: s.kind === 'turret' ? 0.25 : 0.6,
          });
        }
      }
    }
  }

  // 4. Update Zombies (Smart flank steering + Spitter acid projectiles + Riot armor)
  // Civilians: rescue by touching them with a ground unit (or Blackhawk/Chinook), escort to the bunker
  {
    const bunker = world.structures.find((b) => b.kind === 'fob' && b.hp > 0);
    for (let ci = world.civilians.length - 1; ci >= 0; ci--) {
      const c = world.civilians[ci];
      if (c.state === 'waiting') {
        for (const u of world.units) {
          if (u.hp <= 0 || u.koTimer > 0) continue;
          const sp = UNIT_SPECS[u.kind];
          if (sp.isAir && u.kind !== 'blackhawk' && u.kind !== 'chinook') continue;
          if (Math.hypot(u.x - c.x, u.y - c.y) <= 48) {
            c.state = 'following';
            break;
          }
        }
      } else if (c.state === 'following' && bunker) {
        const dx = bunker.x - c.x;
        const dy = bunker.y - c.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= 70) {
          if (world.bunkerSaved < world.bunkerCap) {
            world.bunkerSaved++;
            addCoins(world, 20);
            setAlert(world, `CIVILIAN SAVED ${world.bunkerSaved}/${world.bunkerCap} · +20 COINS`, 1.6);
            world.civilians.splice(ci, 1);
            continue;
          }
          c.state = 'refuge';
          setAlert(world, 'BUNKER FULL — CIVILIANS WAIT OUTSIDE', 1.8);
        } else {
          c.x += (dx / dist) * 80 * dt;
          c.y += (dy / dist) * 80 * dt;
        }
      }
      // zombies kill civilians that are caught outside
      const nearbyCount = zombieGrid.queryRadiusInto(c.x, c.y, 26, nearbyZombieIndices, 32);
      for (let nearIndex = 0; nearIndex < nearbyCount; nearIndex++) {
        const z = world.zombies[nearbyZombieIndices[nearIndex]];
        if (!z || z.hp <= 0 || z.koTimer > 0) continue;
        const ddx = z.x - c.x; const ddy = z.y - c.y;
        if (ddx * ddx + ddy * ddy < 26 * 26) { c.hp -= 30 * dt; if (c.hp <= 0) break; }
      }
      if (c.hp <= 0) {
        world.civiliansLost++;
        setAlert(world, 'CIVILIAN LOST', 1.4);
        world.civilians.splice(ci, 1);
      }
    }
  }

  // Fences: slow / damage zombies that touch them (ticks 4x per second)
  for (let zi = 0; zi < world.zombies.length; zi++) {
    const zz = world.zombies[zi];
    if (zz.slowTimer && zz.slowTimer > 0) zz.slowTimer -= dt;
  }
  for (const f of world.structures) {
    if (f.hp <= 0 || (f.kind !== 'wire' && f.kind !== 'oil' && f.kind !== 'laser' && f.kind !== 'electric')) continue;
    if (f.kind === 'oil' && oilIsBurning(world, f)) {
      igniteOilSlick(world, f);
      continue;
    }
    const fx = FENCE_FX[f.kind];
    f.fireCooldown -= dt;
    const tick = f.fireCooldown <= 0;
    if (tick) f.fireCooldown = 0.25;
    const cs = Math.cos(-f.angle);
    const sn = Math.sin(-f.angle);
    let touched = false;
    const fenceRadius = Math.max(f.w, f.h) * 0.75 + 48;
    const fenceCount = zombieGrid.queryRadiusInto(f.x, f.y, fenceRadius, nearbyZombieIndices, nearbyZombieIndices.length);
    for (let nearIndex = 0; nearIndex < fenceCount; nearIndex++) {
      const z = world.zombies[nearbyZombieIndices[nearIndex]];
      if (!z || z.hp <= 0 || z.koTimer > 0) continue;
      const dx = z.x - f.x; const dy = z.y - f.y;
      if (dx * dx + dy * dy > 12000) continue;
      const lx = dx * cs - dy * sn; const ly = dx * sn + dy * cs;
      if (Math.abs(lx) > f.w * 0.5 + z.radius || Math.abs(ly) > f.h * 0.5 + z.radius + 4) continue;
      touched = true;
      if (fx.slow) z.slowTimer = 0.35;
      if (tick) {
        damageZombie(world, z, fx.dps * 0.25, 0, 0, undefined, 'crush');
        spawnParticle(world, z.x, z.y, (Math.random() - 0.5) * 90, (Math.random() - 0.5) * 90, 3, 0.22, fx.color, 'spark');
      }
    }
    if (tick && touched) f.hp -= fx.wear;
  }

  for (let i = world.zombies.length - 1; i >= 0; i--) {
    const z = world.zombies[i];
    if (z.koTimer > 0) {
      z.koTimer -= dt;
      z.x += z.vx * dt;
      z.y += z.vy * dt;
      z.vx *= 0.88;
      z.vy *= 0.88;
      if (z.koTimer <= 0) {
        world.zombies.splice(i, 1);
      }
      continue;
    }

    z.hitFlash = Math.max(0, z.hitFlash - dt);
    z.attackCooldown = Math.max(0, z.attackCooldown - dt);

    const cachedUnit = z.targetUnitRef ?? null;
    const cachedStructure = z.targetStructureRef ?? null;
    // Target-acquisition LOD: nearby zombies refresh frequently; distant hordes
    // refresh less often. Movement, attacks, damage and visibility are NOT skipped.
    // This bounds expensive target searches without making distant zombies disappear.
    const cameraDx = z.x - world.camera.targetX;
    const cameraDy = z.y - world.camera.targetY;
    const cameraDistSq = cameraDx * cameraDx + cameraDy * cameraDy;
    const targetRefreshMask = cameraDistSq < 900 * 900 ? 1 : cameraDistSq < 2200 * 2200 ? 3 : 7;
    const refreshTarget = !z.targetCacheReady || ((world.simulationTick + i) & targetRefreshMask) === 0 ||
      (cachedUnit !== null && (cachedUnit.hp <= 0 || cachedUnit.koTimer > 0)) ||
      (cachedStructure !== null && cachedStructure.hp <= 0);
    let targetUnit: PlayerUnit | null = cachedUnit;
    let targetStruct: Structure | null = cachedStructure;
    if (refreshTarget) {
      targetUnit = null;
      targetStruct = null;
      let bestScore = Infinity;
      const isAirCapable = z.kind === 'leaper' || z.kind === 'spitter';
      // Query only nearby living units instead of scanning the entire army for
      // every zombie. The unit spatial grid is rebuilt once per simulation tick.
      // A generous search radius preserves target priority while bounding work.
      playerUnitGrid.queryRadius(z.x, z.y, 2600, (uIdx) => {
        const u = world.units[uIdx];
        if (!u || u.hp <= 0 || u.koTimer > 0) return;
        const isAir = UNIT_SPECS[u.kind].isAir;
        if (isAir && !isAirCapable) return;
        const udx = u.x - z.x; const udy = u.y - z.y;
        const priorityBias = isAir ? 150 : 0;
        const cap = bestScore - priorityBias;
        if (cap > 0 && (Math.abs(udx) > cap || Math.abs(udy) > cap)) return;
        const d = Math.sqrt(udx * udx + udy * udy);
        if (d + priorityBias < bestScore) { bestScore = d + priorityBias; targetUnit = u; targetStruct = null; }
      });
      const isBrute = z.kind === 'brute' || z.kind === 'tank';
      for (let sIdx = 0; sIdx < world.structures.length; sIdx++) {
        const structure = world.structures[sIdx];
        if (structure.hp <= 0) continue;
        const bias = isBrute ? -80 : structure.kind === 'wall' || structure.kind === 'gate' ? 95 : 40;
        const cap = bestScore - bias;
        const sdx = structure.x - z.x; const sdy = structure.y - z.y;
        if (cap > 0 && (Math.abs(sdx) > cap || Math.abs(sdy) > cap)) continue;
        const d = Math.sqrt(sdx * sdx + sdy * sdy);
        if (d + bias < bestScore) { bestScore = d + bias; targetStruct = structure; targetUnit = null; }
      }
      z.targetUnitRef = targetUnit;
      z.targetStructureRef = targetStruct;
      z.targetCacheReady = true;
    }

    const tx = targetUnit ? targetUnit.x : targetStruct ? targetStruct.x : world.fobPos.x;
    const ty = targetUnit ? targetUnit.y : targetStruct ? targetStruct.y : world.fobPos.y;
    const dx = tx - z.x;
    const dy = ty - z.y;
    const dist = Math.hypot(dx, dy);

    if (z.telegraphTimer > 0) {
      z.telegraphTimer -= dt;
      if (z.telegraphTimer <= 0) {
        if (z.telegraphKind === 'leap' && dist > 0.1) {
          z.leapTimer = 0.28;
          z.vx = (dx / dist) * 340;
          z.vy = (dy / dist) * 340;
          world.events.push({ type: 'zombie_screech', intensity: 0.65 });
        } else if (z.telegraphKind === 'spit' && dist > 0.1) {
          const spitAngle = Math.atan2(dy, dx);
          const spitSpeed = 420;
          spawnProjectile(world, false, z.x + Math.cos(spitAngle) * (z.radius + 4), z.y + Math.sin(spitAngle) * (z.radius + 4), z.x, z.y, Math.cos(spitAngle) * spitSpeed, Math.sin(spitAngle) * spitSpeed, 0.72, z.damage, 0, 'acid');
          world.events.push({ type: 'spitter_acid', intensity: 0.7 });
          z.attackCooldown = ZOMBIE_SPECS.spitter.attackRate;
        } else if (z.telegraphKind === 'slam' && z.kind === 'exploder') {
          spawnParticle(world, z.x, z.y, 0, 0, 118, 0.48, '#fb923c', 'ring');
          world.events.push({ type: 'brute_roar', intensity: 0.7 });
          for (const u of world.units) {
            if (u.hp > 0 && u.koTimer <= 0 && !UNIT_SPECS[u.kind].isAir) {
              const d = Math.hypot(u.x - z.x, u.y - z.y);
              if (d <= 118) { u.hp -= z.damage * (1 - d / 150); u.hitFlash = 0.16; }
            }
          }
          for (const st of world.structures) {
            const d = Math.hypot(st.x - z.x, st.y - z.y);
            if (st.hp > 0 && d <= 125) { st.hp -= z.damage * 1.2; st.hitFlash = 0.16; }
          }
          z.hp = 0;
          z.koTimer = 0.28;
          z.vx = 0;
          z.vy = 0;
        } else if (z.telegraphKind === 'slam' && z.kind === 'screamer') {
          spawnParticle(world, z.x, z.y, 0, 0, 165, 0.55, '#c084fc', 'ring');
          world.events.push({ type: 'zombie_screech', intensity: 1.0 });
          for (const u of world.units) {
            if (u.hp > 0 && u.koTimer <= 0 && Math.hypot(u.x - z.x, u.y - z.y) <= 165) {
              u.hitFlash = 0.12;
              u.fireCooldown = Math.max(u.fireCooldown, 0.35);
            }
          }
          z.attackCooldown = ZOMBIE_SPECS.screamer.attackRate;
        } else if (z.telegraphKind === 'slam') {
          spawnParticle(world, z.x, z.y, 0, 0, z.kind === 'tank' ? 104 : 70, 0.35, '#ef4444', 'ring');
          addTrauma(world, 0.07);
          world.events.push({ type: 'brute_roar', intensity: 0.85 });
          for (const u of world.units) {
            if (u.hp > 0 && u.koTimer <= 0 && !UNIT_SPECS[u.kind].isAir) {
              if (Math.hypot(u.x - z.x, u.y - z.y) <= (z.kind === 'tank' ? 112 : 78)) {
                u.hp -= z.damage;
                u.hitFlash = 0.12;
              }
            }
          }
          for (const s of world.structures) {
            if (s.hp > 0 && Math.hypot(s.x - z.x, s.y - z.y) <= (z.kind === 'tank' ? 118 : 84)) {
              s.hp -= z.damage * 1.45;
              s.hitFlash = 0.12;
            }
          }
          z.attackCooldown = 1.6;
        }
        z.telegraphKind = null;
      }
      continue;
    }

    if (z.leapTimer > 0) {
      z.leapTimer -= dt;
      z.x += z.vx * dt;
      z.y += z.vy * dt;
      const bPushed = pushOutOfBuildings(z.x, z.y, z.radius, world.buildings);
      z.x = bPushed.x;
      z.y = bPushed.y;
      if (targetUnit && Math.hypot(targetUnit.x - z.x, targetUnit.y - z.y) <= z.radius + targetUnit.radius + 8) {
        targetUnit.hp -= z.damage;
        targetUnit.hitFlash = 0.12;
        z.leapTimer = 0;
        z.attackCooldown = 1.0;
      }
      continue;
    }

    // Spitter standoff attack if in range & line of sight
    if (z.kind === 'spitter' && z.attackCooldown <= 0 && dist <= 265 && dist >= 75) {
      if (hasLineOfSight(z.x, z.y, tx, ty, world.buildings)) {
        z.angle = Math.atan2(dy, dx);
        z.telegraphKind = 'spit';
        z.telegraphTimer = 0.28;
        continue;
      }
    }

    let speedMult = 1;
    let flankX = 0;
    let flankY = 0;
    if ((z.kind === 'sprinter' || z.kind === 'mutated') && dist < 420) {
      speedMult = z.kind === 'mutated' ? 1.18 : 1.32;
      const perpX = -dy / Math.max(1, dist);
      const perpY = dx / Math.max(1, dist);
      const zig = Math.sin(world.elapsedSec * 5 + z.id) * 0.42;
      flankX = perpX * zig;
      flankY = perpY * zig;
    } else if (z.kind === 'spitter' && dist < 120) {
      // Back up slightly to keep standoff acid distance
      speedMult = -0.45;
    }

    let sepX = 0;
    let sepY = 0;
    // Separation is only useful where the player can see the horde. Stagger it
    // across three ticks and use a bounded scratch buffer (no callback/closure).
    const zoomForSeparation = Math.max(0.25, world.camera.zoom);
    const nearCamera = Math.abs(z.x - world.camera.x) < (viewportWidth * 0.5) / zoomForSeparation + 180 &&
      Math.abs(z.y - world.camera.y) < (viewportHeight * 0.5) / zoomForSeparation + 180;
    if (nearCamera && ((world.simulationTick + i) % 3 === 0)) {
      const candidateCount = zombieGrid.queryRadiusInto(z.x, z.y, z.radius * 2.5, separationNeighbors, 24);
      let neighbors = 0;
      for (let n = 0; n < candidateCount && neighbors < 5; n++) {
        const nIdx = separationNeighbors[n];
        if (nIdx === i) continue;
        const other = world.zombies[nIdx];
        if (!other || other.koTimer > 0) continue;
        const ndx = z.x - other.x; const ndy = z.y - other.y;
        const minD = z.radius + other.radius + 1;
        const ndSq = ndx * ndx + ndy * ndy;
        if (ndSq > 0.0001 && ndSq < minD * minD) {
          const nd = Math.sqrt(ndSq); const force = (minD - nd) / minD;
          sepX += (ndx / nd) * force; sepY += (ndy / nd) * force; neighbors++;
        }
      }
    }


    const dirX = dist > 0.1 ? dx / dist + flankX : 0;
    const dirY = dist > 0.1 ? dy / dist + flankY : 0;
    const dLen = Math.hypot(dirX, dirY) || 1;
    if (z.kind === 'crawler' && dist < 95) speedMult = 1.25;
    if (z.kind === 'infected_marine' && dist < 260) speedMult = 1.08;
    const moveVx = (dirX / dLen) * z.speed * speedMult * (z.slowTimer && z.slowTimer > 0 ? 0.4 : 1) + sepX * 95;
    const moveVy = (dirY / dLen) * z.speed * speedMult * (z.slowTimer && z.slowTimer > 0 ? 0.4 : 1) + sepY * 95;

    z.vx = moveVx;
    z.vy = moveVy;
    z.x += moveVx * dt;
    z.y += moveVy * dt;
    z.gaitPhase += Math.hypot(moveVx, moveVy) * dt * 0.2;
    z.angle = Math.atan2(dy, dx);

    const prevX = z.x;
    const prevY = z.y;
    const bPush = pushOutOfBuildings(z.x, z.y, z.radius, world.buildings);
    if (Math.abs(bPush.x - prevX) > 0.2 || Math.abs(bPush.y - prevY) > 0.2) {
      const tangentX = -(bPush.y - prevY);
      const tangentY = bPush.x - prevX;
      const sign = tangentX * dx + tangentY * dy >= 0 ? 1 : -1;
      z.x = bPush.x + tangentX * sign * 0.55;
      z.y = bPush.y + tangentY * sign * 0.55;
    } else {
      z.x = bPush.x;
      z.y = bPush.y;
    }

    const waterPush = pushOutOfWater(z.x, z.y, z.radius, world.waterChannels, world.bridges);
    z.x = waterPush.x;
    z.y = waterPush.y;

    const preWallX = z.x;
    const preWallY = z.y;
    const bunkerPush = pushOutOfBunker(z.x, z.y, z.radius, world.structures);
    z.x = bunkerPush.x;
    z.y = bunkerPush.y;
    const wPush = pushOutOfWalls(z.x, z.y, z.radius, world.structures, true);
    const hitWall = Math.abs(wPush.x - preWallX) > 0.1 || Math.abs(wPush.y - preWallY) > 0.1;
    if (hitWall) {
      // Smart zombies try to slide around barricades/gates using persistent flankDir while pressing attack
      const wallNormX = wPush.x - preWallX;
      const wallNormY = wPush.y - preWallY;
      const nLen = Math.hypot(wallNormX, wallNormY) || 1;
      const txSlide = (-wallNormY / nLen) * z.flankDir * z.speed * 0.45 * dt;
      const tySlide = (wallNormX / nLen) * z.flankDir * z.speed * 0.45 * dt;
      z.x = wPush.x + txSlide;
      z.y = wPush.y + tySlide;
    } else {
      z.x = wPush.x;
      z.y = wPush.y;
    }

    z.x = Math.max(world.coastlineX + z.radius + 4, Math.min(world.width - z.radius - 4, z.x));
    z.y = Math.max(z.radius + 4, Math.min(world.height - z.radius - 4, z.y));

    if (z.kind === 'leaper' && z.attackCooldown <= 0 && (hitWall || (dist < 135 && dist > 42))) {
      z.telegraphKind = 'leap';
      z.telegraphTimer = 0.36;
      continue;
    }

    if (z.kind === 'exploder' && z.attackCooldown <= 0 && dist <= 112) {
      z.telegraphKind = 'slam';
      z.telegraphTimer = 0.62;
      continue;
    }

    if (z.kind === 'screamer' && z.attackCooldown <= 0 && dist <= 190) {
      z.telegraphKind = 'slam';
      z.telegraphTimer = 0.72;
      continue;
    }

    if ((z.kind === 'brute' || z.kind === 'tank') && z.attackCooldown <= 0 && dist <= (z.kind === 'tank' ? 72 : 56)) {
      z.telegraphKind = 'slam';
      z.telegraphTimer = z.kind === 'tank' ? 0.68 : 0.52;
      continue;
    }

    if (z.attackCooldown <= 0) {
      if (targetUnit && dist <= z.radius + targetUnit.radius + 10) {
        targetUnit.hp -= z.damage;
        targetUnit.hitFlash = 0.1;
        z.attackCooldown = ZOMBIE_SPECS[z.kind].attackRate;
      } else if (
        targetStruct &&
        (hitWall || dist <= z.radius + Math.max(targetStruct.w, targetStruct.h) * 0.55 + 8)
      ) {
        targetStruct.hp -= z.damage;
        targetStruct.hitFlash = 0.1;
        z.attackCooldown = ZOMBIE_SPECS[z.kind].attackRate;
      }
    }
  }

  for (const u of world.units) {
    if (u.hp <= 0 && u.koTimer <= 0) {
      u.hp = 0;
      u.koTimer = 0.45;
      // Fallen infantry can reanimate as an infected marine after the loss event.
      // Vehicles and aircraft never convert. Keep the effect non-graphic.
      if (!UNIT_SPECS[u.kind].isVehicle && !UNIT_SPECS[u.kind].isAir && u.kind !== 'truck') {
        spawnZombie(world, 'infected_marine', u.x + 8, u.y - 6);
        setAlert(world, 'INFECTED MARINE DETECTED', 2.4);
      }
      world.unitsLost += 1;
      if (world.directControlUnitId === u.id) {
        world.directControlUnitId = null;
      }
      triggerSplashExplosion(world, u.x, u.y, u.kind === 'tank' || u.kind === 'ifv' ? 68 : 42, 35, u.kind === 'tank');
      world.events.push({ type: 'unit_lost', intensity: 1 });
      world.events.push({ type: 'voice_alert', intensity: 0.9 });
      setAlert(world, `${UNIT_SPECS[u.kind].shortName.toUpperCase()} LOST IN ACTION`, 2.4);
    }
  }

  // 5. Update Projectiles (Player ordnance + Zombie Spitter Acid)
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    if (!p.active) continue;
    p.prevX = p.x;
    p.prevY = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;

    let hit = false;
    if (p.kind !== 'rocket' && p.kind !== 'artillery') {
      for (const b of world.buildings) {
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
          hit = true;
          spawnParticle(
            world,
            p.x,
            p.y,
            -p.vx * 0.08,
            -p.vy * 0.08,
            2.5,
            0.2,
            p.kind === 'acid' ? '#4ade80' : '#cbd5e1',
            'spark',
          );
          break;
        }
      }
    }

    if (!hit) {
      if (p.fromPlayer) {
        zombieGrid.queryRadius(p.x, p.y, 26, (zIdx) => {
          if (hit) return;
          const z = world.zombies[zIdx];
          if (!z || z.hp <= 0 || z.koTimer > 0) return;
          if (Math.hypot(z.x - p.x, z.y - p.y) <= z.radius + 6) {
            hit = true;
            if (p.splashRadius > 0) {
              triggerSplashExplosion(world, p.x, p.y, p.splashRadius, p.damage, p.kind === 'shell');
            } else {
              const pLen = Math.hypot(p.vx, p.vy) || 1;
              damageZombie(
                world,
                z,
                p.damage,
                (p.vx / pLen) * 5,
                (p.vy / pLen) * 5,
                undefined,
                p.kind,
              );
            }
          }
        });
      } else {
        // Enemy acid projectile hits player ground units or structures
        for (const u of world.units) {
          if (u.hp <= 0 || u.koTimer > 0 || UNIT_SPECS[u.kind].isAir) continue;
          if (Math.hypot(u.x - p.x, u.y - p.y) <= u.radius + 6) {
            hit = true;
            u.hp -= p.damage;
            u.hitFlash = 0.14;
            spawnParticle(world, p.x, p.y, 0, 0, 12, 0.28, '#4ade80', 'ring');
            break;
          }
        }
        if (!hit) {
          for (const s of world.structures) {
            if (s.hp <= 0) continue;
            if (Math.hypot(s.x - p.x, s.y - p.y) <= Math.max(s.w, s.h) * 0.45) {
              hit = true;
              s.hp -= p.damage;
              s.hitFlash = 0.12;
              spawnParticle(world, p.x, p.y, 0, 0, 10, 0.25, '#4ade80', 'ring');
              break;
            }
          }
        }
      }
    }

    if (hit || p.life <= 0) {
      if (!hit && p.fromPlayer && p.splashRadius > 0 && (p.kind === 'shell' || p.kind === 'rocket')) {
        triggerSplashExplosion(world, p.x, p.y, p.splashRadius, p.damage, p.kind === 'shell');
      }
      p.active = false;
    }
  }

  // 6. Update Pending Strikes (including Offshore Battleship/Destroyer turret broadside)
  for (let i = world.pendingStrikes.length - 1; i >= 0; i--) {
    const st = world.pendingStrikes[i];
    if (st.timer > 0) {
      st.timer -= dt;
      continue;
    }

    if (st.kind === 'reinforce') {
      const squad: PlayerUnitKind[] = ['squad', 'squad', 'heavy', 'sniper'];
      squad.forEach((k, idx) => {
        const a = (idx / squad.length) * Math.PI * 2 + Math.random() * 0.5;
        createPlayerUnit(world, k, st.x + Math.cos(a) * 34, st.y + Math.sin(a) * 34); // adds itself to world.units
      });
      spawnParticle(world, st.x, st.y, 0, 0, 70, 0.5, '#4ade80', 'ring');
      world.events.push({ type: 'supply', intensity: 1 });
      setAlert(world, 'REINFORCEMENTS ON THE GROUND', 2.5);
      world.pendingStrikes.splice(i, 1);
      continue;
    }

    if (st.kind === 'supplydrop') {
      world.supplyCrates.push({
        id: world.nextId++,
        x: st.x,
        y: st.y,
        ammoAmount: 120,
        healAmount: 160,
        life: 60,
      });
      spawnParticle(world, st.x, st.y, 0, 0, 56, 0.4, '#38bdf8', 'ring');
      world.events.push({ type: 'supply', intensity: 0.9 });
      world.pendingStrikes.splice(i, 1);
      continue;
    }

    st.subTimer -= dt;
    if (st.subTimer <= 0 && st.shellsRemaining > 0) {
      st.shellsRemaining -= 1;
      if (st.kind === 'barrage') {
        st.subTimer = 0.22;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 145;
        const ix = st.x + Math.cos(a) * r;
        const iy = st.y + Math.sin(a) * r;
        for (const ship of world.navalFleet) {
          ship.turretAngle = Math.atan2(iy - ship.y, ix - ship.x);
          ship.recoil = ship.kind === 'battleship' ? 8 : 5;
          ship.muzzleFlash = 0.28;
        }
        triggerSplashExplosion(world, ix, iy, 132, 255, true);
      } else if (st.kind === 'airstrike') {
        st.subTimer = 0.08;
        const progress = 1 - st.shellsRemaining / 16 - 0.5;
        const sx = st.x + Math.cos(st.angle) * progress * 300 + (Math.random() - 0.5) * 32;
        const sy = st.y + Math.sin(st.angle) * progress * 300 + (Math.random() - 0.5) * 32;
        triggerSplashExplosion(world, sx, sy, 88, 138, false);
        if (st.shellsRemaining === 15) {
          world.events.push({ type: 'airstrike', intensity: 1 });
        }
      }
    }

    if (st.shellsRemaining <= 0) {
      world.pendingStrikes.splice(i, 1);
    }
  }

  // 7. Update Sectors
  for (const sec of world.sectors) {
    let friendlyPower = 0;
    let zombiePower = 0;

    for (const u of world.units) {
      if (u.hp <= 0 || u.koTimer > 0) continue;
      if (Math.hypot(u.x - sec.x, u.y - sec.y) <= sec.radius) {
        friendlyPower +=
          u.kind === 'squad'
            ? 2.4
            : u.kind === 'heavy' || u.kind === 'rpg' || u.kind === 'medic' || u.kind === 'sniper'
              ? 1.8
              : u.kind === 'tank' || u.kind === 'ifv' || u.kind === 'howitzer'
                ? 1.5
                : 0.9;
      }
    }
    if (sec.fobBuilt) friendlyPower += 1.0;

    zombieGrid.queryRadius(sec.x, sec.y, sec.radius, (zIdx) => {
      const z = world.zombies[zIdx];
      if (!z || z.hp <= 0 || z.koTimer > 0) return;
      if (Math.hypot(z.x - sec.x, z.y - sec.y) <= sec.radius) {
        zombiePower += z.kind === 'brute' ? 2.4 : z.kind === 'riot_zombie' ? 0.9 : 0.45;
      }
    });

    if (friendlyPower > zombiePower) {
      sec.captureProgress = Math.min(100, sec.captureProgress + (friendlyPower - zombiePower) * 10 * dt);
      if (sec.captureProgress >= 100 && sec.owner !== 'player') {
        sec.owner = 'player';
        addCoins(world, 120);
        if (!sec.fobBuilt) {
          sec.fobBuilt = true;
          world.structures.push({
            id: world.nextId++,
            kind: 'fob',
            x: sec.x,
            y: sec.y,
            w: 54,
            h: 54,
            angle: 0,
            hp: 1100,
            maxHp: 1100,
            ammo: 999,
            maxAmmo: 999,
            fireCooldown: 0,
            recoil: 0,
            hitFlash: 0,
            sectorId: sec.id,
          });
        }
        world.events.push({ type: 'sector_captured', intensity: 1 });
        world.events.push({ type: 'voice_order', intensity: 0.9 });
        setAlert(world, `${sec.code} ${sec.name.toUpperCase()} SECURED · +120 COINS · EVAC ACTIVE`, 3.6);
      }
    } else if (zombiePower > friendlyPower + 1.5 && sec.owner !== 'player') {
      sec.captureProgress = Math.max(0, sec.captureProgress - 6 * dt);
      if (sec.captureProgress <= 0) sec.owner = 'infected';
    }

    if (sec.owner === 'player' && sec.civiliansEvacuated < sec.civiliansTotal) {
      const fobAlive = world.structures.some((s) => s.sectorId === sec.id && s.hp > 0);
      if (fobAlive || friendlyPower > 0) {
        const evacRate = friendlyPower > zombiePower ? 7.5 : 3.2;
        sec.civiliansEvacuated = Math.min(
          sec.civiliansTotal,
          sec.civiliansEvacuated + evacRate * dt,
        );
      }
    }
  }

  const allSectorsSecured = world.sectors.every(
    (s) => s.owner === 'player' && s.civiliansEvacuated >= s.civiliansTotal,
  );
  const mission = getCampaignMission(world.campaignMissionId);
  const missionSectors = world.sectors.filter((sector) => sector.owner === 'player').length;
  const missionRescued = world.sectors.reduce((n, sec) => n + sec.civiliansEvacuated, 0);
  const missionComplete = mission !== null && world.kills >= mission.killTarget && missionSectors >= mission.sectorTarget && missionRescued >= mission.rescueTarget;
  if ((!world.endlessMode && allSectorsSecured) || missionComplete) {
    if (missionComplete && mission) {
      addCoins(world, mission.reward);
      setAlert(world, `MISSION COMPLETE · +${mission.reward} COINS`, 4);
    }
    world.phase = 'gameover';
    world.outcome = 'victory';
    world.events.push({ type: 'victory', intensity: 1 });
    return;
  }

  const activeUnitsCount = world.units.filter((u) => u.hp > 0 && u.koTimer <= 0).length;
  const activeFobsCount = world.structures.filter((s) => s.kind === 'fob' && s.hp > 0).length;

  if (activeUnitsCount === 0 && activeFobsCount === 0) {
    world.defeatDelayTimer += dt;
    if (world.defeatDelayTimer >= 0.55) {
      world.carrierIntegrity = 0;
      world.phase = 'gameover';
      world.outcome = 'defeat';
      world.events.push({ type: 'defeat', intensity: 1 });
      return;
    }
  } else {
    world.defeatDelayTimer = 0;
  }

  updateCameraAndParticles(world, dt, viewportWidth, viewportHeight);
}

function updateCameraAndParticles(
  world: GameWorld,
  dt: number,
  _viewportWidth = 1440,
  _viewportHeight = 900,
): void {
  const damp = 1 - Math.exp(-10 * dt);
  world.camera.x += (world.camera.targetX - world.camera.x) * damp;
  world.camera.y += (world.camera.targetY - world.camera.y) * damp;
  world.camera.zoom += (world.camera.targetZoom - world.camera.zoom) * damp;

  if (world.lowLagMode) {
    world.camera.trauma = 0;
    world.camera.shakeX = 0;
    world.camera.shakeY = 0;
  } else if (world.camera.trauma > 0) {
    world.camera.trauma = Math.max(0, world.camera.trauma - dt * 3.2);
    const shake = world.camera.trauma * world.camera.trauma * 4.5;
    world.camera.shakeX = (Math.random() * 2 - 1) * shake;
    world.camera.shakeY = (Math.random() * 2 - 1) * shake;
  } else {
    world.camera.shakeX = 0;
    world.camera.shakeY = 0;
  }

  updateFires(world, dt);
  updateNests(world, dt);
  updateTide(world);
  for (const b of world.buildings) if (b.damageFlash && b.damageFlash > 0) b.damageFlash = Math.max(0, b.damageFlash - dt);

  // Scorch marks / craters: fade out and get removed (fixes lingering black circles)
  for (let i = world.craters.length - 1; i >= 0; i--) {
    world.craters[i].life -= dt;
    if (world.craters[i].life <= 0) world.craters.splice(i, 1);
  }
  // Blood decals: slow fade so the ground never stays covered
  for (let i = 0; i < world.bloodDecals.length; i++) {
    const b = world.bloodDecals[i];
    if (b.alpha > 0) b.alpha = Math.max(0, b.alpha - dt * 0.03);
  }

  for (let i = 0; i < world.particles.length; i++) {
    const p = world.particles[i];
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
  }
}

export function screenToWorld(
  world: GameWorld,
  screenX: number,
  screenY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  const z = world.camera.zoom;
  return {
    x: (screenX - canvasWidth * 0.5) / z + world.camera.x,
    y: (screenY - canvasHeight * 0.5) / z + world.camera.y,
  };
}

export function buildHudSnapshot(world: GameWorld): HudSnapshot {
  let sectorsCaptured = 0;
  let civiliansTotal = 0;
  let civiliansEvacuated = 0;
  for (let i = 0; i < world.sectors.length; i++) {
    const sector = world.sectors[i];
    if (sector.owner === 'player') sectorsCaptured++;
    civiliansTotal += sector.civiliansTotal;
    civiliansEvacuated += Math.floor(sector.civiliansEvacuated);
  }
  const activeHordeCount = world.activeZombieCount;
  let unitsAlive = 0; let selectedCount = 0; let civiliansWaiting = 0;
  for (let i = 0; i < world.units.length; i++) { const unit = world.units[i]; if (unit.koTimer <= 0) unitsAlive++; if (unit.selected && unit.koTimer <= 0) selectedCount++; }
  for (let i = 0; i < world.civilians.length; i++) if (world.civilians[i].state === 'waiting') civiliansWaiting++;
  const threatLevel =
    activeHordeCount > 240
      ? 'CRITICAL'
      : activeHordeCount > 140
        ? 'SURGE'
        : activeHordeCount > 70
          ? 'ELEVATED'
          : 'LOW';

  const controlled =
    world.directControlUnitId !== null
      ? world.units.find((u) => u.id === world.directControlUnitId && u.koTimer <= 0) ?? null
      : null;

  return {
    phase: world.phase,
    outcome: world.outcome,
    mapId: world.mapId,
    scenarioId: world.scenarioId,
    weatherKind: world.weather.kind,
    req: Math.floor(world.req),
    elapsedSec: Math.floor(world.elapsedSec),
    kills: world.kills,
    unitsAlive,
    unitsLost: world.unitsLost,
    sectorsCaptured,
    sectorsTotal: world.sectors.length,
    civiliansEvacuated,
    civiliansTotal,
    bunkerSaved: world.bunkerSaved,
    bunkerCap: world.bunkerCap,
    civiliansWaiting,
    waveNumber: world.waveNumber,
    nextWaveIn: Math.max(0, Math.ceil(world.waveTimer)),
    activeHordeCount,
    threatLevel,
    zoom: world.camera.zoom,
    isOpsView: world.camera.zoom < OPS_VIEW_ZOOM_THRESHOLD,
    directControlUnitId: controlled ? controlled.id : null,
    directControlUnitKind: controlled ? controlled.kind : null,
    directControlHp: controlled ? Math.round(controlled.hp) : 0,
    directControlMaxHp: controlled ? controlled.maxHp : 0,
    directControlAmmo: controlled ? Math.round(controlled.ammo) : 0,
    directControlMaxAmmo: controlled ? controlled.maxAmmo : 0,
    directControlReloadTimer: controlled ? Math.max(0, controlled.reloadTimer ?? 0) : 0,
    bunkerDoorOpen: Boolean(world.structures.find((s) => s.kind === 'fob')?.gateOpen),
    bunkerDoorLocked: world.structures.find((s) => s.kind === 'fob')?.doorLocked ?? true,
    selectedCount,
    strikeCooldowns: {
      barrage: Number(world.strikeCooldowns.barrage.toFixed(1)),
      airstrike: Number(world.strikeCooldowns.airstrike.toFixed(1)),
      supplydrop: Number(world.strikeCooldowns.supplydrop.toFixed(1)),
      reinforce: Number(world.strikeCooldowns.reinforce.toFixed(1)),
    },
    placementMode: world.placementMode,
    placementAngle: world.placementAngle,
    sectorStatuses: world.sectors.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      owner: s.owner,
      captureProgress: Math.round(s.captureProgress),
      civiliansEvacuated: Math.floor(s.civiliansEvacuated),
      civiliansTotal: s.civiliansTotal,
    })),
    carrierIntegrity: world.carrierIntegrity,
    alertMessage: world.alertMessage,
    lowLagMode: world.lowLagMode,
    formation: world.formation,
    fogEnabled: world.fogEnabled,
    campaignMissionId: world.campaignMissionId,
    campaignMissionTitle: getCampaignMission(world.campaignMissionId)?.name ?? null,
    campaignObjective: (() => { const m = getCampaignMission(world.campaignMissionId); if (!m) return null; const saved = world.sectors.reduce((n, sec) => n + sec.civiliansEvacuated, 0); return `${m.killTarget} kills · ${m.sectorTarget} sectors` + (m.rescueTarget > 0 ? ` · rescue ${Math.min(saved, m.rescueTarget)}/${m.rescueTarget}` : ''); })(),
    campaignProgress: (() => { const m = getCampaignMission(world.campaignMissionId); return m ? Math.min(100, (() => { const saved = world.sectors.reduce((n, sec) => n + sec.civiliansEvacuated, 0); const r = m.rescueTarget > 0 ? Math.min(1, saved / m.rescueTarget) : 1; return Math.round((Math.min(1, world.kills / m.killTarget) * 0.4 + Math.min(1, sectorsCaptured / m.sectorTarget) * 0.3 + r * 0.3) * 100); })()) : 0; })(),
    autoBattleAssist: world.autoBattleAssist,
    rallyPoint: world.rallyPoint,
  };
}
