import { drawLighting } from './lighting';
import {
  MAPS,
  OPS_VIEW_ZOOM_THRESHOLD,
  STRIKE_SPECS,
  STRUCTURE_SPECS,
  UNIT_SPECS,
  WALL_TIERS,
  ZOMBIE_SPECS,
} from './data';
import { isNearSupplyOrFob } from './engine';
import { GameWorld, InputState, NavalShip, PlayerUnit, PlayerUnitKind, Zombie } from './types';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// Offscreen static terrain cache keyed by map dimensions & mapId to keep frame render times minimal
const terrainCache = new Map<string, HTMLCanvasElement>();
const fogGradientCache = new WeakMap<CanvasRenderingContext2D, { key: string; gradient: CanvasGradient }>();

function getOrBuildTerrainCache(world: GameWorld): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = `${world.mapId}:${world.width}x${world.height}`;
  const cached = terrainCache.get(key);
  if (cached) return cached;

  const off = document.createElement('canvas');
  off.width = world.width;
  off.height = world.height;
  const octx = off.getContext('2d');
  if (!octx) return null;

  const coastX = world.coastlineX;

  // Deep ocean gradient
  const seaGrad = octx.createLinearGradient(0, 0, coastX, 0);
  seaGrad.addColorStop(0, '#051422');
  seaGrad.addColorStop(0.7, '#082238');
  seaGrad.addColorStop(1, '#0d324d');
  octx.fillStyle = seaGrad;
  octx.fillRect(0, 0, coastX, world.height);

  // Urban concrete landmass base + subtle gridded paving blocks
  octx.fillStyle = MAPS[world.mapId]?.groundColor ?? '#182029';
  octx.fillRect(coastX, 0, world.width - coastX, world.height);

  // Cached procedural surface texture: subtle aggregate, sand and concrete grain.
  // It is baked once per map into the terrain canvas, so it adds detail without
  // creating per-frame particle or draw-call overhead.
  let textureSeed = world.mapId.length * 7919 + world.width;
  const seeded = () => {
    textureSeed = (textureSeed * 1664525 + 1013904223) >>> 0;
    return textureSeed / 4294967296;
  };
  for (let i = 0; i < 5200; i++) {
    const tx = coastX + 48 + seeded() * (world.width - coastX - 64);
    const ty = seeded() * world.height;
    const radius = 0.6 + seeded() * 2.1;
    octx.fillStyle = seeded() > 0.52 ? 'rgba(226,232,240,0.035)' : 'rgba(0,0,0,0.055)';
    octx.beginPath();
    octx.arc(tx, ty, radius, 0, Math.PI * 2);
    octx.fill();
  }
  // Fine expansion joints and worn concrete seams.
  octx.strokeStyle = 'rgba(203,213,225,0.035)';
  octx.lineWidth = 1;
  for (let gx = coastX + 90; gx < world.width; gx += 260) {
    octx.beginPath();
    octx.moveTo(gx, 0);
    octx.lineTo(gx, world.height);
    octx.stroke();
  }

  drawMapDecor(octx, world);

  octx.fillStyle = 'rgba(255, 255, 255, 0.018)';
  for (let gx = coastX + 40; gx < world.width; gx += 180) {
    for (let gy = 40; gy < world.height; gy += 180) {
      octx.fillRect(gx, gy, 140, 140);
    }
  }

  // Sandy coastal beach & concrete seawall
  const sandGrad = octx.createLinearGradient(coastX, 0, coastX + 44, 0);
  sandGrad.addColorStop(0, '#4c4538');
  sandGrad.addColorStop(1, '#262b33');
  octx.fillStyle = sandGrad;
  octx.fillRect(coastX, 0, 44, world.height);

  octx.fillStyle = '#475569';
  octx.fillRect(coastX - 10, 0, 22, world.height);
  octx.strokeStyle = '#64748b';
  octx.lineWidth = 2;
  octx.beginPath();
  octx.moveTo(coastX + 11, 0);
  octx.lineTo(coastX + 11, world.height);
  octx.stroke();

  // Harbor Pier Causeway
  const fy = world.fobPos.y;
  octx.fillStyle = '#475569';
  octx.fillRect(coastX - 125, fy - 90, 150, 180);
  octx.fillStyle = '#334155';
  octx.fillRect(coastX - 117, fy - 82, 134, 164);
  octx.strokeStyle = '#94a3b8';
  octx.lineWidth = 2;
  octx.strokeRect(coastX - 125, fy - 90, 150, 180);
  octx.fillStyle = '#eab308';
  for (let by = fy - 74; by <= fy + 74; by += 37) {
    octx.fillRect(coastX - 118, by - 3, 6, 6);
  }

  // Multi-lane roads with concrete curbs, medians & crosswalk markings
  for (const r of world.roads) {
    if (r.axis === 'h') {
      const startX = r.start ?? coastX;
      const endX = r.end ?? world.width;
      const wLen = endX - startX;
      // Sidewalks
      octx.fillStyle = '#313944';
      octx.fillRect(startX, r.center - r.width * 0.5 - 12, wLen, r.width + 24);
      // Asphalt roadbed
      octx.fillStyle = '#222933';
      octx.fillRect(startX, r.center - r.width * 0.5, wLen, r.width);

      // Curb edges
      octx.fillStyle = '#475569';
      octx.fillRect(startX, r.center - r.width * 0.5, wLen, 3);
      octx.fillRect(startX, r.center + r.width * 0.5 - 3, wLen, 3);

      // Center median or double yellow lines
      if (r.hasMedian) {
        octx.fillStyle = '#3f4956';
        octx.fillRect(startX, r.center - 6, wLen, 12);
        octx.fillStyle = '#eab308';
        octx.fillRect(startX, r.center - 7, wLen, 2);
        octx.fillRect(startX, r.center + 5, wLen, 2);
      } else {
        octx.fillStyle = '#ca8a04';
        octx.fillRect(startX, r.center - 3, wLen, 2);
        octx.fillRect(startX, r.center + 1, wLen, 2);
      }

      // Dashed white lane dividers
      octx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
      octx.lineWidth = 2;
      octx.setLineDash([22, 20]);
      octx.beginPath();
      if (r.lanes >= 4) {
        const laneOff = r.width * 0.25;
        octx.moveTo(startX + 16, r.center - laneOff);
        octx.lineTo(endX - 16, r.center - laneOff);
        octx.moveTo(startX + 16, r.center + laneOff);
        octx.lineTo(endX - 16, r.center + laneOff);
      }
      octx.stroke();
      octx.setLineDash([]);
    } else {
      const startY = r.start ?? 0;
      const endY = r.end ?? world.height;
      const hLen = endY - startY;
      octx.fillStyle = '#313944';
      octx.fillRect(r.center - r.width * 0.5 - 12, startY, r.width + 24, hLen);
      octx.fillStyle = '#222933';
      octx.fillRect(r.center - r.width * 0.5, startY, r.width, hLen);

      octx.fillStyle = '#475569';
      octx.fillRect(r.center - r.width * 0.5, startY, 3, hLen);
      octx.fillRect(r.center + r.width * 0.5 - 3, startY, 3, hLen);

      if (r.hasMedian) {
        octx.fillStyle = '#3f4956';
        octx.fillRect(r.center - 6, startY, 12, hLen);
        octx.fillStyle = '#eab308';
        octx.fillRect(r.center - 7, startY, 2, hLen);
        octx.fillRect(r.center + 5, startY, 2, hLen);
      } else {
        octx.fillStyle = '#ca8a04';
        octx.fillRect(r.center - 3, startY, 2, hLen);
        octx.fillRect(r.center + 1, startY, 2, hLen);
      }

      octx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
      octx.lineWidth = 2;
      octx.setLineDash([22, 20]);
      octx.beginPath();
      if (r.lanes >= 4) {
        const laneOff = r.width * 0.25;
        octx.moveTo(r.center - laneOff, startY + 16);
        octx.lineTo(r.center - laneOff, endY - 16);
        octx.moveTo(r.center + laneOff, startY + 16);
        octx.lineTo(r.center + laneOff, endY - 16);
      }
      octx.stroke();
      octx.setLineDash([]);
    }
  }

  // Intersection zebra crosswalks
  octx.fillStyle = 'rgba(226, 232, 240, 0.36)';
  for (const hr of world.roads) {
    if (hr.axis !== 'h') continue;
    for (const vr of world.roads) {
      if (vr.axis !== 'v') continue;
      // Intersection apron
      octx.fillStyle = '#252d38';
      octx.fillRect(
        vr.center - vr.width * 0.5,
        hr.center - hr.width * 0.5,
        vr.width,
        hr.width,
      );
      octx.fillStyle = 'rgba(226, 232, 240, 0.32)';
      for (let cx = vr.center - vr.width * 0.4; cx < vr.center + vr.width * 0.4; cx += 14) {
        octx.fillRect(cx, hr.center - hr.width * 0.5 - 10, 6, 8);
        octx.fillRect(cx, hr.center + hr.width * 0.5 + 2, 6, 8);
      }
    }
  }

  // Airfield 2,200m concrete runway on Bayfront Airfield map
  if (world.mapId === 'airfield') {
    octx.fillStyle = '#2b3440';
    octx.fillRect(1080, 1020, 2240, 270);
    octx.strokeStyle = '#94a3b8';
    octx.lineWidth = 3;
    octx.strokeRect(1080, 1020, 2240, 270);
    octx.fillStyle = 'rgba(248, 250, 252, 0.55)';
    for (let rx = 1160; rx < 3230; rx += 95) {
      octx.fillRect(rx, 1151, 48, 8);
    }
    for (let py = 1045; py < 1265; py += 26) {
      octx.fillRect(1100, py, 38, 12);
      octx.fillRect(3260, py, 38, 12);
    }
  }

  // Water canals (Floodzone Bridges)
  for (const wc of world.staticWater) {
    octx.fillStyle = '#0b2d48';
    octx.fillRect(wc.x, wc.y, wc.w, wc.h);
    octx.strokeStyle = '#38bdf8';
    octx.lineWidth = 2;
    octx.strokeRect(wc.x, wc.y, wc.w, wc.h);
  }

  // Concrete highway bridges over canals
  for (const br of world.bridges) {
    octx.fillStyle = '#475569';
    octx.fillRect(br.x, br.y, br.w, br.h);
    octx.fillStyle = '#2a333f';
    octx.fillRect(br.x + 4, br.y + 8, br.w - 8, br.h - 16);
    octx.strokeStyle = '#cbd5e1';
    octx.lineWidth = 3;
    octx.beginPath();
    octx.moveTo(br.x, br.y + 4);
    octx.lineTo(br.x + br.w, br.y + 4);
    octx.moveTo(br.x, br.y + br.h - 4);
    octx.lineTo(br.x + br.w, br.y + br.h - 4);
    octx.stroke();
  }

  terrainCache.set(key, off);
  return off;
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  input: InputState,
  width: number,
  height: number,
  rainIntensity: 'off' | 'light' | 'normal' = 'normal',
  nightVisibility: 'normal' | 'bright' = 'normal',
  screenShake = true,
): void {
  ctx.save();
  ctx.fillStyle = '#07131e';
  ctx.fillRect(0, 0, width, height);

  const zoom = world.camera.zoom;
  const camX = world.camera.x + (screenShake ? world.camera.shakeX : 0);
  const camY = world.camera.y + (screenShake ? world.camera.shakeY : 0);
  const opsBlend = clamp01((OPS_VIEW_ZOOM_THRESHOLD + 0.08 - zoom) / 0.18);

  const halfW = (width * 0.5) / zoom + 90;
  const halfH = (height * 0.5) / zoom + 90;
  const minVisX = camX - halfW;
  const maxVisX = camX + halfW;
  const minVisY = camY - halfH;
  const maxVisY = camY + halfH;

  ctx.translate(width * 0.5, height * 0.5);
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  // 1. Cached Ocean, Roads, Canals & Bridges (visible-slice blit) + Animated Surf
  drawOceanAndLand(ctx, world, opsBlend, minVisX, maxVisX, minVisY, maxVisY);

  // 2. Sectors & Ops Grid
  drawSectorsAndOpsGrid(ctx, world, opsBlend);

  // 3. Persistent Blood Splatters & Explosion Craters
  if (opsBlend < 0.85) {
    ctx.save();
    ctx.globalAlpha = 1 - opsBlend;
    const fastDecals = world.lowLagMode || world.graphicsQuality !== 'high';
    const decalLimit = world.graphicsQuality === 'low' ? 28 : world.graphicsQuality === 'medium' ? 80 : world.bloodDecals.length;
    const decalStart = Math.max(0, world.bloodDecals.length - decalLimit);
    for (let i = decalStart; i < world.bloodDecals.length; i++) {
      const b = world.bloodDecals[i];
      if (b.alpha <= 0.01) continue;
      if (b.x < minVisX || b.x > maxVisX || b.y < minVisY || b.y > maxVisY) continue;
      ctx.fillStyle = b.variant === 2 ? `rgba(127, 29, 29, ${b.alpha})` : `rgba(88, 12, 18, ${b.alpha})`;
      if (fastDecals) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        ctx.beginPath();
        ctx.ellipse(0, 0, b.r * 1.15, b.r * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(b.r * 0.75, -b.r * 0.35, b.r * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    const craterLimit = world.graphicsQuality === 'low' ? 12 : world.graphicsQuality === 'medium' ? 35 : world.craters.length;
    const craterStart = Math.max(0, world.craters.length - craterLimit);
    for (let i = craterStart; i < world.craters.length; i++) {
      const c = world.craters[i];
      if (c.x < minVisX || c.x > maxVisX || c.y < minVisY || c.y > maxVisY) continue;
      const fade = Math.min(1, c.life / 2);
      if (fade <= 0) continue;
      ctx.fillStyle = `rgba(12, 16, 22, ${c.alpha * fade})`;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      ctx.fill();
      if (!fastDecals) {
        ctx.strokeStyle = `rgba(71, 85, 105, ${0.45 * fade})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    for (const n of world.nests) {
      if (n.x < minVisX - 60 || n.x > maxVisX + 60 || n.y < minVisY - 60 || n.y > maxVisY + 60) continue;
      const pulse = 1 + Math.sin(n.pulse * 3) * 0.06;
      ctx.fillStyle = 'rgba(40, 16, 56, 0.9)';
      ctx.beginPath();
      ctx.ellipse(n.x, n.y, 44 * pulse, 36 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(126, 34, 206, 0.65)';
      ctx.beginPath();
      ctx.ellipse(n.x, n.y, 26 * pulse, 20 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(244, 114, 182, 0.85)';
      ctx.beginPath();
      ctx.arc(n.x, n.y, 7 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(n.x - 30, n.y - 52, 60, 6);
      ctx.fillStyle = '#c084fc';
      ctx.fillRect(n.x - 30, n.y - 52, 60 * Math.max(0, n.hp / n.maxHp), 6);
    }
    for (const tf of world.tidalFlats) {
      if (tf.x + tf.w < minVisX || tf.x > maxVisX || tf.y + tf.h < minVisY || tf.y > maxVisY) continue;
      ctx.fillStyle = 'rgba(92, 82, 64, 0.85)'; // wet mudflat
      ctx.fillRect(tf.x, tf.y, tf.w, tf.h);
      const water = Math.max(0, Math.min(1, (world.tide - 0.25) / 0.45));
      if (water > 0.02) {
        ctx.fillStyle = `rgba(11, 45, 72, ${0.92 * water})`;
        ctx.fillRect(tf.x, tf.y, tf.w, tf.h);
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.8 * water})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(tf.x, tf.y, tf.w, tf.h);
      }
    }
    for (const f of world.fires) {
      if (f.x < minVisX || f.x > maxVisX || f.y < minVisY || f.y > maxVisY) continue;
      const k = Math.min(1, f.life / 2);
      const flick = 0.85 + 0.15 * Math.sin(world.elapsedSec * 14 + f.x * 0.1);
      ctx.fillStyle = `rgba(30, 18, 10, ${0.5 * k})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(249, 115, 22, ${0.38 * k * flick})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.radius * 0.85 * flick, 0, Math.PI * 2);
      ctx.fill();
      if (!fastDecals) {
        ctx.fillStyle = `rgba(253, 224, 71, ${0.5 * k * flick})`;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius * 0.42 * flick, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 4. Supply Links & Crates
  drawSupplyLinksAndCrates(ctx, world, opsBlend);

  // 5. Naval Task Force (Aircraft Carrier + Battleships/Destroyers)
  if (minVisX < world.coastlineX + 200) {
    drawNavalTaskForce(ctx, world, opsBlend);
  }

  // 6. Structures (FOBs, Rotatable Walls, Blast Gates, Sentries, 40mm Flak, Hydra Rocket Pods)
  drawStructures(ctx, world, opsBlend, minVisX, maxVisX, minVisY, maxVisY);

  // 7. Ground Units (excluding airborne helicopters)
  for (let i = 0; i < world.units.length; i++) {
    const u = world.units[i];
    if (u.x < minVisX - 60 || u.x > maxVisX + 60 || u.y < minVisY - 60 || u.y > maxVisY + 60) continue;
    if (!UNIT_SPECS[u.kind].isAir) {
      drawPlayerUnit(ctx, u, world, opsBlend);
    }
  }

  drawCivilians(ctx, world, minVisX, maxVisX, minVisY, maxVisY);

  // 8. Articulated Zombies (viewport culled)
  if (opsBlend < 0.92) {
    ctx.save();
    ctx.globalAlpha = 1 - opsBlend * 0.85;
    for (let i = 0; i < world.zombies.length; i++) {
      const z = world.zombies[i];
      if (z.x < minVisX || z.x > maxVisX || z.y < minVisY || z.y > maxVisY) continue;
      if (world.graphicsQuality === 'low' || (world.graphicsQuality === 'medium' && zoom < 0.58)) {
        const dot = z.elite ? 7 : 5;
        ctx.fillStyle = z.elite ? '#fbbf24' : ZOMBIE_SPECS[z.kind].color;
        ctx.beginPath(); ctx.arc(z.x, z.y, dot * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(2, 6, 23, 0.95)'; ctx.lineWidth = 1.25; ctx.stroke();
      } else {
        if (!drawZombieCached(ctx, z, zoom, world.graphicsQuality)) drawZombie(ctx, z, zoom, world.graphicsQuality);
      }
    }
    ctx.restore();
  }
  if (!world.lowLagMode && world.damageNumbersEnabled && opsBlend < 0.8) {
    ctx.save();
    ctx.font = '700 12px sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 2.5;
    for (let i = 0; i < world.damageNumbers.length; i++) {
      const number = world.damageNumbers[i];
      if (!number.active || number.x < minVisX || number.x > maxVisX || number.y < minVisY || number.y > maxVisY) continue;
      ctx.globalAlpha = Math.min(1, number.life * 1.8); ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)'; ctx.fillStyle = '#fde68a';
      ctx.strokeText(number.label, number.x, number.y); ctx.fillText(number.label, number.x, number.y);
    }
    ctx.restore();
  }
  if (opsBlend > 0.1) {
    drawHordeHeatmap(ctx, world, opsBlend);
  }

  // 9. 2.5D Extruded City Buildings
  drawBuildings(ctx, world, camX, camY, opsBlend, minVisX, maxVisX, minVisY, maxVisY);

  // 10. Airborne Helicopters (above buildings)
  for (let i = 0; i < world.units.length; i++) {
    const u = world.units[i];
    if (u.x < minVisX - 80 || u.x > maxVisX + 80 || u.y < minVisY - 80 || u.y > maxVisY + 80) continue;
    if (UNIT_SPECS[u.kind].isAir) {
      drawPlayerUnit(ctx, u, world, opsBlend);
    }
  }

  // 11. Vehicle Headlights in low-visibility weather
  if (!world.lowLagMode && opsBlend < 0.5 && world.weather.kind !== 'clear') {
    drawWeatherHeadlights(ctx, world, minVisX, maxVisX, minVisY, maxVisY);
  }

  // 12. Projectiles & Tracers
  drawProjectiles(ctx, world, minVisX, maxVisX, minVisY, maxVisY);

  // 13. Pending Strikes
  drawPendingStrikes(ctx, world);

  // 14. Pooled Particles
  drawParticles(ctx, world, minVisX, maxVisX, minVisY, maxVisY);

  // 15. Placement Preview & Direct Control Aim Line
  if (world.phase === 'playing') {
    drawPlacementPreview(ctx, world, input);
    drawDirectControlReticle(ctx, world, input);
  }

  // 16. NATO Ops Overlay
  if (opsBlend > 0.12) {
    drawNatoOpsOverlay(ctx, world, opsBlend);
  }

  drawLighting(ctx, world, minVisX, maxVisX, minVisY, maxVisY, opsBlend, nightVisibility);
  drawFogOfWar(ctx, world, minVisX, maxVisX, minVisY, maxVisY);
  ctx.restore();

  // 17. Dynamic Screen-Space Weather Overlay (Rain, Fog, Lightning)
  drawWeatherOverlay(ctx, world, width, height, opsBlend, rainIntensity);
  if (nightVisibility === 'bright') { ctx.save(); ctx.fillStyle = 'rgba(255, 238, 190, 0.035)'; ctx.fillRect(0, 0, width, height); ctx.restore(); }

  // 18. Screen-space Drag Selection Box
  if (input.dragBoxStartScreen && input.dragBoxCurrentScreen && world.phase === 'playing') {
    const x1 = Math.min(input.dragBoxStartScreen.x, input.dragBoxCurrentScreen.x);
    const y1 = Math.min(input.dragBoxStartScreen.y, input.dragBoxCurrentScreen.y);
    const w = Math.abs(input.dragBoxCurrentScreen.x - input.dragBoxStartScreen.x);
    const h = Math.abs(input.dragBoxCurrentScreen.y - input.dragBoxStartScreen.y);
    if (w > 6 || h > 6) {
      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(x1, y1, w, h);
      ctx.strokeRect(x1, y1, w, h);
      ctx.restore();
    }
  }
}

function drawFogOfWar(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): void {
  if (!world.fogEnabled || world.phase !== 'playing' && world.phase !== 'paused') return;
  const cell = 100;
  const minGX = Math.max(0, Math.floor(minX / cell));
  const maxGX = Math.min(39, Math.floor(maxX / cell));
  const minGY = Math.max(0, Math.floor(minY / cell));
  const maxGY = Math.min(23, Math.floor(maxY / cell));
  ctx.save();
  for (let gy = minGY; gy <= maxGY; gy++) {
    for (let gx = minGX; gx <= maxGX; gx++) {
      const index = gy * 40 + gx;
      if (world.fogVisible[index]) continue;
      ctx.fillStyle = world.fogExplored[index] ? 'rgba(2, 8, 16, 0.58)' : 'rgba(2, 7, 14, 0.94)';
      ctx.fillRect(gx * cell, gy * cell, cell + 1, cell + 1);
    }
  }
  ctx.restore();
}

function drawOceanAndLand(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  opsBlend: number,
  minVisX: number,
  maxVisX: number,
  minVisY: number,
  maxVisY: number,
): void {
  const coastX = world.coastlineX;
  const cached = getOrBuildTerrainCache(world);
  if (cached) {
    const sx = Math.max(0, Math.floor(minVisX));
    const sy = Math.max(0, Math.floor(minVisY));
    const ex = Math.min(world.width, Math.ceil(maxVisX));
    const ey = Math.min(world.height, Math.ceil(maxVisY));
    const sw = ex - sx;
    const sh = ey - sy;
    if (sw > 0 && sh > 0) {
      ctx.drawImage(cached, sx, sy, sw, sh, sx, sy, sw, sh);
    }
  } else {
    ctx.fillStyle = '#082036';
    ctx.fillRect(-400, -400, coastX + 400, world.height + 800);
    ctx.fillStyle = '#182029';
    ctx.fillRect(coastX, 0, world.width - coastX, world.height);
  }

  if (opsBlend > 0.15) {
    ctx.fillStyle = `rgba(8, 17, 29, ${opsBlend * 0.45})`;
    ctx.fillRect(0, 0, world.width, world.height);
  }

  // Animated ocean ripples & surf line (skipped in lowLagMode and offscreen)
  if (!world.lowLagMode && opsBlend < 0.9 && minVisX < coastX + 20) {
    ctx.save();
    ctx.globalAlpha = (1 - opsBlend) * 0.2;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const t = world.elapsedSec;
    const yStart = Math.max(50, Math.floor(minVisY / 165) * 165 + 50);
    const yEnd = Math.min(world.height, maxVisY + 50);
    const xEnd = Math.min(coastX - 30, maxVisX);
    for (let x = 40; x < xEnd; x += 90) {
      for (let y = yStart; y < yEnd; y += 165) {
        const waveY = y + Math.sin(t * 1.4 + x * 0.03) * 14;
        ctx.moveTo(x, waveY);
        ctx.quadraticCurveTo(x + 18, waveY - 7, x + 36, waveY);
      }
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(186, 230, 253, 0.45)';
    ctx.lineWidth = 3;
    const surfOff = Math.sin(world.elapsedSec * 2) * 3;
    ctx.beginPath();
    ctx.moveTo(coastX - 12 + surfOff, Math.max(0, minVisY));
    ctx.lineTo(coastX - 12 + surfOff, Math.min(world.height, maxVisY));
    ctx.stroke();
    ctx.restore();
  }
}

function drawSectorsAndOpsGrid(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  opsBlend: number,
): void {
  const coastX = world.coastlineX;

  if (opsBlend > 0.1) {
    ctx.save();
    ctx.globalAlpha = opsBlend * 0.25;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = coastX; x <= world.width; x += 400) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, world.height);
    }
    for (let y = 0; y <= world.height; y += 400) {
      ctx.moveTo(coastX, y);
      ctx.lineTo(world.width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  for (const sec of world.sectors) {
    const color =
      sec.owner === 'player'
        ? '#38bdf8'
        : sec.owner === 'neutral'
          ? '#f59e0b'
          : '#ef4444';

    ctx.save();
    ctx.fillStyle =
      sec.owner === 'player'
        ? 'rgba(56, 189, 248, 0.09)'
        : sec.owner === 'neutral'
          ? 'rgba(245, 158, 11, 0.08)'
          : 'rgba(239, 68, 68, 0.08)';
    ctx.beginPath();
    ctx.arc(sec.x, sec.y, sec.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 / Math.max(0.4, world.camera.zoom * 0.8);
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.arc(sec.x, sec.y, sec.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (sec.captureProgress > 0) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(
        sec.x,
        sec.y,
        sec.radius - 8,
        -Math.PI * 0.5,
        -Math.PI * 0.5 + (Math.PI * 2 * sec.captureProgress) / 100,
      );
      ctx.stroke();
    }

    ctx.font = '700 15px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.fillText(`${sec.code} · ${sec.name.toUpperCase()}`, sec.x, sec.y - sec.radius - 12);
    ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(
      sec.owner === 'player'
        ? `EVAC ${Math.floor(sec.civiliansEvacuated)}/${sec.civiliansTotal}`
        : `CAPTURE ${Math.round(sec.captureProgress)}%`,
      sec.x,
      sec.y + sec.radius + 20,
    );
    ctx.restore();
  }
}

function drawSupplyLinksAndCrates(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  opsBlend: number,
): void {
  ctx.save();
  ctx.strokeStyle = `rgba(250, 204, 21, ${0.18 + opsBlend * 0.35})`;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);

  for (const s of world.structures) {
    if (s.hp > 0 && s.kind === 'fob') {
      ctx.beginPath();
      ctx.moveTo(world.carrierPos.x + 80, world.carrierPos.y);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
  }
  ctx.restore();

  for (const c of world.supplyCrates) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#d97706';
    ctx.fillRect(-10, -10, 20, 20);
    ctx.strokeStyle = '#fef3c7';
    ctx.lineWidth = 2;
    ctx.strokeRect(-10, -10, 20, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-2, -6, 4, 12);
    ctx.fillRect(-6, -2, 12, 4);
    ctx.restore();
  }
}

function drawWarship(
  ctx: CanvasRenderingContext2D,
  ship: NavalShip,
  elapsed: number,
): void {
  ctx.save();
  ctx.translate(ship.x, ship.y);

  const halfL = ship.length * 0.5;
  const halfB = ship.beam * 0.5;

  // Bow & stern wake
  ctx.fillStyle = 'rgba(186, 230, 253, 0.1)';
  ctx.beginPath();
  ctx.ellipse(-6, 0, halfB * 1.45, halfL * 1.18, 0, 0, Math.PI * 2);
  ctx.fill();

  // Armor steel hull
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(0, -halfL); // pointed bow north
  ctx.lineTo(halfB * 0.85, -halfL * 0.45);
  ctx.lineTo(halfB, halfL * 0.65);
  ctx.lineTo(halfB * 0.65, halfL);
  ctx.lineTo(-halfB * 0.65, halfL);
  ctx.lineTo(-halfB, halfL * 0.65);
  ctx.lineTo(-halfB * 0.85, -halfL * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Teak / non-skid main deck
  ctx.fillStyle = ship.kind === 'battleship' ? '#475569' : ship.kind === 'gunboat' ? '#3f5364' : '#263242';
  ctx.fillRect(-halfB * 0.58, -halfL * 0.68, halfB * 1.16, halfL * 1.38);

  // Armored citadel & bridge superstructure
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(-halfB * 0.42, -halfL * 0.16, halfB * 0.84, halfL * 0.36);
  ctx.fillStyle = '#64748b';
  ctx.fillRect(-halfB * 0.25, -halfL * 0.08, halfB * 0.5, halfL * 0.16);

  // Rotating radar sweep
  const radarA = elapsed * 2.8 + (ship.kind === 'battleship' ? 0 : ship.kind === 'gunboat' ? 2.3 : 1.5);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(radarA) * 14, Math.sin(radarA) * 14);
  ctx.stroke();

  // Main Gun Turrets (Battleship has 2x Triple 406mm, Destroyer has fore 127mm + aft VLS pad)
  const turretOffsets =
    ship.kind === 'battleship' ? [-halfL * 0.46, halfL * 0.48] : ship.kind === 'gunboat' ? [-halfL * 0.22] : [-halfL * 0.46];

  for (const ty of turretOffsets) {
    ctx.save();
    ctx.translate(0, ty);
    ctx.rotate(ship.turretAngle);
    ctx.translate(-ship.recoil * 0.45, 0);

    if (ship.kind === 'battleship') {
      ctx.fillStyle = '#64748b';
      ctx.fillRect(-13, -12, 26, 24);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-13, -12, 26, 24);
      // Triple 16-inch barrels
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(10, -8, 28, 3);
      ctx.fillRect(10, -1.5, 28, 3);
      ctx.fillRect(10, 5, 28, 3);
    } else {
      ctx.fillStyle = '#64748b';
      ctx.fillRect(-9, -8, 18, 16);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(8, -2, 20, 4);
    }

    if (ship.muzzleFlash > 0) {
      ctx.fillStyle = `rgba(253, 224, 71, ${ship.muzzleFlash * 2})`;
      ctx.beginPath();
      ctx.arc(38, 0, 14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Stern Helipad / VLS hatch
  if (ship.kind === 'destroyer') {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-11, halfL * 0.36, 22, 28);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-9, halfL * 0.38, 18, 24);
  }

  ctx.font = '700 12px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#bae6fd';
  ctx.fillText(`${ship.hullCode} ${ship.name.toUpperCase()}`, 0, halfL + 18);

  ctx.restore();
}

function drawNavalTaskForce(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  opsBlend: number,
): void {
  // Escort Battleships & Destroyers
  for (const ship of world.navalFleet) {
    drawWarship(ctx, ship, world.elapsedSec);
  }

  const cx = world.carrierPos.x;
  const cy = world.carrierPos.y;
  ctx.save();
  ctx.translate(cx, cy);

  // Carrier wake ripples
  ctx.fillStyle = 'rgba(186, 230, 253, 0.11)';
  ctx.beginPath();
  ctx.ellipse(-20, 0, 118, 285, 0, 0, Math.PI * 2);
  ctx.fill();

  // Flight deck hull
  ctx.fillStyle = '#2d3947';
  ctx.beginPath();
  ctx.moveTo(-42, -225);
  ctx.lineTo(38, -225);
  ctx.lineTo(58, -125);
  ctx.lineTo(58, 175);
  ctx.lineTo(28, 228);
  ctx.lineTo(-36, 228);
  ctx.lineTo(-60, 135);
  ctx.lineTo(-60, -125);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Deck elevators
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(30, -110, 22, 34);
  ctx.fillRect(30, 65, 22, 34);

  // Runway stripes
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([14, 10]);
  ctx.beginPath();
  ctx.moveTo(-8, -206);
  ctx.lineTo(-8, 206);
  ctx.stroke();
  ctx.setLineDash([]);

  // Deck edge perimeter lights
  ctx.fillStyle = '#38bdf8';
  for (let ly = -180; ly <= 180; ly += 42) {
    ctx.fillRect(-52, ly, 3, 3);
    ctx.fillRect(48, ly, 3, 3);
  }

  // Island superstructure
  ctx.fillStyle = '#182230';
  ctx.fillRect(22, -45, 24, 85);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(22, -45, 24, 85);

  const radarAngle = world.elapsedSec * 2.4;
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(34, -10);
  ctx.lineTo(34 + Math.cos(radarAngle) * 14, -10 + Math.sin(radarAngle) * 14);
  ctx.stroke();

  // Parked deck fighter jets
  const jetOffsets = [
    { x: -30, y: -140 },
    { x: -30, y: -74 },
    { x: 18, y: 128 },
  ];
  ctx.fillStyle = '#64748b';
  for (const j of jetOffsets) {
    ctx.beginPath();
    ctx.moveTo(j.x + 11, j.y);
    ctx.lineTo(j.x - 8, j.y - 7);
    ctx.lineTo(j.x - 5, j.y);
    ctx.lineTo(j.x - 8, j.y + 7);
    ctx.closePath();
    ctx.fill();
  }

  ctx.font = '700 14px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#bae6fd';
  ctx.fillText('CVN TF-1 "VANGUARD"', 0, 250);

  if (opsBlend > 0.15) {
    ctx.strokeStyle = `rgba(56, 189, 248, ${opsBlend * 0.24})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 14]);
    ctx.beginPath();
    ctx.arc(0, 0, 1800, -Math.PI * 0.4, Math.PI * 0.4);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // Docked LCAC landing craft
  ctx.save();
  ctx.fillStyle = '#475569';
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  const fy = world.fobPos.y;
  ctx.fillRect(world.coastlineX - 115, fy - 122, 46, 22);
  ctx.strokeRect(world.coastlineX - 115, fy - 122, 46, 22);
  ctx.fillRect(world.coastlineX - 115, fy + 100, 46, 22);
  ctx.strokeRect(world.coastlineX - 115, fy + 100, 46, 22);
  ctx.restore();
}

function drawStructures(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  _opsBlend: number,
  minVisX: number,
  maxVisX: number,
  minVisY: number,
  maxVisY: number,
): void {
  for (let i = 0; i < world.structures.length; i++) {
    const s = world.structures[i];
    if (s.hp <= 0) continue;
    if (s.x < minVisX - 80 || s.x > maxVisX + 80 || s.y < minVisY - 80 || s.y > maxVisY + 80) {
      continue;
    }
    ctx.save();
    ctx.translate(s.x, s.y);

    if (s.kind === 'fob') {
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.2)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, 220, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      drawBunker(ctx, s);
    } else if (s.kind === 'wall') {
      ctx.save();
      ctx.rotate(s.angle);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(-s.w * 0.5 + 3, -s.h * 0.5 + 4, s.w, s.h);

      const wt = WALL_TIERS[s.tier ?? 2] ?? WALL_TIERS[2];
      ctx.fillStyle = s.hitFlash > 0 ? '#ffffff' : wt.base;
      ctx.fillRect(-s.w * 0.5, -s.h * 0.5, s.w, s.h);
      ctx.fillStyle = wt.face;
      ctx.fillRect(-s.w * 0.5 + 3, -s.h * 0.5 + 4, s.w - 6, s.h - 8);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.strokeRect(-s.w * 0.5, -s.h * 0.5, s.w, s.h);

      ctx.fillStyle = '#f59e0b';
      for (let hx = -s.w * 0.5 + 6; hx < s.w * 0.5 - 10; hx += 22) {
        ctx.fillRect(hx, -s.h * 0.5 + 2, 10, 3.5);
        ctx.fillRect(hx, s.h * 0.5 - 5.5, 10, 3.5);
      }
      ctx.restore();
    } else if (s.kind === 'gate') {
      ctx.save();
      ctx.rotate(s.angle);
      const openAmt = clamp01(s.gateOpen ?? 0);
      const wingSlide = openAmt * (s.w * 0.36);

      // Gate concrete anchor pylons at either end
      ctx.fillStyle = '#475569';
      ctx.fillRect(-s.w * 0.5, -s.h * 0.5 - 2, 14, s.h + 4);
      ctx.fillRect(s.w * 0.5 - 14, -s.h * 0.5 - 2, 14, s.h + 4);

      // Sliding armored steel blast leaves
      ctx.fillStyle = s.hitFlash > 0 ? '#ffffff' : '#334155';
      const leafW = s.w * 0.38;
      ctx.fillRect(-s.w * 0.5 + 10 - wingSlide * 0.45, -s.h * 0.5 + 3, leafW, s.h - 6);
      ctx.fillRect(s.w * 0.5 - 10 - leafW + wingSlide * 0.45, -s.h * 0.5 + 3, leafW, s.h - 6);

      // Gate beacon status LED (sky green when open for friendlies, amber when sealed)
      ctx.fillStyle = openAmt > 0.35 ? '#38bdf8' : '#f59e0b';
      ctx.fillRect(-s.w * 0.5 + 4, -3, 6, 6);
      ctx.fillRect(s.w * 0.5 - 10, -3, 6, 6);
      ctx.restore();
    } else if (s.kind === 'charge') {
      ctx.fillStyle = '#4b5320';
      ctx.fillRect(-9, -9, 18, 18);
      ctx.strokeStyle = '#1f2410';
      ctx.lineWidth = 2;
      ctx.strokeRect(-9, -9, 18, 18);
      ctx.fillStyle = '#d6c07a';
      ctx.fillRect(-6, -2, 12, 4);
      const armed = s.fireCooldown <= 0;
      ctx.fillStyle = armed && Math.floor(world.elapsedSec * 3) % 2 === 0 ? '#ef4444' : '#7f1d1d';
      ctx.beginPath();
      ctx.arc(0, -5.5, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.kind === 'oil') {
      ctx.save();
      ctx.rotate(s.angle);
      ctx.fillStyle = 'rgba(8, 10, 14, 0.82)';
      ctx.beginPath();
      ctx.ellipse(0, 0, s.w * 0.5, s.h * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(96, 90, 140, 0.35)';
      ctx.beginPath();
      ctx.ellipse(-s.w * 0.12, -s.h * 0.1, s.w * 0.22, s.h * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (s.kind === 'wire' || s.kind === 'laser' || s.kind === 'electric') {
      const ft = Date.now() / 1000;
      const fhw = s.w * 0.5;
      ctx.save();
      ctx.rotate(s.angle);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-fhw + 2, 3, s.w, 4);
      if (s.kind === 'wire') {
        ctx.strokeStyle = s.hitFlash > 0 ? '#ffffff' : '#cbd5e1';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let x = -fhw; x <= fhw; x += 5) {
          const y = ((x / 5) % 2 === 0 ? -1 : 1) * 4;
          if (x === -fhw) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = '#94a3b8';
        for (let x = -fhw + 8; x < fhw; x += 14) ctx.fillRect(x, -1, 2.5, 2.5);
        ctx.fillStyle = '#6b4f2a';
      } else if (s.kind === 'laser') {
        const pulse = 0.55 + 0.3 * Math.sin(ft * 18);
        ctx.strokeStyle = `rgba(239,68,68,${0.18 * pulse})`;
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(-fhw, 0); ctx.lineTo(fhw, 0); ctx.stroke();
        ctx.strokeStyle = `rgba(254,202,202,${pulse})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(-fhw, 0); ctx.lineTo(fhw, 0); ctx.stroke();
        ctx.fillStyle = '#1e293b';
      } else {
        ctx.strokeStyle = s.hitFlash > 0 ? '#ffffff' : '#67e8f9';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let x = -fhw; x <= fhw; x += 6) {
          const y = Math.sin(x * 1.7 + ft * 45) * 4;
          if (x === -fhw) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = '#0e7490';
      }
      // end posts (colored per fence type)
      ctx.fillRect(-fhw - 4, -7, 8, 14);
      ctx.fillRect(fhw - 4, -7, 8, 14);
      ctx.fillStyle = s.kind === 'laser' ? '#ef4444' : s.kind === 'electric' ? '#22d3ee' : '#94a3b8';
      ctx.fillRect(-fhw - 1, -2, 3, 4);
      ctx.fillRect(fhw - 2, -2, 3, 4);
      ctx.restore();
    } else if (s.kind === 'turret') {
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + Math.PI / 8;
        const px = Math.cos(a) * 18;
        const py = Math.sin(a) * 18;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.rotate(s.angle);
      ctx.translate(-s.recoil, 0);
      if (s.ammo > 0) {
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(22, 0);
        ctx.lineTo(130, 0);
        ctx.stroke();
      }
      ctx.fillStyle = s.hitFlash > 0 ? '#ffffff' : '#475569';
      ctx.fillRect(-10, -10, 20, 20);
      ctx.fillStyle = '#d97706';
      ctx.fillRect(-13, -6, 6, 12);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(8, -5, 16, 3);
      ctx.fillRect(8, 2, 16, 3);
      ctx.restore();
    } else if (s.kind === 'autocannon') {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-19, -19, 38, 38);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.strokeRect(-19, -19, 38, 38);

      ctx.save();
      ctx.rotate(s.angle);
      ctx.translate(-s.recoil, 0);
      ctx.fillStyle = s.hitFlash > 0 ? '#ffffff' : '#52525b';
      ctx.fillRect(-12, -12, 24, 24);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(8, -11, 5, 22);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(10, -3.5, 19, 7);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(26, -4.5, 4, 9);
      ctx.restore();
    } else if (s.kind === 'rocket_turret') {
      // Heavy octagonal SAM/Hydra bunker pad
      ctx.fillStyle = '#182230';
      ctx.fillRect(-20, -20, 40, 40);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(-20, -20, 40, 40);

      ctx.save();
      ctx.rotate(s.angle);
      ctx.translate(-s.recoil * 0.5, 0);
      ctx.fillStyle = s.hitFlash > 0 ? '#ffffff' : '#334155';
      ctx.fillRect(-11, -11, 22, 22);
      // Side multi-tube Hydra pods
      ctx.fillStyle = '#475569';
      ctx.fillRect(-8, -17, 22, 7);
      ctx.fillRect(-8, 10, 22, 7);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(12, -16, 3, 2);
      ctx.fillRect(12, -13, 3, 2);
      ctx.fillRect(12, 11, 3, 2);
      ctx.fillRect(12, 14, 3, 2);
      ctx.restore();
    }

    if (s.hp < s.maxHp) {
      drawHealthBar(ctx, 0, -s.h * 0.5 - 12, 42, s.hp / s.maxHp, '#38bdf8');
    }
    ctx.restore();
  }
}

function shadeHex(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

// Deterministic camo blotches so the texture never shimmers between frames
const CAMO_BLOBS: Array<[number, number, number, number, number]> = [
  [-2.6, -3.2, 2.1, 1.3, 0.4],
  [1.2, -2.4, 1.7, 1.1, -0.5],
  [-1.2, 0.4, 2.2, 1.2, 0.2],
  [2.4, 1.1, 1.5, 1.0, 0.9],
  [-2.8, 3.1, 1.8, 1.1, -0.3],
  [0.6, 3.5, 1.9, 1.0, 0.1],
  [2.6, -0.2, 1.2, 0.9, 0.0],
];

function drawSoldierTrooper(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  aimAngle: number,
  gait: number,
  vestColor: string,
  helmetColor: string,
  weaponKind: 'rifle' | 'heavy' | 'rpg' | 'medic' | 'sniper',
  hitFlash: number,
): void {
  const flash = hitFlash > 0;
  const swing = Math.sin(gait);
  const stride = swing * 2.4;
  const skin = flash ? '#ffffff' : '#d6a77a';
  const uniform = flash ? '#ffffff' : shadeHex(vestColor, -0.1);
  const uniformDark = flash ? '#e5e7eb' : shadeHex(vestColor, -0.24);
  const uniformLight = flash ? '#ffffff' : shadeHex(vestColor, 0.12);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(aimAngle);

  // Ground shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  ctx.beginPath();
  ctx.ellipse(-0.5, 1.5, 7.2, 5.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs: trousers + boots with alternating stride
  const legs: Array<[number, number]> = [
    [-2 + stride, -3.6],
    [-2 - stride, 2.4],
  ];
  for (const [lx, ly] of legs) {
    ctx.fillStyle = flash ? '#ffffff' : '#3b4a2f';
    ctx.fillRect(lx - 1, ly, 5, 2.6);
    ctx.fillStyle = flash ? '#ffffff' : '#171717';
    ctx.fillRect(lx + 3.2, ly - 0.2, 2.6, 3); // boot
    ctx.fillStyle = flash ? '#ffffff' : '#52525b';
    ctx.fillRect(lx + 0.6, ly + 0.4, 1.6, 1.8); // knee pad
  }

  // Backpack / ruck with straps
  if (weaponKind === 'sniper') {
    ctx.fillStyle = flash ? '#ffffff' : '#365314';
    ctx.beginPath();
    ctx.ellipse(-3, 0, 6.8, 5.8, 0, 0, Math.PI * 2); // ghillie cloak
    ctx.fill();
    ctx.fillStyle = flash ? '#ffffff' : '#4d7c0f';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(-8 + i * 1.3, -4 + ((i * 3) % 7), 1.4, 1);
    }
  } else {
    ctx.fillStyle = flash ? '#ffffff' : '#2b3340';
    ctx.fillRect(-7.2, -3.8, 3.6, 7.6);
    ctx.fillStyle = flash ? '#ffffff' : '#1f2630';
    ctx.fillRect(-7.2, -0.3, 3.6, 0.6);
    ctx.fillStyle = flash ? '#ffffff' : '#3f4a5a';
    ctx.fillRect(-6.6, -3.2, 1.2, 6.4);
  }

  // Torso: camo uniform base
  ctx.fillStyle = uniform;
  ctx.beginPath();
  ctx.ellipse(0, 0, 4.9, 5.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Camo blotches clipped to the torso
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, 4.9, 5.6, 0, 0, Math.PI * 2);
  ctx.clip();
  for (let i = 0; i < CAMO_BLOBS.length; i++) {
    const [bx, by, rx, ry, rot] = CAMO_BLOBS[i];
    ctx.fillStyle = i % 2 === 0 ? uniformDark : uniformLight;
    ctx.beginPath();
    ctx.ellipse(bx, by, rx, ry, rot, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Plate carrier + mag pouches
  ctx.fillStyle = flash ? '#ffffff' : '#3d4654';
  ctx.fillRect(-3.4, -4.6, 6.8, 9.2);
  ctx.fillStyle = flash ? '#ffffff' : '#2a313c';
  ctx.fillRect(-3.4, -0.4, 6.8, 0.8);
  ctx.fillStyle = flash ? '#ffffff' : '#555f70';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(1.1, -3.7 + i * 2.7, 1.9, 2.1); // pouches
  }
  ctx.fillStyle = flash ? '#ffffff' : '#a3b1c2';
  ctx.fillRect(-2.8, -4.3, 0.8, 8.6); // shoulder strap highlight

  // Role gear: belt + holster, radio, and a unit patch on the sleeve
  ctx.fillStyle = flash ? '#ffffff' : '#1c1917';
  ctx.fillRect(-3.5, 3.6, 7, 0.9); // utility belt
  ctx.fillStyle = flash ? '#ffffff' : '#292524';
  ctx.fillRect(-1.6, 3.6, 2.4, 2.4); // sidearm holster
  if (weaponKind !== 'sniper') {
    ctx.fillStyle = flash ? '#ffffff' : '#111827';
    ctx.fillRect(-6.2, -4.3, 1.8, 2.4); // radio
    ctx.strokeStyle = flash ? '#ffffff' : '#111827';
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(-5.3, -4.3);
    ctx.lineTo(-7.8, -6.2); // antenna
    ctx.stroke();
  }
  ctx.fillStyle = flash ? '#ffffff' : weaponKind === 'medic' ? '#ef4444' : weaponKind === 'heavy' ? '#f59e0b' : weaponKind === 'rpg' ? '#f97316' : '#38bdf8';
  ctx.fillRect(2.2, -5.1, 1.5, 1.1); // team patch

  // Weapon
  const w = weaponKind;
  if (w === 'rpg') {
    // RPG-7: tube, flared rear, optical sight, and a loaded fin-stabilised warhead
    ctx.fillStyle = flash ? '#ffffff' : '#57534e';
    ctx.fillRect(-7, 1.2, 20, 3.2);
    ctx.fillStyle = flash ? '#ffffff' : '#292524';
    ctx.beginPath();
    ctx.moveTo(-7, 0.6); ctx.lineTo(-4, 1.2); ctx.lineTo(-4, 4.4); ctx.lineTo(-7, 5);
    ctx.closePath();
    ctx.fill(); // rear venturi
    ctx.fillStyle = flash ? '#ffffff' : '#6b7280';
    ctx.fillRect(1.5, 0.1, 3.4, 1.2); // optic
    ctx.fillStyle = flash ? '#ffffff' : '#78350f';
    ctx.fillRect(5, 1.2, 2.2, 3.2); // wooden grip
    ctx.fillStyle = flash ? '#ffffff' : '#4d5a3a';
    ctx.beginPath();
    ctx.moveTo(11, 1.3); ctx.lineTo(14, 2.8); ctx.lineTo(11, 4.3);
    ctx.closePath();
    ctx.fill(); // warhead
    ctx.fillStyle = flash ? '#ffffff' : '#f59e0b';
    ctx.fillRect(13.4, 2.4, 1.6, 0.8); // warhead tip
    ctx.fillStyle = flash ? '#ffffff' : '#44403c';
    ctx.fillRect(-9.8, -3.2, 2.4, 6.4); // spare rocket on the back
  } else if (w === 'heavy') {
    // M249 SAW: belt-fed receiver, heat shield, bipod, ammo box with a visible belt
    ctx.fillStyle = flash ? '#ffffff' : '#1f2937';
    ctx.fillRect(0, -1.7, 12, 3.4); // receiver
    ctx.fillStyle = flash ? '#ffffff' : '#111827';
    ctx.fillRect(11, -1.1, 6.6, 2.2); // barrel
    ctx.fillStyle = flash ? '#ffffff' : '#374151';
    ctx.fillRect(11.5, -1.6, 3.6, 3.2); // heat shield
    ctx.fillStyle = flash ? '#ffffff' : '#9ca3af';
    ctx.fillRect(17.2, -0.8, 1.2, 1.6); // flash hider
    ctx.strokeStyle = flash ? '#ffffff' : '#9ca3af';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(13.2, 1.2); ctx.lineTo(15.8, 3.2);
    ctx.moveTo(13.2, -1.2); ctx.lineTo(15.8, -3.2); // folded bipod legs
    ctx.stroke();
    ctx.fillStyle = flash ? '#ffffff' : '#44403c';
    ctx.fillRect(-1.6, -1.6, 3, 3.2); // stock
    ctx.fillStyle = flash ? '#ffffff' : '#365314';
    ctx.fillRect(3.2, 1.5, 5.2, 3.3); // ammo box
    ctx.fillStyle = flash ? '#ffffff' : '#facc15';
    ctx.fillRect(3.4, 0.6, 4.6, 0.9); // belt
  } else if (w === 'sniper') {
    // Suppressed bolt-action rifle with long scope and bipod
    ctx.fillStyle = flash ? '#ffffff' : '#1c1917';
    ctx.fillRect(-1, -0.9, 17, 1.9);
    ctx.fillStyle = flash ? '#ffffff' : '#0f172a';
    ctx.fillRect(15.4, -1.3, 5.6, 2.6); // suppressor
    ctx.fillStyle = flash ? '#ffffff' : '#57534e';
    ctx.fillRect(-1.6, -1.5, 5.4, 3); // stock with cheek rest
    ctx.fillStyle = flash ? '#ffffff' : '#0b1220';
    ctx.fillRect(3.5, -2.8, 8, 1.8); // scope
    ctx.fillStyle = flash ? '#ffffff' : '#38bdf8';
    ctx.fillRect(11.1, -2.7, 0.9, 1.5); // lens
    ctx.strokeStyle = flash ? '#ffffff' : '#9ca3af';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(11.5, 0.9); ctx.lineTo(13.5, 3.2);
    ctx.moveTo(11.5, -0.9); ctx.lineTo(13.5, -3.6); // bipod
    ctx.stroke();
  } else {
    // M4A1-style carbine: rail handguard, red-dot optic, foregrip, suppressor, curved magazine
    ctx.fillStyle = flash ? '#ffffff' : '#111827';
    ctx.fillRect(1, -1.3, 9.5, 2.6); // receiver + handguard
    ctx.fillStyle = flash ? '#ffffff' : '#1f2937';
    ctx.fillRect(6, -1.7, 4.6, 3.4); // handguard rail
    ctx.fillStyle = flash ? '#ffffff' : '#44403c';
    ctx.fillRect(-1.2, -1.5, 3.6, 3); // adjustable stock
    ctx.fillStyle = flash ? '#ffffff' : '#374151';
    ctx.fillRect(4.6, 1.2, 1.9, 3.6); // magazine
    ctx.fillRect(5.4, 4.2, 1.9, 1); // magazine curve
    ctx.fillStyle = flash ? '#ffffff' : '#ef4444';
    ctx.fillRect(4, -2.3, 1.6, 1); // red-dot optic
    ctx.fillStyle = flash ? '#ffffff' : '#1f2937';
    ctx.fillRect(8.6, 1.2, 1.1, 2.4); // vertical foregrip
    ctx.fillStyle = flash ? '#ffffff' : '#0f172a';
    ctx.fillRect(10.4, -0.8, 4.8, 1.6); // suppressor
  }

  // Arms reaching to the weapon, hands in skin tone
  ctx.fillStyle = uniform;
  ctx.fillRect(1.5, -4.4, 6, 2.1);
  ctx.fillRect(1.5, 2.3, 7, 2.1);
  ctx.fillStyle = flash ? '#ffffff' : '#1f2937'; // tactical gloves
  ctx.beginPath();
  ctx.arc(7.8, -3.4, 1.35, 0, Math.PI * 2);
  ctx.arc(8.8, 3.3, 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = skin; // forearm skin peeks out above the glove cuff
  ctx.fillRect(6.1, -4.0, 1, 1.2);
  ctx.fillRect(6.9, 2.7, 1, 1.2);

  // Helmet: shell, camo cover bands, highlight, goggles
  ctx.fillStyle = flash ? '#ffffff' : helmetColor;
  ctx.beginPath();
  ctx.arc(0, 0, 4.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = flash ? '#ffffff' : shadeHex(helmetColor, -0.18);
  ctx.beginPath();
  ctx.arc(0, 0, 4.1, 0.9, 2.3);
  ctx.arc(0, 0, 2.2, 2.3, 0.9, true);
  ctx.fill();
  ctx.strokeStyle = flash ? '#ffffff' : shadeHex(helmetColor, 0.2);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, 3.2, -2.5, -1.0);
  ctx.stroke();
  ctx.fillStyle = flash ? '#ffffff' : '#0b1220';
  ctx.fillRect(2.4, -2.3, 1.9, 4.6); // goggles
  ctx.fillStyle = flash ? '#ffffff' : '#7dd3fc';
  ctx.fillRect(3.5, -1.6, 0.6, 1.2); // lens reflection
  ctx.fillStyle = flash ? '#ffffff' : '#1f2937';
  ctx.fillRect(-0.6, -4.5, 1.8, 1.2); // NVG mount
  ctx.fillStyle = flash ? '#ffffff' : '#0f172a';
  ctx.fillRect(-1.2, -4.6, 2.4, 1.1); // comms headset, left ear
  ctx.fillRect(-1.2, 3.5, 2.4, 1.1); // comms headset, right ear
  ctx.strokeStyle = flash ? '#ffffff' : '#0f172a';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(-0.2, 3.9); ctx.lineTo(2.3, 2.7); // boom mic
  ctx.stroke();

  if (weaponKind === 'medic') {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-3.4, -3.2, 3.8, 3.8);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-2.3, -2.0, 1.6, 0.8);
    ctx.fillRect(-1.9, -2.4, 0.8, 1.6);
  }
  ctx.restore();
}

// Camouflage patches, a white star and tactical marks on a hull rectangle (drawn in the hull's local space).
function drawHullDetails(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, hit: number, big: boolean): void {
  if (hit > 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const shades = [shadeHex(base, -0.22), shadeHex(base, 0.14), '#3b3a2a'];
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = shades[i % 3];
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(x + ((i * 0.37 + 0.11) % 1) * w, y + ((i * 0.53 + 0.19) % 1) * h, w * 0.16, h * 0.2, i, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // Allied star on the hull plus a short tactical number bar
  const cx = x + w * 0.2;
  const cy = y + h * 0.5;
  const r = Math.min(w, h) * (big ? 0.22 : 0.2);
  ctx.fillStyle = 'rgba(248, 250, 252, 0.88)';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.42;
    ctx.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(248, 250, 252, 0.7)';
  ctx.fillRect(x + w * 0.38, y + h * 0.82, w * 0.22, 1.2);
  // Whip antenna
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x + 2, y + 2);
  ctx.lineTo(x - w * 0.18, y - h * 0.1);
  ctx.stroke();
}

function drawPlayerUnit(
  ctx: CanvasRenderingContext2D,
  u: PlayerUnit,
  world: GameWorld,
  opsBlend: number,
): void {
  const isDirect = world.directControlUnitId === u.id;
  ctx.save();
  ctx.translate(u.x, u.y);

  if (u.koTimer > 0) {
    ctx.globalAlpha = Math.max(0, u.koTimer / 0.45);
  }

  // Soft ground shadow anchors units to the battlefield and improves readability.
  if (!UNIT_SPECS[u.kind].isAir) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
    ctx.beginPath();
    ctx.ellipse(3, u.radius * 0.42, u.radius * 1.18, Math.max(3, u.radius * 0.52), u.angle, 0, Math.PI * 2);
    ctx.fill();
  }

  if (u.selected || isDirect) {
    const pulse = 0.88 + Math.sin(world.elapsedSec * 5.2 + u.id * 0.17) * 0.12;
    ctx.strokeStyle = isDirect ? `rgba(245, 158, 11, ${pulse})` : `rgba(56, 189, 248, ${pulse})`;
    ctx.lineWidth = isDirect ? 3 : 2;
    ctx.beginPath();
    ctx.arc(0, 0, u.radius + 7 + (1 - pulse) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = isDirect ? 'rgba(245, 158, 11, 0.08)' : 'rgba(56, 189, 248, 0.055)';
    ctx.beginPath();
    ctx.arc(0, 0, u.radius + 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Selected-unit orders get a readable route and a pulsing destination marker.
  if (u.selected && u.targetX !== null && u.targetY !== null && opsBlend < 0.7) {
    const dx = u.targetX - u.x;
    const dy = u.targetY - u.y;
    const dist = Math.hypot(dx, dy);
    const pulse = 0.72 + Math.sin(world.elapsedSec * 7 + u.id) * 0.18;
    const orderColor = u.attackMove ? '#f59e0b' : '#38bdf8';
    ctx.save();
    ctx.strokeStyle = u.attackMove ? 'rgba(245, 158, 11, 0.55)' : 'rgba(56, 189, 248, 0.48)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 7]);
    ctx.lineDashOffset = -world.elapsedSec * 13;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dx, dy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.translate(dx, dy);
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = orderColor;
    ctx.fillStyle = u.attackMove ? 'rgba(245, 158, 11, 0.16)' : 'rgba(56, 189, 248, 0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 9 + (1 - pulse) * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = orderColor;
    ctx.fill();
    if (dist > 30) {
      const angle = Math.atan2(dy, dx);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(-15, -6);
      ctx.lineTo(-7, 0);
      ctx.lineTo(-15, 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (u.kind === 'truck') {
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.16)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.arc(0, 0, UNIT_SPECS.truck.range, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (u.kind === 'medic' || u.kind === 'blackhawk' || u.kind === 'chinook') {
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.14)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 165, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (u.kind === 'squad') {
    const offs = [
      { x: -7, y: -7 },
      { x: 7, y: -7 },
      { x: -7, y: 7 },
      { x: 7, y: 7 },
    ];
    for (let idx = 0; idx < offs.length; idx++) {
      drawSoldierTrooper(
        ctx,
        offs[idx].x,
        offs[idx].y,
        u.turretAngle,
        u.gaitPhase + idx * 1.4,
        '#4d7c0f',
        '#65a30d',
        'rifle',
        u.hitFlash,
      );
    }
  } else if (u.kind === 'heavy') {
    drawSoldierTrooper(ctx, 4, -5, u.turretAngle, u.gaitPhase, '#78716c', '#57534e', 'heavy', u.hitFlash);
    drawSoldierTrooper(ctx, -6, 6, u.turretAngle, u.gaitPhase + 1.5, '#78716c', '#57534e', 'rifle', u.hitFlash);
  } else if (u.kind === 'rpg') {
    drawSoldierTrooper(ctx, 4, -5, u.turretAngle, u.gaitPhase, '#64748b', '#475569', 'rpg', u.hitFlash);
    drawSoldierTrooper(ctx, -6, 6, u.turretAngle, u.gaitPhase + 1.5, '#64748b', '#475569', 'rifle', u.hitFlash);
  } else if (u.kind === 'medic') {
    drawSoldierTrooper(ctx, -5, -4, u.turretAngle, u.gaitPhase, '#0284c7', '#e2e8f0', 'medic', u.hitFlash);
    drawSoldierTrooper(ctx, 5, 5, u.turretAngle, u.gaitPhase + 1.5, '#0284c7', '#e2e8f0', 'medic', u.hitFlash);
  } else if (u.kind === 'sniper') {
    drawSoldierTrooper(ctx, 0, 0, u.turretAngle, u.gaitPhase, '#3f6212', '#365314', 'sniper', u.hitFlash);
  } else if (u.kind === 'humvee') {
    ctx.save();
    ctx.rotate(u.angle);
    // Wheels
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-15, -13, 9, 4);
    ctx.fillRect(6, -13, 9, 4);
    ctx.fillRect(-15, 9, 9, 4);
    ctx.fillRect(6, 9, 9, 4);
    // Armored 4x4 chassis
    ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#7b7052';
    ctx.fillRect(-16, -10, 32, 20);
    ctx.strokeStyle = '#3f3928';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-16, -10, 32, 20);
    drawHullDetails(ctx, -16, -10, 32, 20, '#7b7052', u.hitFlash, false);
    // Split windshield + hood louvers
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(5, -7, 4, 14);
    ctx.fillStyle = '#475569';
    ctx.fillRect(10, -6, 4, 12);
    ctx.restore();

    // Roof cupola + .50cal gun
    ctx.save();
    ctx.rotate(u.turretAngle);
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(-2, 0, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(4, -1.5, 16, 3);
    ctx.restore();
  } else if (u.kind === 'raider') {
    ctx.save();
    ctx.rotate(u.angle);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-12, -11, 8, 4);
    ctx.fillRect(5, -11, 8, 4);
    ctx.fillRect(-12, 7, 8, 4);
    ctx.fillRect(5, 7, 8, 4);
    ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#9a6b2f';
    ctx.fillRect(-13, -7, 26, 14);
    ctx.strokeStyle = '#3a2a14';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-13, -7, 26, 14);
    drawHullDetails(ctx, -13, -7, 26, 14, '#9a6b2f', u.hitFlash, false);
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(-9, -7); ctx.lineTo(-9, 7); ctx.moveTo(1, -7); ctx.lineTo(1, 7);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.rotate(u.turretAngle);
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(-1, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(3, -1, 12, 2);
    ctx.restore();
  } else if (u.kind === 'howitzer') {
    ctx.save();
    ctx.rotate(u.angle);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-22, -16, 44, 7);
    ctx.fillRect(-22, 9, 44, 7);
    ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#5b6b4a';
    ctx.fillRect(-20, -12, 40, 24);
    ctx.strokeStyle = '#2f3a25';
    ctx.lineWidth = 2;
    ctx.strokeRect(-20, -12, 40, 24);
    drawHullDetails(ctx, -20, -12, 40, 24, '#5b6b4a', u.hitFlash, true);
    ctx.restore();
    ctx.save();
    ctx.rotate(u.turretAngle);
    ctx.fillStyle = '#4b5a3c';
    ctx.fillRect(-12, -10, 22, 20);
    ctx.strokeStyle = '#2f3a25';
    ctx.strokeRect(-12, -10, 22, 20);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(8, -2.5, 28 - u.recoil, 5);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(32 - u.recoil, -4, 5, 8);
    ctx.restore();
  } else if (u.kind === 'ifv') {
    // M2 Bradley IFV
    ctx.save();
    ctx.rotate(u.angle);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-20, -14, 40, 6);
    ctx.fillRect(-20, 8, 40, 6);
    ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#65694b';
    ctx.fillRect(-18, -11, 36, 22);
    ctx.strokeStyle = '#363b28';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-18, -11, 36, 22);
    drawHullDetails(ctx, -18, -11, 36, 22, '#65694b', u.hitFlash, true);
    ctx.fillStyle = '#3f4532';
    ctx.fillRect(8, -8, 7, 16);
    ctx.restore();

    ctx.save();
    ctx.rotate(u.turretAngle);
    ctx.translate(-u.recoil * 0.4, 0);
    ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#7b805c';
    ctx.fillRect(-8, -7.5, 17, 15);
    // Side TOW launcher box
    ctx.fillStyle = '#475569';
    ctx.fillRect(-4, 7.5, 10, 4);
    // 25mm Bushmaster barrel
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(9, -2, 18, 4);
    ctx.restore();
  } else if (u.kind === 'tank') {
    ctx.save();
    ctx.rotate(u.angle);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-22, -16, 44, 7);
    ctx.fillRect(-22, 9, 44, 7);
    ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#556b42';
    ctx.fillRect(-20, -12, 40, 24);
    ctx.strokeStyle = '#2d3a24';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-20, -12, 40, 24);
    drawHullDetails(ctx, -20, -12, 40, 24, '#556b42', u.hitFlash, true);
    // ERA side skirt armor blocks
    ctx.fillStyle = '#6c8555';
    for (let sx = -15; sx <= 10; sx += 8) {
      ctx.fillRect(sx, -13, 6, 3);
      ctx.fillRect(sx, 10, 6, 3);
    }
    ctx.fillStyle = '#273222';
    ctx.fillRect(-17, -8, 6, 16);
    ctx.restore();

    ctx.save();
    ctx.rotate(u.turretAngle);
    ctx.translate(-u.recoil * 0.5, 0);
    ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#6c8555';
    ctx.fillRect(-12, -9.5, 24, 19);
    ctx.fillStyle = '#3f4f32';
    ctx.beginPath();
    ctx.arc(-2, -3, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(10, -2.5, 25, 5);
    ctx.fillStyle = '#64748b';
    ctx.fillRect(30, -3.5, 5, 7);
    ctx.restore();
  } else if (u.kind === 'chopper') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.beginPath();
    ctx.ellipse(16, 22, 22, 9, u.angle, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.rotate(u.angle);
    ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#3f4b5b';
    ctx.fillRect(-4, -20, 9, 40);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(-1, -19, 4, 5);
    ctx.fillRect(-1, 14, 4, 5);

    ctx.fillStyle = '#334155';
    ctx.fillRect(-28, -2.5, 24, 5);
    ctx.fillRect(-29, -8, 4, 16);

    ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#475569';
    ctx.beginPath();
    ctx.moveTo(24, 0);
    ctx.lineTo(6, -8);
    ctx.lineTo(-10, -6);
    ctx.lineTo(-10, 6);
    ctx.lineTo(6, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-6, -9, 10, 4);
    ctx.fillRect(-6, 5, 10, 4);

    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(4, -3.5, 12, 7);

    ctx.fillStyle = 'rgba(226, 232, 240, 0.08)';
    ctx.beginPath();
    ctx.arc(0, 0, 29, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(world.elapsedSec * 24 + u.id);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.6)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-29, 0);
    ctx.lineTo(29, 0);
    ctx.moveTo(0, -29);
    ctx.lineTo(0, 29);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.rotate(u.turretAngle);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(14, -1.5, 10, 3);
    ctx.restore();
  } else if (u.kind === 'littlebird' || u.kind === 'hind' || u.kind === 'chinook' || u.kind === 'drone') {
    drawExtraAircraft(ctx, u, world);
  } else if (u.kind === 'blackhawk') {
    // UH-60 Blackhawk Medevac & Twin Minigun Gunship
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.beginPath();
    ctx.ellipse(16, 22, 24, 11, u.angle, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.rotate(u.angle);
    ctx.fillStyle = '#334155';
    ctx.fillRect(-30, -3, 24, 6);
    ctx.fillRect(-31, -9, 4, 18);

    // Transport fuselage
    ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#3d4d41';
    ctx.fillRect(-13, -9.5, 29, 19);
    ctx.beginPath();
    ctx.moveTo(23, 0);
    ctx.lineTo(14, -9);
    ctx.lineTo(14, 9);
    ctx.closePath();
    ctx.fill();

    // Windshield & Red Cross rescue emblem on cabin roof
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(10, -6, 6, 12);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-5, -1.5, 7, 3);
    ctx.fillRect(-3, -3.5, 3, 7);

    // Rotor disc + 4 blades
    ctx.fillStyle = 'rgba(226, 232, 240, 0.08)';
    ctx.beginPath();
    ctx.arc(0, 0, 31, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(world.elapsedSec * 22 + u.id);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.62)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-31, 0);
    ctx.lineTo(31, 0);
    ctx.moveTo(0, -31);
    ctx.lineTo(0, 31);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.rotate(u.turretAngle);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(6, -11, 12, 2);
    ctx.fillRect(6, 9, 12, 2);
    ctx.restore();
  } else if (u.kind === 'truck') {
    ctx.save();
    ctx.rotate(u.angle);
    ctx.fillStyle = '#0f172a';
    for (const wx of [-14, -6, 6, 12]) {
      ctx.fillRect(wx, -12, 5, 3);
      ctx.fillRect(wx, 9, 5, 3);
    }
    ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#85704a';
    ctx.fillRect(-18, -10, 25, 20);
    ctx.fillStyle = '#64748b';
    ctx.fillRect(7, -9, 11, 18);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(12, -6, 3, 12);
    ctx.fillStyle = '#fde047';
    ctx.fillRect(-13, -5, 13, 10);
    ctx.restore();
  }

  // Weapon muzzle flash follows the current turret direction and recoil pulse.
  if (u.recoil > 0.45 && !UNIT_SPECS[u.kind].isAir) {
    const flash = Math.min(1, u.recoil / 4.5);
    ctx.save();
    ctx.rotate(u.turretAngle);
    ctx.globalAlpha = flash;
    const muzzleX = u.radius + (u.kind === 'tank' || u.kind === 'howitzer' ? 28 : 15);
    const flare = ctx.createRadialGradient(muzzleX, 0, 1, muzzleX, 0, 15 + flash * 8);
    flare.addColorStop(0, 'rgba(255,255,220,0.98)');
    flare.addColorStop(0.28, 'rgba(251,191,36,0.9)');
    flare.addColorStop(1, 'rgba(249,115,22,0)');
    ctx.fillStyle = flare;
    ctx.beginPath();
    ctx.arc(muzzleX, 0, 15 + flash * 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Part 21: compact unit identity markings. These are deterministic,
  // canvas-only details (no extra assets or per-frame allocations).
  drawUnitSignature(ctx, u);

  if (opsBlend < 0.7 && (u.selected || isDirect || u.hp < u.maxHp || u.ammo < u.maxAmmo * 0.3)) {
    drawHealthBar(ctx, 0, -u.radius - 12, 32, u.hp / u.maxHp, '#22c55e');
    if (u.maxAmmo > 0) {
      drawHealthBar(ctx, 0, -u.radius - 7, 32, u.ammo / u.maxAmmo, '#facc15');
    }
    if (u.ammo <= 0 && UNIT_SPECS[u.kind].fireRate > 0) {
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f87171';
      ctx.fillText('NO AMMO', 0, -u.radius - 17);
    }
  }

  ctx.restore();
}

function drawUnitSignature(ctx: CanvasRenderingContext2D, u: PlayerUnit): void {
  const flash = u.hitFlash > 0;
  const mark = flash ? '#ffffff' : '#fbbf24';
  const dark = flash ? '#ffffff' : '#17212b';
  ctx.save();

  if (u.kind === 'squad' || u.kind === 'heavy' || u.kind === 'rpg' || u.kind === 'medic' || u.kind === 'sniper') {
    // Small shoulder tab and pack silhouette make infantry roles easier to read.
    ctx.rotate(u.turretAngle);
    ctx.fillStyle = u.kind === 'medic' ? '#e2e8f0' : u.kind === 'sniper' ? '#a3a35b' : '#334155';
    ctx.fillRect(-10, -3, 5, 6);
    ctx.fillStyle = u.kind === 'medic' ? '#dc2626' : mark;
    if (u.kind === 'medic') {
      ctx.fillRect(-9, -1, 3, 1.5);
      ctx.fillRect(-8.25, -2, 1.5, 3.5);
    } else {
      ctx.fillRect(-9, -1, 3, 2);
    }
  } else if (['humvee', 'raider', 'ifv', 'tank', 'howitzer', 'truck'].includes(u.kind)) {
    ctx.rotate(u.angle);
    // Stencil stripe, hatch and unit number: readable at tactical zoom.
    ctx.fillStyle = dark;
    ctx.fillRect(-5, -1, 10, 2);
    ctx.fillStyle = mark;
    ctx.fillRect(-3, -1, 6, 1.2);
    ctx.strokeStyle = 'rgba(226,232,240,0.72)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-4, -5, 8, 3);
    if (u.kind === 'tank' || u.kind === 'ifv') {
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(-17, -2, 3, 4);
      ctx.fillRect(14, -2, 3, 4);
    }
  } else if (['chopper', 'blackhawk', 'littlebird', 'hind', 'chinook', 'drone'].includes(u.kind)) {
    ctx.rotate(u.angle);
    // High-contrast rescue/flight stripe and cabin glazing highlight.
    ctx.fillStyle = u.kind === 'blackhawk' || u.kind === 'chinook' ? '#38bdf8' : mark;
    ctx.fillRect(-2, -7, 4, 14);
    ctx.fillStyle = 'rgba(226,232,240,0.85)';
    ctx.fillRect(7, -3, 5, 6);
    if (u.kind === 'drone') {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-10, -10, 20, 20);
    }
  }
  ctx.restore();
}

const CLOTH_SHADES = ['#475569', '#57534e', '#3f6212', '#6b3b34'];
const SKIN_SHADES = ['#8a9a73', '#7d8c6a', '#94a07e', '#a7a98a'];

function zRand(seed: number, i: number): number {
  const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return x - Math.floor(x);
}


// ---- Zombie sprite cache -------------------------------------------------
// Each (kind, variant, elite, angle step, gait frame) is rendered once to a small
// canvas and then blitted with a single drawImage. This replaces dozens of
// path/fill/stroke calls per zombie and keeps big hordes smooth on High graphics.
const ZS_ANGLES = 24;
const ZS_FRAMES = 8;
const ZS_SUPERSAMPLE = 2;
const zombieSpriteCache = new Map<string, HTMLCanvasElement>();

function drawZombieCached(ctx: CanvasRenderingContext2D, z: Zombie, zoom: number, quality: 'low' | 'medium' | 'high'): boolean {
  if (z.koTimer > 0 || z.telegraphTimer > 0 || z.hitFlash > 0 || zoom > 1.25 || typeof document === 'undefined') return false;
  const TAU = Math.PI * 2;
  const ab = Math.round((((z.angle % TAU) + TAU) % TAU) / TAU * ZS_ANGLES) % ZS_ANGLES;
  const fb = Math.floor((((z.gaitPhase % TAU) + TAU) % TAU) / TAU * ZS_FRAMES) % ZS_FRAMES;
  const detail = zoom >= 0.55 ? 1 : 0;
  const key = z.kind + '|' + z.variant + '|' + (z.elite ? 1 : 0) + '|' + ab + '|' + fb + '|' + detail + '|' + (quality === 'high' ? 1 : 0) + '|' + Math.round(z.radius);
  const half = Math.ceil(z.radius * 2.1) + 6;
  let sprite = zombieSpriteCache.get(key);
  if (!sprite) {
    if (zombieSpriteCache.size > 2500) zombieSpriteCache.clear();
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = half * 2 * ZS_SUPERSAMPLE;
    const sctx = sprite.getContext('2d');
    if (!sctx) return false;
    sctx.setTransform(ZS_SUPERSAMPLE, 0, 0, ZS_SUPERSAMPLE, half * ZS_SUPERSAMPLE, half * ZS_SUPERSAMPLE);
    const proxy = { ...z, x: 0, y: 0, angle: (ab / ZS_ANGLES) * TAU, gaitPhase: (fb / ZS_FRAMES) * TAU, hitFlash: 0, koTimer: 0, telegraphTimer: 0, telegraphKind: null } as Zombie;
    drawZombie(sctx, proxy, detail ? 1 : 0.4, quality);
    zombieSpriteCache.set(key, sprite);
  }
  ctx.drawImage(sprite, z.x - half, z.y - half, half * 2, half * 2);
  return true;
}

function drawZombie(ctx: CanvasRenderingContext2D, z: Zombie, zoom: number, quality: 'low' | 'medium' | 'high' = 'high'): void {
  const spec = ZOMBIE_SPECS[z.kind];
  ctx.save();
  ctx.translate(z.x, z.y);

  if (z.koTimer > 0) {
    ctx.globalAlpha = Math.max(0, z.koTimer / 0.32);
    ctx.scale(1.18, 0.72);
  }

  if (z.telegraphTimer > 0) {
    ctx.strokeStyle =
      z.telegraphKind === 'slam' ? '#ef4444' : z.telegraphKind === 'spit' ? '#4ade80' : '#f59e0b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, z.kind === 'brute' ? 68 : 26, 0, Math.PI * 2);
    ctx.stroke();
  }

  const flash = z.hitFlash > 0;
  const detail = zoom >= 0.55 && z.koTimer <= 0;
  const t = z.gaitPhase;
  const sway = Math.sin(t) * 1.4;
  const lurch = Math.sin(t * 0.5) * 0.14; // body twist while shambling
  const fast = z.kind === 'sprinter' || z.kind === 'mutated' || z.kind === 'crawler';
  const armReach = fast ? 1.15 : 0.9;
  const armSwing = Math.sin(t * (fast ? 1.6 : 1.0));

  const r = z.radius;
  const seed = z.variant + 1;
  const cloth =
    z.kind === 'shambler' ? CLOTH_SHADES[z.variant % CLOTH_SHADES.length] : spec.color;
  const skin = flash ? '#ffffff' : SKIN_SHADES[z.variant % SKIN_SHADES.length];
  const clothCol = flash ? '#ffffff' : cloth;
  const clothDark = flash ? '#e5e7eb' : shadeHex(cloth, -0.16);

  // Detailed shadows are reserved for High quality; low tiers avoid thousands
  // of translucent ellipses during dense horde scenes.
  if (quality === 'high') {
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath();
    ctx.ellipse(0, 1.5, r * 1.05, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.rotate(z.angle + lurch);
  if (z.elite && detail) {
    // Compact elite chevron remains legible without costly extra effects.
    ctx.strokeStyle = flash ? '#ffffff' : '#fbbf24';
    ctx.lineWidth = Math.max(1.2, r * 0.09);
    ctx.beginPath();
    ctx.moveTo(-r * 0.48, -r * 0.62);
    ctx.lineTo(-r * 0.16, -r * 0.82);
    ctx.lineTo(r * 0.12, -r * 0.62);
    ctx.stroke();
  }
  if (z.kind === 'crawler') ctx.scale(1.18, 0.58);

  // Dragging legs: alternate shuffle, one leg lags
  ctx.fillStyle = flash ? '#ffffff' : '#27272a';
  ctx.fillRect(-r * 0.55 + Math.sin(t) * 2.4, -r * 0.62, r * 0.8, r * 0.38);
  ctx.fillRect(-r * 0.55 - Math.sin(t) * 1.4, r * 0.24, r * 0.8, r * 0.38);

  // Torso with bob
  ctx.fillStyle = clothCol;
  ctx.beginPath();
  ctx.ellipse(0, sway * 0.4, z.kind === 'crawler' ? r * 1.12 : z.kind === 'tank' ? r * 0.92 : r * 0.72, z.kind === 'crawler' ? r * 0.48 : z.kind === 'tank' ? r * 1.08 : r * 0.98, 0, 0, Math.PI * 2);
  ctx.fill();

  if (detail) {
    // Torn clothing texture: darker patches + exposed skin through rips
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, sway * 0.4, r * 0.72, r * 0.98, 0, 0, Math.PI * 2);
    ctx.clip();
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = clothDark;
      ctx.beginPath();
      ctx.ellipse(
        (zRand(seed, i) - 0.5) * r * 1.2,
        (zRand(seed, i + 9) - 0.5) * r * 1.6,
        r * (0.18 + zRand(seed, i + 3) * 0.2),
        r * (0.12 + zRand(seed, i + 5) * 0.16),
        zRand(seed, i + 7) * 3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    // rips showing skin
    ctx.fillStyle = skin;
    ctx.beginPath();
    const rx = (zRand(seed, 21) - 0.5) * r * 0.5;
    ctx.moveTo(rx, -r * 0.2);
    ctx.lineTo(rx + r * 0.3, -r * 0.05);
    ctx.lineTo(rx + r * 0.1, r * 0.2);
    ctx.lineTo(rx - r * 0.15, r * 0.05);
    ctx.closePath();
    ctx.fill();
    // dried blood stains
    ctx.fillStyle = 'rgba(127, 29, 29, 0.7)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(
        (zRand(seed, i + 40) - 0.2) * r * 0.9,
        (zRand(seed, i + 50) - 0.5) * r * 1.4,
        r * 0.16,
        r * 0.1,
        zRand(seed, i + 60) * 3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    // Exposed ribcage and torn flesh on some of the infected
    if (seed % 3 === 0 && z.kind !== 'crawler') {
      ctx.fillStyle = 'rgba(110, 18, 24, 0.85)';
      ctx.fillRect(-r * 0.12, -r * 0.45, r * 0.5, r * 0.62);
      ctx.strokeStyle = flash ? '#ffffff' : 'rgba(229, 222, 200, 0.95)';
      ctx.lineWidth = Math.max(0.6, r * 0.05);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.08, -r * 0.38 + i * r * 0.15);
        ctx.lineTo(r * 0.34, -r * 0.34 + i * r * 0.15);
        ctx.stroke();
      }
    }
    // Torn remains of a military vest on others
    if (seed % 4 === 1) {
      ctx.fillStyle = flash ? '#ffffff' : 'rgba(38, 48, 34, 0.9)';
      ctx.fillRect(-r * 0.3, -r * 0.85, r * 0.2, r * 1.7);
      ctx.fillRect(r * 0.12, -r * 0.8, r * 0.2, r * 1.4);
      ctx.fillStyle = flash ? '#ffffff' : 'rgba(74, 85, 60, 0.9)';
      ctx.fillRect(-r * 0.25, -r * 0.2, r * 0.12, r * 0.35); // mag pouch
    }
    // Dark infection veins creeping from the wounds
    ctx.strokeStyle = 'rgba(20, 83, 45, 0.7)';
    ctx.lineWidth = Math.max(0.5, r * 0.04);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const vx = (zRand(seed, i + 70) - 0.5) * r * 0.9;
      const vy = (zRand(seed, i + 80) - 0.5) * r * 1.2;
      ctx.moveTo(vx, vy);
      ctx.lineTo(vx + r * 0.22, vy + r * 0.1);
      ctx.lineTo(vx + r * 0.34, vy + r * 0.28);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Armor shoulder pads on Riot Zombies
  if (z.kind === 'riot_zombie') {
    ctx.fillStyle = flash ? '#ffffff' : '#1e293b';
    ctx.fillRect(-4, -r * 0.95, 8, r * 1.9);
    ctx.fillStyle = flash ? '#ffffff' : '#475569';
    ctx.fillRect(-3, -r * 0.8, 1.4, r * 1.6);
  }

  // Distinct silhouettes and equipment for the new infected classes.
  if (z.kind === 'juggernaut') {
    ctx.fillStyle = flash ? '#fff' : '#29232c';
    ctx.fillRect(-r * 0.82, -r * 0.72, r * 1.64, r * 1.44);
    ctx.fillStyle = flash ? '#fff' : '#9f4354';
    ctx.fillRect(-r * 0.92, -r * 0.55, r * 0.38, r * 1.1);
    ctx.fillRect(r * 0.54, -r * 0.55, r * 0.38, r * 1.1);
    ctx.strokeStyle = '#fb7185'; ctx.lineWidth = 2; ctx.strokeRect(-r * 0.7, -r * 0.62, r * 1.4, r * 1.24);
  }
  if (z.kind === 'tank') {
    ctx.fillStyle = flash ? '#fff' : '#1f2937';
    ctx.fillRect(-r * 0.72, -r * 0.7, r * 0.52, r * 1.4);
    ctx.fillRect(r * 0.18, -r * 0.7, r * 0.52, r * 1.4);
    ctx.strokeStyle = flash ? '#fff' : '#94a3b8';
    ctx.lineWidth = 2;
    ctx.strokeRect(-r * 0.58, -r * 0.5, r * 1.16, r);
  }
  if (z.kind === 'infected_marine') {
    ctx.fillStyle = flash ? '#fff' : '#172554';
    ctx.beginPath();
    ctx.arc(r * 0.16, 0, r * 0.62, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-r * 0.36, -r * 0.48, r * 1.02, r * 0.18);
    ctx.fillStyle = flash ? '#fff' : '#0f172a';
    ctx.fillRect(-r * 0.55, -r * 0.28, r * 0.28, r * 0.56);
  }
  if (z.kind === 'screamer') {
    ctx.strokeStyle = flash ? '#fff' : '#d8b4fe';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(r * 0.18, 0, r * 0.74, -1.2, 1.2);
    ctx.stroke();
  }
  if (z.kind === 'exploder') {
    const pulse = 0.65 + 0.35 * Math.sin(t * 3.5);
    ctx.fillStyle = `rgba(251, 146, 60, ${pulse})`;
    ctx.beginPath();
    ctx.arc(-r * 0.28, -r * 0.36, r * 0.23, 0, Math.PI * 2);
    ctx.arc(r * 0.3, r * 0.32, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (z.kind === 'mutated' && detail) {
    ctx.strokeStyle = flash ? '#fff' : '#a3e635';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.45, -r * 0.2);
    ctx.lineTo(-r * 0.95, -r * 0.9);
    ctx.moveTo(-r * 0.35, r * 0.18);
    ctx.lineTo(-r * 0.92, r * 0.88);
    ctx.stroke();
  }

  // Brute: bulging muscle + scars
  if ((z.kind === 'brute' || z.kind === 'tank') && detail) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, 0, r * 0.5, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(248,113,113,0.65)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, -r * 0.5);
    ctx.lineTo(r * 0.1, r * 0.4);
    ctx.stroke();
  }

  // Glowing acid pustules on Spitters (pulsing)
  if (z.kind === 'spitter') {
    const pulse = 0.75 + 0.25 * Math.sin(t * 2.2);
    ctx.fillStyle = `rgba(74, 222, 128, ${pulse})`;
    ctx.beginPath();
    ctx.arc(-2, -r * 0.45, 3.2, 0, Math.PI * 2);
    ctx.arc(-3, r * 0.4, 2.7, 0, Math.PI * 2);
    ctx.arc(1, 0, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Arms: alternate reaching and dropping, with torn sleeves and hands
  const reachL = r * armReach * (1 + 0.28 * armSwing);
  const reachR = r * armReach * (1 - 0.28 * armSwing);
  ctx.fillStyle = clothCol;
  ctx.fillRect(r * 0.1, -r * 0.95 + sway * 0.5, reachL * 0.55, r * 0.34);
  ctx.fillRect(r * 0.1, r * 0.6 - sway * 0.5, reachR * 0.55, r * 0.34);
  ctx.fillStyle = skin;
  ctx.fillRect(r * 0.1 + reachL * 0.55, -r * 0.93 + sway * 0.5, reachL * 0.5, r * 0.3);
  ctx.fillRect(r * 0.1 + reachR * 0.55, r * 0.62 - sway * 0.5, reachR * 0.5, r * 0.3);
  if (detail) {
    // clawed fingertips
    ctx.fillStyle = flash ? '#ffffff' : '#e7e5e4';
    ctx.fillRect(r * 0.1 + reachL * 1.05, -r * 0.93 + sway * 0.5, 2.2, r * 0.3);
    ctx.fillRect(r * 0.1 + reachR * 1.05, r * 0.62 - sway * 0.5, 2.2, r * 0.3);
  }

  // Head: lolling tilt, mottled skin
  const tilt = Math.sin(t * 0.7) * 0.18;
  ctx.save();
  ctx.translate(r * 0.18, sway * 0.25);
  ctx.rotate(tilt);
  ctx.fillStyle =
    flash ? '#ffffff' : z.kind === 'riot_zombie' ? '#0f172a' : z.kind === 'shambler' ? skin : spec.accent;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
  ctx.fill();

  if (detail) {
    if (z.kind !== 'riot_zombie') {
      // sickly mottling + sunken cheek shadow
      ctx.fillStyle = 'rgba(30, 41, 28, 0.35)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.1, -r * 0.18, r * 0.2, r * 0.12, 0.6, 0, Math.PI * 2);
      ctx.ellipse(-r * 0.05, r * 0.2, r * 0.16, r * 0.1, -0.5, 0, Math.PI * 2);
      ctx.fill();
      // matted hair on the back of the skull
      ctx.fillStyle = flash ? '#ffffff' : '#292524';
      ctx.beginPath();
      ctx.arc(-r * 0.12, 0, r * 0.4, 1.7, 4.6);
      ctx.fill();
    } else {
      ctx.fillStyle = '#475569';
      ctx.fillRect(r * 0.05, -r * 0.35, r * 0.4, r * 0.7); // riot visor
    }

    // Glowing eyes
    ctx.fillStyle =
      z.kind === 'spitter'
        ? '#4ade80'
        : z.kind === 'sprinter' || z.kind === 'brute'
          ? '#f87171'
          : '#fde047';
    ctx.fillRect(r * 0.3, -r * 0.24, 2.2, 1.7);
    ctx.fillRect(r * 0.3, r * 0.1, 2.2, 1.7);

    // Jaw opens and snaps as the zombie moans
    const jaw = 0.5 + 0.5 * Math.sin(t * (fast ? 3.2 : 1.8));
    ctx.fillStyle = '#450a0a';
    ctx.fillRect(r * 0.38, -r * 0.1 - jaw * 1.2, 2.6, 2 + jaw * 2.4);
    ctx.fillStyle = flash ? '#ffffff' : '#f5f5f4';
    ctx.fillRect(r * 0.38, -r * 0.1 - jaw * 1.2, 1.2, 1);
  }
  ctx.restore();

  if ((z.kind === 'brute' || z.kind === 'tank' || z.kind === 'mutated' || z.kind === 'infected_marine' || z.kind === 'juggernaut') && z.koTimer <= 0) {
    ctx.rotate(-(z.angle + lurch));
    drawHealthBar(ctx, 0, -z.radius - 10, z.kind === 'juggernaut' ? 48 : z.kind === 'tank' ? 42 : 34, z.hp / z.maxHp, '#ef4444');
  }
  ctx.restore();
}

function drawHordeHeatmap(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  opsBlend: number,
): void {
  ctx.save();
  ctx.fillStyle = `rgba(239, 68, 68, ${opsBlend * 0.28})`;
  ctx.beginPath();
  for (let i = 0; i < world.zombies.length; i += 2) {
    const z = world.zombies[i];
    if (z.koTimer > 0) continue;
    const r = z.kind === 'tank' ? 38 : z.kind === 'brute' ? 32 : 22;
    ctx.moveTo(z.x + r, z.y);
    ctx.arc(z.x, z.y, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

function drawBuildings(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  camX: number,
  camY: number,
  opsBlend: number,
  minVisX: number,
  maxVisX: number,
  minVisY: number,
  maxVisY: number,
): void {
  for (const r of world.rubble) {
    if (r.x + r.w < minVisX || r.x > maxVisX || r.y + r.h < minVisY || r.y > maxVisY) continue;
    ctx.fillStyle = 'rgba(30, 33, 38, 0.92)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(100, 108, 118, 0.7)';
    let seed = r.seed;
    const n = opsBlend > 0.75 ? 6 : Math.min(26, Math.floor((r.w * r.h) / 1400));
    for (let k = 0; k < n; k++) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      const px = r.x + (seed / 4294967296) * (r.w - 14);
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      const py = r.y + (seed / 4294967296) * (r.h - 10);
      ctx.fillRect(px, py, 6 + (k % 4) * 3, 4 + (k % 3) * 3);
    }
  }
  for (const b of world.buildings) {
    if (
      b.x + b.w < minVisX - 60 ||
      b.x > maxVisX + 60 ||
      b.y + b.h < minVisY - 60 ||
      b.y > maxVisY + 60
    ) {
      continue;
    }

    if (opsBlend > 0.75) {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      continue;
    }

    const cx = b.x + b.w * 0.5;
    const cy = b.y + b.h * 0.5;
    const parallaxScale = 0.032 * b.height * (1 - opsBlend);
    const ox = Math.max(-22, Math.min(22, (cx - camX) * parallaxScale * 0.03));
    const oy =
      Math.max(-22, Math.min(22, (cy - camY) * parallaxScale * 0.03)) -
      b.height * 0.32 * (1 - opsBlend);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.fillRect(b.x + 12, b.y + 14, b.w, b.h);

    if (b.kind === 'tank_silo') {
      const r = Math.min(b.w, b.h) * 0.46;
      ctx.fillStyle = b.wallColor;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.roofColor;
      ctx.beginPath();
      ctx.arc(cx + ox * 0.6, cy + oy * 0.6, r * 0.92, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + ox * 0.6, cy + oy * 0.6, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }

    ctx.fillStyle = b.wallColor;
    ctx.fillRect(b.x, b.y, b.w, b.h);

    const rx = b.x + ox;
    const ry = b.y + oy;
    ctx.fillStyle = b.roofColor;
    ctx.fillRect(rx, ry, b.w, b.h);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.26)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx, ry, b.w, b.h);

    if (b.kind === 'office' || b.kind === 'apartments') {
      ctx.fillStyle = 'rgba(250, 204, 21, 0.32)';
      for (let wx = rx + 14; wx < rx + b.w - 18; wx += 26) {
        if ((Math.floor(wx) + b.x) % 2 === 0) {
          ctx.fillRect(wx, b.y + b.h - 6, 9, 4);
        }
      }
    }

    if (b.kind === 'hangar') {
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let gx = rx + 20; gx < rx + b.w - 15; gx += 28) {
        ctx.moveTo(gx, ry + 6);
        ctx.lineTo(gx, ry + b.h - 6);
      }
      ctx.stroke();
    }

    if (b.hasHelipad) {
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.68)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(rx + b.w * 0.5, ry + b.h * 0.5, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = '700 18px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(250, 204, 21, 0.78)';
      ctx.fillText('H', rx + b.w * 0.5, ry + b.h * 0.5);
    } else if (b.kind === 'hospital') {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(rx + b.w * 0.5 - 4, ry + b.h * 0.5 - 12, 8, 24);
      ctx.fillRect(rx + b.w * 0.5 - 12, ry + b.h * 0.5 - 4, 24, 8);
    } else {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.38)';
      ctx.fillRect(rx + 14, ry + 14, 20, 14);
      ctx.fillRect(rx + b.w - 38, ry + b.h - 28, 22, 14);
    }
  }
  for (const b of world.buildings) {
    if (b.hp === undefined || b.maxHp === undefined) continue;
    if (b.x + b.w < minVisX || b.x > maxVisX || b.y + b.h < minVisY || b.y > maxVisY) continue;
    const dmg = 1 - b.hp / b.maxHp;
    const flash = b.damageFlash ?? 0;
    if (dmg < 0.05 && flash <= 0) continue;
    ctx.fillStyle = `rgba(10, 8, 6, ${Math.min(0.55, dmg * 0.6)})`;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    if (dmg > 0.35 && opsBlend < 0.75) {
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.2, b.y);
      ctx.lineTo(b.x + b.w * 0.35, b.y + b.h * 0.5);
      ctx.lineTo(b.x + b.w * 0.28, b.y + b.h);
      ctx.moveTo(b.x + b.w * 0.7, b.y + b.h * 0.1);
      ctx.lineTo(b.x + b.w * 0.6, b.y + b.h * 0.6);
      ctx.stroke();
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 190, 90, ${flash * 1.2})`;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
  }

}

function drawWeatherHeadlights(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  minVisX: number,
  maxVisX: number,
  minVisY: number,
  maxVisY: number,
): void {
  ctx.save();
  const alpha = world.weather.kind === 'storm' ? 0.14 : 0.09;
  ctx.fillStyle = `rgba(254, 243, 199, ${alpha})`;
  for (let i = 0; i < world.units.length; i++) {
    const u = world.units[i];
    if (u.koTimer > 0) continue;
    if (u.x < minVisX - 150 || u.x > maxVisX + 150 || u.y < minVisY - 150 || u.y > maxVisY + 150) {
      continue;
    }
    if (UNIT_SPECS[u.kind].isVehicle) {
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(u.turretAngle);
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(150, -45);
      ctx.lineTo(150, 45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  minVisX: number,
  maxVisX: number,
  minVisY: number,
  maxVisY: number,
): void {
  for (let i = 0; i < world.projectiles.length; i++) {
    const p = world.projectiles[i];
    if (!p.active) continue;
    if (p.x < minVisX - 40 || p.x > maxVisX + 40 || p.y < minVisY - 40 || p.y > maxVisY + 40) {
      continue;
    }
    const color = p.kind === 'acid' ? '#4ade80' : p.kind === 'shell' || p.kind === 'artillery' ? '#fb923c' : p.kind === 'rocket' ? '#38bdf8' : p.kind === 'heavy_bullet' ? '#facc15' : '#fef08a';
    const width = p.kind === 'shell' || p.kind === 'artillery' ? 4 : p.kind === 'rocket' ? 3.5 : p.kind === 'heavy_bullet' ? 2.5 : p.kind === 'acid' ? 2.5 : 1.8;
    ctx.save();
    // Add a soft halo behind projectiles; low graphics keeps only the crisp core.
    if (!world.lowLagMode && world.graphicsQuality !== 'low') {
      ctx.globalAlpha = 0.24;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * (p.kind === 'shell' || p.kind === 'rocket' ? 4 : 2.8);
      ctx.beginPath();
      ctx.moveTo(p.prevX, p.prevY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.96;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.prevX, p.prevY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (p.kind === 'acid' || p.kind === 'shell' || p.kind === 'rocket' || p.kind === 'artillery') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.kind === 'acid' ? 3.5 : 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawPendingStrikes(ctx: CanvasRenderingContext2D, world: GameWorld): void {
  for (const st of world.pendingStrikes) {
    const spec = STRIKE_SPECS[st.kind];
    const progress = 1 - Math.max(0, st.timer) / st.duration;
    ctx.save();
    ctx.translate(st.x, st.y);
    const color = st.kind === 'supplydrop' ? '#38bdf8' : st.kind === 'reinforce' ? '#4ade80' : '#ef4444';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, spec.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle =
      st.kind === 'supplydrop' ? 'rgba(56, 189, 248, 0.14)' : st.kind === 'reinforce' ? 'rgba(74, 222, 128, 0.14)' : 'rgba(239, 68, 68, 0.14)';
    ctx.beginPath();
    ctx.arc(0, 0, spec.radius * progress, 0, Math.PI * 2);
    ctx.fill();
    // Render a two-ship fighter formation while the airstrike is inbound/active.
    if (st.kind === 'airstrike') {
      const pass = Math.max(0, Math.min(1, progress));
      for (const offset of [-18, 18]) {
        const along = (pass - 0.5) * 300;
        ctx.save();
        ctx.translate(Math.cos(st.angle) * along - Math.sin(st.angle) * offset,
          Math.sin(st.angle) * along + Math.cos(st.angle) * offset);
        ctx.rotate(st.angle);
        ctx.fillStyle = '#cbd5e1';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(-9, -5);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-9, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  minVisX: number,
  maxVisX: number,
  minVisY: number,
  maxVisY: number,
): void {
  const lowLag = world.lowLagMode;
  const particleStep = lowLag || world.graphicsQuality === 'low' ? 5 : world.graphicsQuality === 'medium' ? 2 : 1;
  for (let i = 0; i < world.particles.length; i += particleStep) {
    const p = world.particles[i];
    if (!p.active) continue;
    if ((lowLag || world.graphicsQuality === 'low') && p.kind === 'casing') continue;
    if (p.x < minVisX - 40 || p.x > maxVisX + 40 || p.y < minVisY - 40 || p.y > maxVisY + 40) {
      continue;
    }
    const t = clamp01(p.life / p.maxLife);
    ctx.globalAlpha = t;
    if (p.kind === 'ring') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 * t;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.1 - t * 0.75), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(
        p.x,
        p.y,
        Math.max(1, p.size * (p.kind === 'smoke' ? 1.8 - t * 0.8 : t)),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawPlacementPreview(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  input: InputState,
): void {
  if (!world.placementMode) return;
  const mode = world.placementMode.kind;
  const wx = input.mouseWorldX;
  const wy = input.mouseWorldY;

  ctx.save();
  ctx.translate(wx, wy);
  if (
    mode === 'wall' ||
    mode === 'gate' ||
    mode === 'wire' ||
    mode === 'oil' ||
    mode === 'laser' ||
    mode === 'electric' ||
    mode === 'turret' ||
    mode === 'autocannon' ||
    mode === 'rocket_turret' ||
    mode === 'charge'
  ) {
    const spec = STRUCTURE_SPECS[mode];
    const valid = isNearSupplyOrFob(world, wx, wy) && wx > world.coastlineX + 25;
    const stroke = valid ? '#38bdf8' : '#ef4444';
    const fill = valid ? 'rgba(56, 189, 248, 0.22)' : 'rgba(239, 68, 68, 0.22)';

    if (mode === 'wall' || mode === 'gate' || mode === 'wire' || mode === 'oil' || mode === 'laser' || mode === 'electric') {
      ctx.rotate(world.placementAngle);
      ctx.strokeStyle = stroke;
      ctx.fillStyle = fill;
      ctx.lineWidth = 2;
      ctx.fillRect(-spec.w * 0.5, -spec.h * 0.5, spec.w, spec.h);
      ctx.strokeRect(-spec.w * 0.5, -spec.h * 0.5, spec.w, spec.h);
      ctx.rotate(-world.placementAngle);
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#bae6fd';
      const deg = Math.round((world.placementAngle * 180) / Math.PI) % 360;
      ctx.fillText(`${mode === 'gate' ? 'GATE ' : ''}${deg}° [R ROTATE]`, 0, -34);
    } else {
      const turretSpec = STRUCTURE_SPECS[mode];
      ctx.strokeStyle = stroke;
      ctx.fillStyle = fill;
      ctx.lineWidth = 2;
      ctx.fillRect(-turretSpec.w * 0.5, -turretSpec.h * 0.5, turretSpec.w, turretSpec.h);
      ctx.strokeRect(-turretSpec.w * 0.5, -turretSpec.h * 0.5, turretSpec.w, turretSpec.h);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.beginPath();
      ctx.arc(0, 0, turretSpec.range, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    const spec = STRIKE_SPECS[mode];
    ctx.strokeStyle = mode === 'supplydrop' ? '#38bdf8' : mode === 'reinforce' ? '#4ade80' : '#f97316';
    ctx.fillStyle =
      mode === 'supplydrop' ? 'rgba(56, 189, 248, 0.14)' : mode === 'reinforce' ? 'rgba(74, 222, 128, 0.14)' : 'rgba(249, 115, 22, 0.14)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, spec.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawDirectControlReticle(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  input: InputState,
): void {
  if (world.directControlUnitId === null) return;
  const unit = world.units.find((u) => u.id === world.directControlUnitId);
  if (!unit) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(unit.x, unit.y);
  ctx.lineTo(input.mouseWorldX, input.mouseWorldY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.translate(input.mouseWorldX, input.mouseWorldY);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.moveTo(-20, 0);
  ctx.lineTo(-8, 0);
  ctx.moveTo(8, 0);
  ctx.lineTo(20, 0);
  ctx.moveTo(0, -20);
  ctx.lineTo(0, -8);
  ctx.moveTo(0, 8);
  ctx.lineTo(0, 20);
  ctx.stroke();
  ctx.restore();
}

function drawNatoOpsOverlay(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  opsBlend: number,
): void {
  ctx.save();
  ctx.globalAlpha = opsBlend;
  const scale = Math.max(1, 0.58 / Math.max(0.28, world.camera.zoom));

  for (const u of world.units) {
    if (u.koTimer > 0) continue;
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.scale(scale, scale);

    ctx.fillStyle = '#0f2942';
    ctx.strokeStyle = u.selected ? '#facc15' : '#38bdf8';
    ctx.lineWidth = u.selected ? 3 : 2;
    ctx.fillRect(-18, -12, 36, 24);
    ctx.strokeRect(-18, -12, 36, 24);

    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 1.8;
    const spec = UNIT_SPECS[u.kind];
    if (u.kind === 'truck') {
      ctx.font = '700 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#facc15';
      ctx.fillText('SUP', 0, 0);
    } else if (spec.isAir) {
      ctx.beginPath();
      ctx.moveTo(-11, -5);
      ctx.lineTo(11, 5);
      ctx.lineTo(11, -5);
      ctx.lineTo(-11, 5);
      ctx.closePath();
      ctx.stroke();
    } else if (spec.isVehicle) {
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(-18, -12);
      ctx.lineTo(18, 12);
      ctx.moveTo(18, -12);
      ctx.lineTo(-18, 12);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawWeatherOverlay(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  width: number,
  height: number,
  opsBlend: number,
  rainIntensity: 'off' | 'light' | 'normal',
): void {
  const w = world.weather;
  if (w.kind === 'clear' || opsBlend > 0.85) return;
  if (rainIntensity === 'off' && (w.kind === 'rain' || w.kind === 'storm')) return;
  if (world.lowLagMode && (w.kind === 'rain' || w.kind === 'storm')) return;

  const strength = (1 - opsBlend) * ((w.kind === 'rain' || w.kind === 'storm') && rainIntensity === 'light' ? 0.52 : 1);
  ctx.save();

  if (w.kind === 'fog') {
    if (world.lowLagMode) {
      ctx.fillStyle = `rgba(120, 136, 156, ${0.24 * strength})`;
      ctx.fillRect(0, 0, width, height);
    } else {
      const key = `${width}x${height}`;
      let cached = fogGradientCache.get(ctx);
      if (!cached || cached.key !== key) {
        const gradient = ctx.createRadialGradient(
          width * 0.5, height * 0.5, width * 0.15,
          width * 0.5, height * 0.5, width * 0.68,
        );
        gradient.addColorStop(0, 'rgba(148, 163, 184, 0.14)');
        gradient.addColorStop(1, 'rgba(100, 116, 139, 0.38)');
        cached = { key, gradient };
        fogGradientCache.set(ctx, cached);
      }
      ctx.globalAlpha = strength;
      ctx.fillStyle = cached.gradient;
      ctx.fillRect(0, 0, width, height);
    }
  } else if ((w.kind === 'rain' || w.kind === 'storm') && !world.lowLagMode) {
    ctx.fillStyle = `rgba(6, 16, 30, ${(w.kind === 'storm' ? 0.28 : 0.16) * strength})`;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle =
      w.kind === 'storm'
        ? `rgba(186, 230, 253, ${0.42 * strength})`
        : `rgba(186, 230, 253, ${0.28 * strength})`;
    ctx.lineWidth = w.kind === 'storm' ? 1.5 : 1.1;
    ctx.beginPath();
    const dx = w.windX * 0.025;
    const step = world.lowLagMode ? 2 : 1;
    for (let i = 0; i < world.rainDrops.length; i += step) {
      const r = world.rainDrops[i];
      const sx = (r.x / 1600) * width;
      const sy = (r.y / 1000) * height;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + dx, sy + r.len);
    }
    ctx.stroke();

    if (!world.lowLagMode && w.lightningFlash > 0.02) {
      ctx.fillStyle = `rgba(224, 242, 254, ${w.lightningFlash * 0.34 * strength})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  ctx.restore();
}

function drawHealthBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  ratio: number,
  color: string,
): void {
  const clamped = clamp01(ratio);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(x - w * 0.5, y, w, 3.5);
  ctx.fillStyle = color;
  ctx.fillRect(x - w * 0.5, y, w * clamped, 3.5);
}

// Fortified main-base bunker: apron, sandbags, chamfered concrete hull, roof hatch, fans, gun ports, antenna.
function drawBunker(ctx: CanvasRenderingContext2D, s: { w: number; h: number; hitFlash: number; hp: number; maxHp: number; gateOpen?: number; doorLocked?: boolean }): void {
  const hw = s.w * 0.5;
  const hh = s.h * 0.5;
  const t = Date.now() / 1000;
  const flash = s.hitFlash > 0;
  const poly = (pts: number[][]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  // shadow + concrete apron with hazard border
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(-hw - 6, -hh + 8, s.w + 22, s.h + 18);
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(-hw - 14, -hh - 14, s.w + 28, s.h + 28);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(-hw - 14, -hh - 14, s.w + 28, s.h + 28);
  ctx.setLineDash([]);
  // sandbag ring
  ctx.fillStyle = '#a78a5c';
  for (let x = -hw - 8; x <= hw + 8; x += 13) {
    ctx.beginPath(); ctx.ellipse(x, -hh - 9, 7, 4, 0, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, hh + 9, 7, 4, 0, 0, 6.3); ctx.fill();
  }
  for (let y = -hh; y <= hh; y += 13) {
    ctx.beginPath(); ctx.ellipse(-hw - 9, y, 4, 7, 0, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hw + 9, y, 4, 7, 0, 0, 6.3); ctx.fill();
  }
  // main hull (chamfered)
  const c = 16;
  poly([[-hw + c, -hh], [hw - c, -hh], [hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c]]);
  ctx.fillStyle = flash ? '#ffffff' : '#3b4757';
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  ctx.stroke();
  // raised roof slab
  poly([[-hw + 14, -hh + 10], [hw - 14, -hh + 10], [hw - 8, -hh + 18], [hw - 8, hh - 22], [-hw + 8, hh - 22], [-hw + 8, -hh + 18]]);
  ctx.fillStyle = flash ? '#f1f5f9' : '#566377';
  ctx.fill();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(15,23,42,0.45)';
  ctx.beginPath();
  ctx.moveTo(-hw * 0.5, -hh + 12); ctx.lineTo(-hw * 0.5, hh - 24);
  ctx.moveTo(hw * 0.5, -hh + 12); ctx.lineTo(hw * 0.5, hh - 24);
  ctx.stroke();
  // central armored hatch
  ctx.fillStyle = '#1e293b';
  ctx.beginPath(); ctx.arc(0, -4, 17, 0, 6.3); ctx.fill();
  ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = '#64748b';
  ctx.beginPath(); ctx.moveTo(-12, -4); ctx.lineTo(12, -4); ctx.moveTo(0, -16); ctx.lineTo(0, 8); ctx.stroke();
  // spinning vent fans
  for (const fx of [-hw * 0.5 - 2, hw * 0.5 + 2]) {
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.arc(fx, -4, 9, 0, 6.3); ctx.fill();
    ctx.save(); ctx.translate(fx, -4); ctx.rotate(t * 6);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(-7, -1.5, 14, 3); ctx.fillRect(-1.5, -7, 3, 14);
    ctx.restore();
  }
  // corner gun ports with red sensors
  for (const [gx, gy] of [[-hw + 8, -hh + 8], [hw - 8, -hh + 8], [-hw + 8, hh - 8], [hw - 8, hh - 8]]) {
    ctx.fillStyle = '#111827';
    ctx.fillRect(gx - 7, gy - 5, 14, 10);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(gx - 2, gy - 1.5, 4, 3);
  }
  // Animated twin-leaf blast door: leaves slide into the bunker walls when open.
  const dw = 44;
  const openAmt = clamp01(s.gateOpen ?? 0);
  ctx.fillStyle = '#020617';
  ctx.fillRect(-dw / 2, hh - 18, dw, 18);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#111827' : '#facc15';
    ctx.fillRect(-dw / 2 + i * (dw / 6), hh - 6, dw / 6, 5);
  }
  const leafW = dw / 2 - 3;
  const slide = openAmt * (dw * 0.42);
  ctx.fillStyle = s.doorLocked ? '#7f1d1d' : '#475569';
  ctx.fillRect(-dw / 2 + 2 - slide, hh - 16, leafW, 12);
  ctx.fillRect(1 + slide, hh - 16, leafW, 12);
  ctx.fillStyle = s.doorLocked ? '#f87171' : openAmt > 0.5 ? '#38bdf8' : '#facc15';
  ctx.fillRect(-2, hh - 13, 4, 5);
  // blinking status lights
  const on = Math.sin(t * 4) > 0;
  ctx.fillStyle = on ? '#22d3ee' : '#0e7490';
  ctx.fillRect(-hw + 12, hh - 12, 5, 5);
  ctx.fillRect(hw - 17, hh - 12, 5, 5);
  // antenna mast
  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(hw - 20, -hh + 14); ctx.lineTo(hw - 20, -hh - 22); ctx.stroke();
  ctx.fillStyle = Math.sin(t * 3) > 0 ? '#ef4444' : '#7f1d1d';
  ctx.beginPath(); ctx.arc(hw - 20, -hh - 22, 3, 0, 6.3); ctx.fill();
}

// Extra aircraft: Little Bird, Hind, Chinook and Recon Drone (nose points along +x).
function drawExtraAircraft(ctx: CanvasRenderingContext2D, u: PlayerUnit, world: GameWorld): void {
  const spin = world.elapsedSec * 24 + u.id;
  const hit = u.hitFlash > 0;
  const rotor = (x: number, r: number) => {
    ctx.save();
    ctx.translate(x, 0);
    ctx.fillStyle = 'rgba(226, 232, 240, 0.08)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(spin);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.6)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r);
    ctx.stroke();
    ctx.restore();
  };
  ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
  ctx.beginPath();
  ctx.ellipse(16, 22, u.radius, u.radius * 0.42, u.angle, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.rotate(u.angle);
  if (u.kind === 'littlebird') {
    ctx.fillStyle = '#334155';
    ctx.fillRect(-26, -1.5, 20, 3);
    ctx.fillRect(-27, -6, 3, 12);
    ctx.fillStyle = hit ? '#ffffff' : '#2f3d4f';
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath(); ctx.ellipse(6, 0, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-4, -11, 12, 3);
    ctx.fillRect(-4, 8, 12, 3);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(6, -11, 3, 3);
    ctx.fillRect(6, 8, 3, 3);
    rotor(0, 24);
  } else if (u.kind === 'hind') {
    ctx.fillStyle = '#334155';
    ctx.fillRect(-34, -2, 28, 4);
    ctx.fillRect(-35, -7, 4, 14);
    ctx.fillStyle = '#3a4630';
    ctx.fillRect(-4, -20, 10, 40);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(-2, -23, 13, 5);
    ctx.fillRect(-2, 18, 13, 5);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(9, -23, 2, 5);
    ctx.fillRect(9, 18, 2, 5);
    ctx.fillStyle = hit ? '#ffffff' : '#4b5a3a';
    ctx.beginPath();
    ctx.moveTo(28, 0); ctx.lineTo(10, -9); ctx.lineTo(-12, -8); ctx.lineTo(-12, 8); ctx.lineTo(10, 9);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(13, -4, 9, 8);
    ctx.fillRect(3, -3, 7, 6);
    rotor(0, 31);
  } else if (u.kind === 'chinook') {
    ctx.fillStyle = hit ? '#ffffff' : '#3b4a3f';
    ctx.fillRect(-26, -8, 52, 16);
    ctx.beginPath();
    ctx.moveTo(26, -8); ctx.lineTo(33, -4); ctx.lineTo(33, 4); ctx.lineTo(26, 8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(25, -4, 6, 8);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(-31, -6, 5, 12);
    ctx.fillStyle = '#34d399';
    ctx.fillRect(-4, -2, 8, 4);
    ctx.fillRect(-1.5, -5, 3, 10);
    rotor(16, 22);
    rotor(-18, 22);
  } else {
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-2, -21, 6, 42);
    ctx.fillRect(-15, -6, 4, 12);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-1, -15, 4, 5);
    ctx.fillRect(-1, 10, 4, 5);
    ctx.fillStyle = hit ? '#ffffff' : '#94a3b8';
    ctx.beginPath(); ctx.ellipse(0, 0, 15, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111827';
    ctx.beginPath(); ctx.arc(12, 0, 3, 0, Math.PI * 2); ctx.fill();
    rotor(-16, 7);
  }
  ctx.restore();
}

// Shop preview: draws one unit / aircraft / defense centered in a size x size box.
export function drawItemPreview(ctx: CanvasRenderingContext2D, kind: string, size: number): void {
  const stubWorld = {
    directControlUnitId: null,
    elapsedSec: 0.3,
    structures: [] as unknown[],
    units: [],
    zombies: [],
  } as unknown as GameWorld;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  if (kind in UNIT_SPECS) {
    const spec = UNIT_SPECS[kind as PlayerUnitKind];
    const sc = (size * 0.34) / Math.max(spec.radius, 14);
    ctx.scale(sc, sc);
    const u = {
      id: 1, kind, x: 0, y: 0, vx: 0, vy: 0, angle: -0.45, turretAngle: -0.45,
      hp: 1, maxHp: 1, ammo: 1, maxAmmo: 1, radius: spec.radius, selected: false,
      targetX: null, targetY: null, attackMove: false, fireCooldown: 0, secondaryCooldown: 0,
      recoil: 0, hitFlash: 0, gaitPhase: 0, resupplyPulse: 0, kills: 0, koTimer: 0,
    } as unknown as PlayerUnit;
    drawPlayerUnit(ctx, u, stubWorld, 0);
  } else if (kind in STRUCTURE_SPECS) {
    const spec = STRUCTURE_SPECS[kind as keyof typeof STRUCTURE_SPECS];
    const sc = (size * 0.8) / Math.max(spec.w, spec.h, 40);
    ctx.scale(sc, sc);
    const s = {
      id: 1, kind, x: 0, y: 0, w: spec.w, h: spec.h, angle: 0, hp: 100, maxHp: 100,
      ammo: 10, maxAmmo: 10, fireCooldown: 0, recoil: 0, hitFlash: 0, tier: 2, gateOpen: 0,
    };
    stubWorld.structures = [s as never];
    drawStructures(ctx, stubWorld, 0, -1e5, 1e5, -1e5, 1e5);
  }
  ctx.restore();
}

// Map-specific ground decoration (seeded so it never changes between frames)
function drawMapDecor(octx: CanvasRenderingContext2D, world: GameWorld): void {
  if (world.mapId !== 'desert_fort' && world.mapId !== 'frozen_harbor') return;
  let seed = world.mapId === 'desert_fort' ? 1337 : 4242;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const desert = world.mapId === 'desert_fort';
  for (let i = 0; i < 170; i++) {
    const x = world.coastlineX + 60 + rnd() * (world.width - world.coastlineX - 120);
    const y = rnd() * world.height;
    const rx = 70 + rnd() * 220;
    const ry = rx * (0.25 + rnd() * 0.3);
    octx.fillStyle = desert ? 'rgba(214, 176, 110, 0.07)' : 'rgba(200, 232, 255, 0.075)';
    octx.beginPath();
    octx.ellipse(x, y, rx, ry, rnd() * Math.PI, 0, Math.PI * 2);
    octx.fill();
  }
  if (!desert) {
    octx.strokeStyle = 'rgba(180, 220, 245, 0.12)';
    octx.lineWidth = 2;
    for (let i = 0; i < 60; i++) {
      const x = world.coastlineX + 60 + rnd() * (world.width - world.coastlineX - 120);
      const y = rnd() * world.height;
      octx.beginPath();
      octx.moveTo(x, y);
      octx.lineTo(x + (rnd() - 0.5) * 90, y + (rnd() - 0.5) * 90);
      octx.lineTo(x + (rnd() - 0.5) * 140, y + (rnd() - 0.5) * 140);
      octx.stroke();
    }
  }
}

// Civilians waiting for rescue (orange vest + pulsing ring) or following a rescuer to the bunker.
function drawCivilians(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): void {
  const t = world.elapsedSec;
  for (let i = 0; i < world.civilians.length; i++) {
    const c = world.civilians[i];
    if (c.x < minX - 30 || c.x > maxX + 30 || c.y < minY - 30 || c.y > maxY + 30) continue;
    ctx.save();
    ctx.translate(c.x, c.y);
    if (c.state === 'waiting') {
      ctx.strokeStyle = `rgba(250, 204, 21, ${0.35 + 0.3 * Math.sin(t * 5 + c.id)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 13 + 2 * Math.sin(t * 5 + c.id), 0, Math.PI * 2);
      ctx.stroke();
    } else if (c.state === 'following') {
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
    const bob = c.state === 'following' ? Math.sin(t * 14 + c.id) * 1.2 : 0;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath(); ctx.ellipse(0, 6, 6, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fb923c';
    ctx.fillRect(-4, -3 + bob, 8, 9);
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath(); ctx.arc(0, -6 + bob, 3.6, 0, Math.PI * 2); ctx.fill();
    if (c.state === 'waiting') {
      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', 0, -15);
    }
    if (c.hp < 40) {
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(-7, 9, 14, 2);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-7, 9, 14 * Math.max(0, c.hp / 40), 2);
    }
    ctx.restore();
  }
}
