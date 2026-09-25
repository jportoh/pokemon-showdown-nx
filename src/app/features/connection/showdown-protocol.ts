/**
 * One message from the server: a room and its protocol lines.
 * See https://github.com/smogon/pokemon-showdown/blob/master/PROTOCOL.md
 */
export interface ProtocolFrame {
  /** Room the lines belong to. Frames without a `>roomid` first line are for the lobby. */
  roomId: string;
  lines: string[];
}

export const LOBBY_ROOM_ID = 'lobby';

export function parseFrame(data: string): ProtocolFrame {
  const lines = data.split('\n');
  let roomId = LOBBY_ROOM_ID;
  if (lines[0]?.startsWith('>')) {
    roomId = lines.shift()!.slice(1).trim() || LOBBY_ROOM_ID;
  }
  return { roomId, lines: lines.filter((line) => line.length > 0) };
}

/**
 * Splits a `|type|arg1|arg2…` line. The last argument keeps any `|` it contains when `argCount`
 * is given, since chat messages can include pipes: `splitLine('|c|user|a|b', 2)` → `['c', 'user', 'a|b']`.
 * Lines without a leading `|` are plain text and come back as `['', line]`.
 */
export function splitLine(line: string, argCount?: number): string[] {
  if (!line.startsWith('|')) return ['', line];
  const parts = line.slice(1).split('|');
  if (argCount === undefined || parts.length <= argCount + 1) return parts;
  return [...parts.slice(0, argCount), parts.slice(argCount).join('|')];
}
