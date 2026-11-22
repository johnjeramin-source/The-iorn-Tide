import { SimEvent } from './types';


const ORDER_LINES = ['Roger', 'Copy that', 'Moving out', 'On it', 'Affirmative', 'Understood'];
const DEPLOY_LINES = ['Deploying', 'In position', 'Ready', 'Boots on the ground', 'Locked and loaded'];
const ALERT_LINES = ['Contact!', 'Infected incoming!', 'Zombies, left flank!', 'Taking fire!', 'They are everywhere!'];

class TacticalAudio {
  private ctx: AudioContext | null = null;
  private muted = false;
  private soundVolume = 0.75;
  private lastRifleTime = 0;
  private lastZombieVoiceTime = 0;
  private lastRadioVoiceTime = 0;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  setSoundVolume(volume: number): void {
    this.soundVolume = Math.max(0, Math.min(1, volume));
  }

  isMuted(): boolean {
    return this.muted;
  }

  unlock(): void {
    this.ensureContext();
  }

  playEvents(events: SimEvent[]): void {
    if (this.muted || events.length === 0) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    for (const ev of events) {
      switch (ev.type) {
        case 'rifle': {
          if (now - this.lastRifleTime < 0.065) break;
          this.lastRifleTime = now;
          this.playGunshot(ctx, 'rifle', ev.intensity ?? 0.5);
          break;
        }
        case 'heavy_gun': {
          if (now - this.lastRifleTime < 0.045) break;
          this.lastRifleTime = now;
          this.playGunshot(ctx, 'heavy', ev.intensity ?? 0.5);
          break;
        }
        case 'cannon': {
          this.playNoiseBurst(ctx, 0.25, 250, 0.22);
          this.playTone(ctx, 130, 36, 0.26, 'sine', 0.22);
          break;
        }
        case 'naval_salvo': {
          // Massive twin-barrel 406mm battleship broadside
          this.playNoiseBurst(ctx, 0.52, 180, 0.3);
          this.playTone(ctx, 95, 24, 0.55, 'sine', 0.28);
          setTimeout(() => {
            if (!this.muted && this.ctx) {
              this.playNoiseBurst(this.ctx, 0.42, 220, 0.22);
            }
          }, 110);
          break;
        }
        case 'rocket': {
          this.playTone(ctx, 440 + Math.random() * 65, 165, 0.1, 'sawtooth', 0.075);
          break;
        }
        case 'spitter_acid': {
          this.playNoiseBurst(ctx, 0.16, 1800, 0.07);
          this.playTone(ctx, 560, 290, 0.12, 'sawtooth', 0.05);
          break;
        }
        case 'explosion': {
          this.playNoiseBurst(ctx, 0.22, 340, 0.16);
          this.playTone(ctx, 110, 42, 0.22, 'triangle', 0.16);
          break;
        }
        case 'artillery_impact': {
          this.playNoiseBurst(ctx, 0.4, 190, 0.26);
          this.playTone(ctx, 90, 26, 0.42, 'sine', 0.28);
          break;
        }
        case 'thunder': {
          this.playNoiseBurst(ctx, 0.78, 130, 0.18);
          this.playTone(ctx, 68, 28, 0.65, 'sine', 0.14);
          break;
        }
        case 'airstrike': {
          this.playTone(ctx, 160, 115, 0.35, 'sawtooth', 0.14);
          this.playNoiseBurst(ctx, 0.3, 950, 0.12);
          break;
        }
        case 'vehicle_engine': {
          this.playTone(ctx, 62, 88, 0.24, 'sawtooth', 0.065);
          this.playNoiseBurst(ctx, 0.2, 220, 0.05);
          break;
        }
        case 'heli_blades': {
          for (let b = 0; b < 4; b++) {
            setTimeout(() => {
              if (!this.muted && this.ctx) {
                this.playNoiseBurst(this.ctx, 0.05, 320, 0.07);
              }
            }, b * 55);
          }
          break;
        }
        case 'voice_order': {
          if (now - this.lastRadioVoiceTime < 0.35) break;
          this.lastRadioVoiceTime = now;
          if (!this.speak(ORDER_LINES)) this.playRadioVoice(ctx, [175, 215, 195], 0.07);
          break;
        }
        case 'voice_deploy': {
          if (now - this.lastRadioVoiceTime < 0.35) break;
          this.lastRadioVoiceTime = now;
          if (!this.speak(DEPLOY_LINES)) this.playRadioVoice(ctx, [160, 190, 235], 0.085);
          break;
        }
        case 'voice_alert': {
          if (now - this.lastRadioVoiceTime < 0.4) break;
          this.lastRadioVoiceTime = now;
          if (!this.speak(ALERT_LINES)) this.playRadioVoice(ctx, [240, 200, 165], 0.09);
          break;
        }
        case 'zombie_groan': {
          if (now - this.lastZombieVoiceTime < 0.45) break;
          this.lastZombieVoiceTime = now;
          this.playZombieVoice(ctx, 'groan');
          break;
        }
        case 'zombie_screech': {
          if (now - this.lastZombieVoiceTime < 0.4) break;
          this.lastZombieVoiceTime = now;
          this.playZombieVoice(ctx, 'screech');
          break;
        }
        case 'brute_roar': {
          if (now - this.lastZombieVoiceTime < 0.5) break;
          this.lastZombieVoiceTime = now;
          this.playZombieVoice(ctx, 'roar');
          break;
        }
        case 'order': {
          this.playTone(ctx, 640, 780, 0.055, 'sine', 0.075);
          break;
        }
        case 'build': {
          this.playTone(ctx, 320, 480, 0.09, 'square', 0.06);
          break;
        }
        case 'gate_open': {
          this.playTone(ctx, 145, 220, 0.28, 'sawtooth', 0.07);
          this.playNoiseBurst(ctx, 0.18, 95, 0.045);
          break;
        }
        case 'gate_close': {
          this.playTone(ctx, 210, 115, 0.24, 'triangle', 0.065);
          this.playNoiseBurst(ctx, 0.12, 70, 0.035);
          break;
        }
        case 'supply': {
          this.playTone(ctx, 440, 660, 0.12, 'triangle', 0.08);
          break;
        }
        case 'sector_captured': {
          this.playTone(ctx, 523.25, 523.25, 0.12, 'triangle', 0.12);
          setTimeout(() => this.playTone(ctx, 659.25, 659.25, 0.16, 'triangle', 0.12), 90);
          setTimeout(() => this.playTone(ctx, 783.99, 783.99, 0.25, 'triangle', 0.14), 180);
          break;
        }
        case 'unit_lost': {
          this.playTone(ctx, 220, 110, 0.25, 'sawtooth', 0.12);
          break;
        }
        case 'victory': {
          this.playTone(ctx, 523.25, 523.25, 0.18, 'triangle', 0.14);
          setTimeout(() => this.playTone(ctx, 659.25, 659.25, 0.18, 'triangle', 0.14), 120);
          setTimeout(() => this.playTone(ctx, 783.99, 783.99, 0.32, 'triangle', 0.16), 240);
          break;
        }
        case 'defeat': {
          this.playTone(ctx, 260, 140, 0.35, 'sawtooth', 0.16);
          setTimeout(() => this.playTone(ctx, 140, 75, 0.45, 'sawtooth', 0.16), 240);
          break;
        }
      }
    }
  }


  // ---------- Realistic gunfire: noise crack + body + low thump + room tail ----------
  private bus: AudioNode | null = null;
  private reverb: ConvolverNode | null = null;

  private getBus(ctx: AudioContext): AudioNode {
    if (this.bus) return this.bus;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    comp.connect(ctx.destination);

    // Synthetic outdoor-room impulse: decaying noise, brighter early / darker late
    const len = Math.floor(ctx.sampleRate * 1.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const k = 0.15 + 0.8 * t;
        lp += ((Math.random() * 2 - 1) - lp) * (1 - k);
        d[i] = lp * Math.pow(1 - t, 3.2);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    conv.connect(wet);
    wet.connect(comp);
    this.reverb = conv;
    this.bus = comp;
    return comp;
  }

  private noiseBuffer(ctx: AudioContext, duration: number, decayPow: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decayPow);
    }
    return buf;
  }

  private playGunshot(ctx: AudioContext, kind: 'rifle' | 'heavy', intensity: number): void {
    const bus = this.getBus(ctx);
    const now = ctx.currentTime;
    const heavy = kind === 'heavy';
    const vol = (heavy ? 0.5 : 0.4) * (0.75 + Math.min(1, intensity) * 0.5);
    const jitter = 0.92 + Math.random() * 0.16;

    const out = ctx.createGain();
    out.gain.value = vol;
    let node: AudioNode = out;
    if (typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      pan.pan.value = (Math.random() * 2 - 1) * 0.45;
      out.connect(pan);
      node = pan;
    }
    node.connect(bus);
    if (this.reverb) {
      const send = ctx.createGain();
      send.gain.value = heavy ? 0.5 : 0.38;
      node.connect(send);
      send.connect(this.reverb);
    }

    // 1) Supersonic crack - very short bright noise transient
    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer(ctx, 0.035, 4);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1700 * jitter;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(1.0, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    crack.connect(hp);
    hp.connect(crackGain);
    crackGain.connect(out);
    crack.start(now);

    // 2) Muzzle blast body - band-limited noise that sweeps down
    const bodyDur = heavy ? 0.16 : 0.11;
    const body = ctx.createBufferSource();
    body.buffer = this.noiseBuffer(ctx, bodyDur, 2.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime((heavy ? 1700 : 2400) * jitter, now);
    bp.frequency.exponentialRampToValueAtTime(260, now + bodyDur);
    bp.Q.value = 0.9;
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.9, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + bodyDur);
    body.connect(bp);
    bp.connect(bodyGain);
    bodyGain.connect(out);
    body.start(now);

    // 3) Low thump - chest-hit punch
    const thump = ctx.createOscillator();
    const tg = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime((heavy ? 120 : 160) * jitter, now);
    thump.frequency.exponentialRampToValueAtTime(40, now + 0.09);
    tg.gain.setValueAtTime(heavy ? 0.9 : 0.6, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    thump.connect(tg);
    tg.connect(out);
    thump.start(now);
    thump.stop(now + 0.12);

    // 4) Mechanical action click right after the shot
    if (!heavy && Math.random() < 0.5) {
      const click = ctx.createBufferSource();
      click.buffer = this.noiseBuffer(ctx, 0.012, 3);
      const cbp = ctx.createBiquadFilter();
      cbp.type = 'bandpass';
      cbp.frequency.value = 3200;
      cbp.Q.value = 2;
      const cg = ctx.createGain();
      cg.gain.value = 0.12;
      click.connect(cbp);
      cbp.connect(cg);
      cg.connect(out);
      click.start(now + 0.045);
    }
  }

  // ---------- Soldier radio barks via device speech engine ----------
  private lastSpoken = '';

  private speak(lines: string[]): boolean {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
    try {
      const synth = window.speechSynthesis;
      if (synth.speaking || synth.pending) return true; // don't pile up barks
      let line = lines[Math.floor(Math.random() * lines.length)];
      if (line === this.lastSpoken) line = lines[(lines.indexOf(line) + 1) % lines.length];
      this.lastSpoken = line;
      const u = new SpeechSynthesisUtterance(line);
      const voices = synth.getVoices();
      const en = voices.find((v) => /en[-_](US|GB)/i.test(v.lang) && /male|david|daniel|google uk english male/i.test(v.name))
        ?? voices.find((v) => /^en/i.test(v.lang));
      if (en) u.voice = en;
      u.rate = 1.18;
      u.pitch = 0.62;
      u.volume = 0.55 * this.soundVolume;
      synth.speak(u);
      return true;
    } catch {
      return false;
    }
  }

  // ---------- Zombie vocals: vibrato + distortion + breath noise ----------
  private playZombieVoice(ctx: AudioContext, kind: 'groan' | 'screech' | 'roar'): void {
    const now = ctx.currentTime;
    const cfg = {
      groan: { f0: 95 + Math.random() * 30, f1: 62, dur: 0.7, formant: 520, vol: 0.2, vib: 5.5 },
      screech: { f0: 420 + Math.random() * 90, f1: 260, dur: 0.45, formant: 1500, vol: 0.16, vib: 11 },
      roar: { f0: 78, f1: 40, dur: 1.0, formant: 340, vol: 0.32, vib: 7 },
    }[kind];

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(cfg.f0, now);
    osc.frequency.exponentialRampToValueAtTime(cfg.f1, now + cfg.dur);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = cfg.vib;
    lfoGain.gain.value = cfg.f0 * 0.06;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    shaper.curve = curve;

    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.setValueAtTime(cfg.formant, now);
    f1.frequency.linearRampToValueAtTime(cfg.formant * 0.7, now + cfg.dur);
    f1.Q.value = 2.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(cfg.vol, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + cfg.dur);

    osc.connect(shaper);
    shaper.connect(f1);
    f1.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    lfo.start(now);
    osc.stop(now + cfg.dur + 0.02);
    lfo.stop(now + cfg.dur + 0.02);

    // wet breath / rasp layer
    const breath = ctx.createBufferSource();
    breath.buffer = this.noiseBuffer(ctx, cfg.dur, 1.4);
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = cfg.formant * 2.2;
    bf.Q.value = 1.1;
    const bg = ctx.createGain();
    bg.gain.value = cfg.vol * 0.55;
    breath.connect(bf);
    bf.connect(bg);
    bg.connect(ctx.destination);
    breath.start(now);
  }

  private playRadioVoice(ctx: AudioContext, pitches: number[], volume: number): void {
    // Walkie-talkie squelch open click
    this.playNoiseBurst(ctx, 0.035, 2200, volume * 0.6);
    pitches.forEach((f, idx) => {
      setTimeout(() => {
        if (!this.muted && this.ctx) {
          this.playFormantGrowl(this.ctx, f, f * 0.94, 0.075, 1150, volume * 0.75);
        }
      }, 30 + idx * 70);
    });
    // Closing squelch tail
    setTimeout(() => {
      if (!this.muted && this.ctx) {
        this.playNoiseBurst(this.ctx, 0.03, 1800, volume * 0.45);
      }
    }, 35 + pitches.length * 70);
  }

  private playFormantGrowl(
    ctx: AudioContext,
    startFreq: number,
    endFreq: number,
    duration: number,
    formantHz: number,
    volume: number,
  ): void {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);

    filter.type = 'bandpass';
    filter.frequency.value = formantHz;
    filter.Q.value = 3.2;

    gain.gain.setValueAtTime(volume * this.soundVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  private playTone(
    ctx: AudioContext,
    startFreq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
  ): void {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    gain.gain.setValueAtTime(volume * this.soundVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  private playNoiseBurst(
    ctx: AudioContext,
    duration: number,
    cutoffHz: number,
    volume: number,
  ): void {
    const sampleRate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoffHz;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(volume * this.soundVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
  }
}

export const audio = new TacticalAudio();
