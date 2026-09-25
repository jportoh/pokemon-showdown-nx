/** Showdown's ID for users, rooms, species, moves…: lowercase letters and digits only. */
export function toId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
