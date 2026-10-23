# World RPS Bracket

Put all 8.32 billion people on Earth into one single-elimination rock paper scissors bracket. How many games do you have to win to be world champion? 33, because ⌈log₂ 8.32×10⁹⌉ = 33.

**Play it:** https://theshahjee.github.io/world-rps-bracket/

Each opponent has a name and a country (countries are drawn in proportion to population). Their throws come from the measured habits of a real person in a 300-round lab study, so they aren't random. Spot the habit and you win more than half your matches.

## What the page shows

- The match: round *r* of 33, players left, who you're playing and what they won their last game with.
- The live math for the round: players left N<sub>r</sub> = ⌈8.32×10⁹ / 2<sup>r</sup>⌉, how many are knocked out, the chance a coin-flipper gets this far, and the chance of winning the rest at p = ½.
- The opponent's model: their conditional response vector (stay, upgrade, downgrade) after their last result, the Shannon entropy of their next throw, KL divergence from uniform, and the match win chance under perfect play (solved by value iteration, since ties replay).
- Your run: wins, ties, a Laplace estimate of your win rate, and the probability your streak is pure luck.
- Your corner of the bracket, drawn as a tree. The other players in it play each other with their real profiles, so your next opponent is whoever wins the branch next to yours. Tap any name to see that player's habits and your odds against them.
- A 32-player bracket you can watch round by round (32 → 16 → 8 → 4 → 2 → 1), stepping one round at a time or playing it out.
- A Monte Carlo run of 100,000 players at a chosen win rate, plotted against the geometric distribution n·p^r(1 − p).
- An odds calculator for P(champion) = p³³, plotted on a log scale.
- A summary of the studies, with the population statistics computed from the data.

## The numbers

| Per-match win rate | p³³ | Odds | Source |
|---|---|---|---|
| 50.0% | 1.16×10⁻¹⁰ | 1 in 8.59 billion | random play |
| 53.5% | 1.07×10⁻⁹ | 1 in 939 million | countering average habits in the Brockbank & Vul data |
| 60.0% | 4.78×10⁻⁸ | 1 in 20.9 million | figure quoted in the original video |
| 66.6% | 1.52×10⁻⁶ | 1 in 659 thousand (about 1 in 710 thousand with the real opening round) | knowing each opponent's own habits (upper bound) |
| 75.0% | 7.53×10⁻⁵ | 1 in 13.3 thousand | figure quoted in the original video |

The 53.5% and 66.6% rows come from `src/engine.ts` (`habitReaderWinRate`, `readerWinRate`) applied to all 120 player profiles.

## Data and studies

- Opponent behaviour: Brockbank, E. & Vul, E. (2021). Formalizing opponent modeling with the rock, paper, scissors game. *Games* 12(3), 70. [doi:10.3390/g12030070](https://doi.org/10.3390/g12030070). Raw data from [erik-brockbank/rps-dyads](https://github.com/erik-brockbank/rps-dyads): 124 players, 35,969 throws.
- Conditional response model: Wang, Z., Xu, B. & Zhou, H.-J. (2014). Social cycling and conditional responses in the Rock-Paper-Scissors game. *Scientific Reports* 4, 5830. [doi:10.1038/srep05830](https://doi.org/10.1038/srep05830)
- Zhang, H., Moisan, F. & Gonzalez, C. (2021). Rock-Paper-Scissors play: Beyond the win-stay/lose-change strategy. *Games* 12(3), 52. [doi:10.3390/g12030052](https://doi.org/10.3390/g12030052)

The repo holds only derived statistics (`src/data/profiles.json`), not the raw rows. To rebuild them:

```bash
npm run profiles
```

That downloads the CSV into `.cache/`, keeps players with at least 100 rounds, and smooths each conditional row toward the population average with 6 pseudo-observations.

## Development

Everything runs in the browser. There's no server and no tracking. The only thing stored is your best streak, in `localStorage`.

```bash
npm install
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

Pushing to `main` runs the tests and deploys `dist/` to GitHub Pages through `.github/workflows/deploy.yml`.

Stack: TypeScript, Vite, Vitest. No UI framework.

## License

MIT. Opponent names are made up.
