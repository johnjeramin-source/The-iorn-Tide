export interface PlayerProfile {
  callsign: string;
  emblem: number;
  color: string;
  avatar: string;
  cartoonFilter: boolean;
  missions: number;
  victories: number;
  totalKills: number;
  bestKills: number;
  secondsPlayed: number;
}

export const EMBLEMS = ['★', '☠', '⚓', '✦', '▲', '⬢'];
export const PROFILE_COLORS = ['#facc15', '#38bdf8', '#4ade80', '#f87171', '#c084fc', '#fb923c'];
export const PROFILE_KEY = 'irontide_profile_v1';
export const DEFAULT_AVATAR = 'builtin:1';
export const AVATAR_COUNT = 8;

export const DEFAULT_PROFILE: PlayerProfile = {
  callsign: 'Vanguard',
  emblem: 0,
  color: PROFILE_COLORS[0],
  avatar: DEFAULT_AVATAR,
  cartoonFilter: true,
  missions: 0,
  victories: 0,
  totalKills: 0,
  bestKills: 0,
  secondsPlayed: 0,
};

function finiteNonNegative(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function normalizeProfile(value: Partial<PlayerProfile> | null | undefined): PlayerProfile {
  const parsed = value ?? {};
  const color = typeof parsed.color === 'string' && PROFILE_COLORS.includes(parsed.color)
    ? parsed.color : DEFAULT_PROFILE.color;
  const avatar = typeof parsed.avatar === 'string' && (/^builtin:[1-8]$/.test(parsed.avatar) || (parsed.avatar.startsWith('data:image/') && parsed.avatar.length <= 132_000))
    ? parsed.avatar : DEFAULT_AVATAR;
  return {
    ...DEFAULT_PROFILE,
    callsign: typeof parsed.callsign === 'string' ? parsed.callsign.replace(/[<>]/g, '').trim().slice(0, 14) || DEFAULT_PROFILE.callsign : DEFAULT_PROFILE.callsign,
    emblem: Number.isInteger(parsed.emblem) ? Math.max(0, Math.min(EMBLEMS.length - 1, parsed.emblem as number)) : DEFAULT_PROFILE.emblem,
    color,
    avatar,
    cartoonFilter: typeof parsed.cartoonFilter === 'boolean' ? parsed.cartoonFilter : DEFAULT_PROFILE.cartoonFilter,
    missions: finiteNonNegative(parsed.missions),
    victories: finiteNonNegative(parsed.victories),
    totalKills: finiteNonNegative(parsed.totalKills),
    bestKills: finiteNonNegative(parsed.bestKills),
    secondsPlayed: finiteNonNegative(parsed.secondsPlayed),
  };
}

export function loadProfile(): PlayerProfile {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(PROFILE_KEY) : null;
    if (!raw) return { ...DEFAULT_PROFILE };
    return normalizeProfile(JSON.parse(raw) as Partial<PlayerProfile>);
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveProfile(p: PlayerProfile): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(normalizeProfile(p)));
    return true;
  } catch {
    return false;
  }
}

export function recordRun(outcome: 'victory' | 'defeat' | null, kills: number, seconds: number): PlayerProfile {
  const p = loadProfile();
  const safeKills = finiteNonNegative(kills);
  const safeSeconds = finiteNonNegative(seconds);
  p.missions += 1;
  if (outcome === 'victory') p.victories += 1;
  p.totalKills += safeKills;
  p.bestKills = Math.max(p.bestKills, safeKills);
  p.secondsPlayed += safeSeconds;
  saveProfile(p);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('irontide-profile-updated'));
  return p;
}

export const RANKS: Array<[number, string]> = [
  [0, 'Recruit'], [50, 'Private'], [200, 'Corporal'], [600, 'Sergeant'],
  [1500, 'Lieutenant'], [4000, 'Captain'], [10000, 'Major'], [25000, 'Colonel'],
];

export function rankFor(totalKills: number): string {
  let name = RANKS[0][1];
  for (const [min, label] of RANKS) if (totalKills >= min) name = label;
  return name;
}

export function rankProgress(totalKills: number): { current: number; next: number; percent: number; nextName: string } {
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (totalKills >= RANKS[i][0]) index = i;
  const current = RANKS[index][0];
  const next = RANKS[Math.min(index + 1, RANKS.length - 1)][0];
  return { current, next, percent: index === RANKS.length - 1 ? 100 : Math.max(0, Math.min(100, ((totalKills - current) / (next - current)) * 100)), nextName: RANKS[Math.min(index + 1, RANKS.length - 1)][1] };
}
