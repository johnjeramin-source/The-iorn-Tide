import React from 'react';
import { MAPS, SCENARIOS, WEATHER_LABELS } from '../game/data';
import { MapId, ScenarioId } from '../game/types';
import { ProfileChip } from './ProfilePanel';
import { CAMPAIGN_MISSIONS } from '../game/campaign';

interface TitleScreenProps {
  selectedMap: MapId;
  selectedScenario: ScenarioId;
  onSelectMap: (id: MapId) => void;
  onSelectScenario: (id: ScenarioId) => void;
  onStart: () => void;
  onOpenSettings?: () => void;
  selectedMissionId: number | null;
  unlockedMissionId: number;
  onSelectMission: (id: number | null) => void;
  endlessMode: boolean;
  onToggleEndless: () => void;
}

const MAP_ORDER: MapId[] = [
  'port_la',
  'downtown_flood',
  'refinery',
  'airfield',
  'highway_overpass',
  'desert_fort',
  'frozen_harbor',
  'island_base',
  'storm_bay',
  'mountain_relay',
];
const SCENARIO_ORDER: ScenarioId[] = ['harbor_break', 'red_tide', 'iron_ark'];

export const TitleScreen: React.FC<TitleScreenProps> = ({
  selectedMap,
  selectedScenario,
  onSelectMap,
  onSelectScenario,
  onStart,
  onOpenSettings,
  selectedMissionId,
  unlockedMissionId,
  onSelectMission,
  endlessMode,
  onToggleEndless,
}) => {
  const activeMap = MAPS[selectedMap];
  const activeScenario = SCENARIOS[selectedScenario];

  return (
    <div
      className="title-screen fixed inset-0 z-20 flex flex-col justify-between pointer-events-none overflow-y-auto"
      style={{
        background:
          'linear-gradient(90deg, rgba(6, 17, 27, 0.94) 0%, rgba(6, 17, 27, 0.78) 40%, rgba(6, 17, 27, 0.16) 68%, rgba(6, 17, 27, 0.04) 100%)',
      }}
    >
      <ProfileChip />

      {/* Left-third negative-space editorial lockup */}
      <div className="flex-1 flex items-center px-5 sm:px-12 lg:px-16 py-6">
        <div className="w-full max-w-lg pointer-events-auto">
          {/* Official illustrated IRON TIDE game logo */}
          <div className="mb-4 sm:mb-5">
            <img
              src="/iron-tide-logo.png"
              alt="IRON TIDE: Coastal Vanguard"
              className="w-full max-w-[260px] sm:max-w-[320px] h-auto drop-shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
              draggable={false}
            />
          </div>

          <p className="text-slate-300 text-sm leading-relaxed mb-5 max-w-md">
            Lead battleship broadsides and amphibious landings across ten coastal warzones. Build
            rotatable walls, blast gates, and Hydra pods—and pilot any soldier, Bradley, or Blackhawk.
          </p>

          {/* Ten-map selector */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400 mb-1.5">
              <span>Coastal Warzone (10 Maps)</span>
              <span className="font-mono-tabular text-sky-300">
                {WEATHER_LABELS[activeMap.defaultWeather]}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#0b1927]/90 border border-slate-700/70">
              {MAP_ORDER.map((id, idx) => {
                const map = MAPS[id];
                const isSelected = id === selectedMap;
                return (
                  <button
                    key={id}
                    type="button"
                    data-map={id}
                    onClick={() => onSelectMap(id)}
                    className={`px-3 py-2 text-xs font-semibold rounded-md transition-colors text-left whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                      idx >= MAP_ORDER.length - 2 ? 'col-span-1' : ''
                    } ${
                      isSelected
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                  >
                    {map.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              {activeMap.subtitle}
            </p>
          </div>

          {/* Scenario / Theater Selector */}
          <div className="mb-5">
            <div className="text-xs font-medium text-slate-400 mb-1.5">
              Operation Force
            </div>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-[#0b1927]/90 border border-slate-700/70">
              {SCENARIO_ORDER.map((id) => {
                const sc = SCENARIOS[id];
                const isSelected = id === selectedScenario;
                return (
                  <button
                    key={id}
                    type="button"
                    data-scenario={id}
                    onClick={() => onSelectScenario(id)}
                    className={`px-2.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                      isSelected
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                  >
                    {sc.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              {activeScenario.subtitle} · COINS {activeScenario.startingReq}
            </p>
          </div>

          {/* Interactive 20-mission campaign selector */}
          <div className="mb-4 rounded-lg border border-slate-700/70 bg-[#0b1927]/90 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-300">Campaign Operations · 20 Missions</span>
              <span className="text-[10px] text-slate-400">Unlocked through victories</span>
            </div>
            <select
              aria-label="Select campaign mission"
              value={selectedMissionId ?? ''}
              onChange={(event) => onSelectMission(event.target.value ? Number(event.target.value) : null)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Free Operations · Standard Operation</option>
              {CAMPAIGN_MISSIONS.map((mission) => (
                <option key={mission.id} value={mission.id} disabled={mission.id > unlockedMissionId}>
                  {mission.id.toString().padStart(2, '0')} · {mission.name}{mission.id > unlockedMissionId ? ' · LOCKED' : ''}
                </option>
              ))}
            </select>
            {selectedMissionId ? (() => {
              const mission = CAMPAIGN_MISSIONS.find((item) => item.id === selectedMissionId);
              return mission ? <p className="mt-2 text-xs leading-relaxed text-slate-300">{mission.briefing} <span className="text-amber-300">Objective: {mission.killTarget} kills + secure {mission.sectorTarget} sectors · Reward {mission.reward} COINS</span></p> : null;
            })() : <p className="mt-2 text-xs text-slate-400">Choose a mission for a focused objective, or keep Free Operations for the original survival mode.</p>}
          </div>

          <div className="mb-4 rounded-lg border border-emerald-700/60 bg-emerald-950/30 p-3">
            <label className="flex items-center justify-between gap-3 text-sm font-semibold text-emerald-200">
              <span>ENDLESS SURVIVAL <small className="block text-[11px] font-normal text-slate-400">Waves continue after all sectors are secured. Run ends only when your force and FOB are lost.</small></span>
              <input type="checkbox" checked={endlessMode} onChange={onToggleEndless} className="h-5 w-5 accent-emerald-400"/>
            </label>
          </div>

          {/* Primary Start & PWA Install Row */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-start="true"
              onClick={onStart}
              className="px-7 py-3 text-base font-bold tracking-wide text-slate-950 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
            >
              Deploy Task Force
            </button>

          </div>
        </div>
      </div>

      {/* Single flat borderless inline control hint row */}
      <div className="px-5 sm:px-12 lg:px-16 pb-4">
        <p className="text-xs text-slate-400/90 font-medium tracking-wide">
          Drag-Box Select · Right-Click Order · Scroll/Pinch Zoom · R Rotate Wall/Gate · K Mini-Map · L Anti-Lag · T Weather · F Pilot Unit · Esc Pause
        </p>
      </div>
    </div>
  );
};
