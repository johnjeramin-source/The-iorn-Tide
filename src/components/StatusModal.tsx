import React from 'react';
import { HudSnapshot } from '../game/types';

interface StatusModalProps {
  hud: HudSnapshot;
  onResume: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
  onToggleLowLag?: () => void;
  onOpenSettings?: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  hud,
  onResume,
  onRestart,
  onReturnTitle,
  onToggleLowLag,
  onOpenSettings,
}) => {
  if (hud.phase !== 'paused' && hud.phase !== 'gameover') {
    return null;
  }

  const isVictory = hud.phase === 'gameover' && hud.outcome === 'victory';
  const isDefeat = hud.phase === 'gameover' && hud.outcome === 'defeat';
  const sectorRatio = hud.sectorsTotal > 0 ? hud.sectorsCaptured / hud.sectorsTotal : 0;
  const rescueRatio = hud.civiliansTotal > 0 ? hud.civiliansEvacuated / hud.civiliansTotal : sectorRatio;
  const unitTotal = hud.unitsAlive + hud.unitsLost;
  const unitRetention = unitTotal > 0 ? hud.unitsAlive / unitTotal : 1;
  const missionScore = Math.round((sectorRatio * 0.4 + rescueRatio * 0.35 + unitRetention * 0.25) * 100);
  const missionGrade = missionScore >= 92 ? 'S' : missionScore >= 82 ? 'A' : missionScore >= 68 ? 'B' : missionScore >= 52 ? 'C' : 'D';

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(4, 11, 18, 0.78)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-modal-title"
    >
      <div
        className="w-full max-w-md rounded-lg border border-slate-700 p-6 shadow-2xl"
        style={{ backgroundColor: '#0b1826' }}
      >
        <div className="mb-5">
          <div className="text-xs font-mono-tabular uppercase tracking-widest text-slate-400 mb-1">
            {hud.phase === 'paused'
              ? 'Iron Tide · Coastal Vanguard'
              : 'After Action Report · ' + (isVictory ? 'Operation Complete' : 'Operation Failed')}
          </div>
          <h2
            id="status-modal-title"
            className={`text-3xl font-display font-bold tracking-wide ${
              isVictory
                ? 'text-sky-300'
                : isDefeat
                  ? 'text-rose-400'
                  : 'text-slate-100'
            }`}
          >
            {hud.phase === 'paused'
              ? 'Operation Paused'
              : isVictory
                ? (hud.campaignMissionTitle ? hud.campaignMissionTitle : 'All Sectors Evacuated')
                : 'Task Force Lost'}
          </h2>
        </div>

        {hud.campaignMissionTitle && hud.phase === 'gameover' && (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-950/25 p-3">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-200">Campaign Objective Completed</div>
            <div className="mt-1 text-xs text-slate-300">{hud.campaignObjective} · Progress {hud.campaignProgress}%</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-800"><div className="h-full bg-amber-400" style={{ width: `${hud.campaignProgress}%` }} /></div>
            <div className="mt-2 text-[11px] text-emerald-300">Next mission unlocked after this victory.</div>
          </div>
        )}

        {hud.phase === 'gameover' && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-500/35 bg-amber-950/20 px-4 py-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">Mission performance</div>
              <div className="mt-1 text-xs text-slate-300">Based on sectors, evacuation and surviving units</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-black leading-none text-amber-300">{missionGrade}</span>
              <span className="text-xs font-mono-tabular text-slate-400">{missionScore}/100</span>
            </div>
          </div>
        )}

        {/* Compact after-action statistics, responsive for phone screens. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-6">
          <div className="p-3 rounded bg-slate-900/90 border border-slate-800">
            <div className="text-[11px] text-slate-400">Sectors secured</div>
            <div className="text-xl font-bold text-sky-300 font-mono-tabular">{hud.sectorsCaptured}/{hud.sectorsTotal}</div>
          </div>
          <div className="p-3 rounded bg-slate-900/90 border border-slate-800">
            <div className="text-[11px] text-slate-400">Civilians rescued</div>
            <div className="text-xl font-bold text-amber-300 font-mono-tabular">{hud.civiliansEvacuated}/{hud.civiliansTotal}</div>
          </div>
          <div className="p-3 rounded bg-slate-900/90 border border-slate-800">
            <div className="text-[11px] text-slate-400">Infected eliminated</div>
            <div className="text-xl font-bold text-rose-300 font-mono-tabular">{hud.kills.toLocaleString()}</div>
          </div>
          <div className="p-3 rounded bg-slate-900/90 border border-slate-800">
            <div className="text-[11px] text-slate-400">Units surviving</div>
            <div className="text-xl font-bold text-emerald-300 font-mono-tabular">{hud.unitsAlive.toLocaleString()}</div>
          </div>
          <div className="p-3 rounded bg-slate-900/90 border border-slate-800">
            <div className="text-[11px] text-slate-400">Units lost</div>
            <div className="text-xl font-bold text-orange-300 font-mono-tabular">{hud.unitsLost.toLocaleString()}</div>
          </div>
          <div className="p-3 rounded bg-slate-900/90 border border-slate-800">
            <div className="text-[11px] text-slate-400">Operation time</div>
            <div className="text-xl font-bold text-slate-100 font-mono-tabular">{formatTime(hud.elapsedSec)}</div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          {hud.phase === 'paused' ? (
            <button
              type="button"
              onClick={onResume}
              className="flex-1 px-4 py-2.5 text-sm font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              Resume
            </button>
          ) : (
            <button
              type="button"
              data-start="true"
              onClick={onRestart}
              className="flex-1 px-4 py-2.5 text-sm font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              {isVictory ? 'Play Again' : 'Try Again'}
            </button>
          )}

          {hud.phase === 'paused' && (
            <button
              type="button"
              onClick={onRestart}
              className="px-4 py-2.5 text-sm font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              Restart
            </button>
          )}

          <button
            type="button"
            onClick={onReturnTitle}
            className="px-4 py-2.5 text-sm font-semibold text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            Title
          </button>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-center gap-2.5">
          {hud.phase === 'gameover' && <button type="button" onClick={() => {
            const text = `Iron Tide: ${isVictory ? 'Victory' : 'Defeat'} · ${hud.kills} infected · ${formatTime(hud.elapsedSec)} · ${hud.sectorsCaptured}/${hud.sectorsTotal} sectors`;
            const canvas = document.querySelector('canvas[data-testid="game-canvas"]') as HTMLCanvasElement | null;
            if (!canvas) { if (navigator.clipboard) void navigator.clipboard.writeText(text); return; }
            canvas.toBlob((blob) => {
              if (!blob) { if (navigator.clipboard) void navigator.clipboard.writeText(text); return; }
              const file = new File([blob], 'iron-tide-run.png', { type: 'image/png' });
              if (navigator.share && navigator.canShare?.({ files: [file] })) { void navigator.share({ title: 'Iron Tide Run Summary', text, files: [file] }).catch(() => undefined); }
              else { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'iron-tide-run.png'; link.click(); URL.revokeObjectURL(url); }
            }, 'image/png');
          }} className="px-4 py-2.5 text-sm font-semibold text-sky-200 bg-slate-800 border border-slate-700 rounded-md">Share</button>}
          {hud.phase === 'paused' && onOpenSettings && <button type="button" onClick={onOpenSettings} className="px-3.5 py-2.5 text-xs font-semibold rounded-md border bg-slate-900 text-slate-200 border-slate-700">Settings ⚙</button>}
          {hud.phase === 'paused' && onToggleLowLag && (
            <button
              type="button"
              onClick={onToggleLowLag}
              className={`px-3.5 py-2.5 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                hud.lowLagMode
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/60'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-sky-400'
              }`}
            >
              Anti-Lag &amp; No Shake: {hud.lowLagMode ? 'ON' : 'OFF'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
