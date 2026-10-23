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
  sample,
  type Move,
  type OpponentState,
  type Outcome,
  type Profile,
  type Triple,
} from './engine';
import { randomPerson, type Person } from './people';

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
  `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 40c-3-9 2-20 11-23 5-6 15-7 21-2 8 1 13 9 11 17-1 8-7 15-16 16H24c-6 0-10-3-12-8z" fill="currentColor" opacity=".9"/><path d="M24 22c4 3 9 3 13 0M38 30c3 2 7 2 10 0" class="crease" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>`,
  // paper
  `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 8h24l10 10v38H16z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><path d="M40 8v10h10M23 30h20M23 38h20M23 46h13" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  // scissors
  `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="17" cy="46" r="8" fill="none" stroke="currentColor" stroke-width="3.5"/><circle cx="17" cy="18" r="8" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M24 22l32 26M24 42L56 16" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>`,
];

function setGlyph(target: HTMLElement, move: Move | null) {
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

function newOpponent(round: number): { opponent: OpponentState; person: Person; lastText: string } {
  const profileIndex = Math.floor(rng() * profiles.length);
  const profile = profiles[profileIndex];
  const person = randomPerson(rng);
  if (round === 1) {
    return {
      person,
      opponent: { profile, profileIndex, lastMove: null, lastOutcome: 'win' },
      lastText: `First game for both of you. In the study, ${pct(firstMoves[1], 0)} of opening throws were paper.`,
    };
  }
  const lastMove = sample(profile.marg, rng);
  const beaten = randomPerson(rng);
  return {
    person,
    opponent: { profile, profileIndex, lastMove, lastOutcome: 'win' },
    lastText: `Record ${round - 1}–0. Last game: won with ${MOVE_NAMES[lastMove]} against ${beaten.name} (${beaten.country}).`,
  };
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
  setGlyph($('glyph-you'), null);
  setGlyph($('glyph-them'), null);
  setVerdict('', 'Pick your throw.');
  setThrowsEnabled(true);
  $('next').hidden = true;

  renderLedger();
  renderPrediction();
  renderLadder();
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

function play(mine: Move) {
  if (!game || game.phase !== 'choose') return;
  const theirs = opponentMove(game.opponent, firstMoves, rng);
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
    renderLedger();
    renderPrediction();
    return;
  }

  if (result === 'win') {
    game.wins++;
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
    $('progress-bar').style.width = `${(game.round / TOTAL_ROUNDS) * 100}%`;
    const next = $<HTMLButtonElement>('next');
    next.textContent = `Play round ${game.round + 1}`;
    next.hidden = false;
    next.focus({ preventScroll: true });
    return;
  }

  them.classList.add('won');
  you.classList.add('lost');
  game.phase = 'over';
  setThrowsEnabled(false);
  setVerdict('lose', `${MOVE_NAMES[theirs]} beats ${MOVE_NAMES[mine]}. ${game.person.name} knocks you out.`);
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
    eqRow('Probability of this run by pure luck', `2${sup(-k)} = {${sci(0.5 ** k)}}, 1 in ${formatOneIn(0.5 ** k)}`),
    eqRow('Share of the field you outlasted', `1 − 2${sup(-k)} = {${pct(1 - 0.5 ** k, k > 10 ? 6 : 2)}}`),
    eqRow('Rounds that were left', `${TOTAL_ROUNDS} − ${k} = {${TOTAL_ROUNDS - k}}`),
  );
  shareText = champion
    ? `I won all 33 rounds of the World RPS Bracket and beat 8.32 billion people. ${location.href}`
    : `I won ${k} straight in the World RPS Bracket and outlasted ${fmt(beaten)} people (luck odds: 1 in ${formatOneIn(0.5 ** k)}). ${location.href}`;
  $('share').textContent = 'Copy result';
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

// ---------- wiring ----------

function init() {
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
  $('share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      $('share').textContent = 'Copied';
    } catch {
      $('share').textContent = 'Copy failed';
    }
  });
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
}

init();
