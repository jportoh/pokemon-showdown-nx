import { Service, inject } from '@angular/core';
import { Field, Generations, Move, Pokemon, Result, Side, calculate, toID } from '@smogon/calc';
import { getFinalSpeed } from '@smogon/calc/dist/mechanics/util';
import { ChampionsDex } from '@core/dex/champions-dex';
import { PokemonSet } from '@features/teambuilder/models/team';
import { toId } from '@shared/utils/to-id';

/** @smogon/calc's Champions mechanics (its "generation 0"): stat points instead of EVs, level 50. */
const GEN = Generations.get(0);
const LEVEL = 50;

export type CalcWeather = 'Sun' | 'Rain' | 'Sand' | 'Snow';
export type CalcTerrain = 'Electric' | 'Grassy' | 'Psychic' | 'Misty';
/** 'auto': whatever the two Pokémon's abilities set up (Drizzle, Grassy Surge…). */
export type WeatherChoice = CalcWeather | 'none' | 'auto';
export type TerrainChoice = CalcTerrain | 'none' | 'auto';

export interface CalcBoosts {
  atk: number;
  spa: number;
  def: number;
  spd: number;
}

/** One side of the field: its screens, its partner's help, its Pokémon's stat stages and HP left. */
export interface CalcSide {
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  friendGuard: boolean;
  helpingHand: boolean;
  tailwind: boolean;
  boosts: CalcBoosts;
  /** Percent of its HP left, 1 to 100. */
  hp: number;
}

export interface CalcField {
  doubles: boolean;
  weather: WeatherChoice;
  terrain: TerrainChoice;
  crit: boolean;
  /** The slower Pokémon moves first. */
  trickRoom: boolean;
  yours: CalcSide;
  rival: CalcSide;
}

/** What a move does to the target. */
export interface MoveCalc {
  move: string;
  type: string;
  category: string;
  /** 'status': no damage to calc; 'immune': it doesn't affect the target; 'unknown': not in the calc's data. */
  kind: 'damage' | 'status' | 'immune' | 'unknown';
  min: number;
  max: number;
  /** Of the target's maximum HP. */
  minPercent: number;
  maxPercent: number;
  /** How many hits it takes (1 = OHKO; 0 = no KO the calc can tell), and how likely in that many. */
  hits: number;
  chance: number;
  /** "guaranteed 2HKO after Sitrus Berry recovery" */
  koText: string;
  /** Showdown's line: "32 Atk Life Orb Garchomp Earthquake vs. 32 HP / 14 Def Incineroar: 159-190 (78.7 - 94%) -- guaranteed 2HKO" */
  desc: string;
  /** What else matters: a spread move's cut, recoil, the target's Intimidate. */
  notes: string[];
  /** Its priority on this field (Grassy Glide goes first on Grassy Terrain). */
  priority: number;
  /** It hits both foes in Doubles (for 0.75 of the damage). */
  spread: boolean;
  /** It always lands a critical hit (Flower Trick, Frost Breath…), whatever the field says. */
  alwaysCrit: boolean;
}

/** Weather or terrain on the field, and the ability that set it (none when chosen by hand). */
export interface FieldEffect<T> {
  value: T;
  /** "Pelipper's Drizzle" */
  source: string;
}

export interface CalcOutcome {
  weather: FieldEffect<CalcWeather> | null;
  terrain: FieldEffect<CalcTerrain> | null;
  /** The target's HP at full. */
  targetHp: number;
  moves: MoveCalc[];
  /** The stat stages each one battles with: the field's, plus a Terrain Seed's on its terrain. */
  attackerBoosts: CalcBoosts;
  targetBoosts: CalcBoosts;
  /** "Rillaboom's Grassy Seed: +1 Def" */
  seeds: string[];
  /** Each one's Speed on this field (items, abilities, weather, Tailwind), and whether Trick Room turns it round. */
  speed: { attacker: number; target: number; trickRoom: boolean };
}

const WEATHER_ABILITIES: Readonly<Record<string, CalcWeather>> = { drizzle: 'Rain', drought: 'Sun', sandstream: 'Sand', snowwarning: 'Snow', orichalcumpulse: 'Sun' };
const TERRAIN_ABILITIES: Readonly<Record<string, CalcTerrain>> = {
  electricsurge: 'Electric',
  hadronengine: 'Electric',
  grassysurge: 'Grassy',
  psychicsurge: 'Psychic',
  mistysurge: 'Misty',
};
/** Abilities that keep Intimidate from lowering their Attack. */
const UNINTIMIDATED = new Set(['clearbody', 'hypercutter', 'whitesmoke', 'fullmetalbody', 'innerfocus', 'oblivious', 'owntempo', 'scrappy', 'mirrorarmor', 'guarddog']);
const SPREAD_TARGETS = new Set(['allAdjacentFoes', 'allAdjacent']);

/**
 * The damage calculator: @smogon/calc with Champions' mechanics, fed the teambuilder's sets. It takes
 * care of what the library leaves to its caller: a Pokémon holding its Mega Stone battles as its Mega
 * (with the Mega's ability), Aegislash attacks in its Blade Forme and takes hits in its Shield Forme,
 * names the library doesn't know are left out instead of failing, a move that can't affect the target
 * is "immune" (the library would throw for its KO chance), and the weather and terrain the abilities
 * set up are on the field unless chosen by hand (the slower setter's, which comes out last).
 */
@Service()
export class DamageCalc {
  private readonly dex = inject(ChampionsDex);

  /** Each of the attacker's moves against the target, on `field`; `attackerSide` is whose side attacks. */
  calculate(attacker: PokemonSet, target: PokemonSet, attackerSide: 'yours' | 'rival', field: CalcField): CalcOutcome {
    const attackerConditions = attackerSide === 'yours' ? field.yours : field.rival;
    const targetConditions = attackerSide === 'yours' ? field.rival : field.yours;
    const attackerMon = this.pokemon(attacker, 'attacker', attackerConditions);
    const targetMon = this.pokemon(target, 'target', targetConditions);
    const weather = this.effect(field.weather, WEATHER_ABILITIES, attackerMon, targetMon);
    const terrain = this.effect(field.terrain, TERRAIN_ABILITIES, attackerMon, targetMon);
    const calcField = new Field({
      gameType: field.doubles ? 'Doubles' : 'Singles',
      weather: weather?.value,
      terrain: terrain?.value,
      attackerSide: sideOf(attackerConditions, true),
      defenderSide: sideOf(targetConditions, false),
    });
    const moves = attacker.moves.map((name) => this.move(name, attackerMon, targetMon, calcField, field.crit));
    // The library raises a stat for a Terrain Seed inside each calc (and uses the seed up): the same
    // here, so the tab can say so.
    const attackerSeed = seedBoost(attackerMon, terrain?.value);
    const targetSeed = seedBoost(targetMon, terrain?.value);
    return {
      weather,
      terrain,
      targetHp: targetMon.maxHP(),
      moves,
      attackerBoosts: withSeed(attackerConditions.boosts, attackerSeed),
      targetBoosts: withSeed(targetConditions.boosts, targetSeed),
      seeds: [attackerSeed, targetSeed].flatMap((seed) => (seed ? [seed.text] : [])),
      speed: {
        attacker: getFinalSpeed(GEN, attackerMon, calcField, calcField.attackerSide),
        target: getFinalSpeed(GEN, targetMon, calcField, calcField.defenderSide),
        trickRoom: field.trickRoom,
      },
    };
  }

  /** The species a set battles as, for a Pokémon on the field (its Mega, Aegislash's forme). */
  battleSpecies(set: PokemonSet, role: 'attacker' | 'target'): string {
    const mega = this.dex.mega(set.species, set.item);
    const name = mega?.name ?? set.species;
    if (toId(name) === 'aegislash') return role === 'attacker' ? 'Aegislash-Blade' : 'Aegislash-Shield';
    return GEN.species.get(toID(name))?.name ?? name;
  }

  private pokemon(set: PokemonSet, role: 'attacker' | 'target', side: CalcSide): Pokemon {
    const mega = this.dex.mega(set.species, set.item);
    const ability = mega?.ability ?? set.ability;
    const options = {
      level: LEVEL,
      nature: set.nature || 'Serious',
      item: GEN.items.get(toID(set.item))?.name,
      ability: GEN.abilities.get(toID(ability))?.name,
      evs: set.evs,
      boosts: { ...side.boosts },
    };
    const name = this.battleSpecies(set, role);
    const pokemon = new Pokemon(GEN, name, options);
    if (side.hp >= 100) return pokemon;
    return new Pokemon(GEN, name, { ...options, curHP: Math.max(1, Math.floor((pokemon.maxHP() * side.hp) / 100)) });
  }

  /**
   * The weather or terrain on the field: the one chosen, or with 'auto' the one an ability sets up.
   * When both do, the slower one's comes out last and stays.
   */
  private effect<T extends string>(choice: T | 'none' | 'auto', abilities: Readonly<Record<string, T>>, attacker: Pokemon, target: Pokemon): FieldEffect<T> | null {
    if (choice === 'none') return null;
    if (choice !== 'auto') return { value: choice, source: '' };
    const setters = [attacker, target]
      .filter((mon) => abilities[toId(mon.ability ?? '')])
      .sort((a, b) => b.stats.spe - a.stats.spe);
    const last = setters.at(-1);
    return last ? { value: abilities[toId(last.ability ?? '')], source: `${last.name}'s ${last.ability}` } : null;
  }

  private move(name: string, attacker: Pokemon, target: Pokemon, field: Field, crit: boolean): MoveCalc {
    const dexMove = this.dex.move(name);
    const base: MoveCalc = {
      move: dexMove?.name ?? name,
      type: dexMove?.type ?? '',
      category: dexMove?.category ?? '',
      kind: 'unknown',
      min: 0,
      max: 0,
      minPercent: 0,
      maxPercent: 0,
      hits: 0,
      chance: 0,
      koText: '',
      desc: '',
      notes: [],
      priority: dexMove?.priority ?? 0,
      spread: false,
      alwaysCrit: false,
    };
    if (!GEN.moves.get(toID(name))) return base;
    const move = new Move(GEN, name, { isCrit: crit });
    if (toId(name) === 'grassyglide' && field.hasTerrain('Grassy')) base.priority = 1;
    base.spread = field.gameType === 'Doubles' && SPREAD_TARGETS.has(move.target);
    // The library makes these critical hits by itself.
    base.alwaysCrit = !!GEN.moves.get(toID(name))?.willCrit;
    if (move.category === 'Status') return { ...base, kind: 'status' };

    const result = calculate(GEN, attacker, target, move, field);
    const [min, max] = result.range();
    if (max <= 0) return { ...base, type: move.type, kind: 'immune' };
    const hp = target.maxHP();
    const ko = safeKoChance(result);
    return {
      ...base,
      type: move.type,
      kind: 'damage',
      min,
      max,
      minPercent: (min * 100) / hp,
      maxPercent: (max * 100) / hp,
      hits: ko.n,
      chance: ko.chance ?? 0,
      koText: ko.text,
      desc: safeDesc(result),
      notes: this.notes(move, attacker, target, field, crit),
    };
  }

  /** What else the player should know about the hit. */
  private notes(move: Move, attacker: Pokemon, target: Pokemon, field: Field, crit: boolean): string[] {
    const notes: string[] = [];
    if (field.gameType === 'Doubles' && SPREAD_TARGETS.has(move.target)) notes.push('Spread move: ×0.75 in Doubles');
    if (toId(move.name) === 'grassyglide' && field.hasTerrain('Grassy')) notes.push('+1 priority on Grassy Terrain');
    if (GEN.moves.get(toID(move.name))?.willCrit && !crit) notes.push('Always a critical hit');
    if (toId(attacker.item ?? '') === 'lifeorb') notes.push(`Life Orb costs ${Math.floor(attacker.maxHP() / 10)} HP`);
    // The target's Intimidate, which the field's Attack stage may not have counted yet.
    if (move.category === 'Physical' && toId(target.ability ?? '') === 'intimidate' && attacker.boosts.atk === 0 && !UNINTIMIDATED.has(toId(attacker.ability ?? ''))) {
      const lowered = attacker.clone();
      lowered.boosts.atk = -1;
      const result = calculate(GEN, lowered, target, new Move(GEN, move.name, { isCrit: crit }), field);
      const [min, max] = result.range();
      const hp = target.maxHP();
      notes.push(`After Intimidate (−1 Atk): ${percent((min * 100) / hp)} – ${percent((max * 100) / hp)}%, ${safeKoChance(result).text || 'no KO'}`);
    }
    return notes;
  }
}

/** A Terrain Seed on its terrain: +1 Def (Electric, Grassy) or +1 SpD (Psychic, Misty); Contrary turns it round. */
function seedBoost(pokemon: Pokemon, terrain: CalcTerrain | undefined): { stat: 'def' | 'spd'; by: number; text: string } | null {
  const item = pokemon.item ?? '';
  if (!terrain || item !== `${terrain} Seed`) return null;
  const stat = terrain === 'Electric' || terrain === 'Grassy' ? 'def' : 'spd';
  const by = pokemon.hasAbility('Contrary') ? -1 : 1;
  return { stat, by, text: `${pokemon.name}'s ${item}: ${by > 0 ? '+1' : '−1'} ${stat === 'def' ? 'Def' : 'SpD'}` };
}

function withSeed(boosts: CalcBoosts, seed: { stat: 'def' | 'spd'; by: number } | null): CalcBoosts {
  return seed ? { ...boosts, [seed.stat]: Math.max(-6, Math.min(6, boosts[seed.stat] + seed.by)) } : boosts;
}

function sideOf(side: CalcSide, attacking: boolean) {
  return {
    isTailwind: side.tailwind,
    isReflect: side.reflect,
    isLightScreen: side.lightScreen,
    isAuroraVeil: side.auroraVeil,
    isFriendGuard: side.friendGuard,
    isHelpingHand: attacking && side.helpingHand,
  };
}

/** The KO chance, never failing (the library throws on some damage it can't reason about). */
function safeKoChance(result: Result): { n: number; chance: number | undefined; text: string } {
  try {
    return result.kochance(false);
  } catch {
    return { n: 0, chance: 0, text: '' };
  }
}

function safeDesc(result: Result): string {
  try {
    return result.fullDesc('%', false);
  } catch {
    return '';
  }
}

/** 78.7, 94, 100 */
export function percent(value: number): string {
  return String(Math.round(value * 10) / 10);
}
