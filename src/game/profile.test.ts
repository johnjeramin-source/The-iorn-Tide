import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, PROFILE_KEY, loadProfile, recordRun, saveProfile } from './profile';

function withMockStorage(run: (store: Map<string, string>, events: string[]) => void): void {
  const store = new Map<string, string>();
  const events: string[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
      },
      dispatchEvent: (event: Event) => { events.push(event.type); return true; },
    },
  });
  try { run(store, events); }
  finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('profile loading repairs malformed and out-of-range saved fields', () => {
  withMockStorage((store) => {
    store.set(PROFILE_KEY, JSON.stringify({ callsign: '<bad>  ', missions: -9, totalKills: 'lots', emblem: 999, color: 'not-a-color' }));
    const profile = loadProfile();
    assert.equal(profile.callsign, 'bad');
    assert.equal(profile.missions, 0);
    assert.equal(profile.totalKills, 0);
    assert.ok(Number.isInteger(profile.emblem) && profile.emblem >= 0, 'out-of-range emblem is clamped into the valid range');
    assert.equal(profile.color, DEFAULT_PROFILE.color);
  });
});

test('recordRun clamps invalid counters and emits one profile update event', () => {
  withMockStorage((store, events) => {
    const profile = recordRun('victory', -20, Number.NaN);
    assert.equal(profile.missions, 1);
    assert.equal(profile.victories, 1);
    assert.equal(profile.totalKills, 0);
    assert.equal(profile.secondsPlayed, 0);
    assert.equal(events.filter((event) => event === 'irontide-profile-updated').length, 1);
    assert.equal(JSON.parse(store.get(PROFILE_KEY)!).missions, 1);
  });
});

test('saveProfile rejects unavailable storage without throwing', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { setItem: () => { throw new Error('quota'); } } } });
  try { assert.equal(saveProfile({ ...DEFAULT_PROFILE }), false); }
  finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
