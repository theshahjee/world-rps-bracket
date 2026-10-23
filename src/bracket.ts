// A small single-elimination bracket: real-profile entrants, simulated matches, and an SVG
// tree drawn left (players) to right (winner), the same way the world bracket halves.

import {
  MOVE_NAMES,
  sample,
  simulateMatch,
  type Move,
  type OpponentState,
  type Profile,
  type Rng,
  type Triple,
} from './engine';
import { randomPerson, type Person } from './people';

export interface Entrant {
  person: Person;
  profile: Profile;
  profileIndex: number;
  you?: boolean;
  lastMove: Move | null; // throw that won their previous game, null before their first game
}

export interface Match {
  winner: number; // leaf index
  loser: number;
  move: Move; // winning throw
  throws: number;
}

export interface Bracket {
  leaves: Entrant[];
  // levels[j][k]: the match at depth j joining leaves [k*2^(j+1), (k+1)*2^(j+1)).
  levels: (Match | null)[][];
}

export function randomEntrant(profiles: Profile[], rng: Rng, gamesWon: number): Entrant {
  const profileIndex = Math.floor(rng() * profiles.length);
  const profile = profiles[profileIndex];
  return {
    person: randomPerson(rng),
    profile,
    profileIndex,
    lastMove: gamesWon > 0 ? sample(profile.marg, rng) : null,
  };
}

/** `count` entrants with no repeated names. */
export function uniqueEntrants(count: number, profiles: Profile[], rng: Rng, gamesWon: number, taken = new Set<string>()): Entrant[] {
  const out: Entrant[] = [];
  while (out.length < count) {
    let e = randomEntrant(profiles, rng, gamesWon);
    for (let tries = 0; taken.has(e.person.name) && tries < 20; tries++) e = randomEntrant(profiles, rng, gamesWon);
    taken.add(e.person.name);
    out.push(e);
  }
  return out;
}

export function emptyBracket(leaves: Entrant[]): Bracket {
  const depth = Math.log2(leaves.length);
  const levels: (Match | null)[][] = [];
  for (let j = 0; j < depth; j++) levels.push(new Array(leaves.length >> (j + 1)).fill(null));
  return { leaves, levels };
}

const stateOf = (e: Entrant): OpponentState => ({
  profile: e.profile,
  profileIndex: e.profileIndex,
  lastMove: e.lastMove,
  lastOutcome: 'win',
});

/** Play one match between two leaves and record it. Returns the winner's leaf index. */
export function playMatch(b: Bracket, level: number, a: number, c: number, firstMoves: Triple, rng: Rng): number {
  const result = simulateMatch(stateOf(b.leaves[a]), stateOf(b.leaves[c]), firstMoves, rng);
  const winner = result.winner === 0 ? a : c;
  record(b, level, winner, winner === a ? c : a, result.winningMove, result.throws);
  return winner;
}

export function record(b: Bracket, level: number, winner: number, loser: number, move: Move, throws: number) {
  b.levels[level][winner >> (level + 1)] = { winner, loser, move, throws };
  b.leaves[winner].lastMove = move;
}

/** Simulate every match inside leaves [lo, lo+size). Returns the block winner. */
export function playBlock(b: Bracket, lo: number, size: number, firstMoves: Triple, rng: Rng): number {
  if (size === 1) return lo;
  const half = size / 2;
  const a = playBlock(b, lo, half, firstMoves, rng);
  const c = playBlock(b, lo + half, half, firstMoves, rng);
  return playMatch(b, Math.log2(size) - 1, a, c, firstMoves, rng);
}

/** Winner of the block at `level` index `k`, or null if it has not been played. */
export function blockWinner(b: Bracket, level: number, k: number): number | null {
  if (level < 0) return k;
  return b.levels[level][k]?.winner ?? null;
}

export function describeMatch(b: Bracket, m: Match): string {
  const w = b.leaves[m.winner].person;
  const l = b.leaves[m.loser].person;
  return `${w.name} beat ${l.name} with ${MOVE_NAMES[m.move]}${m.throws > 1 ? ` after ${m.throws - 1} tie${m.throws > 2 ? 's' : ''}` : ''}`;
}

// ---------- drawing ----------

const SVG_NS = 'http://www.w3.org/2000/svg';
function node<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent: Element,
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent.appendChild(n);
  return n;
}

export interface DrawOptions {
  /** Matches at levels below this are shown. */
  revealLevel: number;
  /** Text under the root. */
  rootLabel?: string;
  /** Makes names clickable; called with the leaf index. */
  onPick?: (leaf: number) => void;
  picked?: number | null;
}

/**
 * Draws the bracket into `svg`, sized to its container's width so text stays legible on phones.
 * Players sit on the left, each column to the right is one round, the champion is at the far right.
 */
export function drawBracket(svg: SVGSVGElement, b: Bracket, opts: DrawOptions) {
  const n = b.leaves.length;
  const depth = b.levels.length;
  const width = Math.max(300, Math.round(svg.parentElement?.clientWidth ?? 560));
  const narrow = width < 480;
  const rowH = narrow ? 24 : 26;
  const labelW = narrow ? 104 : 178;
  const rootW = narrow ? 70 : 130;
  const colW = (width - labelW - rootW) / Math.max(1, depth);
  const height = n * rowH + 8;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('height', String(height));
  svg.replaceChildren();

  const leafY = (i: number) => 4 + i * rowH + rowH / 2;
  const colX = (j: number) => labelW + j * colW;
  const shown = (level: number, m: Match | null): m is Match => m !== null && level < opts.revealLevel;

  // Who is still alive given what is shown, and where each block's line ends up.
  const out = new Set<number>();
  for (let j = 0; j < depth; j++) {
    for (const m of b.levels[j]) if (m && shown(j, m)) out.add(m.loser);
  }
  const ys: number[][] = [Array.from({ length: n }, (_, i) => leafY(i))];
  for (let j = 0; j < depth; j++) {
    ys.push(b.levels[j].map((_, k) => (ys[j][2 * k] + ys[j][2 * k + 1]) / 2));
  }

  const lines = node('g', { class: 'b-lines' }, svg);
  for (let j = 0; j < depth; j++) {
    const size = 1 << j;
    for (let k = 0; k < b.levels[j].length; k++) {
      const m = b.levels[j][k];
      const visible = shown(j, m);
      const parentY = ys[j + 1][k];
      for (const child of [2 * k, 2 * k + 1]) {
        const childY = ys[j][child];
        const prev = j === 0 ? null : b.levels[j - 1][child];
        const shownWinner = j === 0 ? child : shown(j - 1, prev) ? prev.winner : null;
        let cls = 'pending';
        if (shownWinner !== null) {
          cls = visible ? (m.winner === shownWinner ? 'won' : 'lost') : 'live';
          if (b.leaves[shownWinner].you && cls !== 'lost') cls += ' you';
        }
        node('path', {
          d: `M${colX(j)},${childY}H${colX(j + 1)}V${parentY}`,
          class: `b-line ${cls}`,
          'data-size': size,
        }, lines);
      }
    }
  }

  // Root stub and champion label.
  const root = b.levels[depth - 1][0];
  const rootShown = shown(depth - 1, root);
  const rootY = ys[depth][0];
  node('path', {
    d: `M${colX(depth)},${rootY}H${colX(depth) + 18}`,
    class: `b-line ${rootShown ? 'won' : 'pending'}${rootShown && root && b.leaves[root.winner].you ? ' you' : ''}`,
  }, lines);
  if (rootShown && root) {
    const champ = b.leaves[root.winner];
    const t = node('text', { x: colX(depth) + 24, y: rootY + 4, class: 'b-champ' }, svg);
    t.textContent = `${champ.person.flag} ${champ.you ? 'You' : narrow ? firstName(champ.person.name) : champ.person.name}`;
  } else if (opts.rootLabel) {
    const t = node('text', { x: colX(depth) + 24, y: rootY + 4, class: 'b-root' }, svg);
    t.textContent = opts.rootLabel;
  }

  const labels = node('g', { class: 'b-labels' }, svg);
  b.leaves.forEach((e, i) => {
    const t = node('text', {
      x: labelW - 8,
      y: leafY(i) + 4,
      'text-anchor': 'end',
      class: `b-leaf${e.you ? ' you' : ''}${out.has(i) ? ' out' : ''}`,
    }, labels);
    const name = e.you ? 'You' : narrow ? firstName(e.person.name) : e.person.name;
    t.textContent = `${name} ${e.person.flag}`;
    if (opts.picked === i) t.classList.add('picked');
    const label = e.you ? 'You' : `${e.person.name}, ${e.person.country}`;
    if (opts.onPick) {
      const pick = opts.onPick;
      t.setAttribute('tabindex', '0');
      t.setAttribute('role', 'button');
      t.setAttribute('aria-label', `Scout ${label}`);
      t.addEventListener('click', () => pick(i));
      t.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          ev.stopPropagation();
          pick(i);
        }
      });
    }
    node('title', {}, t).textContent = label;
  });
}

const firstName = (full: string) => (full.length > 11 ? full.split(' ')[0] : full);
