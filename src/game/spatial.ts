import {
  BridgeRect,
  BuildingBlock,
  Structure,
  Vec2,
  WaterChannel,
} from './types';

export class SpatialGrid {
  private readonly cellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly buckets: number[][];

  constructor(worldWidth: number, worldHeight: number, cellSize = 80) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(worldWidth / cellSize) + 1;
    this.rows = Math.ceil(worldHeight / cellSize) + 1;
    const total = this.cols * this.rows;
    this.buckets = Array.from({ length: total }, () => []);
  }

  clear(): void {
    for (let i = 0; i < this.buckets.length; i++) {
      this.buckets[i].length = 0;
    }
  }

  insert(idx: number, x: number, y: number): void {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cellSize)));
    const cy = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize)));
    this.buckets[cy * this.cols + cx].push(idx);
  }

  queryRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    callback: (itemIdx: number) => void,
  ): void {
    const minCx = Math.max(0, Math.floor(Math.min(x1, x2) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor(Math.max(x1, x2) / this.cellSize));
    const minCy = Math.max(0, Math.floor(Math.min(y1, y2) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor(Math.max(y1, y2) / this.cellSize));
    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowOffset = cy * this.cols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets[rowOffset + cx];
        for (let i = 0; i < bucket.length; i++) callback(bucket[i]);
      }
    }
  }

  queryRadiusInto(x: number, y: number, radius: number, output: Int32Array, maxItems = output.length): number {
    const minCx = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius) / this.cellSize));
    const minCy = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));
    let count = 0;
    for (let cy = minCy; cy <= maxCy && count < maxItems; cy++) {
      const rowOffset = cy * this.cols;
      for (let cx = minCx; cx <= maxCx && count < maxItems; cx++) {
        const bucket = this.buckets[rowOffset + cx];
        for (let i = 0; i < bucket.length && count < maxItems; i++) output[count++] = bucket[i];
      }
    }
    return count;
  }

  queryRadius(
    x: number,
    y: number,
    radius: number,
    callback: (itemIdx: number) => void,
  ): void {
    const minCx = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius) / this.cellSize));
    const minCy = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));

    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowOffset = cy * this.cols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets[rowOffset + cx];
        for (let i = 0; i < bucket.length; i++) {
          callback(bucket[i]);
        }
      }
    }
  }
}

export function resolveCircleRect(
  x: number,
  y: number,
  radius: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): Vec2 | null {
  const closestX = Math.max(rx, Math.min(x, rx + rw));
  const closestY = Math.max(ry, Math.min(y, ry + rh));
  const dx = x - closestX;
  const dy = y - closestY;
  const distSq = dx * dx + dy * dy;

  if (distSq >= radius * radius) {
    return null;
  }

  if (distSq > 0.0001) {
    const dist = Math.sqrt(distSq);
    const overlap = radius - dist;
    return {
      x: x + (dx / dist) * overlap,
      y: y + (dy / dist) * overlap,
    };
  }

  const leftPen = x - rx;
  const rightPen = rx + rw - x;
  const topPen = y - ry;
  const bottomPen = ry + rh - y;
  const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);
  if (minPen === leftPen) return { x: rx - radius, y };
  if (minPen === rightPen) return { x: rx + rw + radius, y };
  if (minPen === topPen) return { x, y: ry - radius };
  return { x, y: ry + rh + radius };
}

/**
 * Exact Circle vs Oriented Bounding Box (OBB) collision for rotatable concrete barricades.
 */
export function resolveCircleOBB(
  x: number,
  y: number,
  radius: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number,
): Vec2 | null {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const dx = x - cx;
  const dy = y - cy;

  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  const hw = w * 0.5;
  const hh = h * 0.5;
  const clampedX = Math.max(-hw, Math.min(localX, hw));
  const clampedY = Math.max(-hh, Math.min(localY, hh));

  const ldx = localX - clampedX;
  const ldy = localY - clampedY;
  const distSq = ldx * ldx + ldy * ldy;

  if (distSq >= radius * radius) return null;

  let pushLX = 0;
  let pushLY = 0;
  if (distSq > 0.0001) {
    const dist = Math.sqrt(distSq);
    const overlap = radius - dist;
    pushLX = (ldx / dist) * overlap;
    pushLY = (ldy / dist) * overlap;
  } else {
    const px = hw - Math.abs(localX) + radius;
    const py = hh - Math.abs(localY) + radius;
    if (px < py) {
      pushLX = localX >= 0 ? px : -px;
    } else {
      pushLY = localY >= 0 ? py : -py;
    }
  }

  const invCos = Math.cos(angle);
  const invSin = Math.sin(angle);
  return {
    x: x + pushLX * invCos - pushLY * invSin,
    y: y + pushLX * invSin + pushLY * invCos,
  };
}

export function pushOutOfBuildings(
  x: number,
  y: number,
  radius: number,
  buildings: BuildingBlock[],
): Vec2 {
  let nx = x;
  let ny = y;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (
      nx + radius < b.x ||
      nx - radius > b.x + b.w ||
      ny + radius < b.y ||
      ny - radius > b.y + b.h
    ) {
      continue;
    }
    const pushed = resolveCircleRect(nx, ny, radius, b.x, b.y, b.w, b.h);
    if (pushed) {
      nx = pushed.x;
      ny = pushed.y;
    }
  }
  return { x: nx, y: ny };
}

export function pushOutOfWalls(
  x: number,
  y: number,
  radius: number,
  structures: Structure[],
  forZombie = false,
): Vec2 {
  let nx = x;
  let ny = y;
  for (let i = 0; i < structures.length; i++) {
    const s = structures[i];
    if (s.hp <= 0) continue;
    if (s.kind !== 'wall' && s.kind !== 'gate') continue;
    if (s.kind === 'gate' && !forZombie && (s.gateOpen ?? 0) > 0.35) continue;
    const maxExtent = Math.max(s.w, s.h) * 0.65 + radius;
    if (Math.abs(nx - s.x) > maxExtent || Math.abs(ny - s.y) > maxExtent) {
      continue;
    }
    const pushed = resolveCircleOBB(nx, ny, radius, s.x, s.y, s.w, s.h, s.angle);
    if (pushed) {
      nx = pushed.x;
      ny = pushed.y;
    }
  }
  return { x: nx, y: ny };
}

/** Keeps ground units and infected outside the bunker hull while allowing passage
 * through the centered blast-door opening only when the door is fully open. */
export function pushOutOfBunker(
  x: number,
  y: number,
  radius: number,
  structures: Structure[],
): Vec2 {
  let nx = x;
  let ny = y;
  for (let i = 0; i < structures.length; i++) {
    const bunker = structures[i];
    if (bunker.kind !== 'fob' || bunker.hp <= 0) continue;
    const hw = bunker.w * 0.5;
    const hh = bunker.h * 0.5;
    const left = bunker.x - hw;
    const right = bunker.x + hw;
    const top = bunker.y - hh;
    const bottom = bunker.y + hh;
    const doorOpen = !bunker.doorLocked && (bunker.gateOpen ?? 0) > 0.85;
    const doorHalfWidth = doorOpen ? 25 : 0;
    if (nx + radius < left || nx - radius > right || ny + radius < top || ny - radius > bottom) continue;
    const parts: Array<[number, number, number, number]> = [
      [left, top, bunker.w, 12],
      [left, top, 12, bunker.h],
      [right - 12, top, 12, bunker.h],
    ];
    if (doorHalfWidth > 0) {
      const sideWidth = Math.max(0, hw - doorHalfWidth - 6);
      parts.push([left, bottom - 12, sideWidth, 12], [bunker.x + doorHalfWidth + 6, bottom - 12, sideWidth, 12]);
    } else {
      parts.push([left, bottom - 12, bunker.w, 12]);
    }
    for (const [rx, ry, rw, rh] of parts) {
      const pushed = resolveCircleRect(nx, ny, radius, rx, ry, rw, rh);
      if (pushed) { nx = pushed.x; ny = pushed.y; }
    }
  }
  return { x: nx, y: ny };
}

export function isOnBridge(x: number, y: number, bridges: BridgeRect[]): boolean {
  for (let i = 0; i < bridges.length; i++) {
    const br = bridges[i];
    if (x >= br.x - 10 && x <= br.x + br.w + 10 && y >= br.y - 10 && y <= br.y + br.h + 10) {
      return true;
    }
  }
  return false;
}

export function pushOutOfWater(
  x: number,
  y: number,
  radius: number,
  waterChannels: WaterChannel[],
  bridges: BridgeRect[],
): Vec2 {
  if (waterChannels.length === 0 || isOnBridge(x, y, bridges)) {
    return { x, y };
  }
  let nx = x;
  let ny = y;
  for (let i = 0; i < waterChannels.length; i++) {
    const w = waterChannels[i];
    const pushed = resolveCircleRect(nx, ny, radius, w.x, w.y, w.w, w.h);
    if (pushed && !isOnBridge(pushed.x, pushed.y, bridges)) {
      nx = pushed.x;
      ny = pushed.y;
    }
  }
  return { x: nx, y: ny };
}

export function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;

  const p = [-dx, dx, -dy, dy];
  const q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];

  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-8) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

export function hasLineOfSight(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  buildings: BuildingBlock[],
): boolean {
  const minX = x1 < x2 ? x1 : x2;
  const maxX = x1 > x2 ? x1 : x2;
  const minY = y1 < y2 ? y1 : y2;
  const maxY = y1 > y2 ? y1 : y2;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (b.x + b.w < minX || b.x > maxX || b.y + b.h < minY || b.y > maxY) {
      continue;
    }
    if (segmentIntersectsRect(x1, y1, x2, y2, b.x, b.y, b.w, b.h)) {
      return false;
    }
  }
  return true;
}
