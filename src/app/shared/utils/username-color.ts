// Bright 400 shades: all pass AA contrast on the dark chat background.
const USERNAME_COLORS = [
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
];

/** A stable colour (hex) for a username, so each user keeps the same one. */
export function usernameColor(name: string): string {
  let hash = 0;
  for (const char of name.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return USERNAME_COLORS[Math.abs(hash) % USERNAME_COLORS.length];
}
