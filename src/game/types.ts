export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type GameOutcome = 'victory' | 'defeat' | null;

export type MapId =
  | 'port_la'
  | 'downtown_flood'
  | 'refinery'
  | 'airfield'
  | 'highway_overpass'
  | 'desert_fort'
  | 'frozen_harbor'
  | 'island_base'
  | 'storm_bay'
  | 'mountain_relay'
  | 'fortress_zero';

export type ScenarioId = 'harbor_break' | 'red_tide' | 'iron_ark';
export type FormationKind = 'grid' | 'line' | 'column' | 'circle';

export type WeatherKind = 'clear' | 'rain' | 'fog' | 'storm';

export type PlayerUnitKind =
  | 'squad'
  | 'heavy'
  | 'rpg'
  | 'medic'
  | 'sniper'
  | 'humvee'
  | 'raider'
  | 'ifv'
  | 'howitzer'
  | 'tank'
  | 'chopper'
  | 'blackhawk'
  | 'littlebird'
  | 'hind'
  | 'chinook'
  | 'drone'
  | 'truck';

export type ZombieKind =
  | 'shambler'
  | 'sprinter'
  | 'leaper'
  | 'spitter'
  | 'riot_zombie'
  | 'brute'
  | 'crawler'
  | 'exploder'
  | 'tank'
  | 'screamer'
  | 'mutated'
  | 'infected_marine'
  | 'stalker'
  | 'juggernaut';

export type StructureKind =
  | 'fob'
  | 'wall'
  | 'gate'
  | 'turret'
  | 'autocannon'
  | 'rocket_turret'
  | 'wire'
  | 'oil'
  | 'charge'
  | 'laser'
  | 'electric';

export type PlaceableKind = Exclude<StructureKind, 'fob'>;

export type StrikeKind = 'barrage' | 'airstrike' | 'supplydrop' | 'reinforce';

export interface Vec2 {
  x: number;
  y: number;
}

export interface BuildingBlock {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  height: number;
  kind:
    | 'warehouse'
    | 'office'
    | 'apartments'
    | 'hospital'
    | 'container'
    | 'hangar'
    | 'tank_silo'
    | 'depot';
  roofColor: string;
  wallColor: string;
  hp?: number;
  maxHp?: number;
  damageFlash?: number;
  hasHelipad?: boolean;
}

export interface WaterChannel {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BridgeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoadDef {
  axis: 'h' | 'v';
  center: number;
  width: number;
  lanes: number;
  hasMedian?: boolean;
  start?: number;
  end?: number;
}

export interface NavalShip {
  id: string;
  name: string;
  hullCode: string;
  kind: 'battleship' | 'destroyer' | 'gunboat';
  x: number;
  y: number;
  length: number;
  beam: number;
  turretAngle: number;
  recoil: number;
  muzzleFlash: number;
}

export interface SectorZone {
  id: string;
  name: string;
  code: string;
  x: number;
  y: number;
  radius: number;
  captureProgress: number;
  owner: 'neutral' | 'player' | 'infected';
  civiliansTotal: number;
  civiliansEvacuated: number;
  fobBuilt: boolean;
}

export interface MapConfig {
  id: MapId;
  name: string;
  subtitle: string;
  defaultWeather: WeatherKind;
  coastlineX: number;
  carrierPos: Vec2;
  fobPos: Vec2;
  waterChannels: WaterChannel[]; // static water + currently flooded tidal flats (used for collision)
  staticWater: WaterChannel[]; // permanent map water only (baked into terrain)
  tidalFlats: WaterChannel[]; // lanes that flood at high tide and open at low tide
  tide: number; // 0 = low tide, 1 = high tide
  tideFlooded: boolean;
  bridges: BridgeRect[];
  roads: RoadDef[];
  spawnPoints: Vec2[];
  createBuildings: () => BuildingBlock[];
  createSectors: () => SectorZone[];
  groundColor?: string; // terrain base color for a distinct map look
  civilianCap?: number; // bunker civilian capacity on this map
}

export interface UnitSpec {
  kind: PlayerUnitKind;
  name: string;
  shortName: string;
  role: string;
  cost: number;
  maxHp: number;
  maxAmmo: number;
  speed: number;
  radius: number;
  range: number;
  fireRate: number;
  damage: number;
  splashRadius: number;
  hotkey: string;
  isAir?: boolean;
  isVehicle?: boolean;
}

export interface Civilian {
  id: number;
  x: number;
  y: number;
  hp: number;
  state: 'waiting' | 'following' | 'refuge';
}

export interface PlayerUnit {
  id: number;
  kind: PlayerUnitKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  turretAngle: number;
  hp: number;
  maxHp: number;
  ammo: number;
  maxAmmo: number;
  fuel?: number;
  maxFuel?: number;
  reloadTimer?: number;
  radius: number;
  selected: boolean;
  targetX: number | null;
  targetY: number | null;
  attackMove: boolean;
  fireCooldown: number;
  secondaryCooldown: number;
  recoil: number;
  hitFlash: number;
  gaitPhase: number;
  resupplyPulse: number;
  kills: number;
  koTimer: number;
  controlGroup?: number;
}

export interface Structure {
  id: number;
  kind: StructureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  hp: number;
  maxHp: number;
  ammo: number;
  maxAmmo: number;
  fireCooldown: number;
  recoil: number;
  hitFlash: number;
  tier?: number; // wall material tier 0-3
  gateOpen?: number; // 0 = closed, 1 = open for friendly passage
  doorLocked?: boolean; // FOB blast door lock state
  sectorId?: string;
}

export interface Zombie {
  id: number;
  kind: ZombieKind;
  variant: number; // 0..3 visual clothes/appearance diversity
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  damage: number;
  attackCooldown: number;
  telegraphTimer: number;
  telegraphKind: 'leap' | 'slam' | 'spit' | null;
  leapTimer: number;
  hitFlash: number;
  gaitPhase: number;
  koTimer: number;
  slowTimer?: number; // seconds of fence slow remaining
  flankDir: number; // -1 or 1 smart obstacle avoidance direction
  targetKind: 'unit' | 'structure' | 'sector' | null;
  elite?: boolean;
  targetUnitRef?: PlayerUnit | null;
  targetStructureRef?: Structure | null;
  targetCacheReady?: boolean;
}

export interface Projectile {
  active: boolean;
  fromPlayer: boolean;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  damage: number;
  splashRadius: number;
  kind: 'bullet' | 'heavy_bullet' | 'shell' | 'rocket' | 'artillery' | 'acid';
}

export interface PendingStrike {
  id: number;
  kind: StrikeKind;
  x: number;
  y: number;
  timer: number;
  duration: number;
  shellsRemaining: number;
  subTimer: number;
  angle: number;
}

export interface SupplyCrate {
  id: number;
  x: number;
  y: number;
  ammoAmount: number;
  healAmount: number;
  life: number;
}

export interface Nest {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  spawnTimer: number;
  pulse: number;
}

export interface Rubble {
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
}

export interface Fire {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  tick: number;
  gen: number;
}

export interface Crater {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  life: number;
}

export interface BloodDecal {
  x: number;
  y: number;
  r: number;
  angle: number;
  alpha: number;
  variant: number;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
  kind: 'spark' | 'smoke' | 'blood' | 'debris' | 'ring' | 'casing';
}

export interface RainDrop {
  x: number;
  y: number;
  len: number;
  speed: number;
}

export interface WeatherState {
  kind: WeatherKind;
  targetKind: WeatherKind;
  intensity: number;
  nextChangeIn: number;
  lightningFlash: number;
  lightningTimer: number;
  windX: number;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  targetX: number;
  targetY: number;
  targetZoom: number;
  trauma: number;
  shakeX: number;
  shakeY: number;
}

export interface StrikeCooldowns {
  barrage: number;
  airstrike: number;
  supplydrop: number;
  reinforce: number;
}

export interface HordeWaveInfo {
  waveNumber: number;
  nextWaveIn: number;
  activeHordeCount: number;
  threatLevel: 'LOW' | 'ELEVATED' | 'SURGE' | 'CRITICAL';
}

export interface ScenarioConfig {
  id: ScenarioId;
  name: string;
  subtitle: string;
  startingReq: number;
  reqIncomePerSec: number;
  waveInterval: number;
  initialHordeCount: number;
  hordeScaleMultiplier: number;
  startingUnits: Array<{ kind: PlayerUnitKind; offsetX: number; offsetY: number }>;
}

export interface BuildPlacementMode {
  kind: PlaceableKind | StrikeKind;
}

export interface SimEvent {
  type:
    | 'rifle'
    | 'heavy_gun'
    | 'cannon'
    | 'rocket'
    | 'explosion'
    | 'artillery_impact'
    | 'naval_salvo'
    | 'airstrike'
    | 'thunder'
    | 'sector_captured'
    | 'unit_lost'
    | 'supply'
    | 'order'
    | 'build'
    | 'gate_open'
    | 'gate_close'
    | 'voice_order'
    | 'voice_deploy'
    | 'voice_alert'
    | 'zombie_groan'
    | 'zombie_screech'
    | 'spitter_acid'
    | 'brute_roar'
    | 'vehicle_engine'
    | 'heli_blades'
    | 'victory'
    | 'defeat';
  intensity?: number;
}

export interface HudSnapshot {
  phase: GamePhase;
  outcome: GameOutcome;
  mapId: MapId;
  scenarioId: ScenarioId;
  weatherKind: WeatherKind;
  req: number;
  elapsedSec: number;
  kills: number;
  unitsAlive: number;
  unitsLost: number;
  sectorsCaptured: number;
  sectorsTotal: number;
  civiliansEvacuated: number;
  civiliansTotal: number;
  bunkerSaved: number;
  bunkerCap: number;
  civiliansWaiting: number;
  waveNumber: number;
  nextWaveIn: number;
  activeHordeCount: number;
  threatLevel: HordeWaveInfo['threatLevel'];
  zoom: number;
  isOpsView: boolean;
  directControlUnitId: number | null;
  directControlUnitKind: PlayerUnitKind | null;
  directControlHp: number;
  directControlMaxHp: number;
  directControlAmmo: number;
  directControlMaxAmmo: number;
  directControlReloadTimer: number;
  bunkerDoorOpen: boolean;
  bunkerDoorLocked: boolean;
  selectedCount: number;
  strikeCooldowns: StrikeCooldowns;
  placementMode: BuildPlacementMode | null;
  placementAngle: number;
  sectorStatuses: Array<{
    id: string;
    code: string;
    name: string;
    owner: SectorZone['owner'];
    captureProgress: number;
    civiliansEvacuated: number;
    civiliansTotal: number;
  }>;
  carrierIntegrity: number;
  alertMessage: string | null;
  lowLagMode: boolean;
  formation: FormationKind;
  fogEnabled: boolean;
  campaignMissionId: number | null;
  campaignMissionTitle: string | null;
  campaignObjective: string | null;
  campaignProgress: number;
  autoBattleAssist: boolean;
  rallyPoint: Vec2 | null;
}

export interface InputState {
  keysHeld: Set<string>;
  virtualMoveX: number;
  virtualMoveY: number;
  virtualFiring: boolean;
  mouseWorldX: number;
  mouseWorldY: number;
  mouseScreenX: number;
  mouseScreenY: number;
  mouseDownLeft: boolean;
  dragBoxStartScreen: Vec2 | null;
  dragBoxCurrentScreen: Vec2 | null;
}

export interface GameWorld {
  width: number;
  height: number;
  coastlineX: number;
  carrierPos: Vec2;
  fobPos: Vec2;
  navalFleet: NavalShip[];
  carrierIntegrity: number;
  phase: GamePhase;
  outcome: GameOutcome;
  mapId: MapId;
  scenarioId: ScenarioId;
  endlessMode: boolean;
  elapsedSec: number;
  hitstopTimer: number;
  req: number;
  kills: number;
  unitsLost: number;
  damageTally: { bullet: number; explosive: number }; // what the player has been killing with, for adaptive waves
  bossId: number | null;
  waveBonus: { kind: 'kills' | 'no_losses'; target: number; startKills: number; startLost: number; reward: number } | null;
  nextId: number;
  waveNumber: number;
  waveTimer: number;
  alertMessage: string | null;
  alertTimer: number;
  defeatDelayTimer: number;
  directControlUnitId: number | null;
  placementMode: BuildPlacementMode | null;
  placementAngle: number;
  wallTier: number;
  civilians: Civilian[];
  bunkerSaved: number;
  bunkerCap: number;
  civiliansLost: number;
  strikeCooldowns: StrikeCooldowns;
  weather: WeatherState;
  rainDrops: RainDrop[];
  buildings: BuildingBlock[];
  waterChannels: WaterChannel[];
  bridges: BridgeRect[];
  roads: RoadDef[];
  sectors: SectorZone[];
  units: PlayerUnit[];
  structures: Structure[];
  zombies: Zombie[];
  projectiles: Projectile[];
  projectileCursor: number;
  pendingStrikes: PendingStrike[];
  supplyCrates: SupplyCrate[];
  craters: Crater[];
  fires: Fire[];
  rubble: Rubble[];
  nests: Nest[];
  nestsDestroyed: number;
  bloodDecals: BloodDecal[];
  bloodCursor: number;
  craterCursor: number;
  particles: Particle[];
  particleCursor: number;
  camera: CameraState;
  events: SimEvent[];
  lowLagMode: boolean;
  formation: FormationKind;
  fogEnabled: boolean;
  fogExplored: boolean[];
  fogVisible: boolean[];
  fogUpdateTimer: number;
  campaignMissionId: number | null;
  campaignReward: number;
  autoBattleAssist: boolean;
  rallyPoint: Vec2 | null;
  controlGroups: number[][];
  minimapPings: Array<{ x: number; y: number; kind: 'danger' | 'rally'; life: number }>;
  tutorialSeen: boolean;
  damageNumbersEnabled: boolean;
  damageNumbers: Array<{ x: number; y: number; value: number; label: string; life: number; active: boolean }>;
  damageNumberCursor: number;
  graphicsQuality: 'low' | 'medium' | 'high';
  adaptiveQuality: boolean;
  debugPerformance: boolean;
  simulationTick: number;
  activeZombieCount: number;
  preferredGraphicsQuality: 'low' | 'medium' | 'high';
}
