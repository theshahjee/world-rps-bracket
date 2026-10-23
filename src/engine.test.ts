import { describe, expect, it } from 'vitest';
import {
  TOTAL_ROUNDS,
  bestMatchWinRate,
  championOdds,
  counter,
  formatOneIn,
  outcomeOf,
  playersLeft,
  predict,
  readerWinRate,
  sample,
  simulateMatch,
  simulateRuns,
  type Profile,
  type Triple,
} from './engine';
import data from './data/profiles.json';

const uniform: Triple = [1 / 3, 1 / 3, 1 / 3];
const randomProfile: Profile = { n: 300, marg: uniform, win: uniform, tie: uniform, lose: uniform };

describe('rules', () => {
  it('scores every pairing', () => {
    expect(outcomeOf(0, 2)).toBe('win'); // rock crushes scissors
    expect(outcomeOf(1, 0)).toBe('win'); // paper covers rock
    expect(outcomeOf(2, 1)).toBe('win'); // scissors cut paper
    expect(outcomeOf(2, 0)).toBe('lose');
    expect(outcomeOf(1, 1)).toBe('tie');
    expect(counter(0)).toBe(1);
  });
});

describe('bracket math', () => {
  it('needs 33 rounds for 8.32 billion people', () => {
    expect(TOTAL_ROUNDS).toBe(33);
    expect(playersLeft(0)).toBe(8_320_000_000);
    expect(playersLeft(4)).toBe(520_000_000);
    expect(playersLeft(10)).toBe(8_125_000);
    expect(playersLeft(20)).toBe(7_935);
    expect(playersLeft(33)).toBe(1);
  });

  it('reproduces the odds quoted in the video', () => {
    expect(1 / championOdds(0.5)).toBeCloseTo(8.59e9, -7);
    expect(Math.round(1 / championOdds(0.6) / 1e6)).toBe(21);
    expect(Math.round(1 / championOdds(0.75) / 1e3)).toBe(13);
  });

  it('formats long odds', () => {
    expect(formatOneIn(championOdds(0.5))).toBe('8.59 billion');
    expect(formatOneIn(0.5)).toBe('2');
  });
});

describe('opponent model', () => {
  it('rotates stay/upgrade/downgrade onto concrete moves', () => {
    const p: Profile = { ...randomProfile, win: [0.6, 0.3, 0.1] };
    // Last throw rock and won: stay = rock, upgrade = paper, downgrade = scissors.
    expect(predict(p, 0, 'win')).toEqual([0.6, 0.3, 0.1]);
    // Last throw scissors: stay = scissors, upgrade = rock, downgrade = paper.
    expect(predict(p, 2, 'win')).toEqual([0.3, 0.1, 0.6]);
  });

  it('samples according to the distribution', () => {
    let i = 0;
    const seq = [0.1, 0.5, 0.95];
    const rng = () => seq[i++];
    expect([sample([0.2, 0.5, 0.3], rng), sample([0.2, 0.5, 0.3], rng), sample([0.2, 0.5, 0.3], rng)]).toEqual([
      0, 1, 2,
    ]);
  });

  it('gives exactly a coin flip against a random player', () => {
    expect(bestMatchWinRate(randomProfile, uniform)).toBeCloseTo(0.5, 9);
  });

  it('beats a predictable player almost every time', () => {
    const repeater: Profile = { ...randomProfile, win: [1, 0, 0], tie: [1, 0, 0] };
    expect(bestMatchWinRate(repeater, predict(repeater, 0, 'win'))).toBeCloseTo(1, 9);
  });

  it('plays out a match between two modelled players', () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const p = data.profiles[0] as Profile;
    const state = { profile: p, profileIndex: 0, lastMove: null, lastOutcome: 'win' as const };
    const first = data.population.first as Triple;
    let winsA = 0;
    for (let i = 0; i < 2000; i++) {
      const m = simulateMatch(state, { ...state }, first, rng);
      expect(m.throws).toBeGreaterThanOrEqual(1);
      winsA += m.winner === 0 ? 1 : 0;
    }
    // Identical players: each side wins about half.
    expect(winsA / 2000).toBeGreaterThan(0.45);
    expect(winsA / 2000).toBeLessThan(0.55);
  });

  it('Monte Carlo runs follow the geometric law P(reach r) = p^r', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = 200_000;
    const counts = simulateRuns(0.6, n, rng);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(n);
    const reached3 = counts.slice(3).reduce((a, b) => a + b, 0) / n;
    expect(reached3).toBeCloseTo(0.6 ** 3, 2);
  });

  it('every real profile is a valid distribution and beatable at 50% or better', () => {
    expect(data.profiles.length).toBeGreaterThan(100);
    for (const p of data.profiles as Profile[]) {
      for (const row of [p.marg, p.win, p.tie, p.lose]) {
        expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 2);
      }
      expect(readerWinRate(p)).toBeGreaterThanOrEqual(0.5 - 1e-3);
    }
  });
});
