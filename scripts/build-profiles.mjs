// Builds src/data/profiles.json from the Brockbank & Vul (2021) dyad experiment.
// Raw data: https://github.com/erik-brockbank/rps-dyads (data/rps_v1_data.csv)
// Only derived per-player statistics are written to the repo, not the raw rows.
//
// Usage: node scripts/build-profiles.mjs [path/to/rps_v1_data.csv]

import fs from 'node:fs';
import path from 'node:path';

const SOURCE_URL =
  'https://raw.githubusercontent.com/erik-brockbank/rps-dyads/HEAD/data/rps_v1_data.csv';
const CACHE = path.resolve('.cache/rps_v1_data.csv');
const OUT = path.resolve('src/data/profiles.json');
const MIN_ROUNDS = 100;
const SMOOTHING = 6; // pseudo-observations pulled from the population row

const MOVES = { rock: 0, paper: 1, scissors: 2 };
const OUTCOMES = { win: 'win', tie: 'tie', loss: 'lose' };

async function loadCsv(argPath) {
  if (argPath) return fs.readFileSync(argPath, 'utf8');
  if (fs.existsSync(CACHE)) return fs.readFileSync(CACHE, 'utf8');
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, text);
  return text;
}

const zeros = () => [0, 0, 0];
const normalize = (c) => {
  const t = c[0] + c[1] + c[2];
  return t === 0 ? [1 / 3, 1 / 3, 1 / 3] : c.map((x) => x / t);
};
const round3 = (p) => p.map((x) => Math.round(x * 1000) / 1000);

const text = await loadCsv(process.argv[2]);
const rows = text.trim().split('\n').slice(1).map((l) => l.split(','));

// Group rows into one sequence per player per game.
const seqs = new Map();
for (const [gameId, roundIndex, playerId, , move, , outcome] of rows) {
  if (!(move in MOVES) || !(outcome in OUTCOMES)) continue;
  const key = `${gameId}:${playerId}`;
  if (!seqs.has(key)) seqs.set(key, []);
  seqs.get(key).push({ round: +roundIndex, move: MOVES[move], outcome: OUTCOMES[outcome] });
}

// Shift classes relative to the player's own previous move:
// 0 stay, 1 upgrade (play what beats your last move, R->P->S->R), 2 downgrade.
const shiftOf = (prev, next) => (next - prev + 3) % 3;

const pop = { win: zeros(), tie: zeros(), lose: zeros(), marg: zeros(), first: zeros() };
const players = [];

for (const seq of seqs.values()) {
  seq.sort((a, b) => a.round - b.round);
  const p = { win: zeros(), tie: zeros(), lose: zeros(), marg: zeros(), n: seq.length };
  if (seq[0].round === 1) pop.first[seq[0].move]++;
  for (let i = 0; i < seq.length; i++) {
    p.marg[seq[i].move]++;
    const prev = seq[i - 1];
    if (prev && prev.round === seq[i].round - 1) {
      p[prev.outcome][shiftOf(prev.move, seq[i].move)]++;
    }
  }
  for (const k of ['win', 'tie', 'lose', 'marg']) p[k].forEach((c, j) => (pop[k][j] += c));
  players.push(p);
}

const popRows = {
  win: normalize(pop.win),
  tie: normalize(pop.tie),
  lose: normalize(pop.lose),
  marg: normalize(pop.marg),
};
const smooth = (counts, popRow) => normalize(counts.map((c, j) => c + SMOOTHING * popRow[j]));

const profiles = players
  .filter((p) => p.n >= MIN_ROUNDS)
  .map((p) => ({
    n: p.n,
    marg: round3(normalize(p.marg)),
    win: round3(smooth(p.win, popRows.win)),
    tie: round3(smooth(p.tie, popRows.tie)),
    lose: round3(smooth(p.lose, popRows.lose)),
  }));

const out = {
  source: {
    study: 'Brockbank & Vul (2021), Formalizing opponent modeling with the rock, paper, scissors game. Games 12(3), 70.',
    url: 'https://github.com/erik-brockbank/rps-dyads',
    players: players.length,
    games: new Set([...seqs.keys()].map((k) => k.split(':')[0])).size,
    throws: pop.marg[0] + pop.marg[1] + pop.marg[2],
  },
  population: {
    marg: round3(popRows.marg),
    first: round3(normalize(pop.first)),
    firstCounts: pop.first,
    win: round3(popRows.win),
    tie: round3(popRows.tie),
    lose: round3(popRows.lose),
    counts: { win: pop.win, tie: pop.tie, lose: pop.lose },
  },
  profiles,
};

fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`Wrote ${profiles.length} profiles to ${path.relative(process.cwd(), OUT)}`);
console.log(JSON.stringify(out.source), JSON.stringify(out.population));
