// The stage's backdrop shader, with no dependencies: GlRenderer draws every screen on it, and the
// update gate (native/loader/gate-screen.ts) too, before the app has started.

export const BACKDROP_VERTEX = `
attribute vec2 a_pos;
varying vec2 v_pos;
void main() {
  v_pos = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** The stage's background: a grid of small dots (the band colour, a darker base on light), darker at the edges. */
export const BACKDROP_FRAGMENT = `
precision mediump float;
uniform float u_time;
uniform vec3 u_base;
uniform vec3 u_band;
uniform vec2 u_res;
varying vec2 v_pos;
void main() {
  vec2 px = (v_pos * 0.5 + 0.5) * u_res;
  // A dot every 24 stage pixels, 1.3 px across its radius, its edge antialiased.
  float dist = length(fract(px / 24.0) - 0.5) * 24.0;
  float spot = clamp(1.8 - dist, 0.0, 1.0);
  // On a light base the band colour is about as light: the dots are a darker shade of the base instead.
  float light = step(0.45, dot(u_base, vec3(0.2126, 0.7152, 0.0722)));
  vec3 ink = mix(u_band, u_base * 0.84, light);
  vec3 color = mix(u_base, ink, spot * 0.9);
  // Dark edges on a dark base; barely any on a light one (they'd turn it grey).
  float strength = mix(0.35, 0.08, dot(u_base, vec3(0.2126, 0.7152, 0.0722)));
  float vignette = 1.0 - strength * length(v_pos * vec2(0.8, 1.0));
  gl_FragColor = vec4(color * vignette, 1.0);
}`;
