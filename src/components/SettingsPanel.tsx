import React from 'react';
import { GameSettings, saveSettings } from '../game/settings';

interface SettingsPanelProps {
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
  onClose: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onChange, onClose }) => {
  const update = <K extends keyof GameSettings,>(key: K, value: GameSettings[K]) => {
    const next = { ...settings, [key]: value };
    onChange(next);
    saveSettings(next);
  };
  const toggle = (key: 'batterySaver' | 'haptics' | 'leftHanded' | 'largeText' | 'colorblind' | 'damageNumbers' | 'screenShake' | 'autoBattleAssist' | 'adaptiveQuality' | 'debugPerformance') => (
    <button type="button" role="switch" aria-checked={settings[key]} onClick={() => update(key, !settings[key])}
      className={`settings-switch ${settings[key] ? 'is-on' : ''}`}><span />{settings[key] ? 'ON' : 'OFF'}</button>
  );
  const select = <K extends 'graphics' | 'rainIntensity' | 'nightVisibility',>(key: K, values: readonly GameSettings[K][]) => (
    <div className="settings-segment">{values.map((value) => <button key={String(value)} type="button" aria-pressed={settings[key] === value}
      className={settings[key] === value ? 'active' : ''} onClick={() => update(key, value)}>{String(value).toUpperCase()}</button>)}</div>
  );
  const slider = (label: string, key: 'brightness' | 'soundVolume' | 'musicVolume', min: number, max: number, suffix: string) => (
    <label className="settings-row settings-slider-row"><span>{label}</span><input type="range" min={min} max={max} value={settings[key]} onChange={(e) => update(key, Number(e.target.value))} /><strong>{settings[key]}{suffix}</strong></label>
  );
  const row = (label: string, key: Parameters<typeof toggle>[0], description?: string) => (
    <div className="settings-row"><span><strong>{label}</strong>{description && <small>{description}</small>}</span>{toggle(key)}</div>
  );

  return <div className="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <section className="settings-card">
      <header className="settings-header"><div><small>IRON TIDE · FIELD CONFIGURATION</small><h2 id="settings-title">Settings</h2></div><button type="button" onClick={onClose} aria-label="Close settings">✕</button></header>
      <div className="settings-content">
        <h3>Display & Performance</h3>
        {select('graphics', ['low', 'medium', 'high'])}
        <p className="-mt-2 mb-2 text-[11px] text-slate-400">Zombie entity budget: Low 600 · Medium 900 · High 1,200. Use FPS / Zombie Counter to monitor load; 10,000 simultaneously simulated zombies is not a safe mobile target.</p>
        {row('Battery Saver', 'batterySaver', 'Caps simulation at 30 FPS')}
        {row('Adaptive Quality', 'adaptiveQuality', 'Automatically lowers effects during sustained slow frames')}
        {row('FPS / Zombie Counter', 'debugPerformance', 'Show live performance diagnostics')}
        {slider('Brightness', 'brightness', 80, 140, '%')}
        <div className="settings-row"><span><strong>Rain Intensity</strong></span>{select('rainIntensity', ['off', 'light', 'normal'])}</div>
        <div className="settings-row"><span><strong>Night Visibility</strong></span>{select('nightVisibility', ['normal', 'bright'])}</div>
        <h3>Controls & Accessibility</h3>
        {row('Haptics', 'haptics')}{row('Left-handed Layout', 'leftHanded')}{row('Large Text', 'largeText')}{row('Colorblind Mode', 'colorblind')}
        <h3>Audio</h3>
        {slider('Sound Volume', 'soundVolume', 0, 100, '%')}{slider('Music Volume', 'musicVolume', 0, 100, '%')}
        <h3>Combat & Assist</h3>
        {row('Auto-battle Assist', 'autoBattleAssist', 'Units engage nearby threats and retreat when critically damaged')}
        <h3>Combat Feedback</h3>
        {row('Damage Numbers', 'damageNumbers')}{row('Screen Shake', 'screenShake')}
      </div>
      <footer className="settings-footer"><button type="button" onClick={() => { onChange({ ...settings }); onClose(); }}>Done</button></footer>
    </section>
  </div>;
};
