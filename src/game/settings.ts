export type GraphicsQuality = 'low' | 'medium' | 'high';
export type RainIntensity = 'off' | 'light' | 'normal';
export type NightVisibility = 'normal' | 'bright';

export interface GameSettings {
  brightness: number;
  rainIntensity: RainIntensity;
  nightVisibility: NightVisibility;
  graphics: GraphicsQuality;
  batterySaver: boolean;
  haptics: boolean;
  leftHanded: boolean;
  largeText: boolean;
  colorblind: boolean;
  soundVolume: number;
  musicVolume: number;
  damageNumbers: boolean;
  screenShake: boolean;
  autoBattleAssist: boolean;
  adaptiveQuality: boolean;
  debugPerformance: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  brightness: 112,
  rainIntensity: 'light',
  nightVisibility: 'bright',
  graphics: 'medium',
  batterySaver: false,
  haptics: true,
  leftHanded: false,
  largeText: false,
  colorblind: false,
  soundVolume: 75,
  musicVolume: 55,
  damageNumbers: true,
  screenShake: true,
  autoBattleAssist: false,
  adaptiveQuality: true,
  debugPerformance: false,
};

const STORAGE_KEY = 'irontide_settings_v1';

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      brightness: clampNumber(parsed.brightness, 80, 140, DEFAULT_SETTINGS.brightness),
      soundVolume: clampNumber(parsed.soundVolume, 0, 100, DEFAULT_SETTINGS.soundVolume),
      musicVolume: clampNumber(parsed.musicVolume, 0, 100, DEFAULT_SETTINGS.musicVolume),
      rainIntensity: isOneOf(parsed.rainIntensity, ['off', 'light', 'normal']) ? parsed.rainIntensity : DEFAULT_SETTINGS.rainIntensity,
      nightVisibility: isOneOf(parsed.nightVisibility, ['normal', 'bright']) ? parsed.nightVisibility : DEFAULT_SETTINGS.nightVisibility,
      graphics: isOneOf(parsed.graphics, ['low', 'medium', 'high']) ? parsed.graphics : DEFAULT_SETTINGS.graphics,
      autoBattleAssist: typeof parsed.autoBattleAssist === 'boolean' ? parsed.autoBattleAssist : DEFAULT_SETTINGS.autoBattleAssist,
      adaptiveQuality: typeof parsed.adaptiveQuality === 'boolean' ? parsed.adaptiveQuality : DEFAULT_SETTINGS.adaptiveQuality,
      debugPerformance: typeof parsed.debugPerformance === 'boolean' ? parsed.debugPerformance : DEFAULT_SETTINGS.debugPerformance,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage may be unavailable */ }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}
