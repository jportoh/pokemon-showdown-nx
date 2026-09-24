// Full class names so Tailwind can detect them. All pass AA contrast on the dark chat background.
const USERNAME_COLORS = [
  'text-pink-400',
  'text-rose-400',
  'text-orange-400',
  'text-amber-400',
  'text-lime-400',
  'text-green-400',
  'text-emerald-400',
  'text-teal-400',
  'text-cyan-400',
  'text-sky-400',
  'text-blue-400',
  'text-indigo-400',
  'text-violet-400',
  'text-purple-400',
  'text-fuchsia-400',
];

/** Returns a stable Tailwind text color class for a username, so each user keeps the same color. */
export function usernameColor(name: string): string {
  let hash = 0;
  for (const char of name.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return USERNAME_COLORS[Math.abs(hash) % USERNAME_COLORS.length];
}
