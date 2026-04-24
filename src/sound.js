// Spectrum 48K beeper-style sound engine.  The original Cyclone pokes
// port $FE one bit at a time — square-wave, single channel, audible around
// 100 Hz-4 kHz.  We reproduce that timbre with Web Audio square oscillators
// and short one-shot envelopes.

const noteFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);

class Beeper {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.rotorOn = false;
    this.rotor = null;
    this.wind  = null;
    this.windGain = null;
    this.enabled = true;
  }

  _ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.18;
    this.master.connect(this.ctx.destination);
  }

  // Call from a user-gesture handler.
  resume() {
    this._ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) { this.enabled = on; if (!on) this.rotorStop(); }

  _playSquare(freq, dur, gain = 0.22, attack = 0.004, release = 0.03) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setValueAtTime(gain, t0 + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _playSweep(f1, f2, dur, gain = 0.22) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(f1, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // -------- One-shot events --------------------------------------
  pickup()    { this._playSweep(900, 2200, 0.12, 0.20); }
  deliver()   { this._playSweep(440, 1760, 0.35, 0.22); this._playSquare(1320, 0.08, 0.18, 0.0, 0.04); }
  rescue()    { this._playSquare(880, 0.06); setTimeout(()=>this._playSquare(1320, 0.08), 80); }
  warn()      { this._playSquare(220, 0.08, 0.22); }
  lowFuel()   { this._playSweep(440, 180, 0.18, 0.22); }
  crash()     { this._playSweep(800, 60, 0.8, 0.28); }
  gameOver()  { this._playSquare(330, 0.3); setTimeout(()=>this._playSquare(262, 0.3), 280); setTimeout(()=>this._playSquare(220, 0.6), 560); }
  win()       { const ns = [60, 64, 67, 72]; ns.forEach((n,i)=>setTimeout(()=>this._playSquare(noteFreq(n), 0.16), i*160)); }
  noFuel()    { this._playSquare(180, 0.5, 0.24); }
  warnHi()    { this._playSquare(1200, 0.04, 0.18); }
  leave()     { this._playSquare(200, 0.08, 0.22); setTimeout(()=>this._playSquare(160, 0.08, 0.22), 100); }

  // -------- Continuous rotor loop --------------------------------
  // The chopping sound is made by amplitude-modulating a square carrier
  // at the rotor rate (~38 RPM * 2 blades → ~50 Hz chop).
  rotorStart() {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx || this.rotorOn) return;
    const ctx = this.ctx;
    const car = ctx.createOscillator();
    car.type = 'square'; car.frequency.value = 120;
    const mod = ctx.createOscillator();
    mod.type = 'sine'; mod.frequency.value = 18;
    const modGain = ctx.createGain(); modGain.gain.value = 0.45;
    mod.connect(modGain);
    const carGain = ctx.createGain(); carGain.gain.value = 0.5;
    modGain.connect(carGain.gain);
    car.connect(carGain);
    const out = ctx.createGain(); out.gain.value = 0.08;
    carGain.connect(out); out.connect(this.master);
    car.start(); mod.start();
    this.rotor = { car, mod, out };
    this.rotorOn = true;
  }
  rotorStop() {
    if (!this.rotorOn) return;
    const r = this.rotor;
    const t0 = this.ctx.currentTime;
    r.out.gain.setValueAtTime(r.out.gain.value, t0);
    r.out.gain.linearRampToValueAtTime(0, t0 + 0.1);
    setTimeout(() => { try { r.car.stop(); r.mod.stop(); } catch (e) {} }, 200);
    this.rotor = null; this.rotorOn = false;
  }
  // Collective effort changes pitch of the rotor slightly
  rotorSet(throttle01) {
    if (!this.rotorOn) return;
    const freq = 100 + throttle01 * 60;
    this.rotor.car.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
  }

  // -------- Wind drone (cyclone proximity) -----------------------
  windSet(level01) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    if (level01 <= 0.05) {
      if (this.wind) { this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); }
      return;
    }
    if (!this.wind) {
      // pink-noise-ish: two detuned sawtooths + a lowpass
      const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 58;
      const o2 = this.ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 71;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.6;
      const g = this.ctx.createGain(); g.gain.value = 0;
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.master);
      o1.start(); o2.start();
      this.wind = { o1, o2, lp }; this.windGain = g;
    }
    const target = Math.min(0.25, 0.05 + level01 * 0.22);
    this.windGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
  }
}

export const sound = new Beeper();

// Resume audio on first user interaction (browser requirement).
const resumer = () => { sound.resume(); window.removeEventListener('pointerdown', resumer); window.removeEventListener('keydown', resumer); };
window.addEventListener('pointerdown', resumer);
window.addEventListener('keydown', resumer);
