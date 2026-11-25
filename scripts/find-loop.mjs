// Finds where a piece of game music loops, for scripts/update-soundtracks.mjs (sources without loop points).
//
// Rips of game music usually play the loop twice and fade out: an intro, the loop, the loop again and
// a fade. The loop's length is the lag at which the music repeats itself (the best normalized
// autocorrelation, over the whole file at COARSE_RATE, then refined to the sample), and the loop starts
// where that repeat begins (the first stretch of windows that match the ones a loop later). Lossy files
// never repeat exactly, so a window matches when it correlates with the later one at least MATCH.

/** Loops shorter than this aren't looked for: a bar or a phrase that repeats isn't the loop. */
const MIN_LOOP_S = 8;
/** At least this much of the file must repeat at the lag. */
const MIN_OVERLAP_S = 3;
/** Below this normalized autocorrelation at its best lag, nothing repeats (the file is one loop, or none). */
const MIN_SCORE = 0.5;
/** The lag is looked for at about this rate first. */
const COARSE_RATE = 4000;
/** The repeat is checked in windows this long. */
const WINDOW_S = 0.1;
/** A window matches the one a loop later when they correlate at least this much. */
const MATCH = 0.9;
/** The repeat must hold this long where the loop starts (quiet windows don't count). */
const MIN_RUN_S = 2;
/** A window this much quieter than the file's average (power) is silence: it neither matches nor breaks a match. */
const QUIET = 0.001;

/**
 * Where mono `samples` at `rate` Hz loop, in samples: `start`, and `end` = start + the loop's length
 * (where the music goes on as it did at `start`). `match` is the share of the loop's windows that
 * repeat, `checked` how many seconds of it the file lets check (a rip that stops early checks less).
 * Null when nothing repeats.
 */
export function findLoop(samples, rate) {
  const factor = Math.max(1, Math.round(rate / COARSE_RATE));
  const coarse = downsample(samples, factor);
  const coarseLag = bestLag(coarse, rate / factor);
  if (!coarseLag) return null;
  const window = Math.round(WINDOW_S * rate);
  const power = meanPower(samples);
  // Where the repeat holds roughly (the coarse lag is off by up to `factor` samples), then the lag that
  // correlates best there, sample by sample.
  const rough = windowMatches(samples, coarseLag * factor, window, power, 0.7);
  const span = longestRun(rough);
  if (!span) return null;
  const middle = Math.round(((span.from + span.to) / 2) * window);
  const half = Math.min(Math.round(5 * rate), Math.round(((span.to - span.from) * window) / 2));
  const lag = refineLag(samples, coarseLag * factor, factor + 2, middle - half, middle + half);
  // The loop starts at the first stretch that repeats: the intro ends there.
  const matches = windowMatches(samples, lag, window, power, MATCH);
  const minRun = Math.ceil(MIN_RUN_S / WINDOW_S);
  let first = -1;
  for (let i = 0, run = 0, runStart = -1; i < matches.length; i++) {
    if (matches[i] === 0) {
      run = 0;
      runStart = -1;
      continue;
    }
    if (matches[i] === 1) {
      if (runStart < 0) runStart = i;
      if (++run >= minRun) {
        first = runStart;
        break;
      }
    }
  }
  if (first < 0) return null;
  const start = first * window;
  // How much of the loop the file lets check (the second time through stops where the file does).
  const last = Math.min(first + Math.floor(lag / window), matches.length);
  let loud = 0;
  let matching = 0;
  for (let i = first; i < last; i++) {
    if (matches[i] < 0) continue;
    loud++;
    if (matches[i] === 1) matching++;
  }
  return { start, end: start + lag, match: loud ? matching / loud : 0, checked: ((last - first) * window) / rate };
}

/** The lag (in `x`'s samples) at which `x` repeats itself best, or null. */
function bestLag(x, rate) {
  const n = x.length;
  const minLag = Math.round(MIN_LOOP_S * rate);
  const maxLag = n - Math.round(MIN_OVERLAP_S * rate);
  if (maxLag <= minLag) return null;
  const r = autocorrelation(x);
  const energy = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) energy[i + 1] = energy[i] + x[i] * x[i];
  const power = energy[n] / n;
  let best = 0;
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const overlap = n - lag;
    const head = energy[overlap];
    const tail = energy[n] - energy[lag];
    // A quiet overlap (a fade, silence) says nothing.
    if (head < 0.05 * power * overlap || tail < 0.05 * power * overlap) continue;
    const score = r[lag] / Math.sqrt(head * tail);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return bestScore >= MIN_SCORE ? best : null;
}

/** The lag within `radius` of `lag` that correlates [from, to) best with the samples a lag later. */
function refineLag(x, lag, radius, from, to) {
  from = Math.max(0, from);
  let best = lag;
  let bestScore = -Infinity;
  for (let l = lag - radius; l <= lag + radius; l++) {
    const end = Math.min(to, x.length - l);
    let sum = 0;
    let a = 0;
    let b = 0;
    for (let t = from; t < end; t++) {
      sum += x[t] * x[t + l];
      a += x[t] * x[t];
      b += x[t + l] * x[t + l];
    }
    const score = a && b ? sum / Math.sqrt(a * b) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }
  return best;
}

/** For each window of `x`: 1 if it correlates with the one `lag` later at least `threshold`, 0 if not, -1 if both are quiet. */
function windowMatches(x, lag, window, power, threshold) {
  const count = Math.max(0, Math.floor((x.length - lag) / window));
  const out = new Int8Array(count);
  const quiet = QUIET * power * window;
  for (let w = 0; w < count; w++) {
    let sum = 0;
    let a = 0;
    let b = 0;
    for (let t = w * window, end = t + window; t < end; t++) {
      sum += x[t] * x[t + lag];
      a += x[t] * x[t];
      b += x[t + lag] * x[t + lag];
    }
    if (a < quiet && b < quiet) out[w] = -1;
    else out[w] = a && b && sum / Math.sqrt(a * b) >= threshold ? 1 : 0;
  }
  return out;
}

/** The longest stretch of windows that match (quiet ones included), as window indices [from, to). */
function longestRun(matches) {
  let best = null;
  for (let i = 0, from = -1; i <= matches.length; i++) {
    if (i < matches.length && matches[i] !== 0) {
      if (from < 0) from = i;
      continue;
    }
    if (from >= 0 && (!best || i - from > best.to - best.from)) best = { from, to: i };
    from = -1;
  }
  return best;
}

function meanPower(x) {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return sum / Math.max(1, x.length);
}

/** `x` at a `factor`th of its rate: each sample the average of `factor`. */
function downsample(x, factor) {
  if (factor === 1) return Float64Array.from(x);
  const out = new Float64Array(Math.floor(x.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = i * factor; j < (i + 1) * factor; j++) sum += x[j];
    out[i] = sum / factor;
  }
  return out;
}

/** Σ x[t]·x[t+lag] for every lag, through an FFT (padded to twice the length, so nothing wraps around). */
function autocorrelation(x) {
  let size = 1;
  while (size < 2 * x.length) size *= 2;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(x);
  fft(re, im, false);
  for (let i = 0; i < size; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im, true);
  for (let i = 0; i < size; i++) re[i] /= size;
  return re;
}

/** In-place radix-2 FFT (`inverse`: unscaled). */
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = (inverse ? 1 : -1) * Math.sin((2 * Math.PI * k) / n);
  }
  for (let len = 2; len <= n; len *= 2) {
    const half = len / 2;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const wr = cos[k * step];
        const wi = sin[k * step];
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}
