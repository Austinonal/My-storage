// Voice effects as Web Audio graphs. The same graph runs in the preview (live AudioContext) and in the export
// (OfflineAudioContext), so what you hear is what you get.
import type { Voice } from './schema';

export const VOICES: { id: Voice; name: string }[] = [
  { id: 'high', name: 'เสียงแหลม' },
  { id: 'low', name: 'เสียงทุ้ม' },
  { id: 'robot', name: 'หุ่นยนต์' },
  { id: 'echo', name: 'เสียงก้อง' },
  { id: 'radio', name: 'วิทยุ' },
];

export interface Chain {
  input: AudioNode;
  output: AudioNode;
}

const gain = (ctx: BaseAudioContext, v: number) => {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
};

// Pitch shift without changing speed: two delay lines whose delay ramps up or down (a ramp = a steady pitch change),
// crossfaded so the jump back at the end of each ramp is not heard. ratio > 1 is higher.
function pitchShift(ctx: BaseAudioContext, ratio: number): Chain {
  const rate = ctx.sampleRate;
  const bufferTime = 0.1;
  const fadeTime = 0.05;
  const depth = Math.min(0.09, Math.abs(1 - ratio) * bufferTime); // delay change over one ramp
  const n1 = Math.round(bufferTime * rate);
  const n2 = Math.round((bufferTime - 2 * fadeTime) * rate);
  const ramp = ctx.createBuffer(1, n1 + n2, rate);
  const fade = ctx.createBuffer(1, n1 + n2, rate);
  const r = ramp.getChannelData(0);
  const f = fade.getChannelData(0);
  const fl = fadeTime * rate;
  for (let i = 0; i < n1; i++) {
    r[i] = ratio > 1 ? (n1 - i) / n1 : i / n1; // shorter delay over time = playing faster = higher
    f[i] = i < fl ? Math.sqrt(i / fl) : i >= n1 - fl ? Math.sqrt(1 - (i - (n1 - fl)) / fl) : 1;
  }
  const input = gain(ctx, 1);
  const output = gain(ctx, 2); // the two crossfaded delay lines come out about 6 dB quieter
  const start = (b: AudioBuffer, at: number) => {
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.start(at);
    return s;
  };
  const t0 = ctx.currentTime + 0.05;
  for (const at of [t0, t0 + bufferTime - fadeTime]) {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0;
    const amount = gain(ctx, depth);
    start(ramp, at).connect(amount);
    amount.connect(delay.delayTime);
    const mix = gain(ctx, 0);
    start(fade, at).connect(mix.gain);
    input.connect(delay);
    delay.connect(mix);
    mix.connect(output);
  }
  return { input, output };
}

export function voiceChain(ctx: BaseAudioContext, voice: Voice): Chain {
  if (voice === 'high') return pitchShift(ctx, 1.42);
  if (voice === 'low') return pitchShift(ctx, 0.72);
  const input = gain(ctx, 1);
  const output = gain(ctx, 1);
  if (voice === 'robot') {
    // Ring modulation at 50 Hz plus a short metallic comb; the modulation halves the level, so it is made up.
    output.gain.value = 2;
    const ring = gain(ctx, 0);
    const osc = ctx.createOscillator();
    osc.frequency.value = 50;
    osc.connect(ring.gain);
    osc.start();
    const comb = ctx.createDelay(0.1);
    comb.delayTime.value = 0.008;
    const back = gain(ctx, 0.55);
    input.connect(ring);
    ring.connect(comb);
    comb.connect(back);
    back.connect(comb);
    ring.connect(output);
    comb.connect(gain(ctx, 0.6)).connect(output);
  } else if (voice === 'echo') {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.26;
    const back = gain(ctx, 0.42);
    input.connect(output);
    input.connect(delay);
    delay.connect(back);
    back.connect(delay);
    delay.connect(gain(ctx, 0.6)).connect(output);
  } else {
    // radio: telephone band plus a little drive
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 450;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const drive = ctx.createWaveShaper();
    drive.curve = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh(((i / 1023) * 2 - 1) * 3) / Math.tanh(3));
    input.connect(hp).connect(lp).connect(drive).connect(gain(ctx, 0.9)).connect(output);
  }
  return { input, output };
}
