import './style.css';
import data from './data/profiles.json';
import {
  MOVE_NAMES,
  TOTAL_ROUNDS,
  WORLD_POPULATION,
  bestMatchWinRate,
  bestReply,
  beats,
  championOdds,
  cryptoRng,
  formatOneIn,
  habitReaderWinRate,
  opponentMove,
  outcomeOf,
  playersLeft,
  predict,
  readerWinRate,
  simulateRuns,
  type Move,
  type OpponentState,
  type Outcome,
  type Profile,
  type Triple,
} from './engine';
import { randomPerson, type Person } from './people';
import {
  blockWinner,
  describeMatch,
  drawBracket,
  emptyBracket,
  playBlock,
  uniqueEntrants,
  record,
  type Bracket,
  type Entrant,
} from './bracket';

const profiles = data.profiles as Profile[];
const pop = data.population;
const firstMoves = pop.first as Triple;
const popProfile: Profile = {
  n: 0,
  marg: pop.marg as Triple,
  win: pop.win as Triple,
  tie: pop.tie as Triple,
  lose: pop.lose as Triple,
};
const rng = cryptoRng;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- small DOM helpers ----------

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

/**
 * Builds math text without innerHTML: {curly} spans become bold numbers and ^(x) becomes a
 * superscript, _(x) a subscript. Values are inserted as text nodes only.
 */
function rich(source: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let target: Node = frag;
  let last = 0;
  for (const m of source.matchAll(/\{|\}|([\^_])\(([^)]*)\)/g)) {
    if (m.index > last) target.appendChild(document.createTextNode(source.slice(last, m.index)));
    if (m[0] === '{') {
      const b = el('b');
      frag.appendChild(b);
      target = b;
    } else if (m[0] === '}') {
      target = frag;
    } else {
      target.appendChild(el(m[1] === '^' ? 'sup' : 'sub', undefined, m[2].replace('-', '−')));
    }
    last = m.index + m[0].length;
  }
  if (last < source.length) target.appendChild(document.createTextNode(source.slice(last)));
  return frag;
}

function eqRow(label: string, parts: string): HTMLDivElement {
  const row = el('div');
  const dd = el('dd');
  dd.append(rich(parts));
  row.append(el('dt', undefined, label), dd);
  return row;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (p: number, digits = 1) => `${(p * 100).toFixed(digits)}%`;
const sup = (n: number) => `^(${n})`;
const sci = (x: number) => {
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(x));
  const m = x / 10 ** e;
  return e > -3 && e < 4 ? x.toPrecision(3) : `${m.toFixed(2)}×10${sup(e)}`;
};

// ---------- move glyphs (static markup, no user data) ----------

const GLYPHS = [
  // rock
  `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 42 17 22l15-9 16 5 7 17-6 14-21 4z" fill="currentColor"/><path class="crease" d="m17 22 13 9 18-13M30 31l-3 22M30 31l19 4" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>`,
  // paper
  `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 8h24l10 10v38H16z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><path d="M40 8v10h10M23 30h20M23 38h20M23 46h13" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  // scissors
  `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="17" cy="46" r="8" fill="none" stroke="currentColor" stroke-width="3.5"/><circle cx="17" cy="18" r="8" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M24 22l32 26M24 42L56 16" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>`,
];

function setGlyph(target: HTMLElement, move: Move | null) {
  target.classList.remove('idle');
  target.innerHTML = move === null ? '' : GLYPHS[move];
}

// ---------- game state ----------

interface Game {
  round: number; // the round being played, 1..33
  opponent: OpponentState;
  person: Person;
  wins: number;
  ties: number;
  assisted: boolean;
  phase: 'choose' | 'won' | 'over';
}

let game: Game;
let shownLeft = WORLD_POPULATION;

// Your corner of the bracket: you plus the players you could meet over the next few rounds.
// Their matches against each other are simulated, so your opponent is whoever really wins
// the neighbouring branch.
let corner: Bracket;
let cornerStart = 1;
let oppLeaf = 1;
let matchThrows = 0;
const CORNER_DEPTH = 4;

function newCorner(round: number) {
  const depth = Math.min(CORNER_DEPTH, TOTAL_ROUNDS - round + 1);
  const you: Entrant = {
    person: { name: 'You', country: '', flag: '' },
    profile: popProfile,
    profileIndex: -1,
    you: true,
    lastMove: null,
  };
  const leaves = [you, ...uniqueEntrants(2 ** depth - 1, profiles, rng, round - 1)];
  cornerPick = null;
  corner = emptyBracket(leaves);
  cornerStart = round;
  for (let j = 0; j < depth; j++) playBlock(corner, 2 ** j, 2 ** j, firstMoves, rng);
}

function newOpponent(round: number): { opponent: OpponentState; person: Person; lastText: string } {
  if (round === 1 || round - cornerStart >= corner.levels.length) newCorner(round);
  const j = round - cornerStart;
  oppLeaf = j === 0 ? 1 : blockWinner(corner, j - 1, 1)!;
  matchThrows = 0;
  const entrant = corner.leaves[oppLeaf];
  const opponent: OpponentState = {
    profile: entrant.profile,
    profileIndex: entrant.profileIndex,
    lastMove: entrant.lastMove,
    lastOutcome: 'win',
  };
  let lastText: string;
  if (entrant.lastMove === null) {
    lastText = `First game for both of you. In the study, ${pct(firstMoves[1], 0)} of opening throws were paper.`;
  } else if (j === 0) {
    const beaten = randomPerson(rng);
    lastText = `Record ${round - 1}–0. Last game: won with ${MOVE_NAMES[entrant.lastMove]} against ${beaten.name} (${beaten.country}).`;
  } else {
    const m = corner.levels[j - 1][1]!;
    const loser = corner.leaves[m.loser].person;
    lastText = `Record ${round - 1}–0. Just won the next branch over, beating ${loser.name} (${loser.country}) with ${MOVE_NAMES[m.move]}.`;
  }
  return { opponent, person: entrant.person, lastText };
}

function renderCorner(revealLevel: number) {
  const n = corner.leaves.length;
  const before = playersLeft(cornerStart - 1);
  const endRound = cornerStart + corner.levels.length - 1;
  $('corner-note').replaceChildren(
    rich(
      `Rounds ${cornerStart}–${endRound}: {${n}} of the {${fmt(before)}} players still in. ` +
        (cornerStart > 1 ? `Everyone here has already won ${cornerStart - 1} games. ` : '') +
        `The whole bracket is ${fmt(Math.ceil(before / n))} corners like this one, halving at the same time.`,
    ),
  );
  cornerReveal = revealLevel;
  drawBracket($('corner-svg') as unknown as SVGSVGElement, corner, {
    revealLevel,
    rootLabel: endRound === TOTAL_ROUNDS ? 'Champion' : `Round ${endRound + 1}`,
    picked: cornerPick,
    onPick: (i) => {
      cornerPick = cornerPick === i ? null : i;
      renderCorner(cornerReveal);
    },
  });
  renderScout($('corner-scout'), corner, cornerPick, revealLevel, () => {
    cornerPick = null;
    renderCorner(cornerReveal);
  });
}

let cornerPick: number | null = null;
let cornerReveal = 0;

/** Status of a leaf given what has been revealed: still in, or out in which round of the bracket. */
function leafStatus(b: Bracket, leaf: number, revealLevel: number): string {
  for (let j = 0; j < Math.min(revealLevel, b.levels.length); j++) {
    for (const m of b.levels[j]) {
      if (m?.loser === leaf) return `Knocked out by ${b.leaves[m.winner].you ? 'you' : b.leaves[m.winner].person.name} with ${MOVE_NAMES[m.move]}`;
    }
  }
  const root = b.levels[b.levels.length - 1][0];
  if (revealLevel >= b.levels.length && root?.winner === leaf) return 'Won this bracket';
  return 'Still in';
}

function renderScout(box: HTMLElement, b: Bracket, leaf: number | null, revealLevel: number, close: () => void) {
  if (leaf === null) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  const e = b.leaves[leaf];
  const head = el('div', 'scout-head');
  head.append(el('h3', undefined, e.you ? 'You' : `${e.person.flag} ${e.person.name}`));
  const closeBtn = el('button', 'close', 'Close');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', close);
  head.append(closeBtn);
  box.replaceChildren(head);
  box.hidden = false;
  if (e.you) {
    box.append(
      el('p', 'scout-sub', leafStatus(b, leaf, revealLevel)),
      el('p', 'scout-sub', `So far: ${game.wins} winning throws and ${game.ties} ties. Your habits are the one thing the model can't see.`),
    );
    return;
  }
  box.append(el('p', 'scout-sub', `${e.person.country}. ${leafStatus(b, leaf, revealLevel)}.`));
  const grid = el('div', 'scout-grid');
  const groups: [string, Triple][] = [
    ['After a win', e.profile.win],
    ['After a tie', e.profile.tie],
    ['After a loss', e.profile.lose],
  ];
  for (const [title, row] of groups) {
    const g = el('div');
    g.append(
      el('h4', undefined, title),
      barRow('Stay', row[0], 0.6, 1 / 3),
      barRow('Upgrade', row[1], 0.6, 1 / 3),
      barRow('Downgrade', row[2], 0.6, 1 / 3),
    );
    grid.append(g);
  }
  const fav = e.profile.marg.indexOf(Math.max(...e.profile.marg));
  box.append(
    grid,
    (() => {
      const dl = el('dl', 'eqs');
      dl.append(
        eqRow('Throws observed in the study', `{${e.profile.n}}, favourite {${MOVE_NAMES[fav]}} at ${pct(e.profile.marg[fav])}`),
        eqRow('Your match win chance reading their habits', `V = {${pct(readerWinRate(e.profile))}}`),
        eqRow('Countering average habits instead', `{${pct(habitReaderWinRate(e.profile, popProfile))}}`),
      );
      return dl;
    })(),
  );
}

function startGame() {
  const first = newOpponent(1);
  game = { round: 1, ...first, wins: 0, ties: 0, assisted: $<HTMLInputElement>('assist').checked, phase: 'choose' };
  shownLeft = WORLD_POPULATION;
  $('players-left').textContent = fmt(WORLD_POPULATION);
  renderRound(first.lastText);
}

function nextRound() {
  game.round++;
  const next = newOpponent(game.round);
  game.opponent = next.opponent;
  game.person = next.person;
  game.phase = 'choose';
  renderRound(next.lastText);
}

// ---------- rendering ----------

function animateCount(to: number) {
  const out = $('players-left');
  const from = shownLeft;
  shownLeft = to;
  if (reducedMotion.matches || from === to) {
    out.textContent = fmt(to);
    return;
  }
  const start = performance.now();
  const dur = 700;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - (1 - t) ** 3;
    out.textContent = fmt(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderRound(lastText: string) {
  const r = game.round;
  $('round-num').textContent = String(r);
  animateCount(playersLeft(r - 1));
  $('progress-bar').style.width = `${((r - 1) / TOTAL_ROUNDS) * 100}%`;

  $('opp-kicker').textContent = r === TOTAL_ROUNDS ? 'The final. One opponent left.' : `Round ${r} opponent`;
  $('opp-flag').textContent = game.person.flag;
  $('opp-name').textContent = game.person.name;
  $('opp-from').textContent = game.person.country;
  $('opp-last').textContent = lastText;
  $('who-them').textContent = game.person.name.split(' ')[0];

  for (const id of ['hand-you', 'hand-them']) $(id).classList.remove('won', 'lost', 'pop');
  setGlyph($('glyph-you'), 0);
  setGlyph($('glyph-them'), 0);
  setVerdict('', 'Pick your throw.');
  setThrowsEnabled(true);
  $('next').hidden = true;

  renderLedger();
  renderPrediction();
  renderLadder();
  renderCorner(r - cornerStart);
  updateMinibar();
  for (const g of ['glyph-you', 'glyph-them']) $(g).classList.add('idle');
}

function setVerdict(kind: Outcome | '', text: string) {
  const v = $('verdict');
  v.className = `verdict ${kind}`;
  v.textContent = text;
}

function setThrowsEnabled(on: boolean) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.throw')) b.disabled = !on;
}

function currentDistribution(): Triple {
  const o = game.opponent;
  return o.lastMove === null ? firstMoves : predict(o.profile, o.lastMove, o.lastOutcome);
}

function entropy(dist: Triple) {
  return -dist.reduce((s, p) => (p > 0 ? s + p * Math.log2(p) : s), 0);
}

function renderLedger() {
  const r = game.round;
  const before = playersLeft(r - 1);
  const after = playersLeft(r);
  const outSoFar = WORLD_POPULATION - before;
  const winsNeeded = TOTAL_ROUNDS - r + 1;

  $('eqs').replaceChildren(
    eqRow('Players left before this round', `N${sub(r - 1)} = ⌈8.32×10⁹ / 2${sup(r - 1)}⌉ = {${fmt(before)}}`),
    eqRow('Eliminated this round', `N${sub(r - 1)} − N${sub(r)} = {${fmt(before - after)}}`),
    eqRow(
      'Eliminated so far',
      `{${fmt(outSoFar)}}, a share of 1 − 2${sup(-(r - 1))} ≈ {${pct(outSoFar / WORLD_POPULATION, r > 10 ? 4 : 2)}}`,
    ),
    eqRow(
      'Chance a coin-flipper gets this far',
      r === 1 ? 'Everyone starts here: (½)^(0) = {1}' : `(½)${sup(r - 1)} = {1 in ${formatOneIn(0.5 ** (r - 1))}}`,
    ),
    eqRow(
      `Chance of winning the remaining ${winsNeeded} at p = ½`,
      `(½)${sup(winsNeeded)} = {${sci(0.5 ** winsNeeded)}}, 1 in ${formatOneIn(0.5 ** winsNeeded)}`,
    ),
  );

  const o = game.opponent;
  const dist = currentDistribution();
  const H = entropy(dist);
  const reply = bestReply(dist);
  const edge = dist[beats(reply)] - dist[(reply + 1) % 3];
  const matchP = bestMatchWinRate(o.profile, dist);
  const modelRows: HTMLElement[] = [];
  if (o.lastMove === null) {
    modelRows.push(
      eqRow('Opening throws in the study (R, P, S)', `({${firstMoves.map((p) => p.toFixed(3)).join(', ')}})`),
    );
  } else {
    const key = o.lastOutcome;
    modelRows.push(
      eqRow(
        `After a ${key === 'lose' ? 'loss' : key} with ${MOVE_NAMES[o.lastMove]}`,
        `(${['0', '+', '−'].map((x) => key[0].toUpperCase() + sub(x)).join(', ')}) = ({${o.profile[key].map((p) => p.toFixed(3)).join(', ')}})`,
      ),
    );
  }
  modelRows.push(
    eqRow('Shannon entropy of their next throw', `H = −Σ p_(i) log_(2) p_(i) = {${H.toFixed(3)}} bits (max log_(2) 3 ≈ 1.585)`),
    eqRow('Predictability', `D_(KL)(p ‖ uniform) = log_(2) 3 − H = {${(Math.log2(3) - H).toFixed(3)}} bits`),
    eqRow(
      'Best single-throw edge',
      `max_(a) [P(win) − P(lose)] = {${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)} pts}`,
    ),
    eqRow('Match win chance with perfect play', `V = {${pct(matchP)}} (ties replay; solved by value iteration)`),
    eqRow('Source', `real player #{${o.profileIndex + 1}} of ${profiles.length}, {${o.profile.n}} throws observed`),
  );
  $('model-eqs').replaceChildren(...modelRows);
  renderRun();
}

function renderRun() {
  const k = game.round - 1;
  const throws = game.wins + game.ties;
  const pHat = (k + 1) / (k + 2);
  $('run-eqs').replaceChildren(
    eqRow('Throws so far', `{${game.wins}} wins, {${game.ties}} ties out of {${throws}}`),
    eqRow('Matches won in a row', `k = {${k}}`),
    eqRow(
      'Your match win rate, Laplace estimate',
      `p̂ = (k + 1)/(k + 2) = {${pHat.toFixed(3)}}`,
    ),
    eqRow(
      'p-value that you are just lucky',
      `P(k wins | p = ½) = 2${sup(-k)} = {${sci(0.5 ** k)}}`,
    ),
    eqRow(
      'Projected title odds at p̂',
      `p̂${sup(TOTAL_ROUNDS - k)} = {1 in ${formatOneIn(championOdds(pHat, TOTAL_ROUNDS - k))}}`,
    ),
  );
}

const sub = (n: number | string) => `_(${n})`;

function renderPrediction() {
  const box = $('prediction');
  box.hidden = !$<HTMLInputElement>('assist').checked;
  if (box.hidden || !game) return;
  const dist = currentDistribution();
  $('pred-bars').replaceChildren(...dist.map((p, i) => barRow(MOVE_NAMES[i], p, 1)));
}

function barRow(label: string, value: number, scale: number, tick?: number) {
  const row = el('div', 'bar-row');
  const track = el('div', 'bar-track');
  const fill = el('div', 'bar-fill');
  fill.style.width = `${Math.min(1, value / scale) * 100}%`;
  track.append(fill);
  if (tick !== undefined) {
    const t = el('span', 'tick');
    t.style.left = `${(tick / scale) * 100}%`;
    track.append(t);
  }
  row.append(el('span', undefined, label), track, el('span', 'bar-val', pct(value)));
  return row;
}

function renderLadder(lostAt?: number) {
  const max = Math.log10(WORLD_POPULATION);
  const items: HTMLLIElement[] = [];
  for (let r = 1; r <= TOTAL_ROUNDS; r++) {
    const n = playersLeft(r);
    const li = el('li');
    if (game && r < game.round) li.classList.add('done');
    if (game && r === game.round && lostAt === undefined && game.phase !== 'over') li.classList.add('now');
    if (lostAt === r) li.classList.add('out');
    const rail = el('span', 'rail');
    rail.style.width = `${Math.max(1.5, (Math.log10(n) / max) * 100)}%`;
    const railWrap = el('span');
    railWrap.append(rail);
    li.append(el('span', 'r', `R${r}`), railWrap, el('span', 'n', r === TOTAL_ROUNDS ? '1 champion' : fmt(n)));
    li.setAttribute('aria-label', `After round ${r}: ${fmt(n)} players left`);
    items.push(li);
  }
  $('ladder').replaceChildren(...items);
}

// ---------- play ----------

let counting = false;
const CHANT = ['Rock…', 'Paper…', 'Scissors…'];

/** A quick "rock, paper, scissors, shoot" before the reveal. Skipped for reduced motion. */
function play(mine: Move) {
  if (!game || game.phase !== 'choose' || counting) return;
  if (reducedMotion.matches) return resolve(mine);
  counting = true;
  setThrowsEnabled(false);
  const stage = $('stage');
  for (const id of ['hand-you', 'hand-them']) $(id).classList.remove('won', 'lost', 'pop');
  setGlyph($('glyph-you'), 0);
  setGlyph($('glyph-them'), 0);
  stage.classList.add('counting');
  const verdict = $('verdict');
  verdict.className = 'verdict chant';
  CHANT.forEach((word, i) => setTimeout(() => (verdict.textContent = word), i * 190));
  setTimeout(() => {
    stage.classList.remove('counting');
    counting = false;
    resolve(mine);
  }, CHANT.length * 190);
}

function resolve(mine: Move) {
  const theirs = opponentMove(game.opponent, firstMoves, rng);
  matchThrows++;
  const result = outcomeOf(mine, theirs);

  const you = $('hand-you');
  const them = $('hand-them');
  for (const h of [you, them]) {
    h.classList.remove('won', 'lost', 'pop');
    void h.offsetWidth; // restart the pop animation
    h.classList.add('pop');
  }
  setGlyph($('glyph-you'), mine);
  setGlyph($('glyph-them'), theirs);

  // The opponent remembers this throw for the replay (ties) using their tie row.
  game.opponent.lastMove = theirs;
  game.opponent.lastOutcome = result === 'win' ? 'lose' : result === 'lose' ? 'win' : 'tie';

  const name = game.person.name.split(' ')[0];
  if (result === 'tie') {
    game.ties++;
    setVerdict('tie', `Tie, both ${MOVE_NAMES[mine]}. Throw again. ${name} just tied, so their tie habits apply now.`);
    $('opp-last').textContent = `Just tied with ${MOVE_NAMES[theirs]}.`;
    setThrowsEnabled(true);
    renderLedger();
    renderPrediction();
    return;
  }

  if (result === 'win') {
    game.wins++;
    record(corner, game.round - cornerStart, 0, oppLeaf, mine, matchThrows);
    renderCorner(game.round - cornerStart + 1);
    you.classList.add('won');
    them.classList.add('lost');
    if (game.round === TOTAL_ROUNDS) {
      game.phase = 'over';
      setVerdict('win', `${MOVE_NAMES[mine]} beats ${MOVE_NAMES[theirs]}. You are the world champion.`);
      setThrowsEnabled(false);
      finish(true);
      return;
    }
    game.phase = 'won';
    const left = playersLeft(game.round);
    setVerdict(
      'win',
      `${MOVE_NAMES[mine]} beats ${MOVE_NAMES[theirs]}. ${fmt(left)} players left, ${fmt(playersLeft(game.round - 1) - left)} just went home.`,
    );
    setThrowsEnabled(false);
    animateCount(left);
    updateMinibar();
    $('progress-bar').style.width = `${(game.round / TOTAL_ROUNDS) * 100}%`;
    const next = $<HTMLButtonElement>('next');
    next.textContent = `Play round ${game.round + 1}`;
    next.hidden = false;
    next.focus({ preventScroll: true });
    return;
  }

  record(corner, game.round - cornerStart, oppLeaf, 0, theirs, matchThrows);
  renderCorner(game.round - cornerStart + 1);
  them.classList.add('won');
  you.classList.add('lost');
  game.phase = 'over';
  setThrowsEnabled(false);
  setVerdict('lose', `${MOVE_NAMES[theirs]} beats ${MOVE_NAMES[mine]}. ${game.person.name} knocks you out.`);
  updateMinibar();
  finish(false);
}

// ---------- end of run ----------

const BEST_KEY = 'world-rps-best-round';

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(wins: number) {
  try {
    if (wins > readBest()) localStorage.setItem(BEST_KEY, String(wins));
  } catch {
    /* storage unavailable, nothing to keep */
  }
}

let shareText = '';
const canNativeShare = typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches;

/** Copy through a hidden textarea. It must live inside the open dialog, because a modal makes the rest of the page inert. */
function legacyCopy(text: string): boolean {
  const area = el('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'offscreen';
  $('end-dialog').append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

async function shareResult() {
  const button = $('share');
  if (canNativeShare) {
    try {
      await navigator.share({ text: shareText });
      return;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return; // the viewer closed the share sheet
    }
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(shareText);
    copied = true;
  } catch {
    copied = legacyCopy(shareText);
  }
  if (copied) {
    button.textContent = 'Copied';
    return;
  }
  // Last resort: show the text, selected, so the viewer can copy it themselves.
  const box = $<HTMLTextAreaElement>('share-text');
  box.value = shareText;
  box.hidden = false;
  box.select();
  button.textContent = 'Select and copy the text above';
}

function finish(champion: boolean) {
  const k = champion ? TOTAL_ROUNDS : game.round - 1;
  const previousBest = readBest();
  saveBest(k);
  renderLadder(champion ? undefined : game.round);
  renderRun();

  const beaten = WORLD_POPULATION - playersLeft(k);
  const assisted = $<HTMLInputElement>('assist').checked || game.assisted;
  $('end-kicker').textContent = champion
    ? `All ${TOTAL_ROUNDS} rounds won${assisted ? ', with the model showing' : ''}`
    : `Knocked out in round ${game.round} of ${TOTAL_ROUNDS}`;
  $('end-title').textContent = champion
    ? 'World rock paper scissors champion'
    : `${game.person.flag} ${game.person.name} beat you`;
  $('end-body').textContent = champion
    ? `You beat 33 opponents in a row and outlasted ${fmt(WORLD_POPULATION - 1)} people.`
    : k === 0
      ? `Out in the first round, along with about ${fmt(playersLeft(1))} other people. It happens to half of everyone.`
      : `You won ${k} in a row and outlasted ${fmt(beaten)} people, ${pct(beaten / WORLD_POPULATION, k > 10 ? 4 : 2)} of the planet.` +
        (k > previousBest ? ' That is your best run so far.' : ` Your best is ${Math.max(previousBest, k)}.`);
  $('end-eqs').replaceChildren(
    ...(k === 0
      ? [
          eqRow('Chance of losing round 1 at random', `{½}, the same as everyone else`),
          eqRow('Rounds that were left', `{${TOTAL_ROUNDS}}`),
        ]
      : []),
  );
  if (k > 0) $('end-eqs').replaceChildren(
    eqRow('Probability of this run by pure luck', `2${sup(-k)} = {${sci(0.5 ** k)}}, 1 in ${formatOneIn(0.5 ** k)}`),
    eqRow('Share of the field you outlasted', `1 − 2${sup(-k)} = {${pct(1 - 0.5 ** k, k > 10 ? 6 : 2)}}`),
    eqRow('Rounds that were left', `${TOTAL_ROUNDS} − ${k} = {${TOTAL_ROUNDS - k}}`),
  );
  shareText = champion
    ? `I won all 33 rounds of the World RPS Bracket and beat 8.32 billion people. ${location.href}`
    : `I won ${k} straight in the World RPS Bracket and outlasted ${fmt(beaten)} people (luck odds: 1 in ${formatOneIn(0.5 ** k)}). ${location.href}`;
  $('share').textContent = canNativeShare ? 'Share result' : 'Copy result';
  $('share-text').hidden = true;
  const dialog = $<HTMLDialogElement>('end-dialog');
  setTimeout(() => dialog.showModal(), reducedMotion.matches ? 0 : 650);
}

// ---------- math section ----------

const studyNumbers = (() => {
  const habit = profiles.map((p) => habitReaderWinRate(p, popProfile));
  const perfect = profiles.map((p) => readerWinRate(p));
  const opening = profiles.map((p) => bestMatchWinRate(p, firstMoves));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { habit: mean(habit), perfect: mean(perfect), opening: mean(opening) };
})();

function richCell(text: string) {
  const td = el('td');
  td.append(rich(text));
  return td;
}

function renderMath() {
  const points = [
    { p: 0.5, label: '50%', note: 'Random throws. Ties replay, so every match is a coin flip.' },
    {
      p: studyNumbers.habit,
      label: 'habits',
      note: 'Counter the average habits from the Brockbank & Vul data, seeing only their last winning throw.',
    },
    { p: 0.6, label: '60%', note: 'The "skilled player" figure quoted in the video.' },
    {
      p: studyNumbers.perfect,
      label: 'perfect read',
      note: 'Know each opponent’s own habits exactly. An upper bound from this data.',
    },
    { p: 0.75, label: '75%', note: 'The expert figure from the video.' },
    { p: 0.9, label: '90%', note: 'Near-total read on every opponent.' },
  ];

  const tbody = $('odds-table').querySelector('tbody')!;
  tbody.replaceChildren(
    ...points.map(({ p, note }) => {
      const tr = el('tr');
      const odds = championOdds(p);
      tr.append(el('td', undefined, pct(p)), richCell(sci(odds)), el('td', undefined, `1 in ${formatOneIn(odds)}`), el('td', undefined, note));
      return tr;
    }),
  );

  // Chart: x = p from 0.34 to 0.95, y = log10 P(champion) from -16 to 0.
  const chart = $('odds-chart') as unknown as SVGSVGElement;
  const W = 560, H = 300, L = 64, R = 16, T = 12, B = 40;
  const x0 = 0.34, x1 = 0.95, y0 = -16, y1 = 0;
  const X = (p: number) => L + ((p - x0) / (x1 - x0)) * (W - L - R);
  const Y = (lg: number) => T + ((y1 - lg) / (y1 - y0)) * (H - T - B);
  const g = svg('g', { class: 'axis' }, chart);
  for (let e = 0; e >= -16; e -= 4) {
    svg('line', { x1: L, x2: W - R, y1: Y(e), y2: Y(e), class: 'gridline' }, g);
    const t = svg('text', { x: L - 8, y: Y(e) + 4, 'text-anchor': 'end' }, g);
    t.textContent = e === 0 ? '1' : '10';
    if (e !== 0) svg('tspan', { dy: -6, 'font-size': 10 }, t).textContent = `−${-e}`;
  }
  for (let p = 0.4; p <= 0.95; p += 0.1) {
    const t = svg('text', { x: X(p), y: H - B + 20, 'text-anchor': 'middle' }, g);
    t.textContent = `${Math.round(p * 100)}%`;
  }
  const xl = svg('text', { x: (L + W - R) / 2, y: H - 2, 'text-anchor': 'middle' }, g);
  xl.textContent = 'win rate per match, p';
  let d = '';
  for (let p = x0; p <= x1 + 1e-9; p += 0.005) d += `${d ? 'L' : 'M'}${X(p).toFixed(1)},${Y(33 * Math.log10(p)).toFixed(1)}`;
  svg('path', { d, class: 'curve' }, chart);
  for (const [i, { p, label }] of points.entries()) {
    const pt = svg('g', { class: 'pt' }, chart);
    const cx = X(p), cy = Y(33 * Math.log10(p));
    svg('circle', { cx, cy, r: 4.5 }, pt);
    // Alternate labels above-left and below-right so neighbours don't collide.
    const above = i % 2 === 0;
    const t = svg('text', { x: above ? cx - 8 : cx + 8, y: above ? cy - 10 : cy + 18, 'text-anchor': above ? 'end' : 'start' }, pt);
    t.textContent = label;
  }
  const cursor = svg('g', { class: 'cursor' }, chart);
  const cLine = svg('line', {}, cursor);
  const cDot = svg('circle', { r: 6 }, cursor);

  const slider = $<HTMLInputElement>('p-slider');
  const update = () => {
    const p = Number(slider.value) / 100;
    const odds = championOdds(p);
    $('p-out').textContent = pct(p);
    $('p-pow').replaceChildren(rich(sci(odds)));
    $('p-onein').textContent = formatOneIn(odds);
    const cx = X(p), cy = Y(33 * Math.log10(p));
    cLine.setAttribute('x1', String(cx));
    cLine.setAttribute('x2', String(cx));
    cLine.setAttribute('y1', String(cy));
    cLine.setAttribute('y2', String(H - B));
    cDot.setAttribute('cx', String(cx));
    cDot.setAttribute('cy', String(cy));
  };
  slider.addEventListener('input', update);
  update();
}

function renderStudies() {
  $('ds-players').textContent = fmt(data.source.players);
  $('ds-throws').textContent = fmt(data.source.throws);
  $('ds-lose-stay').textContent = pct(pop.lose[0]);

  const groups: [string, Triple, number[]][] = [
    ['After a win', pop.win as Triple, pop.counts.win],
    ['After a tie', pop.tie as Triple, pop.counts.tie],
    ['After a loss', pop.lose as Triple, pop.counts.lose],
  ];
  $('cr-chart').replaceChildren(
    ...groups.map(([title, row, counts]) => {
      const box = el('div', 'cr-group');
      const h = el('h4', undefined, `${title} `);
      h.append(el('span', 'n', `n = ${fmt(counts.reduce((a, b) => a + b, 0))}`));
      const bars = el('div', 'cr-bars');
      bars.append(
        barRow('Stay', row[0], 0.5, 1 / 3),
        barRow('Upgrade', row[1], 0.5, 1 / 3),
        barRow('Downgrade', row[2], 0.5, 1 / 3),
      );
      box.append(h, bars);
      return box;
    }),
  );

  const findings: [string, string][] = [
    [pct(pop.lose[0]), 'of losers threw the same move again. Random play would give 33.3%.'],
    [pct(firstMoves[1], 0), `of opening throws were paper (n = ${pop.firstCounts.reduce((a, b) => a + b, 0)}). Scissors was rarest at ${pct(firstMoves[2], 0)}.`],
    [pct(studyNumbers.habit), `match win rate from countering average habits. Title odds about 1 in ${formatOneIn(championOdds(studyNumbers.habit))}.`],
    [pct(studyNumbers.perfect), `match win rate if you knew each player's own habits. Title odds about 1 in ${formatOneIn(studyNumbers.opening * studyNumbers.perfect ** 32)}.`],
  ];
  $('findings').replaceChildren(
    ...findings.map(([big, text]) => {
      const f = el('div', 'finding');
      f.append(el('span', 'big', big), el('p', undefined, text));
      return f;
    }),
  );
}

// ---------- sticky score bar and theme ----------

function updateMinibar() {
  if (!game) return;
  $('mb-round').textContent = String(game.round);
  $('mb-left').textContent = fmt(game.phase === 'won' ? playersLeft(game.round) : playersLeft(game.round - 1));
  $('mb-opp').textContent = game.phase === 'over' ? 'Run over' : `vs ${game.person.flag} ${game.person.name}`;
}

function watchScoreline() {
  const bar = $('minibar');
  const target = document.querySelector('.scoreline')!;
  new IntersectionObserver(([entry]) => {
    const above = entry.boundingClientRect.top < 0;
    bar.classList.toggle('show', !entry.isIntersecting && above);
  }).observe(target);
}

const THEME_KEY = 'world-rps-theme';
function applyTheme(theme: string | null) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  $('theme').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  $('theme').textContent = dark ? '☀' : '☾';
}

function initTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    /* storage unavailable */
  }
  applyTheme(saved);
  $('theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage unavailable */
    }
    // Charts read colours from CSS, but redraw so nothing keeps stale state.
    renderMonteCarlo();
  });
}

// ---------- simulations ----------

let simBracket: Bracket | null = null;
let simReveal = 0;
let simTimer = 0;
let simPick: number | null = null;
let simPlaying = false;

function newSimField() {
  clearTimeout(simTimer);
  simPlaying = false;
  simBracket = emptyBracket(uniqueEntrants(32, profiles, rng, 0));
  playBlock(simBracket, 0, 32, firstMoves, rng);
  simReveal = 0;
  simPick = null;
  $<HTMLButtonElement>('sim-run').disabled = false;
  renderSim();
}

function stepSim() {
  if (!simBracket || simReveal >= simBracket.levels.length) return;
  simReveal++;
  renderSim();
}

function renderSim() {
  const svgEl = $('sim-svg') as unknown as SVGSVGElement;
  if (!simBracket) return;
  drawBracket(svgEl, simBracket, {
    revealLevel: simReveal,
    rootLabel: 'Champion',
    picked: simPick,
    onPick: (i) => {
      simPick = simPick === i ? null : i;
      renderSim();
    },
  });
  renderScout($('sim-scout'), simBracket, simPick, simReveal, () => {
    simPick = null;
    renderSim();
  });
  const done = simReveal >= simBracket.levels.length;
  $<HTMLButtonElement>('sim-step').disabled = done || simPlaying;
  $('sim-run').textContent = done ? 'Play a new bracket' : 'Play it out';
  const depth = simBracket.levels.length;
  const left = 32 / 2 ** simReveal;
  $('sim-status').textContent =
    simReveal === 0 ? '32 players, round 1 about to start' : simReveal < depth ? `After round ${simReveal}: ${left} left` : 'Done: 1 champion';

  const played = simBracket.levels.slice(0, simReveal).flat().filter((m) => m !== null);
  const throws = played.reduce((t, m) => t + m.throws, 0);
  const ties = throws - played.length;
  const rows = [
    eqRow('Players left', `N${sub(simReveal)} = 32 / 2${sup(simReveal)} = {${left}}`),
    eqRow('Matches played', `{${played.length}} of 31 (every match removes exactly one player)`),
    eqRow('Throws, including replayed ties', `{${throws}}, of which {${ties}} were ties` + (throws ? ` (${pct(ties / throws)})` : '')),
  ];
  if (simReveal === depth) {
    const champ = simBracket.leaves[simBracket.levels[depth - 1][0]!.winner];
    rows.push(
      eqRow('Champion', `{${champ.person.flag} ${champ.person.name}}, ${champ.person.country}`),
      eqRow('Chance of that by coin flips alone', `(½)${sup(5)} = {1 in 32}`),
      eqRow('Same path for the world', `(½)${sup(33)} = {1 in 8.59 billion}`),
    );
  } else if (played.length) {
    rows.push(eqRow('Latest result', describeMatch(simBracket, played[played.length - 1])));
  }
  $('sim-eqs').replaceChildren(...rows);
}

function runSim() {
  if (!simBracket || simReveal >= simBracket.levels.length) newSimField();
  const button = $<HTMLButtonElement>('sim-run');
  button.disabled = true;
  simPlaying = true;
  const tick = () => {
    stepSim();
    if (simReveal < simBracket!.levels.length) simTimer = window.setTimeout(tick, reducedMotion.matches ? 0 : 900);
    else {
      simPlaying = false;
      button.disabled = false;
      renderSim();
    }
  };
  renderSim();
  simTimer = window.setTimeout(tick, reducedMotion.matches ? 0 : 400);
}

const MC_PLAYERS = 100_000;
let mcCounts: number[] | null = null;
let mcP = 0.6;

function renderMonteCarlo() {
  const svgEl = $('mc-chart') as unknown as SVGSVGElement;
  const width = Math.max(300, Math.round(svgEl.parentElement!.clientWidth - 24));
  const height = width < 480 ? 220 : 260;
  svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svgEl.setAttribute('height', String(height));
  svgEl.replaceChildren();
  if (!mcCounts) return;

  const p = mcP;
  const n = MC_PLAYERS;
  const theory = (r: number) => (r < TOTAL_ROUNDS ? n * p ** r * (1 - p) : n * p ** TOTAL_ROUNDS);
  let maxR = 0;
  for (let r = 0; r <= TOTAL_ROUNDS; r++) if (mcCounts[r] > 0 || theory(r) >= 0.5) maxR = r;
  maxR = Math.min(TOTAL_ROUNDS, Math.max(maxR, 6));

  const L = 44, R = 10, T = 10, B = 34;
  const yMax = Math.ceil(Math.log10(n));
  const X = (r: number) => L + ((r + 0.5) / (maxR + 1)) * (width - L - R);
  const yMin = -0.35; // a little below 10^0 so a count of 1 still gets a visible bar
  const Y = (v: number) => T + (1 - (Math.log10(Math.max(v, 1)) - yMin) / (yMax - yMin)) * (height - T - B);
  const base = height - B;
  const barW = Math.max(2, ((width - L - R) / (maxR + 1)) * 0.7);

  for (let e = 0; e <= yMax; e++) {
    svg('line', { x1: L, x2: width - R, y1: Y(10 ** e), y2: Y(10 ** e), class: 'grid' }, svgEl);
    const t = svg('text', { x: L - 6, y: Y(10 ** e) + 4, 'text-anchor': 'end' }, svgEl);
    t.textContent = e === 0 ? '1' : '10';
    if (e > 0) svg('tspan', { dy: -5, 'font-size': 9 }, t).textContent = String(e);
  }
  const tickEvery = maxR > 20 ? 5 : maxR > 10 ? 2 : 1;
  for (let r = 0; r <= maxR; r += tickEvery) {
    const t = svg('text', { x: X(r), y: height - B + 16, 'text-anchor': 'middle' }, svgEl);
    t.textContent = String(r);
  }
  const xl = svg('text', { x: (L + width - R) / 2, y: height - 4, 'text-anchor': 'middle' }, svgEl);
  xl.textContent = 'matches won before the first loss';

  for (let r = 0; r <= maxR; r++) {
    const c = mcCounts[r];
    if (c > 0) {
      const bar = svg('rect', { x: X(r) - barW / 2, y: Y(c), width: barW, height: base - Y(c), class: `bar${r === TOTAL_ROUNDS ? ' champ' : ''}` }, svgEl);
      svg('title', {}, bar).textContent = `${fmt(c)} players won ${r}`;
    }
    const th = theory(r);
    if (th >= 1) svg('circle', { cx: X(r), cy: Y(th), r: 3.5, class: 'theory' }, svgEl);
  }

  const mean = mcCounts.reduce((s, c, r) => s + c * r, 0) / n;
  const reach10 = mcCounts.slice(10).reduce((a, b) => a + b, 0);
  const champs = mcCounts[TOTAL_ROUNDS];
  $('mc-eqs').replaceChildren(
    eqRow('Average matches won', `simulated {${mean.toFixed(3)}}, theory p/(1 − p) = {${(p / (1 - p)).toFixed(3)}}`),
    eqRow('Reached 10 wins', `simulated {${fmt(reach10)}}, theory n·p${sup(10)} = {${fmt(n * p ** 10)}}`),
    eqRow('World champions', `simulated {${fmt(champs)}}, theory n·p${sup(33)} = {${sci(n * p ** TOTAL_ROUNDS)}}`),
  );
}

function runMonteCarlo() {
  mcP = Number($<HTMLInputElement>('mc-p').value) / 100;
  // Math.random is fine here: this is a statistics demo, and it is much faster than crypto for 10^5+ draws.
  mcCounts = simulateRuns(mcP, MC_PLAYERS, Math.random);
  renderMonteCarlo();
}

// ---------- wiring ----------

function init() {
  initTheme();
  watchScoreline();
  document.querySelectorAll<HTMLButtonElement>('.throw').forEach((b) => {
    const move = Number(b.dataset.move) as Move;
    b.querySelector<HTMLElement>('.glyph')!.innerHTML = GLYPHS[move];
    b.addEventListener('click', () => play(move));
  });
  $('next').addEventListener('click', () => {
    if (game.phase === 'won') nextRound();
  });
  $('assist').addEventListener('change', () => {
    if ($<HTMLInputElement>('assist').checked && game) game.assisted = true;
    renderPrediction();
  });
  $('again').addEventListener('click', () => {
    $<HTMLDialogElement>('end-dialog').close();
    startGame();
    $('game').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  });
  $('share').addEventListener('click', shareResult);
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    if ($<HTMLDialogElement>('end-dialog').open) return;
    const key = e.key.toLowerCase();
    const map: Record<string, Move> = { r: 0, p: 1, s: 2, '1': 0, '2': 1, '3': 2 };
    if (key in map) {
      e.preventDefault();
      play(map[key]);
    } else if (key === 'enter' && game.phase === 'won' && document.activeElement === document.body) {
      nextRound();
    }
  });

  renderMath();
  renderStudies();
  startGame();

  $('sim-run').addEventListener('click', runSim);
  const mcSlider = $<HTMLInputElement>('mc-p');
  mcSlider.addEventListener('input', () => {
    $('mc-p-out').textContent = `${mcSlider.value}%`;
  });
  $('mc-run').addEventListener('click', runMonteCarlo);
  runMonteCarlo();
  $('sim-step').addEventListener('click', stepSim);
  $('sim-new').addEventListener('click', newSimField);
  newSimField();

  let resizeTimer = 0;
  let lastWidth = innerWidth;
  addEventListener('resize', () => {
    if (innerWidth === lastWidth) return;
    lastWidth = innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      renderCorner(game.phase === 'choose' ? game.round - cornerStart : game.round - cornerStart + 1);
      renderSim();
      renderMonteCarlo();
    }, 150);
  });
}

init();
