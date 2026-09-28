// Reading Showdown's client data files (play.pokemonshowdown.com/data/*.js), shared by the update
// scripts. The files are object literals (`exports.X = {id:{…},…}`), not JSON: they're only parsed
// as text, never run.

const DATA_URL = 'https://play.pokemonshowdown.com/data';

export async function download(file) {
  const response = await fetch(`${DATA_URL}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

/** The top-level entries of `exports.X = {id:{…},…}`, as [id, body]. */
export function entries(source) {
  const result = [];
  let i = source.indexOf('{') + 1;
  while (i < source.length) {
    const key = /^\s*,?\s*"?([a-z0-9]+)"?:\{/.exec(source.slice(i, i + 80));
    if (!key) break;
    const open = i + key[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === '"' || char === "'") {
        for (end++; end < source.length && source[end] !== char; end++) if (source[end] === '\\') end++;
      } else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) break;
    }
    result.push([key[1], source.slice(open, end + 1)]);
    i = end + 1;
  }
  return result;
}

/** A quoted string field of an entry's body (`name:"Mr. Mime"`), unescaped; undefined when absent. */
export function stringField(body, field) {
  const value = new RegExp(`[{,]${field}:"((?:[^"\\\\]|\\\\.)*)"`).exec(body)?.[1];
  return value === undefined ? undefined : JSON.parse(`"${value}"`);
}
