import React, { memo } from 'react';
import { STRIKE_SPECS, STRUCTURE_SPECS, UNIT_SPECS } from '../game/data';
import { BuildPlacementMode, PlayerUnitKind, StrikeKind } from '../game/types';
import { ItemThumb } from './ItemThumb';

interface UnitActionButtonProps {
  kind: PlayerUnitKind;
  affordable: boolean;
  compact?: boolean;
  onDeploy: (kind: PlayerUnitKind) => void;
}

export const UnitActionButton = memo(function UnitActionButton({
  kind, affordable, compact = false, onDeploy,
}: UnitActionButtonProps) {
  const spec = UNIT_SPECS[kind];
  return (
    <button
      type="button"
      data-deploy={kind}
      disabled={!affordable}
      onClick={() => onDeploy(kind)}
      title={`${spec.name} — ${spec.role}`}
      className={`hud-unit-btn ${compact ? 'hud-unit-btn-compact' : 'hud-unit-btn-wide'} ${affordable ? 'is-affordable' : 'is-locked'}`}
      aria-label={`Deploy ${spec.name}, costs ${spec.cost} coins${affordable ? '' : ', insufficient coins'}`}
    >
      <ItemThumb kind={kind} size={compact ? 30 : 34} />
      {compact ? (
        <>
          <span className="compact-unit-name text-[10px]">{spec.shortName}</span>
          <span className="font-mono-tabular text-amber-400">{spec.cost}</span>
        </>
      ) : (
        <span className="flex items-center justify-between gap-1.5 text-[11px] font-semibold">
          [{spec.hotkey}] {spec.shortName}
          <span className="font-mono-tabular text-amber-400">{spec.cost}</span>
        </span>
      )}
    </button>
  );
});

interface DefenseActionButtonProps {
  kind: keyof typeof STRUCTURE_SPECS;
  affordable: boolean;
  active: boolean;
  compact?: boolean;
  onSelect: (mode: BuildPlacementMode | null) => void;
}

export const DefenseActionButton = memo(function DefenseActionButton({
  kind, affordable, active, compact = false, onSelect,
}: DefenseActionButtonProps) {
  const spec = STRUCTURE_SPECS[kind];
  const label = kind === 'wall' ? 'Wall' : kind === 'gate' ? 'Gate'
    : kind === 'turret' ? 'Sentry' : kind === 'autocannon' ? '40mm'
    : kind === 'rocket_turret' ? 'Hydra Pod' : kind === 'wire' ? 'Wire'
    : kind === 'oil' ? 'Oil' : kind === 'charge' ? 'Charge' : kind === 'laser' ? 'Laser' : 'Shock';
  return (
    <button
      type="button"
      data-place={kind}
      disabled={!affordable && !active}
      onClick={() => onSelect(active ? null : { kind })}
      title={`${spec.name} — ${spec.role}`}
      className={`hud-build-btn ${compact ? 'hud-build-btn-compact' : 'hud-build-btn-wide'} ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      aria-label={`Build ${spec.name}, costs ${spec.cost} coins`}
    >
      <ItemThumb kind={kind} size={compact ? 30 : 34} />
      {compact ? <span>{label}</span> : <span className="text-[11px] font-semibold">[{spec.hotkey}] {label}</span>}
      <span className="font-mono-tabular text-amber-400">{spec.cost}</span>
    </button>
  );
});

interface StrikeActionButtonProps {
  kind: StrikeKind;
  affordable: boolean;
  cooldown: number;
  active: boolean;
  compact?: boolean;
  onSelect: (mode: BuildPlacementMode | null) => void;
}

export const StrikeActionButton = memo(function StrikeActionButton({
  kind, affordable, cooldown, active, compact = false, onSelect,
}: StrikeActionButtonProps) {
  const spec = STRIKE_SPECS[kind];
  const ready = cooldown <= 0 && affordable;
  const label = kind === 'barrage' ? '406mm Salvo' : kind === 'airstrike' ? 'A-10' : 'Air Drop';
  return (
    <button
      type="button"
      disabled={!ready && !active}
      onClick={() => onSelect(active ? null : { kind })}
      title={`${spec.name} — ${spec.role}`}
      className={`hud-strike-btn ${compact ? 'hud-strike-btn-compact' : ''} ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      aria-label={`${spec.name}, ${cooldown > 0 ? `ready in ${Math.ceil(cooldown)} seconds` : `costs ${spec.cost} coins`}`}
    >
      <span>{label}</span>
      <span className="font-mono-tabular text-amber-400">{cooldown > 0 ? `${cooldown.toFixed(0)}s` : spec.cost}</span>
    </button>
  );
});
