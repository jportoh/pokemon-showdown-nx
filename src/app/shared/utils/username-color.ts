// The same 15 hues twice: bright 400 shades for the dark chat background, deep 700 shades for the light
// one. Each passes AA contrast on its background.
const USERNAME_COLORS: Readonly<Record<'dark' | 'light', readonly string[]>> = {
  dark: [
    '#f472b6', // pink
    '#fb7185', // rose
    '#fb923c', // orange
    '#fbbf24', // amber
    '#a3e635', // lime
    '#4ade80', // green
    '#34d399', // emerald
    '#2dd4bf', // teal
    '#22d3ee', // cyan
    '#38bdf8', // sky
    '#60a5fa', // blue
    '#818cf8', // indigo
    '#a78bfa', // violet
    '#c084fc', // purple
    '#e879f9', // fuchsia
  ],
  light: [
    '#be185d', // pink
    '#be123c', // rose
    '#c2410c', // orange
    '#b45309', // amber
    '#4d7c0f', // lime
    '#15803d', // green
    '#047857', // emerald
    '#0f766e', // teal
    '#0e7490', // cyan
    '#0369a1', // sky
    '#1d4ed8', // blue
    '#4338ca', // indigo
    '#6d28d9', // violet
    '#7e22ce', // purple
    '#a21caf', // fuchsia
  ],
};

/** A stable colour (hex) for a username, so each user keeps the same one (in its light or dark shade). */
export function usernameColor(name: string, light = false): string {
  let hash = 0;
  for (const char of name.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  const colors = USERNAME_COLORS[light ? 'light' : 'dark'];
  return colors[Math.abs(hash) % colors.length];
}
