import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, deployUnit, repairSelectedVehicles } from './engine';

test('field repair restores selected damaged vehicles near the FOB and charges requisition', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.req = 100000;
  const result = deployUnit(world, 'humvee');
  assert.equal(result.ok, true);
  const vehicle = result.unit!;
  vehicle.x = world.fobPos.x;
  vehicle.y = world.fobPos.y;
  vehicle.hp = Math.max(1, vehicle.maxHp - 20);
  vehicle.selected = true;
  const beforeReq = world.req;

  const repair = repairSelectedVehicles(world);
  assert.equal(repair.repaired, 1);
  assert.ok(vehicle.hp > vehicle.maxHp - 20);
  assert.ok(vehicle.hp <= vehicle.maxHp);
  assert.equal(world.req, beforeReq - repair.cost);
});

test('field repair refuses vehicles outside a service area', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.req = 100000;
  const result = deployUnit(world, 'humvee');
  assert.equal(result.ok, true);
  const vehicle = result.unit!;
  vehicle.x = world.width - 100;
  vehicle.y = world.height - 100;
  vehicle.hp = Math.max(1, vehicle.maxHp - 20);
  vehicle.selected = true;

  const repair = repairSelectedVehicles(world);
  assert.equal(repair.repaired, 0);
  assert.match(repair.reason ?? '', /near the FOB or a supply truck/i);
});

test('field repair does not spend requisition when funds are insufficient', () => {
  const world = createWorld('harbor_break', 'playing', 'port_la');
  world.req = 100000;
  const result = deployUnit(world, 'humvee');
  assert.equal(result.ok, true);
  const vehicle = result.unit!;
  vehicle.x = world.fobPos.x;
  vehicle.y = world.fobPos.y;
  vehicle.hp = Math.max(1, vehicle.maxHp - 20);
  vehicle.selected = true;
  world.req = 0;
  const beforeHp = vehicle.hp;

  const repair = repairSelectedVehicles(world);
  assert.equal(repair.repaired, 0);
  assert.equal(vehicle.hp, beforeHp);
  assert.equal(world.req, 0);
  assert.match(repair.reason ?? '', /Need .* COINS/i);
});
