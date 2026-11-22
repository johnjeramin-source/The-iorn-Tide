import type { GameWorld } from './types';

export const DAY_LENGTH_SEC = 480; // one full day/night cycle = 8 minutes of play

export interface Daylight {
  darkness: number; // 0 = full day, 1 = deep night
  warm: number; // 0..1 dawn/dusk amber tint strength
  label: 'DAWN' | 'DAY' | 'DUSK' | 'NIGHT';
}

// Start in the morning so early waves are readable; night peaks at ~0.75 of the cycle.
export function getDaylight(elapsedSec: number): Daylight {
  const t = (elapsedSec / DAY_LENGTH_SEC + 0.18) % 1;
  const sun = Math.sin(t * Math.PI * 2); // +1 at t=0.25 (noon), -1 at t=0.75 (midnight)
  const rising = Math.cos(t * Math.PI * 2) > 0;
  const darkness = Math.max(0, Math.min(1, 0.5 - sun * 0.85));
  const warm = darkness > 0.15 && darkness < 0.85 ? Math.max(0, 1 - Math.abs(darkness - 0.5) * 3.2) : 0;
  const label: Daylight['label'] = darkness > 0.7 ? 'NIGHT' : darkness > 0.3 ? (rising ? 'DAWN' : 'DUSK') : 'DAY';
  return { darkness, warm, label };
}

const glowSprites = new Map<string, HTMLCanvasElement>();

// One pre-rendered radial glow per colour, scaled when drawn. Avoids building a
// new gradient for every light every frame.
function getGlowSprite(rgb: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  let sprite = glowSprites.get(rgb);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = 128;
    const c = sprite.getContext('2d');
    if (!c) return null;
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, `rgba(${rgb}, 1)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    glowSprites.set(rgb, sprite);
  }
  return sprite;
}

export function drawLighting(
  ctx: CanvasRenderingContext2D,
  world: GameWorld,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  opsBlend: number,
  nightVisibility: 'normal' | 'bright',
): void {
  if (opsBlend > 0.75) return;
  const { darkness, warm } = getDaylight(world.elapsedSec);
  const comfort = nightVisibility === 'bright' ? 0.5 : 1; // Night Visibility setting halves the dimming
  const night = darkness * 0.46 * comfort * (1 - opsBlend);
  if (night < 0.01 && warm < 0.02) return;

  ctx.save();
  if (warm > 0.02) {
    ctx.fillStyle = `rgba(255, 150, 60, ${0.08 * warm * (1 - opsBlend)})`;
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
  }
  if (night >= 0.01) {
    ctx.fillStyle = `rgba(6, 14, 40, ${night})`;
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

    // Light pools around FOBs, defensive turrets and burning fires (skipped in Low-Lag mode)
    if (!world.lowLagMode && darkness > 0.25) {
      ctx.globalCompositeOperation = 'lighter';
      const pool = (x: number, y: number, r: number, rgb: string, a: number) => {
        if (x < minX - r || x > maxX + r || y < minY - r || y > maxY + r) return;
        const sprite = getGlowSprite(rgb);
        if (!sprite) return;
        ctx.globalAlpha = Math.min(1, a * darkness);
        ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
      };
      let drawn = 0;
      for (const s of world.structures) {
        if (drawn >= 14) break;
        if (s.hp <= 0) continue;
        if (s.kind === 'fob') { pool(s.x, s.y, 190, '255, 220, 150', 0.34); drawn++; }
        else if (s.kind === 'turret' || s.kind === 'autocannon' || s.kind === 'rocket_turret') { pool(s.x, s.y, 80, '190, 225, 255', 0.2); drawn++; }
      }
      for (const f of world.fires) pool(f.x, f.y, f.radius * 3.2, '255, 150, 60', 0.45);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}
