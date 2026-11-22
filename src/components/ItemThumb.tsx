import React, { memo, useEffect, useRef } from 'react';
import { drawItemPreview } from '../game/renderer';

// Small preview picture of a unit / aircraft / defense, drawn with the same art used in battle.
function ItemThumbView({ kind, size = 48 }: { kind: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    try {
      drawItemPreview(ctx, kind, size);
    } catch {
      /* preview is cosmetic only */
    }
  }, [kind, size]);
  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size }}
      className="shrink-0 rounded bg-slate-900/80 border border-slate-700/70"
    />
  );
}

export const ItemThumb = memo(ItemThumbView);
