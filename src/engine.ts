// Pure game logic: no DOM access, so it can be unit-tested in Node.

export type Move = 0 | 1 | 2; // rock, paper, scissors
export type Outcome = 'win' | 'tie' | 'lose';
export type Triple = [number, number, number];

/** A real player's behaviour, measured from their games in the study. */
export interface Profile {
  n: number;
  marg: Triple;
  // Probability of [stay, upgrade, downgrade] after each outcome of their previous throw.
  // Upgrade means playing the move that beats your own last move (R->P->S->R).
  win: Triple;
  tie: Triple;
  lose: Triple;
}

export const MOVE_NAMES = ['Rock', 'Paper', 'Scissors'] as const;
export const WORLD_POPULATION = 8_320_000_000;
export const TOTAL_ROUNDS = Math.ceil(Math.log2(WORLD_POPULATION)); // 33

export const beats = (a: Move): Move => ((a + 2) % 3) as Move; // the move `a` defeats
export const counter = (a: Move): Move => ((a + 1) % 3) as Move; // the move that defeats `a`

export function outcomeOf(mine: Move, theirs: Move): Outcome {
  if (mine === theirs) return 'tie';
  return beats(mine) === theirs ? 'win' : 'lose';
}

/** Players still in after `round` rounds, in a single-elimination bracket with byes. */
export function playersLeft(round: number, population = WORLD_POPULATION): number {
  return Math.max(1, Math.ceil(population / 2 ** round));
}

/** Probability distribution over the opponent's next move, given their last throw. */
export function predict(profile: Profile, lastMove: Move, lastOutcome: Outcome): Triple {
  const [stay, up, down] = profile[lastOutcome];
  const dist: Triple = [0, 0, 0];
  dist[lastMove] += stay;
  dist[(lastMove + 1) % 3] += up;
  dist[(lastMove + 2) % 3] += down;
  return dist;
}

export type Rng = () => number;

export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
};

export function sample(dist: Triple, rng: Rng): Move {
  const total = dist[0] + dist[1] + dist[2];
  let r = rng() * total;
  for (let i = 0; i < 3; i++) {
    r -= dist[i];
    if (r < 0) return i as Move;
  }
  return 2;
}

/** State the opponent carries into the next throw. */
export interface OpponentState {
  profile: Profile;
  profileIndex: number;
  lastMove: Move | null; // null = they have never thrown (round 1)
  lastOutcome: Outcome;
}

/** The opponent's next move. Round-1 opponents use the study's opening-move frequencies. */
export function opponentMove(state: OpponentState, firstMoves: Triple, rng: Rng): Move {
  if (state.lastMove === null) return sample(firstMoves, rng);
  return sample(predict(state.profile, state.lastMove, state.lastOutcome), rng);
}

/** Odds of winning `rounds` independent matches in a row at a fixed per-match win rate. */
export function championOdds(winRate: number, rounds = TOTAL_ROUNDS): number {
  return winRate ** rounds;
}

/**
 * Chance of winning a whole match (ties replay) against `profile` if you always throw
 * the move that maximises your chance, starting from the opponent distribution `entry`.
 * Tie states are solved by value iteration; it converges in a few dozen steps.
 */
export function bestMatchWinRate(profile: Profile, entry: Triple): number {
  const tieValue: Triple = [0, 0, 0]; // value when the opponent's last throw was m and it tied
  const step = (dist: Triple, v: Triple) => {
    let best = 0;
    for (let a = 0 as Move; a < 3; a = (a + 1) as Move) {
      // We win if they throw what `a` beats; a tie on `a` puts them in tie state `a`.
      const value = dist[beats(a)] + dist[a] * v[a];
      if (value > best) best = value;
    }
    return best;
  };
  for (let iter = 0; iter < 200; iter++) {
    let delta = 0;
    for (let m = 0 as Move; m < 3; m = (m + 1) as Move) {
      const next = step(predict(profile, m, 'tie'), tieValue);
      delta = Math.max(delta, Math.abs(next - tieValue[m]));
      tieValue[m] = next;
    }
    if (delta < 1e-12) break;
  }
  return step(entry, tieValue);
}

/**
 * Match win rate for someone who knows this opponent's habits and sees the move they
 * just won with (as the game shows). Their winning move is weighted by how often they play it.
 */
export function readerWinRate(profile: Profile): number {
  let total = 0;
  for (let m = 0 as Move; m < 3; m = (m + 1) as Move) {
    total += profile.marg[m] * bestMatchWinRate(profile, predict(profile, m, 'win'));
  }
  return total;
}

/** The throw with the best win-minus-loss edge against a predicted distribution. */
export function bestReply(dist: Triple): Move {
  let best: Move = 0;
  let bestEdge = -Infinity;
  for (let a = 0 as Move; a < 3; a = (a + 1) as Move) {
    const edge = dist[beats(a)] - dist[counter(a)];
    if (edge > bestEdge) {
      bestEdge = edge;
      best = a;
    }
  }
  return best;
}

/**
 * Match win rate against `truth` for a player who only knows general human habits
 * (`belief`, usually the population average) and sees the opponent's last winning move.
 */
export function habitReaderWinRate(truth: Profile, belief: Profile): number {
  const tieValue: Triple = [0, 0, 0];
  const value = (lastMove: Move, outcome: Outcome) => {
    const a = bestReply(predict(belief, lastMove, outcome));
    const dist = predict(truth, lastMove, outcome);
    return dist[beats(a)] + dist[a] * tieValue[a];
  };
  for (let iter = 0; iter < 200; iter++) {
    for (let m = 0 as Move; m < 3; m = (m + 1) as Move) tieValue[m] = value(m, 'tie');
  }
  let total = 0;
  for (let m = 0 as Move; m < 3; m = (m + 1) as Move) total += truth.marg[m] * value(m, 'win');
  return total;
}

/** Same as random play: a match is a coin flip because ties replay. */
export const RANDOM_MATCH_WIN_RATE = 0.5;

export function formatOneIn(probability: number): string {
  const n = 1 / probability;
  if (n < 1_000) return Math.round(n).toLocaleString('en-US');
  const units: [number, string][] = [
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
  ];
  for (const [size, word] of units) {
    if (n >= size) return `${(n / size).toFixed(n / size < 10 ? 2 : 1)} ${word}`;
  }
  return Math.round(n).toLocaleString('en-US');
}
