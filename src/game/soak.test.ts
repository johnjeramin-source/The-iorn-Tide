import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHudSnapshot, createWorld, deployUnit, issueMoveOrder, placeStructureOrStrike, stepWorld, selectUnitsInRect } from './engine';
import { MAPS, UNIT_SPECS } from './data';
import { InputState, MapId, PlayerUnitKind, ScenarioId } from './types';

function input(): InputState {
  return { keysHeld: new Set<string>(), virtualMoveX: 0, virtualMoveY: 0, mouseWorldX: 1000, mouseWorldY: 1200, mouseScreenX: 720, mouseScreenY: 450, mouseDownLeft: false, mouseDownRight: false, virtualFiring: false, dragBoxStartScreen: null, dragBoxCurrentScreen: null } as unknown as InputState;
}

const scenarios: ScenarioId[] = ['harbor_break', 'red_tide', 'iron_ark'];
const kinds = Object.keys(UNIT_SPECS) as PlayerUnitKind[];

for (const mapId of Object.keys(MAPS) as MapId[]) {
  test(`soak: ${mapId} runs 4 minutes of play without NaN or crashes`, () => {
    const world = createWorld(scenarios[Object.keys(MAPS).indexOf(mapId) % 3], 'playing', mapId);
    world.req = 20000;
    for (const k of kinds) deployUnit(world, k);
    for (const strike of ['barrage', 'airstrike'] as const) {
      world.placementMode = { kind: strike } as never;
      placeStructureOrStrike(world, 1500, 1200);
    }
    for (let step = 0; step < 4800; step++) {
      if (step % 300 === 0) {
        selectUnitsInRect(world, 0, 0, 4000, 2400);
        issueMoveOrder(world, 1400 + (step % 900), 1100);
        world.req += 500;
        for (const k of kinds) deployUnit(world, k);
      }
      stepWorld(world, 0.05, input());
      if (world.phase === "gameover") break;
    }
    for (const u of world.units) {
      assert.ok(Number.isFinite(u.x) && Number.isFinite(u.y) && Number.isFinite(u.hp), `unit ${u.kind} has NaN`);
    }
    for (const z of world.zombies) {
      assert.ok(Number.isFinite(z.x) && Number.isFinite(z.y) && Number.isFinite(z.hp), `zombie ${z.kind} has NaN`);
    }
    for (const f of world.fires) assert.ok(Number.isFinite(f.x) && f.life > 0);
    assert.ok(world.fires.length <= 20);
    assert.ok(world.rubble.length <= 40);
    const hud = buildHudSnapshot(world);
    assert.ok(Number.isFinite(hud.req));
  });
}
