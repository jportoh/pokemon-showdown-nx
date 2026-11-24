import { Service, inject, signal } from '@angular/core';
import { readJson, writeJson } from '@core/persistence/device-storage';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { randomFreshItem, randomInt } from '@core/runtime/random';
import { Observable, Subject } from 'rxjs';
import { toId } from '@shared/utils/to-id';
import { AVATAR_CHOICES } from '@features/trainer-card/data/avatar-choices';
import { SavedLogin } from './saved-login';
import { ShowdownConnection } from './showdown-connection';
import { LOGIN_ASSERTION_URL, LOGIN_URL, REGISTER_URL } from './showdown-config';
import { splitLine } from './showdown-protocol';

export interface LoginState {
  /**
   * `offline` until the player connects (as a guest or to log in), `connecting` until the server's
   * challenge arrives, `ready` while it waits for the player's name and password (logging in),
   * `naming` while a random name is claimed, `named` once the server calls us by a name,
   * `unavailable` when it can't be done (see `error`).
   */
  status: 'offline' | 'connecting' | 'ready' | 'naming' | 'named' | 'unavailable';
  /** How the player connected: as a guest (a random name) or to log in; null while offline. */
  mode: 'guest' | 'login' | null;
  /** The name the server knows us by: a guest's ("Guest 16415171") until named. */
  name: string;
  error: string | null;
  /** A name the player asked for (`logIn`) is being claimed. */
  loggingIn: boolean;
  /** Why the last `logIn` failed, until the next one. */
  loginError: string | null;
  /** The current name is the player's own (asked for with `logIn`), not a random one. */
  ownName: boolean;
  /** The player's own name is a registered one (logged in with its password). */
  registered: boolean;
  /** The trainer avatar the server shows for us ("lucas", "167", "#custom"); empty until named. */
  avatar: string;
  /** The player's unregistered name is being registered (`register`). */
  registering: boolean;
  /** Why the last `register` failed, until the next one. */
  registerError: string | null;
  /** The connection dropped while we had a name: it's being claimed again on the new one. */
  reclaiming: boolean;
}

/** A name the player chose, and its password for a registered one (empty otherwise). */
interface Credentials {
  name: string;
  password: string;
}

/**
 * The avatars the player chose (a trainer sprite's name), set again on every connection: one per
 * registered name, by its ID. Guests (and unregistered names) get a random one each time instead
 * (guestAvatar); an entry v2 kept for them (GUEST_AVATAR) is no longer read. v1 kept a single one for all.
 */
const AVATAR_STORAGE_KEY = 'psb.avatars.v2';
/** The avatar each of the player's own names last had (by ID), for the entry screen to show before connecting. */
const LAST_AVATAR_STORAGE_KEY = 'psb.last-avatars.v1';
const GUEST_AVATAR = '';

/** Names tried in a row before giving up: registered ones, or ones someone is already using. */
const MAX_NAME_TRIES = 3;

/**
 * Getting our name back after the connection dropped: the server may still hold it for the old
 * connection ("Someone is already using the name…") until it notices that one is gone, and the login
 * server may not answer while the network comes back. Tried again every 5 s for a minute, as long as
 * Showdown waits for a player who dropped out of a battle.
 */
const RECLAIM_TRIES = 12;
const RECLAIM_DELAY_MS = 5000;

/**
 * Connects the player to Showdown and gives them a name, only when they ask: `connectAsGuest()` or
 * `startLogin()` then `logIn()`; `disconnect()` ends it. Other connections (the team validation's)
 * get no name. As a guest: guests can't battle, but any unregistered
 * name can be claimed with the login server's assertion (`userid` + the server's `challstr`) and
 * `/trn name,0,assertion`. A new random name each time the player connects; a taken one ("Someone is
 * already using the name…") moves on to another. `newName()` asks for another one by hand.
 * `logIn()` claims the player's own name instead: with its password when it's registered (the login
 * server's `login` gives the assertion then). It's kept in memory to log in again when the connection
 * is replaced; `disconnect()` forgets it. When the connection drops, the name we had (a guest's too)
 * is claimed again on the new one (`reclaiming`), retried for a minute while the server still holds it
 * for the old connection: the server puts a player back in their battles by the name. Settings may also keep the name and, to log in when the app
 * starts (`logInSaved()`), a registered name's password (see SavedLogin).
 * The login server only allows CORS from Showdown's own site, so a regular browser can't read its
 * answer; the console's engine doesn't enforce CORS, so there it works.
 */
@Service()
export class ShowdownLogin {
  private readonly connection = inject(ShowdownConnection);
  private readonly render = inject(RenderScheduler);
  private readonly saved = inject(SavedLogin);
  private readonly stateSignal = signal<LoginState>({
    status: 'offline',
    mode: null,
    name: '',
    error: null,
    loggingIn: false,
    loginError: null,
    ownName: false,
    registered: false,
    avatar: '',
    registering: false,
    registerError: null,
    reclaiming: false,
  });
  private readonly namedSubject = new Subject<void>();
  /** The server's latest challenge: a login for an older one would be refused. */
  private challstr: string | null = null;
  /**
   * The name we had when the connection dropped (a guest's random one too, with no password),
   * claimed again on the new connection; null once it's back, or given up on.
   */
  private held: Credentials | null = null;
  private reclaimTries = 0;
  private reclaimTimer: ReturnType<typeof setTimeout> | null = null;
  /** Names tried for the current claim, so a taken one moves on to another. */
  private tries = 0;
  /** The player's own name, once asked for: claimed again on each new connection. */
  private credentials: Credentials | null = null;
  /** The avatars the player chose, by name (see AVATAR_STORAGE_KEY): the server gives a random one to each new connection. */
  private readonly chosenAvatars = readAvatars();
  /** The avatar each of the player's own names last had (see LAST_AVATAR_STORAGE_KEY). */
  private readonly lastAvatars = readAvatars(LAST_AVATAR_STORAGE_KEY);
  /** Whose chosen avatar was last asked for on this connection (a registered name's ID, or GUEST_AVATAR). */
  private avatarAppliedFor: string | null = null;
  /**
   * This guest's avatar: a random one each time the player connects as a guest (Showdown would give
   * the same default one), or the one they picked meanwhile. Kept across reconnections, not saved.
   */
  private guestAvatar: string | null = null;

  readonly state = this.stateSignal.asReadonly();
  /**
   * Emits each time the server calls us by a chosen name, a reclaimed one after a reconnection
   * included: what our battles' rooms wait for to be joined again (see BattleRooms).
   */
  readonly named: Observable<void> = this.namedSubject.asObservable();

  constructor() {
    this.connection.frames.subscribe((frame) => {
      for (const line of frame.lines) {
        const [type, ...args] = splitLine(line);
        if (type === 'challstr') {
          this.challstr = line.slice('|challstr|'.length);
          this.tries = 0;
          this.onChallenge();
        } else if (type === 'updateuser') this.onUpdateUser(args[0] ?? '', args[1] === '1', args[2] ?? '');
        else if (type === 'nametaken') this.onNameTaken(args[1] || `The name ${args[0]} can't be used.`);
      }
    });
    this.connection.opened.subscribe(() => {
      // A new connection has a new random avatar.
      this.avatarAppliedFor = null;
      const state = this.stateSignal();
      if (!state.mode) return;
      // Back after a drop: the name we had is claimed again (a drop while reclaiming keeps trying the same one).
      if (state.status === 'named') {
        this.held = { name: state.name, password: state.ownName ? (this.credentials?.password ?? '') : '' };
        this.reclaimTries = 0;
      }
      this.clearReclaimTimer();
      this.setState({ status: 'connecting', error: null, reclaiming: this.held !== null });
    });
    // Closed by something else (it doesn't happen while the player is connected, but just in case).
    this.connection.ended.subscribe(() => {
      this.challstr = null;
      if (this.stateSignal().mode) this.reset();
    });
  }

  /** Connects with a random name (the server's challenge brings it). */
  connectAsGuest(): void {
    if (this.busy()) return;
    this.credentials = null;
    // Another round of names: a try after a failed one gets its own.
    this.tries = 0;
    // A new guest, a new trainer.
    this.guestAvatar = randomAvatar();
    this.setState({ mode: 'guest', status: 'connecting', error: null, loginError: null });
    if (this.challstr) this.onChallenge();
    else this.connection.connect();
  }

  /** Connects to log in: once the server's challenge is here (`ready`), `logIn()` claims the name. */
  startLogin(): void {
    if (this.busy()) return;
    this.credentials = null;
    this.setState({ mode: 'login', status: 'connecting', error: null, loginError: null });
    if (this.challstr) this.onChallenge();
    else this.connection.connect();
  }

  /**
   * Connects and logs in to the registered name Settings saved, when the player asked for that.
   * Returns whether it did. A refusal (say, the password changed since) leaves it to the login box.
   */
  logInSaved(): boolean {
    const credentials = this.saved.credentials();
    if (!credentials || this.stateSignal().mode) return false;
    this.credentials = credentials;
    this.setState({ mode: 'login', status: 'connecting', error: null, loginError: null });
    this.connection.connect();
    return true;
  }

  /** Settings' "Log in automatically": turned on while logged in to a registered name, that login is saved. */
  setAutoLogin(on: boolean): void {
    const state = this.stateSignal();
    const current =
      state.status === 'named' && state.registered && this.credentials ? { name: state.name, password: this.credentials.password } : null;
    this.saved.setAutoLogin(on, current);
  }

  /** Leaves a connection (a guest's or a login) that hasn't got its name yet: back offline. */
  cancelLogin(): void {
    const state = this.stateSignal();
    if (state.mode && state.status !== 'named' && !state.loggingIn) this.disconnect();
  }

  /** Closes the connection and forgets the name (and the password): back offline. */
  disconnect(): void {
    this.credentials = null;
    this.challstr = null;
    this.reset();
    this.connection.disconnect();
  }

  /** Swaps a guest's name for another random one (the server allows renaming on the same connection). */
  newName(): void {
    if (!this.challstr || this.busy() || this.stateSignal().mode !== 'guest') return;
    this.credentials = null;
    this.tries = 0;
    void this.claimName();
  }

  /** Claims the player's own name: a registered one needs its password, a free one none. */
  logIn(name: string, password: string): void {
    if (!this.challstr || this.busy()) return;
    const trimmed = name.trim();
    if (!toId(trimmed)) {
      this.setState({ loginError: 'Enter a name.' });
      return;
    }
    this.setState({ mode: 'login' });
    void this.claimOwnName({ name: trimmed, password });
  }

  /**
   * Registers the player's own unregistered name with a password, as Showdown's register form does
   * (the login server's `register`, with its "What is this Pokémon?" answer), and logs in to it: the
   * server's `updateuser` then makes it `registered`.
   */
  register(password: string, confirmation: string, captcha: string): void {
    const state = this.stateSignal();
    const challstr = this.challstr;
    if (!challstr || state.status !== 'named' || !state.ownName || state.registered || state.registering) return;
    if (!password) {
      this.setState({ registerError: 'Choose a password.' });
      return;
    }
    if (password !== confirmation) {
      this.setState({ registerError: "The passwords don't match." });
      return;
    }
    if (!captcha) {
      this.setState({ registerError: 'Answer which Pokémon it is.' });
      return;
    }
    this.setState({ registering: true, registerError: null });
    void fetchRegisterAssertion(state.name, password, confirmation, captcha, challstr).then(
      (result) => {
        if (this.challstr !== challstr) return;
        if ('error' in result) {
          this.setState({ registering: false, registerError: result.error });
          return;
        }
        // Logged in to it from now on, reconnections included.
        this.credentials = { name: state.name, password };
        this.connection.send('', `/trn ${state.name},0,${result.assertion}`);
      },
      () => this.setState({ registering: false, registerError: "Couldn't reach Showdown's login server." }),
    );
  }

  /**
   * Changes the player's avatar (a trainer sprite's name, as the client sends it: `/avatar dawn`)
   * and keeps it: a registered name's for its later connections, a guest's (or an unregistered
   * name's) only until it leaves, since each new guest gets a random one.
   */
  setAvatar(avatar: string): void {
    const state = this.stateSignal();
    if (state.status !== 'named') return;
    const owner = avatarOwner(state.name, state.registered);
    this.avatarAppliedFor = owner;
    if (owner === GUEST_AVATAR) this.guestAvatar = avatar;
    else {
      this.chosenAvatars[owner] = avatar;
      writeJson(AVATAR_STORAGE_KEY, this.chosenAvatars);
    }
    this.connection.send('', `/avatar ${avatar}`);
    // Shown at once: the server's own update may come later, or not at all.
    this.setState({ avatar });
  }

  /** The avatar a name of the player's had last (chosen here, or the server's), or '' if none is known. */
  knownAvatar(name: string): string {
    const id = toId(name);
    return (id && (this.chosenAvatars[id] ?? this.lastAvatars[id])) || '';
  }

  /** The name as Showdown's user ID ("player1234"), to recognise our own messages. */
  userId(): string {
    return toId(this.stateSignal().name);
  }

  /** The server's challenge: what the player connected for (nothing if they didn't). */
  private onChallenge(): void {
    const mode = this.stateSignal().mode;
    if (!mode) return;
    if (this.held) void this.reclaimName(this.held);
    else if (this.credentials) void this.claimOwnName(this.credentials);
    else if (mode === 'login') this.setState({ status: 'ready', error: null });
    else void this.claimName();
  }

  /**
   * Claims the name we had before the connection dropped, as it was had: a registered one with its
   * password, a free one (ours or a guest's) with none. The server's `updateuser` confirms it; a name
   * still held by the old connection, or a login server out of reach, is tried again (retryReclaim).
   */
  private async reclaimName(held: Credentials): Promise<void> {
    const challstr = this.challstr;
    if (!challstr) return;
    this.setState({ reclaiming: true });
    let assertion: string;
    try {
      assertion = held.password ? await fetchLoginAssertion(held.name, held.password, challstr) : await fetchAssertion(held.name, challstr);
    } catch {
      if (this.challstr === challstr && this.held === held) this.retryReclaim();
      return;
    }
    if (this.challstr !== challstr || this.held !== held) return;
    // Registered by someone else meanwhile, or its password changed: it can't be had back.
    if (assertion.startsWith(';')) {
      this.giveUpReclaim();
      return;
    }
    this.connection.send('', `/trn ${held.name},0,${assertion}`);
  }

  private retryReclaim(): void {
    this.reclaimTries++;
    if (this.reclaimTries >= RECLAIM_TRIES) {
      this.giveUpReclaim();
      return;
    }
    this.clearReclaimTimer();
    this.reclaimTimer = setTimeout(() => {
      this.reclaimTimer = null;
      // Dropped again meanwhile: the next connection's challenge tries again.
      if (this.held && this.challstr && this.connection.state().status === 'connected') void this.reclaimName(this.held);
    }, RECLAIM_DELAY_MS);
  }

  /** The old name can't be had back: as on a fresh connection, a guest gets a new random name, a login waits for the player. */
  private giveUpReclaim(): void {
    const held = this.held;
    this.held = null;
    this.clearReclaimTimer();
    this.setState({ reclaiming: false });
    if (!held) return;
    if (this.stateSignal().mode === 'guest') {
      this.tries = 0;
      void this.claimName();
      return;
    }
    this.credentials = null;
    this.setState({ status: 'ready', loginError: `Couldn't get the name ${held.name} back after reconnecting. Log in again.` });
  }

  private clearReclaimTimer(): void {
    if (this.reclaimTimer !== null) clearTimeout(this.reclaimTimer);
    this.reclaimTimer = null;
  }

  private reset(): void {
    this.avatarAppliedFor = null;
    this.guestAvatar = null;
    this.held = null;
    this.clearReclaimTimer();
    this.setState({
      status: 'offline',
      mode: null,
      name: '',
      error: null,
      loggingIn: false,
      loginError: null,
      ownName: false,
      registered: false,
      avatar: '',
      registering: false,
      registerError: null,
      reclaiming: false,
    });
  }

  private busy(): boolean {
    const state = this.stateSignal();
    return state.status === 'naming' || state.loggingIn || state.reclaiming;
  }

  /** Claims a random name for the current challenge; registered names are skipped. */
  private async claimName(): Promise<void> {
    const challstr = this.challstr;
    if (!challstr) return;
    this.setState({ status: 'naming', error: null });
    while (this.tries < MAX_NAME_TRIES) {
      this.tries++;
      const name = randomName();
      let assertion: string;
      try {
        assertion = await fetchAssertion(name, challstr);
      } catch {
        this.fail("Couldn't reach Showdown's login server (a web browser blocks it; the console app can).");
        return;
      }
      // A newer challenge means the connection was replaced: its own login is under way.
      if (this.challstr !== challstr) return;
      if (assertion.startsWith(';;')) {
        this.fail(assertion.slice(2) || "Showdown's login server refused the name.");
        return;
      }
      // ";" alone: someone registered the name. Try another.
      if (assertion.startsWith(';')) continue;
      this.connection.send('', `/trn ${name},0,${assertion}`);
      return;
    }
    this.fail("Couldn't find a free name on Showdown.");
  }

  /** Claims the player's name for the current challenge; the server's `updateuser` confirms it. */
  private async claimOwnName(credentials: Credentials): Promise<void> {
    const challstr = this.challstr;
    if (!challstr) return;
    this.credentials = credentials;
    this.setState({ loggingIn: true, loginError: null });
    let assertion: string;
    try {
      assertion = credentials.password
        ? await fetchLoginAssertion(credentials.name, credentials.password, challstr)
        : await fetchAssertion(credentials.name, challstr);
    } catch {
      this.loginFailed("Couldn't reach Showdown's login server (a web browser blocks it; the console app can).");
      return;
    }
    if (this.challstr !== challstr) return;
    if (assertion.startsWith(';;')) {
      this.loginFailed(assertion.slice(2) || 'Wrong password.');
      return;
    }
    if (assertion.startsWith(';')) {
      this.loginFailed(`${credentials.name} is registered: enter its password.`);
      return;
    }
    this.connection.send('', `/trn ${credentials.name},0,${assertion}`);
  }

  /**
   * The name asked for can't be had: forgotten, so a reconnection won't try it again. A name held
   * before stays; without one, the login waits for another try (`ready`).
   */
  private loginFailed(message: string): void {
    this.credentials = null;
    this.setState({ loggingIn: false, loginError: message });
    if (this.stateSignal().status !== 'named') this.setState({ status: 'ready' });
  }

  /** `|nametaken|name|message`: another connection holds it. Another name, while tries are left. */
  private onNameTaken(message: string): void {
    if (this.held) this.retryReclaim();
    else if (this.stateSignal().loggingIn) this.loginFailed(message);
    else if (this.tries < MAX_NAME_TRIES) void this.claimName();
    else this.fail(message);
  }

  /**
   * `|updateuser| Player1234|1|lucas|…`: the name (with a leading rank character), whether it's a
   * chosen one, and the avatar.
   */
  private onUpdateUser(rawName: string, named: boolean, avatar: string): void {
    if (!this.stateSignal().mode) return;
    const name = rawName.replace(/^[^A-Za-z0-9]/, '').replace(/@!?$/, '');
    if (!named) {
      this.setState({ name, avatar });
      return;
    }
    const ownName = this.credentials !== null && toId(name) === toId(this.credentials.name);
    // Only a registered name needs its password, so one given means it's registered.
    const registered = ownName && this.credentials?.password !== '';
    this.applyChosenAvatar(avatar, avatarOwner(name, registered));
    // Just logged in (or registered): kept as Settings say.
    const previous = this.stateSignal();
    if (ownName && this.credentials && (previous.loggingIn || previous.registering)) this.saved.loggedIn(name, this.credentials.password);
    if (ownName && this.lastAvatars[toId(name)] !== avatar) {
      this.lastAvatars[toId(name)] = avatar;
      writeJson(LAST_AVATAR_STORAGE_KEY, this.lastAvatars);
    }
    this.setState({
      status: 'named',
      name,
      avatar,
      error: null,
      ownName,
      registered,
      registering: false,
      loggingIn: this.stateSignal().loggingIn && !ownName,
    });
    if (this.held && toId(name) === toId(this.held.name)) {
      this.held = null;
      this.clearReclaimTimer();
      this.setState({ reclaiming: false });
    }
    this.namedSubject.next();
  }

  /**
   * Once per connection and name, as soon as it has one: asks for the avatar the player chose for it
   * (a registered name's, or the guests'), silently (`,1`, as the client does), when the server gave
   * another one. A name without one gets a random one again, not the last name's.
   */
  private applyChosenAvatar(current: string, owner: string): void {
    if (this.avatarAppliedFor === owner) return;
    const previous = this.avatarAppliedFor;
    this.avatarAppliedFor = owner;
    // A guest (or an unregistered name): this session's random trainer, or the one picked meanwhile.
    const chosen =
      owner === GUEST_AVATAR
        ? (this.guestAvatar ??= randomAvatar())
        : (this.chosenAvatars[owner] ?? (previous !== null && current === this.chosenAvatars[previous] ? randomAvatar() : null));
    if (chosen && current !== chosen) this.connection.send('', `/avatar ${chosen},1`);
  }

  private fail(error: string): void {
    this.setState({ status: 'unavailable', error });
  }

  private setState(changes: Partial<LoginState>): void {
    this.stateSignal.update((state) => ({ ...state, ...changes }));
    this.render.request();
  }
}

/** The guest names' first word. */
const NAME_ADJECTIVES = [
  'Brave', 'Swift', 'Sleepy', 'Lucky', 'Mighty', 'Shiny', 'Sneaky', 'Jolly', 'Calm', 'Bold', 'Timid', 'Hasty',
  'Gentle', 'Quirky', 'Fiery', 'Frosty', 'Stormy', 'Cosmic', 'Turbo', 'Fluffy', 'Grumpy', 'Happy', 'Noble', 'Wild',
  'Clever', 'Dizzy', 'Spicy', 'Zippy', 'Rusty', 'Golden', 'Silent', 'Rowdy', 'Cheeky', 'Mystic', 'Royal', 'Tiny',
];
/** The guest names' second word: Pokémon everyone knows. */
const NAME_POKEMON = [
  'Pikachu', 'Snorlax', 'Eevee', 'Gengar', 'Lapras', 'Psyduck', 'Togepi', 'Mudkip', 'Lucario', 'Ditto', 'Jigglypuff',
  'Bulbasaur', 'Squirtle', 'Charmander', 'Magikarp', 'Gyarados', 'Dragonite', 'Mew', 'Wooper', 'Piplup', 'Totodile',
  'Garchomp', 'Pichu', 'Slowpoke', 'Vulpix', 'Growlithe', 'Meowth', 'Rowlet', 'Sobble', 'Fuecoco', 'Sprigatito',
  'Quaxly', 'Zorua', 'Mimikyu', 'Tyrunt', 'Axew', 'Bidoof', 'Spheal', 'Swablu', 'Riolu',
];
/** The guest names' words used lately (see randomFreshItem), so the next names don't repeat them. */
const RECENT_ADJECTIVES_KEY = 'psb.recent-name-adjectives.v1';
const RECENT_POKEMON_KEY = 'psb.recent-name-pokemon.v1';
/** The guest avatars given lately, so the next guests get other ones. */
const RECENT_AVATARS_KEY = 'psb.recent-guest-avatars.v1';
/** Showdown's longest name. */
const MAX_NAME_LENGTH = 18;

/**
 * A guest's name, two words and two digits ("BraveSnorlax42"): fun, within Showdown's 18 characters,
 * and unlikely to be taken (a registered one is skipped: see claimName). Its words aren't the last
 * few names' (they fit: no adjective is over 6 letters, no Pokémon over 10).
 */
function randomName(): string {
  const adjective = randomFreshItem(NAME_ADJECTIVES, RECENT_ADJECTIVES_KEY, 12);
  const pokemon = randomFreshItem(NAME_POKEMON, RECENT_POKEMON_KEY, 15);
  return `${adjective}${pokemon}${10 + randomInt(90)}`.slice(0, MAX_NAME_LENGTH);
}

/** The login server's answer: an assertion, ";" for a registered name or ";;message" for an error. */
async function fetchAssertion(name: string, challstr: string): Promise<string> {
  const response = await fetch(LOGIN_ASSERTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `userid=${encodeURIComponent(toId(name))}&challstr=${encodeURIComponent(challstr)}`,
  });
  if (!response.ok) throw new Error(`The login server answered ${response.status}.`);
  return (await response.text()).trim();
}

/**
 * Logs in to a registered name. The answer is JSON after a "]" guard:
 * `]{"curuser":{"loggedin":true,…},"assertion":"…"}`, or ";;message" as the assertion when refused.
 * Returned in `fetchAssertion`'s terms.
 */
async function fetchLoginAssertion(name: string, password: string, challstr: string): Promise<string> {
  const response = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `name=${encodeURIComponent(name)}&pass=${encodeURIComponent(password)}&challstr=${encodeURIComponent(challstr)}`,
  });
  if (!response.ok) throw new Error(`The login server answered ${response.status}.`);
  const data: unknown = JSON.parse((await response.text()).replace(/^\]/, ''));
  if (!isLoginAnswer(data)) return ";;The login server's answer wasn't understood.";
  const assertion = data.assertion ?? '';
  if (data.curuser?.loggedin && assertion && !assertion.startsWith(';')) return assertion;
  return assertion.startsWith(';;') ? assertion : ';;Wrong password.';
}

/**
 * Registers a name: the answer is JSON after a "]" guard, as `login`'s, with `actionerror` when
 * refused ("Your passwords do not match.", a wrong answer, a name taken meanwhile…).
 */
async function fetchRegisterAssertion(
  name: string,
  password: string,
  confirmation: string,
  captcha: string,
  challstr: string,
): Promise<{ assertion: string } | { error: string }> {
  const response = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: [
      `username=${encodeURIComponent(name)}`,
      `password=${encodeURIComponent(password)}`,
      `cpassword=${encodeURIComponent(confirmation)}`,
      `captcha=${encodeURIComponent(captcha)}`,
      `challstr=${encodeURIComponent(challstr)}`,
    ].join('&'),
  });
  if (!response.ok) throw new Error(`The login server answered ${response.status}.`);
  const data: unknown = JSON.parse((await response.text()).replace(/^]/, ''));
  if (!isLoginAnswer(data)) return { error: "The login server's answer wasn't understood." };
  const assertion = data.assertion ?? '';
  if (data.curuser?.loggedin && assertion && !assertion.startsWith(';')) return { assertion };
  return { error: data.actionerror || (assertion.startsWith(';;') ? assertion.slice(2) : "Showdown couldn't register the name.") };
}

interface LoginAnswer {
  assertion?: string;
  curuser?: { loggedin?: boolean };
  actionerror?: string;
}

function isLoginAnswer(data: unknown): data is LoginAnswer {
  return typeof data === 'object' && data !== null;
}

/** Whose chosen avatar a name uses: a registered name's own (by its ID), or the guests'. */
function avatarOwner(name: string, registered: boolean): string {
  return registered ? toId(name) : GUEST_AVATAR;
}

function readAvatars(key = AVATAR_STORAGE_KEY): Record<string, string> {
  const stored = readJson<unknown>(key, {});
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** Any of the avatars the client offers, as a new connection would get. */
function randomAvatar(): string {
  return randomFreshItem(AVATAR_CHOICES, RECENT_AVATARS_KEY, 40);
}
