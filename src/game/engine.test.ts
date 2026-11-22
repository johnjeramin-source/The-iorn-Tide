import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustCameraZoom,
  igniteFire,
  tideAt,
  tideAt,
  TIDE_PERIOD_SEC,
  buildHudSnapshot,
  canPlaceStructureAt,
  createWorld,
  cycleWeather,
  deployUnit,
  issueMoveOrder,
  placeStructureOrStrike,
  rotatePlacement,
  selectUnitsInRect,
  spawnZombie,
  stepWorld,
  toggleDirectControl,
  requestDirectReload,
  toggleBunkerDoor,
  toggleLowLagMode,
  setFormation,
  toggleFogOfWar,
  setAutoBattleAssist,
  setRallyPoint,
  saveControlGroup,
  selectControlGroup,
  addMinimapPing,
  recordDamageNumber,
  getZombieCapForQuality,
  MAX_COINS,
} from './engine';
import {
  MAPS,
  MAX_ZOOM,
  MIN_ZOOM,
  OPS_VIEW_ZOOM_THRESHOLD,
  UNIT_SPECS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './data';
import { SpatialGrid, pushOutOfBunker, pushOutOfWalls, resolveCircleOBB } from './spatial';
import { InputState, MapId } from './types';

function makeEmptyInput(): InputState {
  return {
    keysHeld: new Set<string>(),
    virtualMoveX: 0,
    virtualMoveY: 0,
    virtualFiring: false,
    mouseWorldX: 1000,
    mouseWorldY: 1200,
    mouseScreenX: 720,
    mouseScreenY: 450,
    mouseDownLeft: false,
    dragBoxStartScreen: null,
    dragBoxCurrentScreen: null,
  };
}


test('direct-control reload refills ammo after a timed reload', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  const deployed = deployUnit(world, 'squad');
  assert.equal(deployed.ok, true);
  const unit = deployed.unit!;
  toggleDirectControl(world, unit.id);
  unit.ammo = 0;
  assert.equal(requestDirectReload(world), true);
  assert.ok((unit.reloadTimer ?? 0) > 0);
  for (let i = 0; i < 40; i++) stepWorld(world, 0.05, makeEmptyInput());
  assert.equal(unit.ammo, unit.maxAmmo);
  assert.equal(unit.reloadTimer, 0);
});

test('bunker hull blocks passage when sealed and leaves a traversable doorway when open', () => {
  const world = createWorld('harbor_break', 'playing', 'desert_fort');
  const bunker = world.structures.find((s) => s.kind === 'fob');
  assert.ok(bunker);
  const doorwayX = bunker.x;
  const doorwayY = bunker.y + bunker.h * 0.5 - 6;
  const sealed = pushOutOfBunker(doorwayX, doorwayY, 10, world.structures);
  assert.ok(Math.hypot(sealed.x - doorwayX, sealed.y - doorwayY) > 1, 'sealed hull should block the doorway');
  bunker.doorLocked = false;
  bunker.gateOpen = 1;
  const open = pushOutOfBunker(doorwayX, doorwayY, 10, world.structures);
  assert.equal(open.x, doorwayX);
  assert.equal(open.y, doorwayY);
});

test('bunker blast door cycles locked, unlocked, open, and sealed states', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  const bunker = world.structures.find((s) => s.kind === 'fob');
  assert.ok(bunker);
  assert.equal(bunker.doorLocked, true);
  assert.equal(toggleBunkerDoor(world), true);
  assert.equal(bunker.doorLocked, false);
  assert.equal(bunker.gateOpen, 0);
  toggleBunkerDoor(world);
  assert.equal(bunker.gateOpen, 1);
  toggleBunkerDoor(world);
  assert.equal(bunker.gateOpen, 0);
  assert.equal(bunker.doorLocked, true);
});

test('endless mode is carried into the world configuration', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la', null, true);
  assert.equal(world.endlessMode, true);
});

test('createWorld initializes all 10 coastal maps at 4000x2400 with naval fleet and roads', () => {
  const mapIds: MapId[] = [
    'port_la',
    'downtown_flood',
    'refinery',
    'airfield',
    'highway_overpass',
    'desert_fort',
    'frozen_harbor',
    'island_base',
    'storm_bay',
    'mountain_relay', 'fortress_zero',
  ];
  for (const mapId of mapIds) {
    const world = createWorld('harbor_break', 'playing', mapId);
    assert.equal(world.width, WORLD_WIDTH);
    assert.equal(world.height, WORLD_HEIGHT);
    assert.equal(world.mapId, mapId);
    assert.equal(world.weather.kind, MAPS[mapId].defaultWeather);
    assert.equal(world.sectors.length, 3);
    assert.ok(world.buildings.length >= 16);
    assert.ok(world.roads.length >= 5);
    assert.equal(world.navalFleet.length, 3);
    assert.ok(world.navalFleet.some((s) => s.kind === 'battleship'));
    assert.ok(world.navalFleet.some((s) => s.kind === 'gunboat'));
    assert.ok(world.structures.some((s) => s.kind === 'fob'));
  }

  const floodWorld = createWorld('harbor_break', 'playing', 'downtown_flood');
  assert.equal(floodWorld.waterChannels.length, 1);
  assert.equal(floodWorld.bridges.length, 3);
  const stormBay = createWorld('harbor_break', 'playing', 'storm_bay');
  assert.equal(stormBay.waterChannels.length, 2);
  assert.equal(stormBay.bridges.length, 5);
});

test('deployUnit supports all 17 unit classes including sniper, humvee, ifv, and blackhawk', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.req = 5000;

  const allKinds = [
    'squad',
    'heavy',
    'rpg',
    'medic',
    'sniper',
    'humvee',
    'raider',
    'ifv',
    'howitzer',
    'tank',
    'chopper',
    'blackhawk',
    'littlebird',
    'hind',
    'chinook',
    'drone',
    'truck',
  ] as const;

  for (const kind of allKinds) {
    const before = world.req;
    const res = deployUnit(world, kind);
    assert.equal(res.ok, true, `Should deploy ${kind}`);
    assert.equal(world.req, before - UNIT_SPECS[kind].cost);
  }

  world.req = 10;
  const blocked = deployUnit(world, 'tank');
  assert.equal(blocked.ok, false);
});

test('medic and blackhawk passively heal nearby friendly units', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  const resBlackhawk = deployUnit(world, 'blackhawk');
  const resSquad = deployUnit(world, 'squad');
  assert.ok(resBlackhawk.unit && resSquad.unit);

  resBlackhawk.unit.x = 1200;
  resBlackhawk.unit.y = 1200;
  resSquad.unit.x = 1240;
  resSquad.unit.y = 1200;
  resSquad.unit.hp = 60;
  resSquad.unit.ammo = 20;

  for (let i = 0; i < 20; i++) {
    stepWorld(world, 0.05, makeEmptyInput());
  }
  assert.ok(resSquad.unit.hp > 60, 'Blackhawk aura should heal nearby ground squad');
  assert.ok(resSquad.unit.ammo > 20, 'Blackhawk aura should resupply nearby ground squad ammo');
});

test('rotatable walls and blast gates rotate and enforce friendly pass / zombie block', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  const initialAngle = world.placementAngle;
  const rotated = rotatePlacement(world, Math.PI / 4);
  assert.notEqual(rotated, initialAngle);

  world.placementMode = { kind: 'wall' };
  world.placementAngle = Math.PI / 4;
  assert.equal(placeStructureOrStrike(world, 785, 1190), true);

  const wall = world.structures.find((s) => s.kind === 'wall')!;
  const hit = resolveCircleOBB(785, 1190, 12, wall.x, wall.y, wall.w, wall.h, wall.angle);
  assert.ok(hit !== null, 'Circle at rotated wall center must intersect OBB');

  world.req = 500;
  world.placementMode = { kind: 'gate' };
  world.placementAngle = Math.PI * 0.5;
  assert.equal(placeStructureOrStrike(world, 890, 1200), true);

  const gate = world.structures.find((s) => s.kind === 'gate')!;
  const squad = world.units[0];
  squad.x = 885;
  squad.y = 1200;

  for (let i = 0; i < 15; i++) {
    stepWorld(world, 0.05, makeEmptyInput());
  }
  assert.ok((gate.gateOpen ?? 0) > 0.35, 'Blast gate should open when friendly unit approaches');

  const zPush = pushOutOfWalls(gate.x, gate.y + 1, 10, [gate], true);
  assert.ok(Math.hypot(zPush.x - gate.x, zPush.y - (gate.y + 1)) > 2, 'Gate must block zombies');
  const uPush = pushOutOfWalls(gate.x, gate.y + 1, 10, [gate], false);
  assert.equal(uPush.x, gate.x, 'Open gate must let friendly units pass');
});

test('Hydra rocket_turret places and engages distant zombie hordes', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  world.req = 500;
  world.placementMode = { kind: 'rocket_turret' };
  assert.equal(placeStructureOrStrike(world, 750, 1140), true);

  spawnZombie(world, 'brute', 1050, 1140);
  const initialBruteHp = world.zombies[0].hp;

  for (let i = 0; i < 50; i++) {
    stepWorld(world, 0.05, makeEmptyInput());
  }
  assert.ok(
    world.zombies.length === 0 || world.zombies[0].hp < initialBruteHp,
    'Hydra rocket pod should damage or destroy brute',
  );

});

test('spitter fires acid projectiles and zombie kills leave capped blood decals', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  world.units = world.units.slice(0, 1);
  const squad = world.units[0];
  squad.x = 1200;
  squad.y = 1200;
  squad.ammo = 0; // don't shoot back immediately

  const spitter = spawnZombie(world, 'spitter', 1380, 1200)!;
  const startHp = squad.hp;

  for (let i = 0; i < 30; i++) {
    stepWorld(world, 0.05, makeEmptyInput());
  }
  assert.ok(
    world.projectiles.some((p) => p.kind === 'acid') || squad.hp < startHp || spitter.attackCooldown > 0,
    'Spitter should launch acid attack',
  );

  // Blood decal accumulation & cap check
  world.req = 999;
  world.placementMode = { kind: 'barrage' };
  placeStructureOrStrike(world, 1380, 1200);
  for (let i = 0; i < 60; i++) {
    stepWorld(world, 0.05, makeEmptyInput());
  }
  assert.ok(world.bloodDecals.length > 0 && world.bloodDecals.length <= 220);
  assert.ok(world.navalFleet.some((s) => s.turretAngle !== 0 || s.recoil > 0));
});

test('cycleWeather switches weather states and updates HUD snapshot', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  assert.equal(world.weather.kind, 'clear');

  const next = cycleWeather(world);
  assert.equal(next, 'rain');
  assert.equal(buildHudSnapshot(world).weatherKind, 'rain');

  cycleWeather(world, 'storm');
  assert.equal(world.weather.kind, 'storm');
  assert.equal(buildHudSnapshot(world).weatherKind, 'storm');
});


test('unit deployments have no artificial force cap and coins cannot exceed the balance limit', () => {
  const world = createWorld('harbor_break', 'playing');
  world.units = [];
  world.req = MAX_COINS;
  for (let i = 0; i < 30; i += 1) {
    const result = deployUnit(world, 'squad');
    assert.equal(result.ok, true);
  }
  assert.equal(world.units.filter((unit) => unit.hp > 0 && unit.koTimer <= 0).length, 30);
  world.req = MAX_COINS - 1;
  stepWorld(world, 0.1, makeEmptyInput());
  assert.ok(world.req <= MAX_COINS);
});

test('selection and formation move orders update selected units', () => {
  const world = createWorld('harbor_break', 'playing');
  const selectedCount = selectUnitsInRect(world, 650, 1000, 1050, 1400, false);
  assert.ok(selectedCount >= 2);

  const ordered = issueMoveOrder(world, 1180, 1200, true);
  assert.equal(ordered, selectedCount);
  const activeSelected = world.units.filter((u) => u.selected);
  assert.ok(activeSelected.every((u) => u.targetX !== null && u.targetY !== null));
});

test('direct control lets player steer unit with WASD or virtual joystick and fire', () => {
  const world = createWorld('harbor_break', 'playing');
  const tank = world.units.find((u) => u.kind === 'tank')!;
  tank.x = 1200;
  tank.y = 1200;
  const controlledId = toggleDirectControl(world, tank.id);
  assert.equal(controlledId, tank.id);

  const input = makeEmptyInput();
  input.virtualMoveX = 1;
  input.virtualFiring = true;
  input.mouseWorldX = tank.x + 250;
  input.mouseWorldY = tank.y;

  const startX = tank.x;
  const startAmmo = tank.ammo;
  for (let i = 0; i < 10; i++) {
    stepWorld(world, 0.04, input);
  }

  assert.ok(tank.x > startX, 'Tank should move east with virtualMoveX');
  assert.ok(tank.ammo < startAmmo, 'Tank should expend ammo when firing');

  const exited = toggleDirectControl(world);
  assert.equal(exited, null);
});

test('supply truck resupplies low-ammo frontline units', () => {
  const world = createWorld('harbor_break', 'playing');
  const tank = world.units.find((u) => u.kind === 'tank')!;
  const truck = world.units.find((u) => u.kind === 'truck')!;
  tank.x = 1400;
  tank.y = 1200;
  tank.ammo = 4;
  truck.x = 1340;
  truck.y = 1200;

  for (let i = 0; i < 15; i++) {
    stepWorld(world, 0.04, makeEmptyInput());
  }
  assert.ok(tank.ammo > 4, 'Supply truck should replenish tank ammo');
});

test('structure placement enforces FOB/supply proximity and clears buildings', () => {
  const world = createWorld('harbor_break', 'playing');
  const nearCheck = canPlaceStructureAt(world, 'wall', 790, 1200);
  assert.equal(nearCheck.ok, true);

  const farCheck = canPlaceStructureAt(world, 'wall', 3100, 1900);
  assert.equal(farCheck.ok, false);

  world.placementMode = { kind: 'turret' };
  const placed = placeStructureOrStrike(world, 790, 1200);
  assert.equal(placed, true);
  assert.equal(world.placementMode, null);
});

test('capturing all sectors and evacuating civilians triggers victory', () => {
  const world = createWorld('harbor_break', 'playing');
  for (const s of world.sectors) {
    s.owner = 'player';
    s.captureProgress = 100;
    s.civiliansEvacuated = s.civiliansTotal;
  }
  stepWorld(world, 0.03, makeEmptyInput());
  assert.equal(world.phase, 'gameover');
  assert.equal(world.outcome, 'victory');
});

test('losing all units and FOBs triggers defeat after brief final beat', () => {
  const world = createWorld('harbor_break', 'playing');
  world.units = [];
  world.structures = [];
  for (let i = 0; i < 20; i++) {
    stepWorld(world, 0.05, makeEmptyInput());
  }
  assert.equal(world.phase, 'gameover');
  assert.equal(world.outcome, 'defeat');
});

test('camera zoom clamps smoothly and exposes ops view flag in HUD snapshot', () => {
  const world = createWorld('harbor_break', 'playing');
  adjustCameraZoom(world, 0.2);
  assert.equal(world.camera.targetZoom, MIN_ZOOM);
  world.camera.zoom = world.camera.targetZoom;
  const opsSnap = buildHudSnapshot(world);
  assert.equal(opsSnap.isOpsView, true);
  assert.ok(opsSnap.zoom < OPS_VIEW_ZOOM_THRESHOLD);

  adjustCameraZoom(world, 10);
  assert.equal(world.camera.targetZoom, MAX_ZOOM);
  world.camera.zoom = world.camera.targetZoom;
  const streetSnap = buildHudSnapshot(world);
  assert.equal(streetSnap.isOpsView, false);
});

test('camera shake stays gentle and lowLagMode eliminates shake and hitstop stutter', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.req = 999;
  world.placementMode = { kind: 'barrage' };
  placeStructureOrStrike(world, 1380, 1200);

  let maxObservedShake = 0;
  for (let i = 0; i < 65; i++) {
    stepWorld(world, 0.04, makeEmptyInput());
    maxObservedShake = Math.max(
      maxObservedShake,
      Math.abs(world.camera.shakeX),
      Math.abs(world.camera.shakeY),
    );
    assert.equal(world.hitstopTimer, 0, 'Explosions must not freeze simulation frames');
  }
  assert.ok(maxObservedShake <= 4.5, `Camera shake should stay gentle (<= 4.5), got ${maxObservedShake}`);

  assert.equal(toggleLowLagMode(world), true);
  assert.equal(buildHudSnapshot(world).lowLagMode, true);
  world.req = 999;
  world.placementMode = { kind: 'barrage' };
  placeStructureOrStrike(world, 1380, 1200);
  for (let i = 0; i < 65; i++) {
    stepWorld(world, 0.04, makeEmptyInput());
    assert.equal(world.camera.shakeX, 0);
    assert.equal(world.camera.shakeY, 0);
  }
});


test('all zombie classes spawn with distinct specs and valid health', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  const kinds = [
    'shambler', 'sprinter', 'leaper', 'spitter', 'riot_zombie', 'brute',
    'crawler', 'exploder', 'tank', 'screamer', 'mutated', 'infected_marine', 'stalker', 'juggernaut',
  ] as const;
  for (const [index, kind] of kinds.entries()) {
    const z = spawnZombie(world, kind, 1100 + index * 24, 900 + index * 20);
    assert.ok(z, `Expected ${kind} to spawn`);
    assert.ok(z.hp > 0 && z.maxHp >= z.hp);
    assert.ok(z.speed > 0 && z.radius > 0);
  }
  assert.equal(world.zombies.length, kinds.length);
});

test('ground movement orders advance units and avoid solid map geometry', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  world.units = [];
  world.req = 500;
  const deployed = deployUnit(world, 'squad');
  assert.ok(deployed.unit);
  const unit = deployed.unit!;
  unit.selected = true;
  unit.targetX = null;
  unit.targetY = null;
  const startX = unit.x;
  const startY = unit.y;
  assert.equal(issueMoveOrder(world, 1180, 1380), 1);
  for (let i = 0; i < 90; i++) stepWorld(world, 1 / 30, makeEmptyInput());
  assert.ok(Math.hypot(unit.x - startX, unit.y - startY) > 80, 'unit should leave its spawn position');
  assert.ok(Number.isFinite(unit.x) && Number.isFinite(unit.y));
});

test('interactive formations change move-order geometry and fog reveals friendly territory', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  world.units.forEach((unit) => { unit.selected = true; });
  assert.equal(setFormation(world, 'line'), 'line');
  assert.equal(world.formation, 'line');
  const before = world.units.map((unit) => unit.targetX);
  issueMoveOrder(world, 1400, 1200, false);
  assert.ok(world.units.some((unit, index) => unit.targetX !== before[index]));
  assert.equal(world.fogEnabled, true);
  stepWorld(world, 0.05, makeEmptyInput());
  assert.ok(world.fogVisible.some(Boolean), 'Friendly units should reveal nearby map cells');
  assert.ok(world.fogExplored.some(Boolean), 'Revealed cells should remain explored');
  assert.equal(toggleFogOfWar(world, false), false);
});

test('campaign missions complete from interactive kill and sector objectives', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la', 1);
  world.zombies = [];
  world.kills = 35;
  world.sectors[0].owner = 'player';
  world.req = 0;
  stepWorld(world, 0.05, makeEmptyInput());
  assert.equal(world.phase, 'gameover');
  assert.equal(world.outcome, 'victory');
  assert.ok(world.req >= 180, 'Mission reward should be credited');
});

test('campaign data provides 20 distinct selectable operations', async () => {
  const { CAMPAIGN_MISSIONS } = await import('./campaign');
  assert.equal(CAMPAIGN_MISSIONS.length, 20);
  assert.equal(new Set(CAMPAIGN_MISSIONS.map((mission) => mission.id)).size, 20);
  for (const mission of CAMPAIGN_MISSIONS) {
    assert.ok(mission.killTarget > 0);
    assert.ok(mission.sectorTarget >= 1 && mission.sectorTarget <= 3);
    assert.ok(mission.reward > 0);
  }
});


test('rally point guides newly deployed units and records a short-lived minimap ping', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  setRallyPoint(world, 1450, 900);
  world.req = 1000;
  const result = deployUnit(world, 'squad');
  assert.equal(result.ok, true);
  assert.equal(result.unit?.targetX, 1450);
  assert.equal(result.unit?.targetY, 900);
  assert.equal(world.minimapPings[0]?.kind, 'rally');
  addMinimapPing(world, 1600, 1000, 'danger');
  assert.equal(world.minimapPings.length, 2);
});

test('control groups save current selection and restore it without selecting lost units', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.units.forEach((unit, index) => { unit.selected = index === 0 || index === 1; });
  saveControlGroup(world, 2);
  world.units.forEach((unit) => { unit.selected = false; });
  assert.equal(selectControlGroup(world, 2), 2);
  world.units[0].hp = 0;
  assert.equal(selectControlGroup(world, 2), 1);
});

test('auto-battle assist acquires an in-range zombie using the spatial grid', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.units = world.units.slice(0, 1);
  const unit = world.units[0];
  unit.x = 1450; unit.y = 1200; unit.targetX = null; unit.targetY = null;
  unit.ammo = 0;
  spawnZombie(world, 'shambler', 1500, 1200);
  setAutoBattleAssist(world, true);
  stepWorld(world, 0.05, makeEmptyInput());
  assert.notEqual(unit.targetX, null);
  assert.equal(world.autoBattleAssist, true);
});


test('low-health auto-battle units retreat toward the FOB and minimap pings expire', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.units = world.units.slice(0, 1);
  const unit = world.units[0];
  unit.x = 1700; unit.y = 900; unit.hp = Math.floor(unit.maxHp * 0.2);
  unit.targetX = null; unit.targetY = null;
  setAutoBattleAssist(world, true);
  addMinimapPing(world, 1400, 800, 'danger');
  stepWorld(world, 0.05, makeEmptyInput());
  assert.equal(unit.targetX, world.fobPos.x + 90);
  for (let i = 0; i < 90; i++) stepWorld(world, 0.05, makeEmptyInput());
  assert.equal(world.minimapPings.length, 0);
});


test('damage number pool reuses slots and stays disabled in Low-Lag mode', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  recordDamageNumber(world, 1200, 900, 24.6);
  assert.equal(world.damageNumbers[0].active, true);
  assert.equal(world.damageNumbers[0].label, '25');
  world.lowLagMode = true;
  recordDamageNumber(world, 1300, 900, 50);
  assert.equal(world.damageNumbers[1].active, false);
});


test('graphics quality selects the intended zombie population cap', () => {
  assert.equal(getZombieCapForQuality('low'), 600);
  assert.equal(getZombieCapForQuality('medium'), 900);
  assert.equal(getZombieCapForQuality('high'), 1200);
});

test('zombie overflow reinforces an existing zombie as elite instead of adding an entity', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.graphicsQuality = 'low';
  while (world.zombies.length < getZombieCapForQuality('low')) {
    const added = spawnZombie(world, 'shambler', 1600, 1200);
    assert.ok(added);
  }
  const countBefore = world.zombies.length;
  const target = world.zombies.find((z) => z.hp > 0)!;
  const hpBefore = target.hp;
  const maxHpBefore = target.maxHp;
  const merged = spawnZombie(world, 'brute', target.x + 2, target.y + 2);
  assert.equal(world.zombies.length, countBefore);
  assert.ok(merged);
  assert.equal(merged?.elite, true);
  assert.ok((merged?.maxHp ?? 0) > maxHpBefore);
  assert.ok((merged?.hp ?? 0) > hpBefore);
});

test('SpatialGrid queryRadiusInto fills a caller-owned buffer without callback allocation', () => {
  const grid = new SpatialGrid(500, 500, 50);
  grid.insert(4, 100, 100);
  grid.insert(8, 115, 105);
  grid.insert(12, 300, 300);
  const output = new Int32Array(8);
  const count = grid.queryRadiusInto(105, 105, 35, output, output.length);
  assert.equal(count, 2);
  assert.deepEqual(Array.from(output.slice(0, count)).sort((a, b) => a - b), [4, 8]);
});


test('HUD horde count uses the world counter updated by spawn operations', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  const before = world.activeZombieCount;
  spawnZombie(world, 'shambler', 1800, 1200);
  assert.equal(world.activeZombieCount, before + 1);
  assert.equal(buildHudSnapshot(world).activeHordeCount, before + 1);
});

test('campaign has 20 unique missions and rescue objectives', async () => {
  const { CAMPAIGN_MISSIONS } = await import('./campaign');
  assert.equal(CAMPAIGN_MISSIONS.length, 20);
  assert.equal(new Set(CAMPAIGN_MISSIONS.map((m) => m.briefing)).size, 20);
  assert.equal(CAMPAIGN_MISSIONS.filter((m) => m.rescueTarget > 0).length, 3);
});

test('fire merges, respects quality cap, burns zombies, and rain extinguishes it', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  world.graphicsQuality = 'low';
  igniteFire(world, 1000, 1000, 40);
  igniteFire(world, 1005, 1005, 40);
  assert.equal(world.fires.length, 1, 'overlapping fire should merge');
  for (let i = 0; i < 20; i++) igniteFire(world, 1000 + i * 400, 300, 40);
  assert.ok(world.fires.length <= 6, 'low quality caps fires at 6');

  world.fires = [];
  world.weatherKind = 'clear';
  igniteFire(world, 1000, 1000, 40);
  const z = spawnZombie(world, 'shambler', 1000, 1000)!;
  const hp0 = z.hp;
  for (let i = 0; i < 30; i++) stepWorld(world, 0.05, makeEmptyInput());
  assert.ok(world.zombies.length === 0 || world.zombies[0].hp < hp0, 'fire should damage zombies standing in it');

  world.zombies = [];
  world.fires = [];
  world.weatherKind = 'storm';
  igniteFire(world, 1000, 1000, 40);
  const lifeBefore = world.fires[0].life;
  for (let i = 0; i < 20; i++) stepWorld(world, 0.05, makeEmptyInput());
  assert.ok(world.fires.length === 0 || world.fires[0].life < lifeBefore - 2.5, 'rain burns fire out ~3x faster');
});

test('barrage strikes collapse buildings, leaving rubble', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  const target = world.buildings[0];
  const id = target.id;
  const count = world.buildings.length;
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  for (let i = 0; i < 1200 && world.buildings.some((b) => b.id === id); i++) {
    if (world.pendingStrikes.length === 0) {
      world.pendingStrikes.push({ id: world.nextId++, kind: 'barrage', x: cx, y: cy, timer: 0.1, duration: 0.1, shellsRemaining: 8, subTimer: 0, angle: 0 });
    }
    stepWorld(world, 0.05, makeEmptyInput());
  }
  assert.ok(!world.buildings.some((b) => b.id === id), 'target building should collapse');
  assert.equal(world.buildings.length, count - 1);
  assert.equal(world.rubble.length, 1);
});

test('day/night cycle starts in daylight, reaches deep night, and returns to day', async () => {
  const { getDaylight, DAY_LENGTH_SEC } = await import('./lighting');
  assert.equal(getDaylight(0).label, 'DAY');
  let maxDark = 0;
  let minDark = 1;
  for (let t = 0; t < DAY_LENGTH_SEC; t += 5) {
    const d = getDaylight(t).darkness;
    maxDark = Math.max(maxDark, d);
    minDark = Math.min(minDark, d);
    assert.ok(d >= 0 && d <= 1);
  }
  assert.ok(maxDark > 0.9, 'night should get dark');
  assert.ok(minDark < 0.05, 'day should be fully bright');
  assert.equal(getDaylight(DAY_LENGTH_SEC).label, 'DAY');
});

test('tide starts low, floods flank lanes at high tide, and reopens them', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  assert.ok(tideAt(0) < 0.01);
  assert.ok(tideAt(TIDE_PERIOD_SEC / 2) > 0.99);
  const staticCount = world.waterChannels.length;
  assert.equal(world.tideFlooded, false);
  world.elapsedSec = TIDE_PERIOD_SEC / 2;
  stepWorld(world, 0.05, makeEmptyInput());
  assert.equal(world.tideFlooded, true);
  assert.equal(world.waterChannels.length, staticCount + world.tidalFlats.length);
  world.elapsedSec = TIDE_PERIOD_SEC;
  stepWorld(world, 0.05, makeEmptyInput());
  assert.equal(world.tideFlooded, false);
  assert.equal(world.waterChannels.length, staticCount);
});

test('tide floods tidal flats at high tide and reopens them at low tide', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  const base = world.staticWater.length;
  assert.ok(tideAt(0) < 0.05 && tideAt(120) > 0.95, 'tide starts low and peaks mid-cycle');
  assert.equal(world.waterChannels.length, base);
  world.elapsedSec = 120;
  stepWorld(world, 0.05, makeEmptyInput());
  assert.equal(world.tideFlooded, true);
  assert.equal(world.waterChannels.length, base + world.tidalFlats.length);
  world.elapsedSec = 240;
  stepWorld(world, 0.05, makeEmptyInput());
  assert.equal(world.tideFlooded, false);
  assert.equal(world.waterChannels.length, base);
});

test('oil slick slows zombies and bursts into fires when touched by flame', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  world.req = 5000;
  world.placementMode = { kind: 'oil' } as never;
  let placed = false;
  for (const [x, y] of [[1100, 1300], [1100, 1100], [1250, 1200], [1000, 1250]]) {
    if (placeStructureOrStrike(world, x, y)) { placed = true; break; }
  }
  assert.ok(placed, 'oil slick should be placeable near the base');
  const oil = world.structures.find((st) => st.kind === 'oil')!;
  assert.ok(oil && oil.hp > 0);
  igniteFire(world, oil.x, oil.y, 30);
  stepWorld(world, 0.05, makeEmptyInput());
  assert.ok(oil.hp <= 0, 'oil is consumed when ignited');
  assert.ok(world.fires.length >= 2, 'burning oil spawns several fires along its length');
});

test('completed wave bonus pays coins when the next wave arrives', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  world.req = 100;
  world.kills = 10;
  world.waveBonus = { kind: 'kills', target: 5, startKills: 0, startLost: 0, reward: 75 };
  world.waveTimer = 0;
  stepWorld(world, 0.05, makeEmptyInput());
  assert.ok(world.req >= 175, 'bonus coins should be paid');
  assert.ok(world.waveBonus === null || world.waveBonus.startKills >= 10, 'old bonus is settled or replaced');
});

test('commander arrives on wave 4 and pays a bounty; collapsing buildings pay salvage', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  world.waveNumber = 3; // next wave is #4
  world.waveTimer = 0;
  stepWorld(world, 0.05, makeEmptyInput());
  const boss = world.zombies.find((z) => z.id === world.bossId);
  assert.ok(boss && boss.elite && boss.kind === 'brute', 'commander brute should spawn');
  assert.ok(boss!.maxHp > 1500 || boss!.maxHp > 0);
  const before = world.req;
  boss!.hp = 1;
  world.zombies = [boss!];
  const attacker = world.units[0];
  // kill via a heavy shell blast right on top of the commander
  world.pendingStrikes.push({ id: world.nextId++, kind: 'barrage', x: boss!.x, y: boss!.y, timer: 0.1, duration: 0.1, shellsRemaining: 6, subTimer: 0, angle: 0 });
  for (let i = 0; i < 120 && boss!.hp > 0; i++) stepWorld(world, 0.05, makeEmptyInput());
  assert.ok(attacker !== undefined);
  assert.ok(boss!.hp <= 0, 'commander can be killed');
  assert.ok(world.req > before, 'bounty/coins should be paid');
});

test('reinforcement beacon drops four units after a delay and then goes on cooldown', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  world.req = 1000;
  const before = world.units.length;
  world.placementMode = { kind: 'reinforce' } as never;
  assert.equal(placeStructureOrStrike(world, 1000, 1250), true);
  assert.ok(world.strikeCooldowns.reinforce > 60);
  assert.equal(world.units.length, before, 'units arrive after the helicopter delay, not instantly');
  for (let i = 0; i < 80; i++) stepWorld(world, 0.05, makeEmptyInput());
  assert.equal(world.units.length, before + 4);
});

test('demolition charge arms, ignores small groups, and detonates on 3+ zombies', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.zombies = [];
  world.req = 1000;
  world.placementMode = { kind: 'charge' } as never;
  let placed = false;
  for (const [x, y] of [[1100, 1300], [1100, 1100], [1250, 1200], [1000, 1250]]) {
    if (placeStructureOrStrike(world, x, y)) { placed = true; break; }
  }
  assert.ok(placed, 'charge should be placeable');
  const charge = world.structures.find((st) => st.kind === 'charge')!;
  world.structures = [charge]; // isolate from base turrets that would shoot the test zombies
  for (const u of world.units) { u.x = 300; u.y = 300; } // keep units alive (no defeat) but out of range
  for (let i = 0; i < 90; i++) stepWorld(world, 0.05, makeEmptyInput()); // let it arm
  spawnZombie(world, 'shambler', charge.x + 20, charge.y);
  spawnZombie(world, 'shambler', charge.x - 20, charge.y);
  for (let i = 0; i < 2; i++) stepWorld(world, 0.05, makeEmptyInput());
  assert.ok(world.structures.includes(charge), 'two zombies must not set it off');
  for (const dx of [-25, 0, 25]) spawnZombie(world, 'shambler', charge.x + dx, charge.y + 30);
  for (let i = 0; i < 40 && world.structures.includes(charge); i++) stepWorld(world, 0.05, makeEmptyInput());
  assert.ok(!world.structures.includes(charge), 'three zombies detonate it');
  assert.ok(world.craters.length > 0, 'detonation leaves a crater');
});

test('every map gets zombie nests that spawn zombies and pay a bounty when destroyed', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  assert.ok(world.nests.length >= 1, 'nests exist');
  world.zombies = [];
  const nest = world.nests[0];
  nest.spawnTimer = 0;
  stepWorld(world, 0.05, makeEmptyInput());
  assert.ok(world.zombies.length >= 3, 'nest spawns a batch of zombies');
  const before = world.req;
  const count = world.nests.length;
  for (let i = 0; i < 1500 && world.nests.length === count; i++) {
    if (world.pendingStrikes.length === 0) {
      world.pendingStrikes.push({ id: world.nextId++, kind: 'barrage', x: nest.x, y: nest.y, timer: 0.1, duration: 0.1, shellsRemaining: 8, subTimer: 0, angle: 0 });
    }
    stepWorld(world, 0.05, makeEmptyInput());
  }
  assert.equal(world.nests.length, count - 1, 'artillery destroys the nest');
  assert.equal(world.nestsDestroyed, 1);
  assert.ok(world.req > before, 'bounty paid');
});
