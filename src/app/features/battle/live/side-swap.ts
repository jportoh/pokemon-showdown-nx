import { BattleRequest } from '@features/battle/models/battle';

// The battle screen shows the player as p1 (own team at the bottom, "Your team", the result from p1's
// side). On Showdown we may be either (a challenger is p1, so after accepting a challenge we're p2, and
// a ladder match can go both ways): these functions swap the two sides in the server's lines so the
// screen sees us as p1.

/** Lines with free text and no side references (chat, HTML), passed through untouched. */
const TEXT_LINES = new Set(['c', 'c:', 'chat', 'raw', 'html', 'uhtml', 'uhtmlchange', 'j', 'l', 'n', 'title', 'inactive', 'inactiveoff']);

/** A side ("p1"), a slot ("p1a") or a Pokémon ("p1a: Garchomp", "p1: Garchomp") at the start of an argument, after an optional tag ("[of] "). */
const SIDE_REF = /^((?:\[[a-z]+\] )?)p([12])(?=[a-d]?(?::|$))/;

const flip = (side: string) => (side === '1' ? '2' : '1');

/** `|switch|p2a: Umbreon|Umbreon, L83|100/100` → `|switch|p1a: Umbreon|Umbreon, L83|100/100`. */
export function swapSidesInLine(line: string): string {
  if (!line.startsWith('|')) return line;
  const parts = line.split('|');
  const type = parts[1];
  if (type === 'request') {
    const json = line.slice('|request|'.length);
    return json ? `|request|${JSON.stringify(swapSidesInRequest(JSON.parse(json) as BattleRequest))}` : line;
  }
  if (TEXT_LINES.has(type)) return line;
  return parts.map((part, index) => (index < 2 ? part : swapArgument(part))).join('|');
}

export function swapSidesInRequest(request: BattleRequest): BattleRequest {
  const side = request.side;
  if (!side) return request;
  return {
    ...request,
    side: {
      ...side,
      id: side.id === 'p1' ? 'p2' : 'p1',
      pokemon: side.pokemon.map((pokemon) => ({ ...pokemon, ident: pokemon.ident.replace(/^p([12])/, (_, n: string) => `p${flip(n)}`) })),
    },
  };
}

function swapArgument(argument: string): string {
  // `[spread] p1a,p1b`: every slot in the list.
  if (argument.startsWith('[spread] ')) {
    const slots = argument.slice('[spread] '.length).split(',');
    return `[spread] ${slots.map((slot) => slot.replace(/^p([12])/, (_, n: string) => `p${flip(n)}`)).join(',')}`;
  }
  return argument.replace(SIDE_REF, (_, tag: string, n: string) => `${tag}p${flip(n)}`);
}
