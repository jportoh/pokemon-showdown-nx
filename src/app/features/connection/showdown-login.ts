import { Service, inject, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { toId } from '@shared/utils/to-id';
import { ShowdownConnection } from './showdown-connection';
import { LOGIN_ASSERTION_URL, LOGIN_URL } from './showdown-config';
import { splitLine } from './showdown-protocol';

export interface LoginState {
  /**
   * `connecting` until the server's challenge arrives, `naming` while the name is claimed, `named` once
   * the server calls us by it, `unavailable` when it can't be done (see `error`).
   */
  status: 'connecting' | 'naming' | 'named' | 'unavailable';
  /** The name the server knows us by: a guest's ("Guest 16415171") until named. */
  name: string;
  error: string | null;
  /** A name the player asked for (`logIn`) is being claimed. */
  loggingIn: boolean;
  /** Why the last `logIn` failed, until the next one. */
  loginError: string | null;
  /** The current name is the player's own (asked for with `logIn`), not a random one. */
  ownName: boolean;
}

/** A name the player chose, and its password for a registered one (empty otherwise). */
interface Credentials {
  name: string;
  password: string;
}

/** Names tried in a row before giving up: registered ones, or ones someone is already using. */
const MAX_NAME_TRIES = 3;

/**
 * Gives the player a name on Showdown. Without an account: guests can't battle, but any unregistered
 * name can be claimed with the login server's assertion (`userid` + the server's `challstr`) and
 * `/trn name,0,assertion`. A new random name each time the connection (re)opens: a name kept from
 * before may still be held by an older connection the server hasn't dropped ("Someone is already
 * using the name…"), and then another one is tried. `newName()` asks for another one by hand.
 * `logIn()` claims the player's own name instead: with its password when it's registered (the login
 * server's `login` gives the assertion then). It's kept in memory only (never stored) to log in
 * again when the connection is replaced; `newName()` logs out.
 * The login server only allows CORS from Showdown's own site, so a regular browser can't read its
 * answer; the Brewser console doesn't enforce CORS (test P1, 2026-09-26), so there it works.
 */
@Service()
export class ShowdownLogin {
  private readonly connection = inject(ShowdownConnection);
  private readonly render = inject(RenderScheduler);
  private readonly stateSignal = signal<LoginState>({
    status: 'connecting',
    name: '',
    error: null,
    loggingIn: false,
    loginError: null,
    ownName: false,
  });
  /** The server's latest challenge: a login for an older one would be refused. */
  private challstr: string | null = null;
  /** Names tried for the current claim, so a taken one moves on to another. */
  private tries = 0;
  /** The player's own name, once asked for: claimed again on each new connection. */
  private credentials: Credentials | null = null;

  readonly state = this.stateSignal.asReadonly();

  constructor() {
    this.connection.frames.subscribe((frame) => {
      for (const line of frame.lines) {
        const [type, ...args] = splitLine(line);
        if (type === 'challstr') {
          this.challstr = line.slice('|challstr|'.length);
          this.tries = 0;
          if (this.credentials) void this.claimOwnName(this.credentials);
          else void this.claimName();
        } else if (type === 'updateuser') this.onUpdateUser(args[0] ?? '', args[1] === '1');
        else if (type === 'nametaken') this.onNameTaken(args[1] || `The name ${args[0]} can't be used.`);
      }
    });
    this.connection.opened.subscribe(() => this.setState({ status: 'connecting', error: null }));
  }

  /** Opens the connection: the name follows as soon as the server sends its challenge. */
  start(): void {
    this.connection.connect();
  }

  /** Swaps the name for another random one (the server allows renaming on the same connection). */
  newName(): void {
    if (!this.challstr || this.busy()) return;
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
    void this.claimOwnName({ name: trimmed, password });
  }

  /** The name as Showdown's user ID ("brewser1234"), to recognise our own messages. */
  userId(): string {
    return toId(this.stateSignal().name);
  }

  private busy(): boolean {
    const state = this.stateSignal();
    return state.status === 'naming' || state.loggingIn;
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
   * The name asked for can't be had: forgotten, so a reconnection won't try it again. The name held
   * before stays; without one yet (the login on a new connection failed), a random one is claimed.
   */
  private loginFailed(message: string): void {
    this.credentials = null;
    this.setState({ loggingIn: false, loginError: message });
    if (this.stateSignal().status !== 'named') void this.claimName();
  }

  /** `|nametaken|name|message`: another connection holds it. Another name, while tries are left. */
  private onNameTaken(message: string): void {
    if (this.stateSignal().loggingIn) this.loginFailed(message);
    else if (this.tries < MAX_NAME_TRIES) void this.claimName();
    else this.fail(message);
  }

  /** `|updateuser| Brewser1234|1|…`: the name (with a leading rank character) and whether it's a chosen one. */
  private onUpdateUser(rawName: string, named: boolean): void {
    const name = rawName.replace(/^[^A-Za-z0-9]/, '').replace(/@!?$/, '');
    if (!named) {
      this.setState({ name });
      return;
    }
    const ownName = this.credentials !== null && toId(name) === toId(this.credentials.name);
    this.setState({ status: 'named', name, error: null, ownName, loggingIn: this.stateSignal().loggingIn && !ownName });
  }

  private fail(error: string): void {
    this.setState({ status: 'unavailable', error });
  }

  private setState(changes: Partial<LoginState>): void {
    this.stateSignal.update((state) => ({ ...state, ...changes }));
    this.render.request();
  }
}

/** "Brewser" and 4 digits: short enough for Showdown's 18 characters, unlikely to be taken. */
function randomName(): string {
  return `Brewser${1000 + Math.floor(Math.random() * 9000)}`;
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

interface LoginAnswer {
  assertion?: string;
  curuser?: { loggedin?: boolean };
}

function isLoginAnswer(data: unknown): data is LoginAnswer {
  return typeof data === 'object' && data !== null;
}
