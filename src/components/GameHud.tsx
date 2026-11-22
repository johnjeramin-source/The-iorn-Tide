import React, { useEffect, useRef, useState } from 'react';
import {
  MAPS,
  STRIKE_SPECS,
  STRUCTURE_SPECS,
  UNIT_SPECS,
  WEATHER_LABELS,
} from '../game/data';
import {
  BuildPlacementMode,
  GameWorld,
  HudSnapshot,
  PlayerUnitKind,
  StrikeKind,
  WeatherKind,
} from '../game/types';
import { TacticalMiniMap } from './TacticalMiniMap';
import { UnitActionButton, DefenseActionButton, StrikeActionButton } from './HudActionButtons';
import { PlayerAvatar } from './ProfilePanel';
import { loadProfile, rankFor, PlayerProfile } from '../game/profile';
import { saveControlGroup, selectControlGroup } from '../game/engine';

export type TouchMode = 'pan' | 'select' | 'order';

interface GameHudProps {
  hud: HudSnapshot;
  worldRef: React.RefObject<GameWorld>;
  showMiniMap: boolean;
  muted: boolean;
  touchMode: TouchMode;
  onSetTouchMode: (mode: TouchMode) => void;
  onToggleMiniMap: () => void;
  onPanToWorld: (wx: number, wy: number) => void;
  onDeployUnit: (kind: PlayerUnitKind) => void;
  onSelectPlacement: (mode: BuildPlacementMode | null) => void;
  onRotatePlacement: () => void;
  onCycleWeather: () => void;
  onToggleLowLag: () => void;
  onToggleDirectControl: () => void;
  onReload: () => void;
  onRepairVehicles: () => void;
  onToggleBunkerDoor: () => void;
  onToggleOpsZoom: () => void;
  onToggleMute: () => void;
  onPause: () => void;
  onRestart: () => void;
  onFocusSector: (sectorId: string) => void;
  onVirtualMove: (vx: number, vy: number) => void;
  onVirtualFire: (firing: boolean) => void;
  onCycleFormation: () => void;
  onToggleFog: () => void;
  onToggleAutoBattleAssist: () => void;
}

const UNIT_BUTTONS: PlayerUnitKind[] = [
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
];
const DEFENSE_BUTTONS = ['wall', 'gate', 'wire', 'oil', 'charge', 'laser', 'electric', 'turret', 'autocannon', 'rocket_turret'] as const;
const STRIKE_BUTTONS: StrikeKind[] = ['barrage', 'airstrike', 'supplydrop', 'reinforce'];

const WEATHER_SHORT: Record<WeatherKind, string> = {
  clear: 'Clear',
  rain: 'Rain',
  storm: 'Storm',
  fog: 'Fog',
};

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  worldRef,
  showMiniMap,
  muted,
  touchMode,
  onSetTouchMode,
  onToggleMiniMap,
  onPanToWorld,
  onDeployUnit,
  onSelectPlacement,
  onRotatePlacement,
  onCycleWeather,
  onToggleLowLag,
  onToggleDirectControl,
  onReload,
  onRepairVehicles,
  onToggleBunkerDoor,
  onToggleOpsZoom,
  onToggleMute,
  onPause,
  onRestart,
  onFocusSector,
  onVirtualMove,
  onVirtualFire,
  onCycleFormation,
  onToggleFog,
  onToggleAutoBattleAssist,
}) => {
  const [hudDetail, setHudDetail] = useState(false);
  const [mobileTabState, setMobileTab] = useState<'units' | 'build' | 'strikes' | 'orders'>('units');
  // The tactical map lives in its own dock tab, so it never floats over the controls.
  const mobileTab: 'units' | 'build' | 'strikes' | 'orders' | 'map' = showMiniMap ? 'map' : mobileTabState;
  const [tutorialVisible, setTutorialVisible] = useState(() => { try { return localStorage.getItem('irontide_tutorial_seen_v1') !== '1'; } catch { return false; } });
  const dismissTutorial = () => { setTutorialVisible(false); try { localStorage.setItem('irontide_tutorial_seen_v1', '1'); } catch { /* storage unavailable */ } };
  const groupLongPressRef = useRef<number | null>(null);
  useEffect(() => {
    if (!tutorialVisible) return;
    const t = window.setTimeout(dismissTutorial, 9000); // never leave the guide blocking the screen
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorialVisible]);
  const groupLongPressFiredRef = useRef(false);
  useEffect(() => () => {
    if (groupLongPressRef.current !== null) window.clearTimeout(groupLongPressRef.current);
  }, []);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile>(() => loadProfile());
  useEffect(() => {
    const refreshProfile = () => setPlayerProfile(loadProfile());
    window.addEventListener('storage', refreshProfile);
    window.addEventListener('irontide-profile-updated', refreshProfile);
    return () => {
      window.removeEventListener('storage', refreshProfile);
      window.removeEventListener('irontide-profile-updated', refreshProfile);
    };
  }, []);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const angleDeg = Math.round(((hud.placementAngle * 180) / Math.PI) % 360);
  const mapName = MAPS[hud.mapId]?.name ?? 'Coastal Sector';
  const isRotateMode =
    ['wall', 'gate', 'wire', 'oil', 'laser', 'electric'].includes(hud.placementMode?.kind as string);

  return (
    <div className="game-hud-root fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-2 sm:p-4">
      {/* Top Row: Compact Perimeter Clusters */}
      <div className="hud-top-row flex items-start justify-between gap-2">
        {/* Top-Left Tactical Telemetry */}
        <div
          className="hud-telemetry relative pointer-events-auto rounded-md border border-slate-700/80 px-2.5 sm:px-3.5 py-1.5 sm:py-2.5 shadow-lg max-w-[60vw] sm:max-w-[660px]"
          style={{ backgroundColor: 'rgba(8, 17, 29, 0.58)' }}
        >
          
          <div className="flex flex-wrap items-baseline gap-x-3 sm:gap-x-5 gap-y-0.5">
            <div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                COINS
              </div>
              <div
                className="text-base sm:text-2xl font-bold text-amber-400 font-mono-tabular leading-none"
                data-testid="hud-req"
              >
                {hud.req.toLocaleString()} <span className="text-[9px] text-amber-200/70">/ 2,500</span>
              </div>
              <div className="text-[8px] uppercase tracking-wider text-slate-500 font-semibold">FORCE {hud.unitsAlive}</div>
            </div>

            <div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                EVAC
              </div>
              <div
                className="text-sm sm:text-xl font-bold text-sky-300 font-mono-tabular leading-none"
                data-testid="hud-evac"
              >
                {hud.civiliansEvacuated}/{hud.civiliansTotal}
              </div>
            </div>

            <div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                BUNKER
              </div>
              <div
                className="text-sm sm:text-xl font-bold text-emerald-300 font-mono-tabular leading-none"
                data-testid="hud-bunker"
                title={`${hud.civiliansWaiting} civilians waiting for rescue`}
              >
                {hud.bunkerSaved}/{hud.bunkerCap}
              </div>
            </div>

            <div className="hidden sm:block">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                INFECTED
              </div>
              <div className="text-xl font-bold text-slate-100 font-mono-tabular leading-none">
                {hud.kills}
              </div>
            </div>

            <div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                WAVE {hud.waveNumber}
              </div>
              <div className="text-[11px] sm:text-sm font-semibold text-rose-400 font-mono-tabular leading-tight">
                {hud.nextWaveIn}s · {hud.threatLevel}
              </div>
            </div>

            <div className="hud-sector-stat">
              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">SECTOR</div>
              <div className="text-sm font-bold text-emerald-300 font-mono-tabular leading-none">
                {hud.sectorsTotal > 0 ? Math.round((hud.sectorsCaptured / hud.sectorsTotal) * 100) : 0}%
              </div>
            </div>
            <div className="desktop-hud-only">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                {mapName}
              </div>
              <div className="text-sm font-semibold text-slate-200 font-mono-tabular leading-tight">
                {formatTime(hud.elapsedSec)}
              </div>
            </div>
          </div>

          {/* Clickable Sector Jump Strip (hidden on narrow portrait top bar to keep sticky HUD < 15%) */}
          {hudDetail && <div className="hidden sm:flex mt-2 pt-2 border-t border-slate-700/60 flex-wrap items-center gap-2">
            {hud.sectorStatuses.map((sec) => {
              const statusLabel =
                sec.owner === 'player'
                  ? `EVAC ${sec.civiliansEvacuated}/${sec.civiliansTotal}`
                  : `${sec.captureProgress}%`;
              const accent =
                sec.owner === 'player'
                  ? 'text-sky-300 border-sky-500/50 bg-sky-950/50'
                  : sec.owner === 'neutral'
                    ? 'text-amber-300 border-amber-500/50 bg-amber-950/40'
                    : 'text-rose-300 border-rose-500/40 bg-rose-950/30';
              return (
                <button
                  key={sec.id}
                  type="button"
                  
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onFocusSector(sec.id);
                  }}
                  className={`px-2 py-1 text-[11px] font-mono-tabular font-semibold rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer hover:brightness-125 ${accent}`}
                  title={`Pan camera to ${sec.name}`}
                >
                  {sec.code} {statusLabel}
                </button>
              );
            })}
          </div>}
          {hud.campaignMissionTitle && !hudDetail && (
            <div className="mt-1 truncate text-[9px] font-semibold text-amber-200">{hud.campaignMissionTitle.toUpperCase()} · {hud.campaignProgress}% · {hud.campaignObjective}</div>
          )}
          {hud.campaignMissionTitle && hudDetail && (
            <div className="mt-2 rounded border border-amber-500/40 bg-amber-950/30 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-amber-200">
                <span>OPERATION {hud.campaignMissionTitle.toUpperCase()}</span>
                <span className="font-mono-tabular">{hud.campaignProgress}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded bg-slate-800"><div className="h-full bg-amber-400" style={{ width: `${hud.campaignProgress}%` }} /></div>
              <div className="mt-1 text-[9px] text-slate-300">Objective: {hud.campaignObjective} · Kills {hud.kills}</div>
            </div>
          )}
          <button type="button"  onClick={(e) => { e.currentTarget.blur(); setHudDetail((v) => !v); }} aria-expanded={hudDetail} title={hudDetail ? 'Hide details' : 'Show details'} className="hud-detail-toggle absolute right-1 top-1 z-10 h-5 w-5 rounded border border-slate-600/70 text-[10px] leading-none text-slate-300">{hudDetail ? '▴' : '▾'}</button>
        </div>

        <div className="hud-player-identity pointer-events-auto" aria-label={`Player ${playerProfile.callsign}, ${rankFor(playerProfile.totalKills)}`}>
          <PlayerAvatar avatar={playerProfile.avatar} color={playerProfile.color} size={30}/>
          <span className="min-w-0 leading-tight">
            <span className="block max-w-[100px] truncate text-[10px] font-black text-slate-100">{playerProfile.callsign}</span>
            <span className="block text-[9px] font-bold text-amber-300">{rankFor(playerProfile.totalKills)} ★</span>
          </span>
        </div>

        {/* Top-Right Utility Controls, Weather, Mini-Map Toggle & Ops View */}
        <div className="hud-utility-rail pointer-events-auto flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            type="button"
            
            data-testid="minimap-toggle"
            aria-pressed={showMiniMap}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMiniMap();
            }}
            title="Toggle Tactical Mini-Map [K]"
            className={`hud-utility-btn px-2 sm:px-2.5 h-8 sm:h-9 text-[11px] sm:text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1 ${
              showMiniMap
                ? 'bg-sky-500 text-slate-950 border-sky-400'
                : 'text-sky-200 border-slate-700/80 hover:border-sky-400'
            }`}
            style={showMiniMap ? undefined : { backgroundColor: 'rgba(8, 17, 29, 0.58)' }}
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2">
              <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6" />
              <line x1="9" y1="3" x2="9" y2="18" />
              <line x1="15" y1="6" x2="15" y2="21" />
            </svg>
            <span className="hud-utility-label">Map</span>
          </button>

          <button
            type="button"
            
            onClick={(e) => { e.currentTarget.blur(); onToggleFog(); }}
            aria-pressed={hud.fogEnabled}
            title="Toggle Fog of War"
            className={`hud-utility-btn px-2 h-8 sm:h-9 text-[10px] sm:text-xs font-semibold rounded-md border whitespace-nowrap cursor-pointer ${hud.fogEnabled ? 'bg-slate-700 text-sky-200 border-sky-500/70' : 'bg-amber-400 text-slate-950 border-amber-300'}`}
          ><span className="hud-wide-label">Fog {hud.fogEnabled ? 'ON' : 'OFF'}</span><span className="hud-icon-label">◉</span></button>
          <button
            type="button"
            
            onClick={(e) => { e.currentTarget.blur(); onCycleFormation(); }}
            title="Cycle formation: Grid, Line, Column, Circle"
            className="hud-utility-btn px-2 h-8 sm:h-9 text-[10px] sm:text-xs font-semibold rounded-md border border-slate-700/80 text-amber-200 whitespace-nowrap cursor-pointer"
            style={{ backgroundColor: 'rgba(8, 17, 29, 0.58)' }}
          ><span className="hud-wide-label">{hud.formation.toUpperCase()}</span><span className="hud-icon-label">≋</span></button>

          <button
            type="button"
            
            data-testid="weather-toggle"
            onClick={(e) => {
              e.currentTarget.blur();
              onCycleWeather();
            }}
            title={`Cycle Dynamic Weather [T]: ${WEATHER_LABELS[hud.weatherKind]}`}
            className="hud-utility-btn px-2 sm:px-2.5 h-8 sm:h-9 text-[11px] sm:text-xs font-semibold rounded-md border border-slate-700/80 text-sky-200 hover:border-sky-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            style={{ backgroundColor: 'rgba(8, 17, 29, 0.58)' }}
          >
            <span className="hud-wide-label">{WEATHER_SHORT[hud.weatherKind]}</span><span className="hud-icon-label">☂</span>
          </button>

          <button
            type="button"
            
            data-testid="antilag-toggle"
            aria-pressed={hud.lowLagMode}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleLowLag();
            }}
            title="Anti-Lag Optimization & Zero Shake [L]"
            className={`hud-utility-btn px-2 sm:px-2.5 h-8 sm:h-9 text-[11px] sm:text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              hud.lowLagMode
                ? 'bg-emerald-400 text-slate-950 border-emerald-300'
                : 'text-slate-200 border-slate-700/80 hover:border-emerald-400'
            }`}
            style={hud.lowLagMode ? undefined : { backgroundColor: 'rgba(8, 17, 29, 0.58)' }}
          >
            <span className="hud-wide-label">{hud.lowLagMode ? 'Smooth ON' : 'Smooth'}</span>
            <span className="hud-icon-label">⚡</span>
          </button>

          <button
            type="button"
            
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleOpsZoom();
            }}
            className={`hud-utility-btn px-2 sm:px-3 h-8 sm:h-9 text-[11px] sm:text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              hud.isOpsView
                ? 'bg-sky-500 text-slate-950 border-sky-400'
                : 'text-slate-100 border-slate-700/80 hover:border-sky-400'
            }`}
            style={
              hud.isOpsView ? undefined : { backgroundColor: 'rgba(8, 17, 29, 0.58)' }
            }
            aria-label="Toggle Operations Map View"
          >
            <span className="hud-wide-label">{hud.isOpsView ? 'Street' : 'Ops'}</span><span className="hud-icon-label">⌖</span>
          </button>

          <button
            type="button"
            
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'Unmute Audio' : 'Mute Audio'}
            title="Mute [M]"
            className="hud-utility-btn hud-sound-btn hidden sm:flex w-9 h-9 items-center justify-center rounded-md border border-slate-700/80 text-slate-200 hover:text-white hover:border-slate-500 cursor-pointer"
            style={{ backgroundColor: 'rgba(8, 17, 29, 0.58)' }}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" opacity="0.2" />
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              {muted ? (
                <>
                  <line x1="22" y1="9" x2="16" y2="15" />
                  <line x1="16" y1="9" x2="22" y2="15" />
                </>
              ) : (
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              )}
            </svg>
          </button>

          <button
            type="button"
            
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            aria-label="Pause Game"
            title="Pause [P / Esc]"
            className="hud-utility-btn w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-md border border-slate-700/80 text-slate-200 hover:text-white hover:border-slate-500 cursor-pointer"
            style={{ backgroundColor: 'rgba(8, 17, 29, 0.58)' }}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          </button>

          <button
            type="button"
            
            onClick={(e) => {
              e.currentTarget.blur();
              onRestart();
            }}
            aria-label="Restart Operation"
            title="Restart [Shift+R]"
            className="hud-utility-btn hud-restart-btn hidden sm:flex w-9 h-9 items-center justify-center rounded-md border border-slate-700/80 text-slate-200 hover:text-white hover:border-slate-500 cursor-pointer"
            style={{ backgroundColor: 'rgba(8, 17, 29, 0.58)' }}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <polyline points="3 3 3 8 8 8" />
            </svg>
          </button>
        </div>
      </div>

      {hud.nextWaveIn <= 8 && hud.nextWaveIn > 0 && (
        <div className="pointer-events-none self-center mt-2 rounded-md border border-rose-500/60 bg-slate-950/90 px-3 py-1.5 text-center shadow-lg">
          <div className="text-[10px] font-black tracking-widest text-rose-300">INCOMING WAVE · {hud.nextWaveIn}s</div>
          <div className="text-[9px] text-slate-200">Shamblers · Sprinters · Specials · Spawn from map perimeter</div>
        </div>
      )}
      {tutorialVisible && hud.phase === 'playing' && (
        <div className="hud-tutorial pointer-events-auto absolute left-1/2 top-12 z-40 w-[min(300px,62vw)] -translate-x-1/2 rounded-lg border border-sky-400/60 bg-slate-950/90 p-2.5 shadow-2xl">
          <div className="text-xs font-black tracking-widest text-sky-300">FIELD GUIDE · FIRST DEPLOYMENT</div>
          <p className="mt-2 text-xs leading-relaxed text-slate-200">Use the command dock to deploy units and build defenses. Pan to move the camera, Select to choose units, and Order to issue commands. Deploy a squad, then place walls near your FOB to slow the infected.</p>
          <button type="button" onClick={dismissTutorial} className="mt-3 w-full rounded bg-sky-500 px-3 py-2 text-xs font-black text-slate-950">UNDERSTOOD</button>
        </div>
      )}

      {/* Transient Radio Alert Banner */}
      {hud.alertMessage && (
        <div className="self-center mt-1.5">
          <div
            className="px-3.5 py-1 rounded border border-amber-400/50 text-amber-300 text-[11px] sm:text-xs font-mono-tabular font-semibold tracking-wider uppercase shadow"
            style={{ backgroundColor: 'rgba(8, 17, 29, 0.58)' }}
          >
            {hud.alertMessage}
          </div>
        </div>
      )}

      <div className="self-center pointer-events-auto">
        <button type="button" onClick={onToggleBunkerDoor} className={`px-3 py-1 rounded border text-[10px] font-black tracking-wider ${hud.bunkerDoorLocked ? 'border-rose-500/70 bg-rose-950/80 text-rose-200' : hud.bunkerDoorOpen ? 'border-sky-400/70 bg-sky-950/80 text-sky-200' : 'border-amber-400/70 bg-amber-950/80 text-amber-200'}`}>
          BUNKER DOOR · {hud.bunkerDoorLocked ? 'LOCKED' : hud.bunkerDoorOpen ? 'OPEN' : 'UNLOCKED'}
        </button>
      </div>

      {/* Spacer keeping central battlefield open */}
      <div className="flex-1" />

      {/* Direct Control Status Bar + Mobile Virtual D-Pad & Fire */}
      {hud.directControlUnitKind && (
        <div className="mb-1.5 flex flex-col items-center gap-2">
          <div className="touch-hud-only w-full flex items-end justify-between px-1 pointer-events-none">
            <div className="pointer-events-auto grid grid-cols-3 gap-1 p-1.5 rounded-lg border border-slate-700/80 bg-[#08111d]/90">
              <div />
              <button
                type="button"
                aria-label="Move Up"
                onPointerDown={() => onVirtualMove(0, -1)}
                onPointerUp={() => onVirtualMove(0, 0)}
                onPointerCancel={() => onVirtualMove(0, 0)}
                onPointerLeave={() => onVirtualMove(0, 0)}
                className="w-10 h-10 rounded bg-slate-800 active:bg-sky-500 active:text-slate-950 text-slate-200 font-bold text-sm"
              >
                ▲
              </button>
              <div />
              <button
                type="button"
                aria-label="Move Left"
                onPointerDown={() => onVirtualMove(-1, 0)}
                onPointerUp={() => onVirtualMove(0, 0)}
                onPointerCancel={() => onVirtualMove(0, 0)}
                onPointerLeave={() => onVirtualMove(0, 0)}
                className="w-10 h-10 rounded bg-slate-800 active:bg-sky-500 active:text-slate-950 text-slate-200 font-bold text-sm"
              >
                ◀
              </button>
              <button
                type="button"
                aria-label="Move Down"
                onPointerDown={() => onVirtualMove(0, 1)}
                onPointerUp={() => onVirtualMove(0, 0)}
                onPointerCancel={() => onVirtualMove(0, 0)}
                onPointerLeave={() => onVirtualMove(0, 0)}
                className="w-10 h-10 rounded bg-slate-800 active:bg-sky-500 active:text-slate-950 text-slate-200 font-bold text-sm"
              >
                ▼
              </button>
              <button
                type="button"
                aria-label="Move Right"
                onPointerDown={() => onVirtualMove(1, 0)}
                onPointerUp={() => onVirtualMove(0, 0)}
                onPointerCancel={() => onVirtualMove(0, 0)}
                onPointerLeave={() => onVirtualMove(0, 0)}
                className="w-10 h-10 rounded bg-slate-800 active:bg-sky-500 active:text-slate-950 text-slate-200 font-bold text-sm"
              >
                ▶
              </button>
            </div>

            <button
              type="button"
              onPointerDown={() => onVirtualFire(true)}
              onPointerUp={() => onVirtualFire(false)}
              onPointerCancel={() => onVirtualFire(false)}
              onPointerLeave={() => onVirtualFire(false)}
              className="pointer-events-auto w-16 h-16 rounded-full bg-amber-400 active:bg-amber-300 text-slate-950 font-bold text-xs shadow-lg border-2 border-amber-200"
            >
              FIRE
            </button>
          </div>

          <div
            className="pointer-events-auto px-3 py-1.5 rounded-md border border-amber-400/70 flex items-center gap-3 text-xs"
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.92)' }}
          >
            <span className="font-bold text-amber-300 whitespace-nowrap">
              {UNIT_SPECS[hud.directControlUnitKind].shortName.toUpperCase()}
            </span>
            <span className="font-mono-tabular text-emerald-300 whitespace-nowrap">
              HP {hud.directControlHp}/{hud.directControlMaxHp}
            </span>
            <span className="font-mono-tabular text-amber-200 whitespace-nowrap">
              AMMO {hud.directControlAmmo}/{hud.directControlMaxAmmo}
            </span>
            <button type="button" onClick={onReload} disabled={hud.directControlAmmo >= hud.directControlMaxAmmo || hud.directControlReloadTimer > 0} className="px-2 py-1 rounded bg-sky-500 text-slate-950 font-black text-[10px] disabled:opacity-40">
              {hud.directControlReloadTimer > 0 ? `RELOAD ${hud.directControlReloadTimer.toFixed(1)}s` : 'RELOAD [R]'}
            </button>
            <span className="desktop-hud-inline text-slate-300 whitespace-nowrap">
              WASD Move · Mouse Fire · F Exit
            </span>
            <button
              type="button"
              
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleDirectControl();
              }}
              className="px-2 py-0.5 bg-amber-400 text-slate-950 font-bold rounded text-[11px] whitespace-nowrap cursor-pointer"
            >
              Exit [F]
            </button>
          </div>
        </div>
      )}

      {hud.selectedCount > 0 && (() => {
        const selected = worldRef.current.units.filter((unit) => unit.selected && unit.koTimer <= 0);
        const hp = selected.reduce((sum, unit) => sum + unit.hp, 0);
        const maxHp = selected.reduce((sum, unit) => sum + unit.maxHp, 0);
        const hpPercent = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
        const selectedTypes = [...new Set(selected.map((unit) => UNIT_SPECS[unit.kind].shortName))].slice(0, 3);
        const stopSelected = () => selected.forEach((unit) => {
          unit.targetX = null;
          unit.targetY = null;
          unit.vx = 0;
          unit.vy = 0;
        });
        const holdSelected = () => selected.forEach((unit) => {
          unit.targetX = null;
          unit.targetY = null;
          unit.attackMove = false;
        });
        return (
          <div className="selection-command-panel pointer-events-auto fixed left-1/2 -translate-x-1/2 bottom-[104px] z-20 flex items-center gap-2 rounded-lg border border-sky-500/40 px-2 py-1.5 shadow-xl">
            <div className="selection-overview pr-2 border-r border-slate-600/70">
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase tracking-wider text-slate-400">Selected Force</span>
                <span className="text-xs font-black text-sky-200 font-mono-tabular">{selected.length}</span>
              </div>
              <div className="selection-unit-types">{selectedTypes.join(' · ') || 'UNIT GROUP'}</div>
              <div className="selection-health-track"><span style={{ width: `${hpPercent}%` }} /></div>
              <div className="text-[9px] text-emerald-300 font-mono-tabular">HP {Math.round(hp).toLocaleString()}/{Math.round(maxHp).toLocaleString()}</div>
            </div>
            <button type="button" className="selection-command-btn" onClick={() => onSetTouchMode('order')}>Move</button>
            <button type="button" className="selection-command-btn" onClick={stopSelected}>Stop</button>
            <button type="button" className="selection-command-btn" onClick={holdSelected}>Hold</button>
            <button type="button" className="selection-command-btn" onClick={onCycleFormation}>Group</button>
            <button type="button" className="selection-command-btn" onClick={() => { selected.forEach((unit) => { unit.attackMove = true; unit.targetX = worldRef.current.fobPos.x + 260; unit.targetY = worldRef.current.fobPos.y; }); }}>Patrol</button>
            {selected.some((unit) => UNIT_SPECS[unit.kind].isVehicle && unit.hp > 0 && unit.hp < unit.maxHp) && (
              <button type="button" className="selection-command-btn border border-emerald-500/60 text-emerald-200" onClick={onRepairVehicles} title="Repair damaged selected vehicles near the FOB or a supply truck">Repair</button>
            )}
          </div>
        );
      })()}

      {/* Desktop dock is replaced by the landscape/touch dock via capability media query. */}
      <div className="command-dock-desktop pointer-events-auto self-center w-full max-w-[1440px]">
        <div
          className="hud-desktop-dock rounded-xl border border-slate-700/80 px-2.5 py-2 shadow-xl flex flex-col gap-1.5"
          style={{ backgroundColor: 'rgba(8, 17, 29, 0.92)' }}
        >
          {/* Row 1: 11 Deployable Combined-Arms Units */}
          <div className="flex items-center gap-1 flex-wrap">
            {UNIT_BUTTONS.map((kind) => (
              <UnitActionButton key={kind} kind={kind} affordable={hud.req >= UNIT_SPECS[kind].cost} onDeploy={onDeployUnit} />
            ))}
          </div>

          {/* Row 2: Defenses, Rotate Wall/Gate, Naval Strikes & Pilot Control */}
          <div className="flex items-center justify-between gap-1.5 flex-wrap pt-1 border-t border-slate-800/80">
            <div className="flex items-center gap-1 flex-wrap">
              {DEFENSE_BUTTONS.map((kind) => (
                <DefenseActionButton key={kind} kind={kind} affordable={hud.req >= STRUCTURE_SPECS[kind].cost} active={hud.placementMode?.kind === kind} onSelect={onSelectPlacement} />
              ))}

              {isRotateMode && (
                <button
                  type="button"
                  
                  data-testid="rotate-wall-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onRotatePlacement();
                  }}
                  className="px-2.5 py-1 rounded border border-amber-400 bg-amber-400 text-slate-950 text-[11px] font-bold font-mono-tabular whitespace-nowrap shrink-0 cursor-pointer"
                  title="Rotate Concrete Barricade or Blast Gate [R]"
                >
                  Rotate [R] {angleDeg}°
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {STRIKE_BUTTONS.map((kind) => (
                <StrikeActionButton key={kind} kind={kind} affordable={hud.req >= STRIKE_SPECS[kind].cost} cooldown={hud.strikeCooldowns[kind]} active={hud.placementMode?.kind === kind} onSelect={onSelectPlacement} />
              ))}

              <button
                type="button"
                
                disabled={hud.unitsAlive === 0}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleDirectControl();
                }}
                className={`px-2.5 py-1 rounded border text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
                  hud.directControlUnitId !== null
                    ? 'bg-amber-400 text-slate-950 border-amber-300'
                    : 'bg-slate-800 text-amber-300 border-amber-500/50 hover:bg-amber-500/20'
                }`}
                title="Take direct WASD + Mouse control of selected unit [F]"
              >
                {hud.directControlUnitId !== null ? 'Exit Pilot [F]' : 'Pilot [F]'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Compact Command Dock (< md) — Fits comfortably under 15% sticky height */}
      <div className="command-dock-compact pointer-events-auto w-full min-w-0" aria-label="Command dock" role="group">
        <div
          className="hud-mobile-dock rounded-xl border border-slate-700/80 p-1.5 shadow-xl flex flex-col gap-1.5"
          style={{ backgroundColor: 'rgba(8, 17, 29, 0.92)' }}
        >
          {/* Row 1: Category tabs + Touch Pan/Select/Order Switcher + Rotate Wall/Gate */}
          <div className="flex items-center justify-between gap-1 overflow-x-auto" data-hud-scroll="true" style={{ touchAction: 'pan-x', overscrollBehaviorX: 'contain', WebkitOverflowScrolling: 'touch' }}>
            <div className="flex items-center gap-1 shrink-0">
              <span className="touch-mode-indicator">{touchMode.toUpperCase()}</span>
              {(['units', 'build', 'strikes', 'orders', 'map'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  
                  onClick={() => {
                    if (tab === 'map') { onToggleMiniMap(); return; }
                    if (showMiniMap) onToggleMiniMap();
                    setMobileTab(tab);
                  }}
                  className={`hud-category-tab px-2.5 py-1 text-[11px] font-semibold rounded capitalize whitespace-nowrap shrink-0 ${
                    mobileTab === tab
                      ? 'bg-sky-500 text-slate-950'
                      : 'bg-slate-800/80 text-slate-300'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>


          </div>

          {/* One horizontal action strip: category tabs never force extra rows. */}
          <div className="hud-action-strip flex items-center gap-1.5 overflow-x-auto overflow-y-hidden pb-0.5" style={{ touchAction: 'pan-x', overscrollBehaviorX: 'contain', WebkitOverflowScrolling: 'touch' }}>
            {mobileTab === 'map' && (
              <TacticalMiniMap worldRef={worldRef} onPanToWorld={onPanToWorld} onClose={onToggleMiniMap} embedded />
            )}
            {mobileTab === 'units' && UNIT_BUTTONS.map((kind) => (
              <UnitActionButton key={kind} kind={kind} compact affordable={hud.req >= UNIT_SPECS[kind].cost} onDeploy={onDeployUnit} />
            ))}
            {mobileTab === 'build' && (
              <>
                {DEFENSE_BUTTONS.map((kind) => (
                  <DefenseActionButton key={kind} kind={kind} compact affordable={hud.req >= STRUCTURE_SPECS[kind].cost} active={hud.placementMode?.kind === kind} onSelect={onSelectPlacement} />
                ))}
                {isRotateMode && <button type="button" onClick={onRotatePlacement} className="min-h-10 px-3 rounded bg-amber-400 text-slate-950 text-xs font-bold whitespace-nowrap">↻ Rotate {angleDeg}°</button>}
                <button type="button"  disabled={hud.unitsAlive === 0} onClick={onToggleDirectControl}
                  className={`min-h-10 px-2.5 py-2 rounded border text-[11px] font-bold whitespace-nowrap shrink-0 disabled:opacity-40 ${hud.directControlUnitId !== null ? 'bg-amber-400 text-slate-950 border-amber-300' : 'bg-slate-800 text-amber-300 border-amber-500/50'}`}>
                  {hud.directControlUnitId !== null ? 'Exit Pilot' : 'Pilot Unit'}
                </button>
              </>
            )}
            {mobileTab === 'strikes' && STRIKE_BUTTONS.map((kind) => (
              <StrikeActionButton key={kind} kind={kind} compact affordable={hud.req >= STRIKE_SPECS[kind].cost} cooldown={hud.strikeCooldowns[kind]} active={hud.placementMode?.kind === kind} onSelect={onSelectPlacement} />
            ))}
            {mobileTab === 'orders' && (
              <div className="flex items-center gap-2 shrink-0">
                {(['pan', 'select', 'order'] as const).map((mode) => (
                  <button key={mode} type="button" data-touch-mode={mode} onClick={() => onSetTouchMode(mode)}
                    className={`min-h-10 px-4 rounded border text-xs font-bold capitalize ${touchMode === mode ? 'bg-amber-400 text-slate-950 border-amber-300' : 'bg-slate-800 text-slate-200 border-slate-600'}`}>
                    {mode === 'pan' ? 'Pan' : mode === 'select' ? 'Select' : 'Order'}
                  </button>
                ))}
                {isRotateMode && <button type="button" onClick={onRotatePlacement} className="min-h-10 px-3 rounded bg-amber-400 text-slate-950 text-xs font-bold">Rotate {angleDeg}°</button>}
                <button type="button" onClick={onToggleDirectControl} className="min-h-10 px-3 rounded bg-slate-800 text-amber-200 text-xs font-bold">Pilot</button>
                <button type="button" onClick={onToggleFog} className="min-h-10 px-3 rounded bg-slate-800 text-sky-200 text-xs font-bold">Fog {hud.fogEnabled ? 'ON' : 'OFF'}</button>
                <button type="button" onClick={onToggleAutoBattleAssist} className={`min-h-10 px-3 rounded text-xs font-bold ${hud.autoBattleAssist ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-emerald-200'}`}>Assist {hud.autoBattleAssist ? 'ON' : 'OFF'}</button>
                {[1,2,3,4,5].map((group) => <button key={group} type="button" onContextMenu={(event) => { event.preventDefault(); saveControlGroup(worldRef.current, group); }} onPointerDown={() => { groupLongPressFiredRef.current = false; groupLongPressRef.current = window.setTimeout(() => { saveControlGroup(worldRef.current, group); groupLongPressFiredRef.current = true; }, 520); }} onPointerUp={() => { if (groupLongPressRef.current !== null) window.clearTimeout(groupLongPressRef.current); groupLongPressRef.current = null; }} onPointerCancel={() => { if (groupLongPressRef.current !== null) window.clearTimeout(groupLongPressRef.current); groupLongPressRef.current = null; }} onClick={() => { if (groupLongPressFiredRef.current) return; selectControlGroup(worldRef.current, group); }} className="min-h-10 min-w-9 rounded bg-slate-800 text-amber-200 text-xs font-bold" title={`Tap select · right-click save group ${group}`}>{group}</button>)}
                <button type="button" onClick={onCycleFormation} className="min-h-10 px-3 rounded bg-slate-800 text-amber-200 text-xs font-bold">{hud.formation.slice(0, 3).toUpperCase()}</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
