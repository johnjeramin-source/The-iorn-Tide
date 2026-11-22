import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameHud, TouchMode } from './components/GameHud';
import { OfflineIndicator } from './components/PWAInstallButton';
import { StatusModal } from './components/StatusModal';
import { SettingsPanel } from './components/SettingsPanel';
import { GameSettings, loadSettings, saveSettings } from './game/settings';
import { TitleScreen } from './components/TitleScreen';
import { audio } from './game/audio';
import { music } from './game/music';
import { recordRun } from './game/profile';
import { DEFAULT_ZOOM, OPS_VIEW_ZOOM_THRESHOLD } from './game/data';
import {
  adjustCameraZoom,
  setAutoBattleAssist,
  buildHudSnapshot,
  clampCameraTarget,
  createWorld,
  cycleWeather,
  deployUnit,
  issueMoveOrder,
  placeStructureOrStrike,
  rotatePlacement,
  requestDirectReload,
  repairSelectedVehicles,
  toggleBunkerDoor,
  cycleWallTier,
  screenToWorld,
  selectUnitsInRect,
  selectUnitAtPoint,
  startScenario,
  stepWorld,
  toggleDirectControl,
  toggleLowLagMode,
  setFormation,
  toggleFogOfWar,
} from './game/engine';
import { renderWorld } from './game/renderer';
import { getCampaignMission } from './game/campaign';
import {
  BuildPlacementMode,
  GameWorld,
  HudSnapshot,
  InputState,
  MapId,
  PlayerUnitKind,
  ScenarioId,
} from './game/types';

function triggerHaptic(duration: number | number[] = 12): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(duration);
  }
}

function shouldAutostart(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('autostart') === '1';
}

function readStoredLowLag(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('irontide_antilag') === '1';
  } catch {
    return false;
  }
}

function applyPerformanceSettings(world: GameWorld, settings: GameSettings): void {
  world.graphicsQuality = settings.graphics;
  world.preferredGraphicsQuality = settings.graphics;
  world.adaptiveQuality = settings.adaptiveQuality;
  world.debugPerformance = settings.debugPerformance;
  world.damageNumbersEnabled = settings.damageNumbers;
  world.autoBattleAssist = settings.autoBattleAssist;
}

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const initialMap: MapId = 'port_la';
  const initialScenario: ScenarioId = 'harbor_break';
  const autostart = shouldAutostart();
  const initialLowLag = readStoredLowLag();

  const worldRef = useRef<GameWorld>(
    (() => {
      const w = createWorld(initialScenario, autostart ? 'playing' : 'title', initialMap);
      w.lowLagMode = initialLowLag;
      applyPerformanceSettings(w, loadSettings());
      return w;
    })(),
  );
  const lowLagPrefRef = useRef<boolean>(initialLowLag);
  const resizeCanvasRef = useRef<(() => void) | null>(null);
  const canvasRectRef = useRef<DOMRect | null>(null);
  const pendingPointerMoveRef = useRef<{ x: number; y: number; id: number; type: string } | null>(null);
  const pointerMoveRafRef = useRef<number>(0);

  const inputRef = useRef<InputState>({
    keysHeld: new Set<string>(),
    virtualMoveX: 0,
    virtualMoveY: 0,
    virtualFiring: false,
    mouseWorldX: 900,
    mouseWorldY: 1200,
    mouseScreenX: 720,
    mouseScreenY: 450,
    mouseDownLeft: false,
    dragBoxStartScreen: null,
    dragBoxCurrentScreen: null,
  });

  const [selectedMap, setSelectedMap] = useState<MapId>(initialMap);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioId>(initialScenario);
  const [selectedMissionId, setSelectedMissionId] = useState<number | null>(null);
  const [endlessMode, setEndlessMode] = useState(false);
  const [unlockedMissionId, setUnlockedMissionId] = useState<number>(() => {
    try { return Math.max(1, Math.min(20, Number(window.localStorage.getItem('irontide_campaign_unlocked') || 1))); } catch { return 1; }
  });
  const selectedMapRef = useRef<MapId>(initialMap);
  const selectedScenarioRef = useRef<ScenarioId>(initialScenario);
  selectedMapRef.current = selectedMap;
  selectedScenarioRef.current = selectedScenario;

  const [hud, setHud] = useState<HudSnapshot>(() => buildHudSnapshot(worldRef.current));
  const [bootLoading, setBootLoading] = useState(() => !shouldAutostart());
  // Real loading screen: waits for fonts and key images, then shows for at least 0.9s so it
  // reads as a proper boot sequence (never longer than 3.5s even if something stalls).
  useEffect(() => {
    if (!bootLoading) return;
    let cancelled = false;
    const startedAt = performance.now();
    const preload = (src: string) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = src;
      });
    const tasks: Promise<unknown>[] = [preload('/iron-tide-logo.png'), preload('/avatars/avatar-1.png')];
    if (typeof document !== 'undefined' && document.fonts?.ready) tasks.push(document.fonts.ready);
    const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 3500));
    Promise.race([Promise.all(tasks), timeout]).then(() => {
      const wait = Math.max(0, 900 - (performance.now() - startedAt));
      window.setTimeout(() => { if (!cancelled) setBootLoading(false); }, wait);
    });
    return () => { cancelled = true; };
  }, [bootLoading]);


  // Save mission result to the player profile once per game over
  const recordedRunRef = useRef(false);
  useEffect(() => {
    if (hud.phase === 'gameover') {
      if (!recordedRunRef.current) {
        recordedRunRef.current = true;
        recordRun(hud.outcome, hud.kills, hud.elapsedSec);
      }
    } else {
      recordedRunRef.current = false;
    }
  }, [hud.phase, hud.outcome, hud.kills, hud.elapsedSec]);
  useEffect(() => {
    if (hud.phase !== 'gameover' || hud.outcome !== 'victory' || hud.campaignMissionId === null) return;
    const nextUnlocked = Math.min(20, Math.max(unlockedMissionId, hud.campaignMissionId + 1));
    if (nextUnlocked !== unlockedMissionId) {
      setUnlockedMissionId(nextUnlocked);
      try { window.localStorage.setItem('irontide_campaign_unlocked', String(nextUnlocked)); } catch { /* storage may be unavailable */ }
    }
  }, [hud.phase, hud.outcome, hud.campaignMissionId, unlockedMissionId]);
  const [muted, setMuted] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());
  const [debugStats, setDebugStats] = useState({ fps: 0, zombies: 0 });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Wire sound/music settings and drive adaptive music from game phase
  useEffect(() => {
    audio.setSoundVolume(settings.soundVolume / 100);
    music.setVolume(settings.musicVolume / 100);
  }, [settings.soundVolume, settings.musicVolume]);

  useEffect(() => {
    if (muted) { music.setMood('off'); return; }
    if (hud.phase === 'title') music.setMood('menu');
    else if (hud.phase === 'playing') music.setMood(hud.waveNumber > 1 ? 'combat' : 'calm');
    else if (hud.phase === 'paused') music.setMood('menu');
    else music.setMood('off');
  }, [hud.phase, hud.waveNumber, muted]);

  useEffect(() => { applyPerformanceSettings(worldRef.current, settings); setAutoBattleAssist(worldRef.current, settings.autoBattleAssist); }, []);
  const previousWaveRef = useRef(worldRef.current.waveNumber);
  const previousIntegrityRef = useRef(worldRef.current.carrierIntegrity);
  useEffect(() => {
    if (hud.waveNumber > previousWaveRef.current && settingsRef.current.haptics) triggerHaptic([0, 45, 70, 45]);
    if (hud.carrierIntegrity < previousIntegrityRef.current && settingsRef.current.haptics) triggerHaptic([0, 80, 45, 80]);
    previousWaveRef.current = hud.waveNumber; previousIntegrityRef.current = hud.carrierIntegrity;
  }, [hud.waveNumber, hud.carrierIntegrity]);
  const handleSettingsChange = useCallback((next: GameSettings) => {
    setSettings(next); settingsRef.current = next; saveSettings(next);
    applyPerformanceSettings(worldRef.current, next);
    setAutoBattleAssist(worldRef.current, next.autoBattleAssist);
  }, []);
  const [touchMode, setTouchMode] = useState<TouchMode>('pan');
  const [showMiniMap, setShowMiniMap] = useState<boolean>(() =>
    false, // opens on the Units tab; the map lives in its own dock tab
  );

  const touchModeRef = useRef<TouchMode>('pan');
  touchModeRef.current = touchMode;

  const syncBodyState = useCallback((phase: GameWorld['phase']) => {
    document.body.dataset.state = phase;
  }, []);

  const syncHudImmediate = useCallback(() => {
    const world = worldRef.current;
    syncBodyState(world.phase);
    setHud(buildHudSnapshot(world));
  }, [syncBodyState]);

  const clearInputs = useCallback(() => {
    inputRef.current.keysHeld.clear();
    inputRef.current.virtualMoveX = 0;
    inputRef.current.virtualMoveY = 0;
    inputRef.current.virtualFiring = false;
    inputRef.current.mouseDownLeft = false;
    inputRef.current.dragBoxStartScreen = null;
    inputRef.current.dragBoxCurrentScreen = null;
  }, []);

  useEffect(() => {
    const pauseIfHidden = () => {
      const world = worldRef.current;
      if ((document.visibilityState === 'hidden' || !document.hasFocus()) && world.phase === 'playing') {
        world.phase = 'paused'; clearInputs(); syncHudImmediate();
      }
    };
    document.addEventListener('visibilitychange', pauseIfHidden);
    window.addEventListener('pagehide', pauseIfHidden);
    window.addEventListener('blur', pauseIfHidden);
    return () => { document.removeEventListener('visibilitychange', pauseIfHidden); window.removeEventListener('pagehide', pauseIfHidden); window.removeEventListener('blur', pauseIfHidden); };
  }, [clearInputs, syncHudImmediate]);

  const handleStart = useCallback(
    (scenarioOverride?: ScenarioId, mapOverride?: MapId) => {
      audio.unlock();
      const mission = getCampaignMission(selectedMissionId);
      const sc = scenarioOverride ?? mission?.scenarioId ?? selectedScenarioRef.current;
      const mp = mapOverride ?? mission?.mapId ?? selectedMapRef.current;
      const next = startScenario(worldRef.current, sc, mp, selectedMissionId, endlessMode);
      next.lowLagMode = lowLagPrefRef.current;
      applyPerformanceSettings(next, settingsRef.current);
      worldRef.current = next;
      clearInputs();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      canvasRef.current?.focus();
      syncHudImmediate();
    },
    [clearInputs, syncHudImmediate, selectedMissionId, endlessMode],
  );

  const handleSelectMap = useCallback(
    (id: MapId) => {
      selectedMapRef.current = id;
      setSelectedMap(id);
      setSelectedMissionId(null);
      if (worldRef.current.phase === 'title') {
        const next = createWorld(selectedScenarioRef.current, 'title', id);
        next.lowLagMode = lowLagPrefRef.current;
        applyPerformanceSettings(next, settingsRef.current);
        worldRef.current = next;
        syncHudImmediate();
      }
    },
    [syncHudImmediate],
  );

  const handleSelectScenario = useCallback(
    (id: ScenarioId) => {
      selectedScenarioRef.current = id;
      setSelectedScenario(id);
      setSelectedMissionId(null);
      if (worldRef.current.phase === 'title') {
        const next = createWorld(id, 'title', selectedMapRef.current);
        next.lowLagMode = lowLagPrefRef.current;
        applyPerformanceSettings(next, settingsRef.current);
        worldRef.current = next;
        syncHudImmediate();
      }
    },
    [syncHudImmediate],
  );

  const handleSelectMission = useCallback((id: number | null) => {
    setSelectedMissionId(id);
    const mission = getCampaignMission(id);
    if (mission) {
      selectedMapRef.current = mission.mapId;
      selectedScenarioRef.current = mission.scenarioId;
      setSelectedMap(mission.mapId);
      setSelectedScenario(mission.scenarioId);
      const next = createWorld(mission.scenarioId, 'title', mission.mapId, id);
      next.lowLagMode = lowLagPrefRef.current;
      applyPerformanceSettings(next, settingsRef.current);
      worldRef.current = next;
      syncHudImmediate();
    } else {
      const next = createWorld(selectedScenarioRef.current, 'title', selectedMapRef.current);
      next.lowLagMode = lowLagPrefRef.current;
      applyPerformanceSettings(next, settingsRef.current);
      worldRef.current = next;
      syncHudImmediate();
    }
  }, [syncHudImmediate]);

  const handleCycleFormation = useCallback(() => {
    const order = ['grid', 'line', 'column', 'circle'] as const;
    const current = worldRef.current.formation;
    setFormation(worldRef.current, order[(order.indexOf(current) + 1) % order.length]);
    syncHudImmediate();
  }, [syncHudImmediate]);

  const handleToggleFog = useCallback(() => {
    toggleFogOfWar(worldRef.current);
    syncHudImmediate();
  }, [syncHudImmediate]);

  const handleToggleAutoBattleAssist = useCallback(() => {
    setAutoBattleAssist(worldRef.current, !worldRef.current.autoBattleAssist);
    syncHudImmediate();
  }, [syncHudImmediate]);

  const handlePauseToggle = useCallback(() => {
    const world = worldRef.current;
    if (world.phase === 'playing') {
      world.phase = 'paused';
      clearInputs();
      syncHudImmediate();
    } else if (world.phase === 'paused') {
      world.phase = 'playing';
      clearInputs();
      canvasRef.current?.focus();
      syncHudImmediate();
    }
  }, [clearInputs, syncHudImmediate]);

  const handleReturnTitle = useCallback(() => {
    const next = createWorld(selectedScenarioRef.current, 'title', selectedMapRef.current);
    next.lowLagMode = lowLagPrefRef.current;
    worldRef.current = next;
    clearInputs();
    syncHudImmediate();
  }, [clearInputs, syncHudImmediate]);

  const handleDeployUnit = useCallback(
    (kind: PlayerUnitKind) => {
      audio.unlock();
      const result = deployUnit(worldRef.current, kind);
      if (result.ok && settingsRef.current.haptics) triggerHaptic(18);
      syncHudImmediate();
    },
    [syncHudImmediate],
  );

  const handleSelectPlacement = useCallback(
    (mode: BuildPlacementMode | null) => {
      worldRef.current.placementMode = mode;
      if (mode && settingsRef.current.haptics) triggerHaptic(10);
      syncHudImmediate();
    },
    [syncHudImmediate],
  );

  const handleRotatePlacement = useCallback(() => {
    rotatePlacement(worldRef.current);
    syncHudImmediate();
  }, [syncHudImmediate]);

  const handleCycleWeather = useCallback(() => {
    cycleWeather(worldRef.current);
    syncHudImmediate();
  }, [syncHudImmediate]);

  const handleToggleLowLag = useCallback(() => {
    const next = toggleLowLagMode(worldRef.current);
    lowLagPrefRef.current = next;
    try {
      window.localStorage.setItem('irontide_antilag', next ? '1' : '0');
    } catch {
      // Ignore storage errors
    }
    resizeCanvasRef.current?.();
    syncHudImmediate();
  }, [syncHudImmediate]);

  const handleToggleBunkerDoor = useCallback(() => {
    toggleBunkerDoor(worldRef.current);
    syncHudImmediate();
  }, [syncHudImmediate]);

  const handleReload = useCallback(() => {
    const started = requestDirectReload(worldRef.current);
    if (started && settingsRef.current.haptics) triggerHaptic(12);
    syncHudImmediate();
  }, [syncHudImmediate]);

  const handleRepairVehicles = useCallback(() => {
    const result = repairSelectedVehicles(worldRef.current);
    if (result.repaired > 0 && settingsRef.current.haptics) triggerHaptic(18);
    if (result.reason) { worldRef.current.alertMessage = result.reason; worldRef.current.alertTimer = 2.4; }
    syncHudImmediate();
  }, [syncHudImmediate]);

  const handleToggleDirectControl = useCallback(() => {
    audio.unlock();
    toggleDirectControl(worldRef.current);
    syncHudImmediate();
  }, [syncHudImmediate]);

  const handleToggleOpsZoom = useCallback(() => {
    const world = worldRef.current;
    if (world.camera.zoom < OPS_VIEW_ZOOM_THRESHOLD) {
      world.camera.targetZoom = DEFAULT_ZOOM;
    } else {
      world.camera.targetZoom = 0.34;
      world.camera.targetX = 2000;
      world.camera.targetY = 1200;
    }
    syncHudImmediate();
  }, [syncHudImmediate]);

  const handleToggleMute = useCallback(() => {
    const next = !audio.isMuted();
    audio.setMuted(next);
    setMuted(next);
  }, []);

  const handleToggleMiniMap = useCallback(() => {
    setShowMiniMap((prev) => !prev);
  }, []);

  const handlePanToWorld = useCallback((wx: number, wy: number) => {
    const world = worldRef.current;
    if (world.directControlUnitId !== null) {
      world.directControlUnitId = null;
    }
    world.camera.targetX = wx;
    world.camera.targetY = wy;
    clampCameraTarget(world);
  }, []);

  const handleFocusSector = useCallback((sectorId: string) => {
    const world = worldRef.current;
    const sec = world.sectors.find((s) => s.id === sectorId);
    if (!sec) return;
    if (world.directControlUnitId !== null) {
      world.directControlUnitId = null;
    }
    world.camera.targetX = sec.x;
    world.camera.targetY = sec.y;
    clampCameraTarget(world);
  }, []);

  const handleVirtualMove = useCallback((vx: number, vy: number) => {
    inputRef.current.virtualMoveX = vx;
    inputRef.current.virtualMoveY = vy;
  }, []);

  const handleVirtualFire = useCallback((firing: boolean) => {
    audio.unlock();
    inputRef.current.virtualFiring = firing;
  }, []);

  // Main animation loop & ResizeObserver (mounted once)
  useEffect(() => {
    syncBodyState(worldRef.current.phase);
    const canvas = canvasRef.current;
    const mount = mountRef.current;
    if (!canvas || !mount) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let viewW = mount.clientWidth || window.innerWidth;
    let viewH = mount.clientHeight || window.innerHeight;
    let autoCapOneDpr = false;
    let slowFrameCount = 0;

    let renderScale = 1; // dynamic resolution: shrinks before graphics quality is ever lowered
    const resizeCanvas = () => {
      const rect = mount.getBoundingClientRect();
      canvasRectRef.current = canvas.getBoundingClientRect();
      viewW = Math.max(320, rect.width || window.innerWidth);
      viewH = Math.max(240, rect.height || window.innerHeight);
      const maxDpr = worldRef.current.lowLagMode || autoCapOneDpr ? 1 : 1.5;
      const dpr = Math.min(maxDpr, window.devicePixelRatio || 1) * renderScale;
      canvas.width = Math.round(viewW * dpr);
      canvas.height = Math.round(viewH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderWorld(ctx, worldRef.current, inputRef.current, viewW, viewH);
    };

    resizeCanvasRef.current = resizeCanvas;
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(mount);

    let rafId = 0;
    let lastTime = performance.now();
    let hudTimer = 0;
    let simulationAccumulator = 0;
    let averageFrameMs = 16.7;
    let slowQualitySeconds = 0;
    let stableQualitySeconds = 0;
    let debugTimer = 0;
    let lastPhase = worldRef.current.phase;
    let needsStaticDraw = false;

    const tick = (now: number) => {
      const elapsed = Math.max(0, (now - lastTime) / 1000);
      const rawDt = Math.min(0.1, elapsed);
      const frameMs = now - lastTime;
      averageFrameMs += (frameMs - averageFrameMs) * 0.08;
      lastTime = now;

      const world = worldRef.current;
      const isStaticPhase = world.phase === 'paused' || world.phase === 'gameover';

      if (!isStaticPhase) {
        // Automatic Anti-Lag DPR drop if sustained frame times fall below ~26fps
        if (world.phase === 'playing' && !autoCapOneDpr && (window.devicePixelRatio || 1) > 1) {
          if (frameMs > 38 && frameMs < 200) {
            slowFrameCount++;
            if (slowFrameCount >= 36) {
              autoCapOneDpr = true;
              if (!world.lowLagMode) {
                world.lowLagMode = true;
                lowLagPrefRef.current = true;
                try { window.localStorage.setItem('irontide_antilag', '1'); } catch { /* storage may be unavailable */ }
              }
              resizeCanvas();
            }
          } else {
            slowFrameCount = Math.max(0, slowFrameCount - 2);
          }
        }

        const fixedStep = settingsRef.current.batterySaver ? 1 / 30 : 1 / 60;
        simulationAccumulator = Math.min(fixedStep * 3, simulationAccumulator + rawDt);
        let substeps = 0;
        while (simulationAccumulator >= fixedStep && substeps < 3) {
          stepWorld(world, fixedStep, inputRef.current, viewW, viewH);
          if (world.events.length > 0) {
            audio.playEvents(world.events);
            if (settingsRef.current.haptics && !world.lowLagMode && world.events.some((event) => event.type === 'explosion' || event.type === 'artillery_impact')) triggerHaptic([0, 65, 35, 65]);
            if (settingsRef.current.haptics && world.events.some((event) => event.type === 'unit_lost')) triggerHaptic([0, 90, 50, 90]);
          }
          simulationAccumulator -= fixedStep;
          substeps++;
        }
        // Adaptive quality changes only the runtime tier; the player's saved
        // graphics preference remains untouched.
        if (world.adaptiveQuality && world.phase === 'playing') {
          if (averageFrameMs > 20) { slowQualitySeconds += rawDt; stableQualitySeconds = 0; }
          else if (averageFrameMs < 16.5) { stableQualitySeconds += rawDt; slowQualitySeconds = Math.max(0, slowQualitySeconds - rawDt * 0.5); }
          else { slowQualitySeconds = Math.max(0, slowQualitySeconds - rawDt * 0.25); stableQualitySeconds = 0; }
          if (slowQualitySeconds >= 1 && renderScale > 0.66) {
            // First lever: render fewer pixels. Keeps High graphics, effects and zombie count intact.
            renderScale = Math.max(0.66, renderScale - 0.1);
            slowQualitySeconds = 0; stableQualitySeconds = 0;
            resizeCanvas();
          } else if (stableQualitySeconds >= 5 && renderScale < 1) {
            renderScale = Math.min(1, renderScale + 0.05);
            stableQualitySeconds = 0;
            resizeCanvas();
          } else if (slowQualitySeconds >= 2) {
            world.graphicsQuality = world.graphicsQuality === 'high' ? 'medium' : 'low';
            slowQualitySeconds = 0; stableQualitySeconds = 0;
          } else if (stableQualitySeconds >= 6) {
            world.graphicsQuality = world.graphicsQuality === 'low' ? 'medium' : world.graphicsQuality === 'medium' && world.preferredGraphicsQuality === 'high' ? 'high' : world.preferredGraphicsQuality;
            stableQualitySeconds = 0;
          }
        }
        renderWorld(ctx, world, inputRef.current, viewW, viewH);
        needsStaticDraw = true;
      } else if (needsStaticDraw || world.phase !== lastPhase) {
        renderWorld(ctx, world, inputRef.current, viewW, viewH);
        needsStaticDraw = false;
      }

      hudTimer += rawDt;
      if (hudTimer >= 0.15 || world.phase !== lastPhase) {
        hudTimer = 0;
        lastPhase = world.phase;
        syncBodyState(world.phase);
        setHud(buildHudSnapshot(world));
      }
      if (settingsRef.current.debugPerformance) {
        debugTimer += rawDt;
        if (debugTimer >= 0.5) { debugTimer = 0; setDebugStats({ fps: Math.round(1000 / Math.max(1, averageFrameMs)), zombies: world.activeZombieCount }); }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      if (pointerMoveRafRef.current) cancelAnimationFrame(pointerMoveRafRef.current);
      pointerMoveRafRef.current = 0;
      pendingPointerMoveRef.current = null;
      observer.disconnect();
      resizeCanvasRef.current = null;
    };
  }, [syncBodyState]);

  // Global keyboard & focus-loss hygiene
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const world = worldRef.current;

      if (world.phase === 'title') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleStart();
        }
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (world.placementMode && e.code === 'Escape') {
          world.placementMode = null;
          syncHudImmediate();
          return;
        }
        if (world.phase === 'playing' || world.phase === 'paused') {
          e.preventDefault();
          handlePauseToggle();
        }
        return;
      }

      if (world.phase !== 'playing') return;

      inputRef.current.keysHeld.add(e.code);

      if (e.repeat) return;

      switch (e.code) {
        case 'Digit1':
          handleDeployUnit('squad');
          break;
        case 'Digit2':
          handleDeployUnit('heavy');
          break;
        case 'Digit3':
          handleDeployUnit('rpg');
          break;
        case 'Digit4':
          handleDeployUnit('medic');
          break;
        case 'Digit5':
          handleDeployUnit('sniper');
          break;
        case 'Digit6':
          handleDeployUnit('humvee');
          break;
        case 'Digit7':
          handleDeployUnit('ifv');
          break;
        case 'Digit8':
          handleDeployUnit('tank');
          break;
        case 'Digit9':
          handleDeployUnit('chopper');
          break;
        case 'Digit0':
          handleDeployUnit('blackhawk');
          break;
        case 'Minus':
          handleDeployUnit('raider');
          break;
        case 'Equal':
          handleDeployUnit('howitzer');
          break;
        case 'KeyU':
          handleDeployUnit('truck');
          break;
        case 'KeyI':
          handleDeployUnit('littlebird');
          break;
        case 'KeyO':
          handleDeployUnit('hind');
          break;
        case 'KeyY':
          handleDeployUnit('chinook');
          break;
        case 'KeyJ':
          handleDeployUnit('drone');
          break;
        case 'KeyQ':
          if (world.placementMode?.kind === 'wall') {
            cycleWallTier(world);
            syncHudImmediate();
          } else {
            handleSelectPlacement({ kind: 'wall' });
          }
          break;
        case 'KeyX': {
          const fences = ['wire', 'oil', 'laser', 'electric'] as const;
          const cur = fences.indexOf(world.placementMode?.kind as (typeof fences)[number]);
          handleSelectPlacement(cur === fences.length - 1 ? null : { kind: fences[cur + 1] });
          break;
        }
        case 'KeyG':
          handleSelectPlacement(
            world.placementMode?.kind === 'gate' ? null : { kind: 'gate' },
          );
          break;
        case 'KeyE':
          handleSelectPlacement(
            world.placementMode?.kind === 'turret' ? null : { kind: 'turret' },
          );
          break;
        case 'KeyC':
          handleSelectPlacement(
            world.placementMode?.kind === 'autocannon' ? null : { kind: 'autocannon' },
          );
          break;
        case 'KeyH':
          handleSelectPlacement(
            world.placementMode?.kind === 'rocket_turret' ? null : { kind: 'rocket_turret' },
          );
          break;
        case 'KeyB':
          handleSelectPlacement(
            world.placementMode?.kind === 'barrage' ? null : { kind: 'barrage' },
          );
          break;
        case 'KeyN':
          handleSelectPlacement(
            world.placementMode?.kind === 'airstrike' ? null : { kind: 'airstrike' },
          );
          break;
        case 'BracketRight':
          handleSelectPlacement(
            world.placementMode?.kind === 'reinforce' ? null : { kind: 'reinforce' },
          );
          break;
        case 'KeyV':
          handleSelectPlacement(
            world.placementMode?.kind === 'supplydrop' ? null : { kind: 'supplydrop' },
          );
          break;
        case 'KeyR':
          if (world.directControlUnitId !== null) {
            handleReload();
          } else if (['wall', 'gate', 'wire', 'oil', 'laser', 'electric'].includes(world.placementMode?.kind as string)) {
            handleRotatePlacement();
          } else if (e.shiftKey) {
            handleStart();
          }
          break;
        case 'KeyK':
          handleToggleMiniMap();
          break;
        case 'KeyL':
          handleToggleLowLag();
          break;
        case 'KeyT':
          handleCycleWeather();
          break;
        case 'KeyF':
          handleToggleDirectControl();
          break;
        case 'KeyZ':
          handleToggleOpsZoom();
          break;
        case 'KeyM':
          handleToggleMute();
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      inputRef.current.keysHeld.delete(e.code);
    };

    const onBlurOrHide = () => {
      clearInputs();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlurOrHide);
    document.addEventListener('visibilitychange', onBlurOrHide);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlurOrHide);
      document.removeEventListener('visibilitychange', onBlurOrHide);
    };
  }, [
    clearInputs,
    handleCycleWeather,
    handleDeployUnit,
    handlePauseToggle,
    handleRotatePlacement,
    handleSelectPlacement,
    handleStart,
    handleToggleDirectControl,
    handleToggleLowLag,
    handleToggleMiniMap,
    handleToggleMute,
    handleToggleOpsZoom,
    syncHudImmediate,
  ]);

  // Pointer, wheel & multi-touch pan/pinch interactions on canvas
  const updateMouseCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { sx: 0, sy: 0, wx: 0, wy: 0, width: 1, height: 1 };
    // ResizeObserver refreshes this rect; avoid layout reads in pointer hot paths.
    const rect = canvasRectRef.current;
    if (!rect) return { sx: 0, sy: 0, wx: 0, wy: 0, width: 1, height: 1 };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const wPos = screenToWorld(worldRef.current, sx, sy, rect.width, rect.height);
    const input = inputRef.current;
    input.mouseScreenX = sx;
    input.mouseScreenY = sy;
    input.mouseWorldX = wPos.x;
    input.mouseWorldY = wPos.y;
    return { sx, sy, wx: wPos.x, wy: wPos.y, width: rect.width, height: rect.height };
  }, []);

  const panDragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });

  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const touchGestureRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const lastUnitTapRef = useRef<{ kind: PlayerUnitKind; at: number } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const world = worldRef.current;
    if (world.phase !== 'playing') return;
    audio.unlock();

    const { sx, sy, wx, wy } = updateMouseCoords(e.clientX, e.clientY);

    if (e.pointerType === 'touch') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is unavailable
      }
      activeTouchesRef.current.set(e.pointerId, { x: sx, y: sy });

      if (activeTouchesRef.current.size === 2) {
        const pts = Array.from(activeTouchesRef.current.values());
        pinchStateRef.current = {
          dist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
          midX: (pts[0].x + pts[1].x) * 0.5,
          midY: (pts[0].y + pts[1].y) * 0.5,
        };
        inputRef.current.dragBoxStartScreen = null;
        inputRef.current.dragBoxCurrentScreen = null;
        touchGestureRef.current = null;
        return;
      }

      touchGestureRef.current = {
        startX: sx,
        startY: sy,
        lastX: sx,
        lastY: sy,
        moved: false,
      };

      if (!world.placementMode && touchModeRef.current === 'select' && world.directControlUnitId === null) {
        inputRef.current.dragBoxStartScreen = { x: sx, y: sy };
        inputRef.current.dragBoxCurrentScreen = { x: sx, y: sy };
      }
      return;
    }

    if (e.button === 1) {
      e.preventDefault();
      panDragRef.current = { active: true, lastX: sx, lastY: sy };
      return;
    }

    if (e.button === 2) {
      e.preventDefault();
      if (world.placementMode) {
        world.placementMode = null;
        syncHudImmediate();
        return;
      }
      if (world.directControlUnitId === null) {
        issueMoveOrder(world, wx, wy, true);
      }
      return;
    }

    if (e.button === 0) {
      if (world.placementMode) {
        placeStructureOrStrike(world, wx, wy);
        syncHudImmediate();
        return;
      }

      inputRef.current.mouseDownLeft = true;
      if (world.directControlUnitId === null) {
        inputRef.current.dragBoxStartScreen = { x: sx, y: sy };
        inputRef.current.dragBoxCurrentScreen = { x: sx, y: sy };
      }
    }
  }, [updateMouseCoords, syncHudImmediate]);

  const processPointerMove = useCallback((clientX: number, clientY: number, pointerId: number, pointerType: string) => {
    const world = worldRef.current;
    const { sx, sy, width, height } = updateMouseCoords(clientX, clientY);

    if (pointerType === 'touch' && activeTouchesRef.current.has(pointerId)) {
      activeTouchesRef.current.set(pointerId, { x: sx, y: sy });

      if (activeTouchesRef.current.size === 2 && pinchStateRef.current) {
        const pts = Array.from(activeTouchesRef.current.values());
        const newDist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
        const newMidX = (pts[0].x + pts[1].x) * 0.5;
        const newMidY = (pts[0].y + pts[1].y) * 0.5;

        const panDx = newMidX - pinchStateRef.current.midX;
        const panDy = newMidY - pinchStateRef.current.midY;
        if (world.directControlUnitId === null) {
          world.camera.targetX -= panDx / world.camera.zoom;
          world.camera.targetY -= panDy / world.camera.zoom;
          clampCameraTarget(world);
        }

        const factor = newDist / Math.max(10, pinchStateRef.current.dist);
        const midWorld = screenToWorld(world, newMidX, newMidY, width, height);
        adjustCameraZoom(world, factor, midWorld.x, midWorld.y);

        pinchStateRef.current = { dist: newDist, midX: newMidX, midY: newMidY };
        return;
      }

      const g = touchGestureRef.current;
      if (g && world.phase === 'playing') {
        const dx = sx - g.lastX;
        const dy = sy - g.lastY;
        if (Math.hypot(sx - g.startX, sy - g.startY) > 10) {
          g.moved = true;
        }
        g.lastX = sx;
        g.lastY = sy;

        if (
          !world.placementMode &&
          touchModeRef.current === 'select' &&
          world.directControlUnitId === null
        ) {
          inputRef.current.dragBoxCurrentScreen = { x: sx, y: sy };
        } else if (world.directControlUnitId === null) {
          world.camera.targetX -= dx / world.camera.zoom;
          world.camera.targetY -= dy / world.camera.zoom;
          clampCameraTarget(world);
        }
      }
      return;
    }

    if (panDragRef.current.active && world.phase === 'playing') {
      const dx = sx - panDragRef.current.lastX;
      const dy = sy - panDragRef.current.lastY;
      panDragRef.current.lastX = sx;
      panDragRef.current.lastY = sy;
      world.camera.targetX -= dx / world.camera.zoom;
      world.camera.targetY -= dy / world.camera.zoom;
      clampCameraTarget(world);
      return;
    }

    if (inputRef.current.dragBoxStartScreen) {
      inputRef.current.dragBoxCurrentScreen = { x: sx, y: sy };
    }
  }, [updateMouseCoords]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const pending = pendingPointerMoveRef.current;
    if (pending) {
      pending.x = e.clientX;
      pending.y = e.clientY;
      pending.id = e.pointerId;
      pending.type = e.pointerType;
    } else {
      pendingPointerMoveRef.current = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
        type: e.pointerType,
      };
    }
    if (pointerMoveRafRef.current !== 0) return;
    pointerMoveRafRef.current = requestAnimationFrame(() => {
      pointerMoveRafRef.current = 0;
      const pending = pendingPointerMoveRef.current;
      pendingPointerMoveRef.current = null;
      if (pending) processPointerMove(pending.x, pending.y, pending.id, pending.type);
    });
  }, [processPointerMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const pendingMove = pendingPointerMoveRef.current;
    if (pendingMove) {
      pendingPointerMoveRef.current = null;
      if (pointerMoveRafRef.current) cancelAnimationFrame(pointerMoveRafRef.current);
      pointerMoveRafRef.current = 0;
      processPointerMove(pendingMove.x, pendingMove.y, pendingMove.id, pendingMove.type);
    }
    const world = worldRef.current;
    const canvas = canvasRef.current;

    if (e.pointerType === 'touch') {
      activeTouchesRef.current.delete(e.pointerId);
      if (activeTouchesRef.current.size < 2) {
        pinchStateRef.current = null;
      }

      const g = touchGestureRef.current;
      touchGestureRef.current = null;

      const start = inputRef.current.dragBoxStartScreen;
      const end = inputRef.current.dragBoxCurrentScreen;
      inputRef.current.dragBoxStartScreen = null;
      inputRef.current.dragBoxCurrentScreen = null;

      if (world.phase !== 'playing') return;
      const { wx, wy } = updateMouseCoords(e.clientX, e.clientY);

      if (g && !g.moved) {
        if (world.placementMode) {
          placeStructureOrStrike(world, wx, wy);
          syncHudImmediate();
          return;
        }
        if (touchModeRef.current === 'select' && world.directControlUnitId === null) {
          const tappedUnit = selectUnitAtPoint(world, wx, wy);
          if (tappedUnit) {
            const now = performance.now();
            const previousTap = lastUnitTapRef.current;
            if (previousTap && previousTap.kind === tappedUnit.kind && now - previousTap.at <= 420) {
              for (const unit of world.units) {
                unit.selected = unit.kind === tappedUnit.kind && unit.hp > 0 && unit.koTimer <= 0;
              }
              lastUnitTapRef.current = null;
            } else {
              lastUnitTapRef.current = { kind: tappedUnit.kind, at: now };
            }
          } else {
            selectUnitsInRect(world, wx, wy, wx, wy, false);
            lastUnitTapRef.current = null;
          }
          if (settingsRef.current.haptics && world.units.some((unit) => unit.selected)) triggerHaptic(10);
          syncHudImmediate();
          return;
        }
        if (touchModeRef.current === 'order' && world.directControlUnitId === null) {
          issueMoveOrder(world, wx, wy, true);
          return;
        }
        if (touchModeRef.current === 'pan' && world.directControlUnitId === null) {
          const tappedUnit = selectUnitAtPoint(world, wx, wy);
          if (tappedUnit) {
            if (settingsRef.current.haptics) triggerHaptic(10);
            const now = performance.now();
            const previousTap = lastUnitTapRef.current;
            if (previousTap && previousTap.kind === tappedUnit.kind && now - previousTap.at <= 360) {
              for (const unit of world.units) {
                unit.selected = unit.kind === tappedUnit.kind && unit.hp > 0 && unit.koTimer <= 0;
              }
              lastUnitTapRef.current = null;
            } else {
              lastUnitTapRef.current = { kind: tappedUnit.kind, at: now };
            }
            syncHudImmediate();
          } else {
            lastUnitTapRef.current = null;
          }
          return;
        }
      }

      if (
        touchModeRef.current === 'select' &&
        world.directControlUnitId === null &&
        start &&
        end &&
        canvas
      ) {
        const rect = canvasRectRef.current ?? canvas.getBoundingClientRect();
        const w1 = screenToWorld(world, start.x, start.y, rect.width, rect.height);
        const w2 = screenToWorld(world, end.x, end.y, rect.width, rect.height);
        selectUnitsInRect(world, w1.x, w1.y, w2.x, w2.y, false);
        if (world.units.some((unit) => unit.selected) && settingsRef.current.haptics) triggerHaptic(10);
        syncHudImmediate();
      }
      return;
    }

    if (e.button === 1) {
      panDragRef.current.active = false;
      return;
    }

    if (e.button === 0) {
      inputRef.current.mouseDownLeft = false;
      const start = inputRef.current.dragBoxStartScreen;
      const end = inputRef.current.dragBoxCurrentScreen;
      inputRef.current.dragBoxStartScreen = null;
      inputRef.current.dragBoxCurrentScreen = null;

      if (world.phase === 'playing' && world.directControlUnitId === null && start && end && canvas) {
        const rect = canvasRectRef.current ?? canvas.getBoundingClientRect();
        const w1 = screenToWorld(world, start.x, start.y, rect.width, rect.height);
        const w2 = screenToWorld(world, end.x, end.y, rect.width, rect.height);
        selectUnitsInRect(world, w1.x, w1.y, w2.x, w2.y, e.shiftKey);
        if (world.units.some((unit) => unit.selected) && settingsRef.current.haptics) triggerHaptic(10);
        syncHudImmediate();
      }
    }
  }, [processPointerMove, updateMouseCoords, syncHudImmediate]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const world = worldRef.current;
    if (world.phase !== 'playing') return;
    if (e.shiftKey && (['wall', 'gate', 'wire', 'oil', 'laser', 'electric'].includes(world.placementMode?.kind as string))) {
      rotatePlacement(world, e.deltaY > 0 ? Math.PI / 8 : -Math.PI / 8);
      syncHudImmediate();
      return;
    }
    const { wx, wy } = updateMouseCoords(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    adjustCameraZoom(world, factor, wx, wy);
    syncHudImmediate();
  }, [updateMouseCoords, syncHudImmediate]);

  return (
    <div className="game-root relative w-screen h-[100dvh] min-h-[100dvh] overflow-hidden bg-[#07131e] select-none">
      {/* Isolated Canvas Mount */}
      <div ref={mountRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          data-testid="game-canvas"
          tabIndex={0}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          className="game-canvas block w-full h-full outline-none cursor-crosshair touch-none"
        />
      </div>

      <OfflineIndicator />
      {settings.debugPerformance && hud.phase === 'playing' && <div className="pointer-events-none fixed left-2 top-2 z-[90] rounded bg-black/75 px-2 py-1 font-mono text-[10px] text-emerald-300">{debugStats.fps} FPS · {debugStats.zombies} INF</div>}

      {bootLoading && (
        <div className="iron-tide-boot fixed inset-0 z-[100] flex flex-col items-center justify-center px-8">
          <div className="iron-tide-boot-emblem">
            <img
              src="/iron-tide-logo.png"
              alt="IRON TIDE"
              className="w-full h-full object-contain rounded-2xl"
              draggable={false}
            />
          </div>
          <div className="mt-5 text-center">
            <div className="font-display text-4xl sm:text-5xl font-bold tracking-[0.18em] text-slate-100">IRON TIDE</div>
            <div className="mt-1 text-[10px] sm:text-xs tracking-[0.32em] font-semibold text-sky-300">COASTAL VANGUARD</div>
            <div className="mt-7 text-[10px] tracking-[0.22em] text-slate-400">INITIALIZING TASK FORCE</div>
          </div>
          <div className="iron-tide-loading-track mt-3 w-64 max-w-full"><span /></div>
          <div className="mt-3 text-[9px] tracking-[0.18em] text-slate-500">PREPARING BATTLEFIELD SYSTEMS</div>
        </div>
      )}

      {hud.phase === 'title' && (
        <TitleScreen
          selectedMap={selectedMap}
          selectedScenario={selectedScenario}
          onSelectMap={handleSelectMap}
          onSelectScenario={handleSelectScenario}
          onStart={() => handleStart()}
          onOpenSettings={() => setSettingsOpen(true)}
          selectedMissionId={selectedMissionId}
          unlockedMissionId={unlockedMissionId}
          onSelectMission={handleSelectMission}
          endlessMode={endlessMode}
          onToggleEndless={() => { setEndlessMode((v) => !v); setSelectedMissionId(null); }}
        />
      )}

      {(hud.phase === 'playing' || hud.phase === 'paused') && (
        <GameHud
          hud={hud}
          worldRef={worldRef}
          showMiniMap={showMiniMap}
          muted={muted}
          touchMode={touchMode}
          onSetTouchMode={setTouchMode}
          onToggleMiniMap={handleToggleMiniMap}
          onPanToWorld={handlePanToWorld}
          onDeployUnit={handleDeployUnit}
          onSelectPlacement={handleSelectPlacement}
          onRotatePlacement={handleRotatePlacement}
          onCycleWeather={handleCycleWeather}
          onToggleLowLag={handleToggleLowLag}
          onToggleDirectControl={handleToggleDirectControl}
          onReload={handleReload}
          onRepairVehicles={handleRepairVehicles}
          onToggleBunkerDoor={handleToggleBunkerDoor}
          onToggleOpsZoom={handleToggleOpsZoom}
          onToggleMute={handleToggleMute}
          onPause={handlePauseToggle}
          onRestart={() => handleStart()}
          onFocusSector={handleFocusSector}
          onVirtualMove={handleVirtualMove}
          onVirtualFire={handleVirtualFire}
          onCycleFormation={handleCycleFormation}
          onToggleFog={handleToggleFog}
          onToggleAutoBattleAssist={handleToggleAutoBattleAssist}
        />
      )}

      <StatusModal
        hud={hud}
        onResume={handlePauseToggle}
        onRestart={() => handleStart()}
        onReturnTitle={handleReturnTitle}
        onToggleLowLag={handleToggleLowLag}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {settingsOpen && <SettingsPanel settings={settings} onChange={handleSettingsChange} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default App;
