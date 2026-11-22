// Procedural adaptive music. No audio files: synthesized with WebAudio.
// Three layers: pad (always), pulse bass (tension), war drums (combat).

type Mood = 'off' | 'menu' | 'calm' | 'combat';

const ROOTS = [55, 49, 58.27, 51.91]; // A1, G1, Bb1, Eb1 - cold, naval minor feel
const PROG = [0, 0, -2, -5]; // semitone shifts per bar

class MusicEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private layers: { pad: GainNode; bass: GainNode; drums: GainNode } | null = null;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private volume = 0.55;
  private mood: Mood = 'off';
  private bpm = 84;
  private noise: AudioBuffer | null = null;

  private ensure(): boolean {
    if (typeof window === 'undefined') return false;
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = 0;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      this.master.connect(lp);
      lp.connect(c.destination);
      const mk = () => {
        const g = c.createGain();
        g.gain.value = 0;
        g.connect(this.master!);
        return g;
      };
      this.layers = { pad: mk(), bass: mk(), drums: mk() };
      const len = Math.floor(c.sampleRate * 0.4);
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
      const resume = () => {
        this.ctx?.resume().catch(() => {});
        window.removeEventListener('pointerdown', resume);
        window.removeEventListener('keydown', resume);
      };
      window.addEventListener('pointerdown', resume);
      window.addEventListener('keydown', resume);
    }
    return true;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyLevels();
  }

  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (mood === 'off') {
      this.applyLevels();
      return;
    }
    if (!this.ensure()) return;
    this.bpm = mood === 'combat' ? 112 : mood === 'menu' ? 72 : 84;
    this.applyLevels();
    this.start();
  }

  private applyLevels(): void {
    if (!this.ctx || !this.master || !this.layers) return;
    const t = this.ctx.currentTime;
    const m = this.mood;
    const target = m === 'off' ? 0 : this.volume * 0.35;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(target, t, 0.6);
    this.layers.pad.gain.setTargetAtTime(m === 'off' ? 0 : 0.9, t, 0.8);
    this.layers.bass.gain.setTargetAtTime(m === 'calm' || m === 'combat' ? 0.8 : 0, t, 0.8);
    this.layers.drums.gain.setTargetAtTime(m === 'combat' ? 0.9 : 0, t, 0.5);
  }

  private start(): void {
    if (this.timer !== null || !this.ctx) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 100);
  }

  stop(): void {
    this.mood = 'off';
    this.applyLevels();
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    const c = this.ctx;
    if (!c) return;
    if (this.mood === 'off' && this.master && this.master.gain.value < 0.001) {
      this.stop();
      return;
    }
    const stepLen = 60 / this.bpm / 2; // eighth notes
    while (this.nextTime < c.currentTime + 0.3) {
      this.playStep(this.step, this.nextTime, stepLen);
      this.nextTime += stepLen;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number, len: number): void {
    const bar = Math.floor(step / 16) % 4;
    const root = ROOTS[0] * Math.pow(2, PROG[bar] / 12);
    const inBar = step % 16;

    if (inBar === 0) this.pad(root * 2, t, len * 16);
    if (inBar === 0) this.pad(root * 2 * 1.189, t, len * 16); // minor third
    if (inBar === 0) this.pad(root * 2 * 1.498, t, len * 16); // fifth

    if (inBar % 2 === 0) this.bassNote(root, t, len * 1.6, inBar % 8 === 0 ? 1 : 0.55);

    if (this.mood === 'combat') {
      if (inBar % 8 === 0) this.drum(t, 55, 0.9, 0.22);
      if (inBar % 8 === 4) this.drum(t, 80, 0.6, 0.16);
      if (inBar % 4 === 2) this.hat(t, 0.25);
      if (inBar === 15) this.hat(t, 0.5);
    }
  }

  private pad(freq: number, t: number, dur: number): void {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(this.layers!.pad);
    for (const det of [-6, 6]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private bassNote(freq: number, t: number, dur: number, vel: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * vel, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.layers!.bass);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private drum(t: number, freq: number, vel: number, dur: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.layers!.drums);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hat(t: number, vel: number): void {
    const c = this.ctx!;
    if (!this.noise) return;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = c.createGain();
    g.gain.setValueAtTime(vel * 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(hp);
    hp.connect(g);
    g.connect(this.layers!.drums);
    s.start(t);
    s.stop(t + 0.06);
  }
}

export const music = new MusicEngine();
