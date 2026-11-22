import React, { useEffect, useRef } from 'react';
import { UNIT_SPECS } from '../game/data';
import { GameWorld } from '../game/types';
import { addMinimapPing, setRallyPoint } from '../game/engine';

interface TacticalMiniMapProps {
  worldRef: React.RefObject<GameWorld>;
  onPanToWorld: (wx: number, wy: number) => void;
  onClose: () => void;
  embedded?: boolean;
}

export const TacticalMiniMap: React.FC<TacticalMiniMapProps> = ({
  worldRef,
  onPanToWorld,
  onClose,
  embedded = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const longPressRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const panFromPointer = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const world = worldRef.current;
    if (!canvas || !world) return;
    const rect = canvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    onPanToWorld(nx * world.width, ny * world.height);
  };

  useEffect(() => {
    let rafId = 0;
    let lastDraw = 0;

    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);
      const world = worldRef.current;
      const intervalMs = world?.lowLagMode ? 180 : 100;
      if (now - lastDraw < intervalMs) return;
      lastDraw = now;

      const canvas = canvasRef.current;
      if (!canvas || !world) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const sx = w / world.width;
      const sy = h / world.height;

      // Ocean & Landmass
      const coastPx = world.coastlineX * sx;
      ctx.fillStyle = '#061a2e';
      ctx.fillRect(0, 0, coastPx, h);
      ctx.fillStyle = '#18222e';
      ctx.fillRect(coastPx, 0, w - coastPx, h);

      // Coastline rim
      ctx.fillStyle = '#475569';
      ctx.fillRect(coastPx - 1, 0, 2, h);

      // Roads
      ctx.fillStyle = '#283342';
      for (const r of world.roads) {
        if (r.axis === 'h') {
          const rx = (r.start ?? world.coastlineX) * sx;
          const rw = ((r.end ?? world.width) - (r.start ?? world.coastlineX)) * sx;
          ctx.fillRect(rx, (r.center - r.width * 0.5) * sy, rw, Math.max(2, r.width * sy));
        } else {
          const ry = (r.start ?? 0) * sy;
          const rh = ((r.end ?? world.height) - (r.start ?? 0)) * sy;
          ctx.fillRect((r.center - r.width * 0.5) * sx, ry, Math.max(2, r.width * sx), rh);
        }
      }

      // Water canals & bridges
      ctx.fillStyle = '#0c3556';
      for (const wc of world.waterChannels) {
        ctx.fillRect(wc.x * sx, wc.y * sy, Math.max(2, wc.w * sx), wc.h * sy);
      }
      ctx.fillStyle = '#64748b';
      for (const br of world.bridges) {
        ctx.fillRect(br.x * sx, br.y * sy, br.w * sx, br.h * sy);
      }

      // Buildings
      ctx.fillStyle = '#0f172a';
      for (const b of world.buildings) {
        ctx.fillRect(b.x * sx, b.y * sy, Math.max(2, b.w * sx), Math.max(2, b.h * sy));
      }

      // Naval Fleet + Carrier
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(
        (world.carrierPos.x - 40) * sx,
        (world.carrierPos.y - 180) * sy,
        Math.max(4, 80 * sx),
        Math.max(10, 360 * sy),
      );
      for (const ship of world.navalFleet) {
        ctx.fillRect(
          (ship.x - ship.beam * 0.5) * sx,
          (ship.y - ship.length * 0.5) * sy,
          Math.max(3, ship.beam * sx),
          Math.max(7, ship.length * sy),
        );
      }

      // Sectors
      for (const sec of world.sectors) {
        ctx.strokeStyle =
          sec.owner === 'player' ? '#38bdf8' : sec.owner === 'neutral' ? '#f59e0b' : '#ef4444';
        ctx.fillStyle =
          sec.owner === 'player'
            ? 'rgba(56, 189, 248, 0.2)'
            : sec.owner === 'neutral'
              ? 'rgba(245, 158, 11, 0.16)'
              : 'rgba(239, 68, 68, 0.16)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(sec.x * sx, sec.y * sy, Math.max(4, sec.radius * sx), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Structures
      for (const s of world.structures) {
        if (s.hp <= 0) continue;
        ctx.fillStyle = s.kind === 'fob' ? '#facc15' : '#94a3b8';
        const size = s.kind === 'fob' ? 4 : 2;
        ctx.fillRect(s.x * sx - size * 0.5, s.y * sy - size * 0.5, size, size);
      }

      // Zombies
      ctx.fillStyle = '#ef4444';
      for (let i = 0; i < world.zombies.length; i++) {
        const z = world.zombies[i];
        if (z.koTimer > 0) continue;
        const size = z.kind === 'tank' ? 3.6 : z.kind === 'brute' ? 3 : 1.8;
        ctx.fillRect(z.x * sx - size * 0.5, z.y * sy - size * 0.5, size, size);
      }

      // Fog of war: unexplored sectors are hidden, explored sectors stay dimmed.
      if (world.fogEnabled) {
        for (let gy = 0; gy < 24; gy++) {
          for (let gx = 0; gx < 40; gx++) {
            const index = gy * 40 + gx;
            if (world.fogVisible[index]) continue;
            ctx.fillStyle = world.fogExplored[index] ? 'rgba(2, 8, 16, 0.58)' : 'rgba(2, 7, 14, 0.94)';
            ctx.fillRect(gx * 100 * sx, gy * 100 * sy, Math.max(1, 100 * sx + 0.5), Math.max(1, 100 * sy + 0.5));
          }
        }
      }

      // Friendly Units
      for (const u of world.units) {
        if (u.koTimer > 0) continue;
        ctx.fillStyle = u.selected ? '#facc15' : UNIT_SPECS[u.kind].isAir ? '#7dd3fc' : '#38bdf8';
        const size = UNIT_SPECS[u.kind].isVehicle ? 3.5 : 2.6;
        ctx.fillRect(u.x * sx - size * 0.5, u.y * sy - size * 0.5, size, size);
      }

      // Short-lived tactical pings and rally marker.
      for (let i = 0; i < world.minimapPings.length; i++) {
        const ping = world.minimapPings[i];
        ctx.globalAlpha = Math.min(1, ping.life);
        ctx.strokeStyle = ping.kind === 'rally' ? '#38bdf8' : '#fb7185';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(ping.x * sx, ping.y * sy, 4 + (4 - ping.life) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (world.rallyPoint) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(world.rallyPoint.x * sx - 2, world.rallyPoint.y * sy - 2, 4, 4);
      }

      // Camera Viewport Frame
      if (typeof window !== 'undefined') {
        const viewW = window.innerWidth / world.camera.zoom;
        const viewH = window.innerHeight / world.camera.zoom;
        const vx = (world.camera.x - viewW * 0.5) * sx;
        const vy = (world.camera.y - viewH * 0.5) * sy;
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.9)';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(vx, vy, viewW * sx, viewH * sy);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [worldRef]);

  return (
    <div
      data-testid={embedded ? 'tactical-minimap-embedded' : 'tactical-minimap'}
      className={embedded ? 'pointer-events-auto rounded border border-slate-700/85 overflow-hidden shrink-0' : 'pointer-events-auto rounded-md border border-slate-700/85 shadow-2xl overflow-hidden shrink-0'}
      style={{ backgroundColor: 'rgba(8, 17, 29, 0.92)' }}
    >
      {!embedded && (
      <div className="flex items-center justify-between px-2 py-1 border-b border-slate-700/70 text-[10px] font-mono-tabular text-sky-300">
        <span className="font-semibold tracking-wider">TACTICAL RADAR</span>
        <button
          type="button"
          tabIndex={-1}
          onClick={onClose}
          aria-label="Hide Mini-Map"
          className="text-slate-400 hover:text-white px-1 cursor-pointer leading-none"
        >
          ×
        </button>
      </div>
      )}
      <canvas
        ref={canvasRef}
        width={200}
        height={120}
        onPointerDown={(e) => {
          e.stopPropagation();
          draggingRef.current = true;
          longPressFiredRef.current = false;
          if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
          longPressRef.current = window.setTimeout(() => {
            const canvas = canvasRef.current; const world = worldRef.current;
            if (!canvas || !world) return;
            const rect = canvas.getBoundingClientRect();
            const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
            setRallyPoint(world, nx * world.width, ny * world.height);
            longPressFiredRef.current = true;
          }, 520);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          if (longPressRef.current !== null && !longPressFiredRef.current) { window.clearTimeout(longPressRef.current); longPressRef.current = null; }
          if (!longPressFiredRef.current) panFromPointer(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
          longPressRef.current = null;
          if (!longPressFiredRef.current) {
            const canvas = canvasRef.current; const world = worldRef.current;
            if (canvas && world && e.detail >= 2) {
              const rect = canvas.getBoundingClientRect();
              const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
              addMinimapPing(world, nx * world.width, ny * world.height, 'danger');
            }
          }
          draggingRef.current = false;
        }}
        onPointerLeave={() => {
          if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
          longPressRef.current = null; draggingRef.current = false;
        }}
        className={embedded ? 'block w-[132px] h-[79px] cursor-crosshair touch-none' : 'block w-[150px] h-[90px] sm:w-[200px] sm:h-[120px] cursor-crosshair touch-none'}
      />
    </div>
  );
};
