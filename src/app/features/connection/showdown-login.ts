import { Service, inject, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { toId } from '@shared/utils/to-id';
import { ShowdownConnection } from './showdown-connection';
import { LOGIN_ASSERTION_URL } from './showdown-config';
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
}

/** Names tried in a row before giving up: registered ones, or ones someone is already using. */
const MAX_NAME_TRIES = 3;

/**
 * Gives the player a name on Showdown without an account: guests can't battle, but any unregistered
 * name can be claimed with the login server's assertion (`userid` + the server's `challstr`) and
 * `/trn name,0,assertion`. A new random name each time the connection (re)opens: a name kept from
 * before may still be held by an older connection the server hasn't dropped ("Someone is already
 * using the name…"), and then another one is tried. `newName()` asks for another one by hand.
 * The login server only allows CORS from Showdown's own site, so a regular browser can't read its
 * answer; the Brewser console doesn't enforce CORS (test P1, 2026-09-26), so there it works.
 */
@Service()
export class ShowdownLogin {
  private readonly connection = inject(ShowdownConnection);
  private readonly render = inject(RenderScheduler);
  private readonly stateSignal = signal<LoginState>({ status: 'connecting', name: '', error: null });
  /** The server's latest challenge: a login for an older one would be refused. */
  private challstr: string | null = null;
  /** Names tried for the current claim, so a taken one moves on to another. */
  private tries = 0;

  readonly state = this.stateSignal.asReadonly();

  constructor() {
    this.connection.frames.subscribe((frame) => {
      for (const line of frame.lines) {
        const [type, ...args] = splitLine(line);
        if (type === 'challstr') {
          this.challstr = line.slice('|challstr|'.length);
          this.tries = 0;
          void this.claimName();
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
    if (!this.challstr || this.stateSignal().status === 'naming') return;
    this.tries = 0;
    void this.claimName();
  }

  /** The name as Showdown's user ID ("brewser1234"), to recognise our own messages. */
  userId(): string {
    return toId(this.stateSignal().name);
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

  /** `|nametaken|name|message`: another connection holds it. Another name, while tries are left. */
  private onNameTaken(message: string): void {
    if (this.tries < MAX_NAME_TRIES) void this.claimName();
    else this.fail(message);
  }

  /** `|updateuser| Brewser1234|1|…`: the name (with a leading rank character) and whether it's a chosen one. */
  private onUpdateUser(rawName: string, named: boolean): void {
    const name = rawName.replace(/^[^A-Za-z0-9]/, '').replace(/@!?$/, '');
    if (named) this.setState({ status: 'named', name, error: null });
    else this.setState({ name });
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
