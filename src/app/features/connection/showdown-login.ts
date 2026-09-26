import { Service, inject, signal } from '@angular/core';
import { readJson, writeJson } from '@core/persistence/device-storage';
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

/** The temporary name, kept so other players can challenge the same name every time. */
const NAME_KEY = 'psb.username.v1';
/** Tries with a new name when the stored one turns out to be registered. */
const MAX_NAME_TRIES = 3;

/**
 * Gives the player a name on Showdown without an account: guests can't battle, but any unregistered
 * name can be claimed with the login server's assertion (`userid` + the server's `challstr`) and
 * `/trn name,0,assertion`. Done again each time the connection (re)opens.
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

  readonly state = this.stateSignal.asReadonly();

  constructor() {
    this.connection.frames.subscribe((frame) => {
      for (const line of frame.lines) {
        const [type, ...args] = splitLine(line);
        if (type === 'challstr') void this.claimName(line.slice('|challstr|'.length));
        else if (type === 'updateuser') this.onUpdateUser(args[0] ?? '', args[1] === '1');
        else if (type === 'nametaken') this.fail(args[1] || `The name ${args[0]} can't be used.`);
      }
    });
    this.connection.opened.subscribe(() => this.setState({ status: 'connecting', error: null }));
  }

  /** Opens the connection: the name follows as soon as the server sends its challenge. */
  start(): void {
    this.connection.connect();
  }

  /** The name as Showdown's user ID ("brewser1234"), to recognise our own messages. */
  userId(): string {
    return toId(this.stateSignal().name);
  }

  private async claimName(challstr: string): Promise<void> {
    this.challstr = challstr;
    this.setState({ status: 'naming', error: null });
    let name = readJson<string>(NAME_KEY, '') || randomName();
    for (let attempt = 0; attempt < MAX_NAME_TRIES; attempt++) {
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
      if (assertion.startsWith(';')) {
        // Someone registered the name: pick another.
        name = randomName();
        continue;
      }
      writeJson(NAME_KEY, name);
      this.connection.send('', `/trn ${name},0,${assertion}`);
      return;
    }
    this.fail("Couldn't find a free name on Showdown.");
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
