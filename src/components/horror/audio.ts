/**
 * 공포게임 효과음. 음원 파일 없이 Web Audio 로 그 자리에서 합성한다.
 * AudioContext 는 사용자가 "시작"을 누른 순간(사용자 제스처)에 만들어야 소리가 난다.
 */
export class HorrorAudio {
  private ctx: AudioContext;
  private master: GainNode;
  private noise: AudioBuffer;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  resume() {
    return this.ctx.resume();
  }

  suspend() {
    return this.ctx.suspend();
  }

  close() {
    return this.ctx.close();
  }

  setMuted(muted: boolean) {
    this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** 낮게 웅웅거리는 배경음 + 방 잡음. 계속 깔린다 */
  private startAmbience() {
    const { ctx } = this;
    const bus = ctx.createGain();
    bus.gain.value = 0.07;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 320;
    lowpass.connect(bus).connect(this.master);

    for (const [freq, type, level] of [
      [49, "sine", 1],
      [49.6, "sine", 1],
      [98.3, "triangle", 0.35],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(lowpass);
      osc.start();
    }

    // 천천히 커졌다 작아지는 울렁임
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.03;
    lfo.connect(lfoDepth).connect(bus.gain);
    lfo.start();

    const hiss = this.noiseSource(true);
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = "lowpass";
    hissFilter.frequency.value = 500;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.012;
    hiss.connect(hissFilter).connect(hissGain).connect(this.master);
    hiss.start();
  }

  private noiseSource(loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    return src;
  }

  /** 짧은 소리 하나: 시작 음량 → 0 으로 감쇠 */
  private envelope(peak: number, attack: number, release: number, at = this.ctx.currentTime) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
    return g;
  }

  step() {
    const { ctx } = this;
    const src = this.noiseSource();
    src.playbackRate.value = 0.7 + Math.random() * 0.3;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 700 + Math.random() * 300;
    band.Q.value = 0.8;
    const env = this.envelope(0.14, 0.005, 0.09);
    src.connect(band).connect(env).connect(this.master);
    src.start(ctx.currentTime, Math.random(), 0.12);
  }

  /** 전등이 꺼질 때 "턱" */
  clunk() {
    const { ctx } = this;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const env = this.envelope(0.35, 0.004, 0.3, t);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.4);

    const src = this.noiseSource();
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 900;
    const nEnv = this.envelope(0.18, 0.002, 0.08, t);
    src.connect(low).connect(nEnv).connect(this.master);
    src.start(t, 0, 0.12);
  }

  /** 문고리를 덜컥거리는 소리 */
  rattle() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const src = this.noiseSource();
      const band = this.ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1800 + Math.random() * 600;
      band.Q.value = 3;
      const at = t + i * 0.13 + Math.random() * 0.03;
      const env = this.envelope(0.25, 0.003, 0.07, at);
      src.connect(band).connect(env).connect(this.master);
      src.start(at, Math.random(), 0.1);
    }
  }

  /** 녹슨 경첩이 끼익 하는 소리. 빠른 톱니파 펄스를 좁은 대역으로 걸러 삐걱임을 만든다 */
  creak(length = 0.9) {
    const { ctx } = this;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(34 + Math.random() * 8, t);
    osc.frequency.linearRampToValueAtTime(68, t + length * 0.4);
    osc.frequency.linearRampToValueAtTime(42, t + length);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 7;
    band.frequency.setValueAtTime(950, t);
    band.frequency.linearRampToValueAtTime(1500, t + length * 0.6);
    const env = this.envelope(0.22, 0.06, length, t);
    osc.connect(band).connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + length + 0.1);
  }

  /** 문이 닫히며 문틀에 부딪히는 소리. level 을 키우면 쾅 */
  thud(level = 0.3) {
    const { ctx } = this;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const env = this.envelope(level, 0.003, 0.22 + level * 0.4, t);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.3);

    const src = this.noiseSource();
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 1400;
    const nEnv = this.envelope(level * 0.75, 0.002, 0.06, t);
    src.connect(low).connect(nEnv).connect(this.master);
    src.start(t, Math.random(), 0.1);
  }

  /** 열쇠를 집을 때 짤랑 */
  pickup() {
    const t = this.ctx.currentTime;
    [2350, 3100, 2700].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.frequency.value = f + Math.random() * 80;
      const at = t + i * 0.06;
      const env = this.envelope(0.07, 0.003, 0.25, at);
      osc.connect(env).connect(this.master);
      osc.start(at);
      osc.stop(at + 0.3);
    });
  }

  /** 자물쇠가 철컥 풀리는 소리 */
  unlock() {
    const { ctx } = this;
    const t = ctx.currentTime;
    for (const [at, f] of [
      [0, 2600],
      [0.12, 1700],
    ] as const) {
      const src = this.noiseSource();
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = f;
      band.Q.value = 4;
      const env = this.envelope(0.3, 0.002, 0.05, t + at);
      src.connect(band).connect(env).connect(this.master);
      src.start(t + at, Math.random(), 0.08);
    }
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(180, t + 0.12);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.25);
    const env = this.envelope(0.2, 0.003, 0.15, t + 0.12);
    osc.connect(env).connect(this.master);
    osc.start(t + 0.12);
    osc.stop(t + 0.35);
  }

  /** 무언가를 봤을 때: 낮게 차오르는 불협화음 */
  stinger() {
    const { ctx } = this;
    const t = ctx.currentTime;
    const bus = this.envelope(0.16, 0.25, 1.6, t);
    bus.connect(this.master);
    for (const f of [146.8, 155.6, 220.5]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.linearRampToValueAtTime(f * 1.06, t + 1.8);
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.setValueAtTime(300, t);
      low.frequency.exponentialRampToValueAtTime(2200, t + 1.2);
      osc.connect(low).connect(bus);
      osc.start(t);
      osc.stop(t + 2);
    }
  }

  /** 등 뒤에서 들리는 속삭임. pan: -1 왼쪽 ~ 1 오른쪽 */
  whisper(pan = 0) {
    const { ctx } = this;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2600;
    band.Q.value = 3;
    // 말소리처럼 들리게 음량을 빠르게 흔든다
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(am.gain);
    const env = this.envelope(0.22, 0.4, 1.8, t);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(band).connect(am).connect(env).connect(panner).connect(this.master);
    src.start(t, 0, 2.4);
    lfo.start(t);
    lfo.stop(t + 2.4);
  }

  /** 점프스케어 비명 */
  scream() {
    const { ctx } = this;
    const t = ctx.currentTime;
    const bus = this.envelope(0.4, 0.01, 1.3, t);
    const comp = ctx.createDynamicsCompressor();
    bus.connect(comp).connect(this.master);
    for (const f of [520, 553, 790, 1180]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + 1.3);
      osc.connect(bus);
      osc.start(t);
      osc.stop(t + 1.4);
    }
    const src = this.noiseSource();
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 1200;
    src.connect(high).connect(bus);
    src.start(t, 0, 1.4);
  }
}
