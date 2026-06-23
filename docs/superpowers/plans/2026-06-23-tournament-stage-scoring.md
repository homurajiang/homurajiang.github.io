# Tournament Stage Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build full group-stage scoring, ranking confirmation, knockout seeding, knockout scoring, and share-state restoration for the existing 12-team badminton tournament page.

**Architecture:** Keep the user flow in `tournament.html`, but move tournament rules into a new pure JavaScript module `js/tournament-core.js`. The page owns DOM rendering, edit permissions, local draft persistence, and KV sharing; the core module owns deterministic group-match generation, score validation, standings, ranking locks, knockout bracket creation, and knockout advancement.

**Tech Stack:** Static HTML/CSS/JavaScript, browser globals, Node's built-in `assert` for pure function tests, existing `js/share.js` and `js/lz-string.min.js`.

## Global Constraints

- Local preview services must bind only to `127.0.0.1` and must be stopped after testing.
- Do not expose `.git/` through a root static server bound to public interfaces.
- Tournament ranking table must display: `排序：胜场 > 净胜分 > 总得分 > 相互胜负 > 手动裁定`.
- Ranking confirmation is manual: standings are computed automatically, but A1-A4/B1-B4 are locked only after the user confirms.
- Old `rulesVersion: 1` tournament links must migrate by generating missing group matches and empty locks.
- Regenerating groups clears group-stage scores, ranking locks, and knockout state.
- Viewer mode is read-only; local and owner modes can edit.

---

## File Structure

- Create `js/tournament-core.js`
  - Exposes `window.TournamentCore` in browsers and `module.exports` in Node.
  - Contains only pure data functions. No DOM, localStorage, network, or toast calls.
- Create `tests/tournament-core.test.js`
  - Runs with `node tests/tournament-core.test.js`.
  - Verifies generation, validation, standings, locks, bracket creation, advancement, reset behavior, and migration.
- Modify `tournament.html`
  - Adds `<script src="js/tournament-core.js"></script>` before the inline page script.
  - Adds CSS for match cards, standings tables, lock state, knockout sections, and invalid score hints.
  - Adds state variables `groupMatches`, `rankingLocks`, and `knockout`.
  - Extends render and event handling.
  - Extends `currentPayload()` and `applyPayload()`.
- Modify `README.md`
  - Updates feature list and sharing notes after implementation.

---

## Task 1: Core Module And Group-Stage Tests

**Files:**
- Create: `js/tournament-core.js`
- Create: `tests/tournament-core.test.js`

**Interfaces:**
- Produces:
  - `TournamentCore.RANKING_RULE_LABEL: string`
  - `TournamentCore.generateGroupMatches(groups: {A: Team[], B: Team[]}): {A: GroupMatch[], B: GroupMatch[]}`
  - `TournamentCore.ensureTournamentState(payload: object): object`
  - `TournamentCore.validateSingleScore(score: {team1: number, team2: number} | null): {valid: boolean, message: string}`
  - `TournamentCore.computeStandings(groupName: 'A' | 'B', teams: Team[], matches: GroupMatch[]): Standing[]`
  - `TournamentCore.canConfirmGroup(standings: Standing[], matches: GroupMatch[]): {ok: boolean, message: string}`
  - `TournamentCore.createRankingLock(groupName: 'A' | 'B', standings: Standing[], now?: string): RankingLock`

- [ ] **Step 1: Create the failing test file**

Add `tests/tournament-core.test.js`:

```js
const assert = require('assert');
const TournamentCore = require('../js/tournament-core.js');

function team(id, name, totalLevel = 10, femaleCount = 0) {
  return {
    id,
    displayName: name,
    totalLevel,
    femaleCount,
    players: [
      { name: `${name}A`, level: totalLevel / 2, gender: 'M' },
      { name: `${name}B`, level: totalLevel / 2, gender: femaleCount > 0 ? 'F' : 'M' },
    ],
  };
}

function groupsFixture() {
  return {
    A: [team('a1', 'A1'), team('a2', 'A2'), team('a3', 'A3'), team('a4', 'A4'), team('a5', 'A5'), team('a6', 'A6')],
    B: [team('b1', 'B1'), team('b2', 'B2'), team('b3', 'B3'), team('b4', 'B4'), team('b5', 'B5'), team('b6', 'B6')],
  };
}

function withScores(matches, scores) {
  return matches.map((match, index) => ({
    ...match,
    score: scores[index] || null,
  }));
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

test('generates 15 deterministic matches per group', () => {
  const matches = TournamentCore.generateGroupMatches(groupsFixture());
  assert.strictEqual(matches.A.length, 15);
  assert.strictEqual(matches.B.length, 15);
  assert.deepStrictEqual(matches.A[0], { id: 'A-1-2', group: 'A', team1Id: 'a1', team2Id: 'a2', score: null });
  assert.deepStrictEqual(matches.A[14], { id: 'A-5-6', group: 'A', team1Id: 'a5', team2Id: 'a6', score: null });
});

test('validates badminton single-game scores', () => {
  assert.strictEqual(TournamentCore.validateSingleScore({ team1: 21, team2: 18 }).valid, true);
  assert.strictEqual(TournamentCore.validateSingleScore({ team1: 22, team2: 20 }).valid, true);
  assert.strictEqual(TournamentCore.validateSingleScore({ team1: 30, team2: 29 }).valid, true);
  assert.strictEqual(TournamentCore.validateSingleScore({ team1: 20, team2: 20 }).valid, false);
  assert.strictEqual(TournamentCore.validateSingleScore({ team1: 21, team2: 20 }).valid, false);
  assert.strictEqual(TournamentCore.validateSingleScore({ team1: 31, team2: 29 }).valid, false);
});

test('computes standings by wins, point differential, points for, and head-to-head', () => {
  const groups = groupsFixture();
  const matches = withScores(TournamentCore.generateGroupMatches(groups).A, [
    { team1: 21, team2: 10 }, // a1 beats a2
    { team1: 21, team2: 11 }, // a1 beats a3
    { team1: 21, team2: 12 }, // a1 beats a4
    { team1: 21, team2: 13 }, // a1 beats a5
    { team1: 21, team2: 14 }, // a1 beats a6
    { team1: 21, team2: 18 }, // a2 beats a3
    { team1: 21, team2: 19 }, // a2 beats a4
    { team1: 21, team2: 17 }, // a2 beats a5
    { team1: 21, team2: 16 }, // a2 beats a6
    { team1: 21, team2: 15 }, // a3 beats a4
    { team1: 21, team2: 16 }, // a3 beats a5
    { team1: 21, team2: 17 }, // a3 beats a6
    { team1: 21, team2: 19 }, // a4 beats a5
    { team1: 21, team2: 20 }, // invalid score should not count
    { team1: 21, team2: 18 }, // a5 beats a6
  ]);
  const standings = TournamentCore.computeStandings('A', groups.A, matches);
  assert.deepStrictEqual(standings.slice(0, 4).map(row => row.teamId), ['a1', 'a2', 'a3', 'a5']);
  assert.strictEqual(standings[0].wins, 5);
  assert.strictEqual(standings[0].played, 5);
});

test('confirms ranking only after all matches have valid scores', () => {
  const groups = groupsFixture();
  const generated = TournamentCore.generateGroupMatches(groups).A;
  const incompleteStandings = TournamentCore.computeStandings('A', groups.A, generated);
  assert.strictEqual(TournamentCore.canConfirmGroup(incompleteStandings, generated).ok, false);
  const completeMatches = generated.map((match, index) => ({
    ...match,
    score: index % 2 === 0 ? { team1: 21, team2: 15 } : { team1: 15, team2: 21 },
  }));
  const standings = TournamentCore.computeStandings('A', groups.A, completeMatches);
  assert.strictEqual(TournamentCore.canConfirmGroup(standings, completeMatches).ok, true);
  const lock = TournamentCore.createRankingLock('A', standings, '2026-06-23T00:00:00.000Z');
  assert.strictEqual(lock.confirmedAt, '2026-06-23T00:00:00.000Z');
  assert.deepStrictEqual(lock.seeds.map(seed => seed.seed), ['A1', 'A2', 'A3', 'A4']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node tests/tournament-core.test.js
```

Expected: failure because `../js/tournament-core.js` does not exist.

- [ ] **Step 3: Add `js/tournament-core.js` with group-stage behavior**

Implement the module with these exact top-level exports:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TournamentCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const RANKING_RULE_LABEL = '排序：胜场 > 净胜分 > 总得分 > 相互胜负 > 手动裁定';

  function toNumber(value) {
    const num = Number(value);
    return Number.isInteger(num) ? num : NaN;
  }

  function validateSingleScore(score) {
    if (!score) return { valid: false, message: '请输入比分' };
    const team1 = toNumber(score.team1);
    const team2 = toNumber(score.team2);
    if (!Number.isFinite(team1) || !Number.isFinite(team2)) return { valid: false, message: '比分必须是整数' };
    if (team1 < 0 || team2 < 0) return { valid: false, message: '比分不能为负数' };
    if (team1 > 30 || team2 > 30) return { valid: false, message: '单局最高 30 分' };
    if (team1 === team2) return { valid: false, message: '比分不能相同' };
    const winner = Math.max(team1, team2);
    const loser = Math.min(team1, team2);
    if (winner < 21) return { valid: false, message: '胜方至少 21 分' };
    if (winner < 30 && winner - loser < 2) return { valid: false, message: '20 平后需领先 2 分' };
    return { valid: true, message: '' };
  }

  function generateMatchesForGroup(groupName, teams) {
    const list = Array.isArray(teams) ? teams : [];
    const matches = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        matches.push({
          id: `${groupName}-${i + 1}-${j + 1}`,
          group: groupName,
          team1Id: list[i].id,
          team2Id: list[j].id,
          score: null,
        });
      }
    }
    return matches;
  }

  function generateGroupMatches(groups) {
    return {
      A: generateMatchesForGroup('A', groups && groups.A),
      B: generateMatchesForGroup('B', groups && groups.B),
    };
  }

  function findHeadToHeadWinner(teamAId, teamBId, matches) {
    const match = (matches || []).find(item =>
      (item.team1Id === teamAId && item.team2Id === teamBId) ||
      (item.team1Id === teamBId && item.team2Id === teamAId)
    );
    if (!match || !validateSingleScore(match.score).valid) return null;
    const team1Won = Number(match.score.team1) > Number(match.score.team2);
    return team1Won ? match.team1Id : match.team2Id;
  }

  function computeStandings(groupName, teams, matches) {
    const groupOrder = new Map((teams || []).map((team, index) => [team.id, index]));
    const rows = new Map((teams || []).map((team, index) => [team.id, {
      group: groupName,
      teamId: team.id,
      team,
      groupOrder: index,
      played: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      rank: index + 1,
      needsManualDecision: false,
    }]));

    (matches || []).forEach(match => {
      if (!validateSingleScore(match.score).valid) return;
      const row1 = rows.get(match.team1Id);
      const row2 = rows.get(match.team2Id);
      if (!row1 || !row2) return;
      const s1 = Number(match.score.team1);
      const s2 = Number(match.score.team2);
      row1.played += 1;
      row2.played += 1;
      row1.pointsFor += s1;
      row1.pointsAgainst += s2;
      row2.pointsFor += s2;
      row2.pointsAgainst += s1;
      if (s1 > s2) {
        row1.wins += 1;
        row2.losses += 1;
      } else {
        row2.wins += 1;
        row1.losses += 1;
      }
    });

    const sorted = Array.from(rows.values()).map(row => ({
      ...row,
      pointDiff: row.pointsFor - row.pointsAgainst,
    })).sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
      const h2h = findHeadToHeadWinner(a.teamId, b.teamId, matches);
      if (h2h === a.teamId) return -1;
      if (h2h === b.teamId) return 1;
      return (groupOrder.get(a.teamId) || 0) - (groupOrder.get(b.teamId) || 0);
    });

    for (let i = 0; i < sorted.length; i++) sorted[i].rank = i + 1;
    return markManualDecisionRows(sorted);
  }

  function sameAutomaticRankKey(a, b) {
    return a.wins === b.wins && a.pointDiff === b.pointDiff && a.pointsFor === b.pointsFor;
  }

  function markManualDecisionRows(rows) {
    return rows.map((row, index, all) => {
      const prev = all[index - 1];
      const next = all[index + 1];
      return {
        ...row,
        needsManualDecision: !!((prev && sameAutomaticRankKey(prev, row)) || (next && sameAutomaticRankKey(next, row))),
      };
    });
  }

  function canConfirmGroup(standings, matches) {
    const allComplete = (matches || []).length > 0 && matches.every(match => validateSingleScore(match.score).valid);
    if (!allComplete) return { ok: false, message: '小组赛比分未录完' };
    const topSeeds = (standings || []).slice(0, 4);
    if (topSeeds.some(row => row.needsManualDecision)) return { ok: false, message: '前四名存在同分同净胜分同总得分，需要手动裁定' };
    return { ok: true, message: '' };
  }

  function createRankingLock(groupName, standings, now) {
    return {
      confirmedAt: now || new Date().toISOString(),
      seeds: (standings || []).slice(0, 4).map((row, index) => ({
        seed: `${groupName}${index + 1}`,
        teamId: row.teamId,
      })),
    };
  }

  function ensureTournamentState(payload) {
    const next = { ...(payload || {}) };
    if (!next.groupMatches && next.groups) next.groupMatches = generateGroupMatches(next.groups);
    if (!next.rankingLocks) next.rankingLocks = { A: null, B: null };
    if (!('knockout' in next)) next.knockout = null;
    if (!next.rulesVersion || next.rulesVersion < 2) next.rulesVersion = 2;
    return next;
  }

  return {
    RANKING_RULE_LABEL,
    generateGroupMatches,
    ensureTournamentState,
    validateSingleScore,
    computeStandings,
    canConfirmGroup,
    createRankingLock,
  };
});
```

- [ ] **Step 4: Run the tests**

Run:

```bash
node tests/tournament-core.test.js
```

Expected: all current tests print `PASS`.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add js/tournament-core.js tests/tournament-core.test.js
git commit -m "feat: add tournament group scoring core"
```

---

## Task 2: Knockout Core And Tests

**Files:**
- Modify: `js/tournament-core.js`
- Modify: `tests/tournament-core.test.js`

**Interfaces:**
- Consumes:
  - `createRankingLock(groupName, standings, now)`
  - `validateSingleScore(score)`
- Produces:
  - `TournamentCore.createKnockout(rankingLocks: {A: RankingLock, B: RankingLock}, now?: string): KnockoutState`
  - `TournamentCore.validateBestOfThree(games: Game[] | null): {valid: boolean, complete: boolean, winnerSide: 'team1' | 'team2' | null, message: string}`
  - `TournamentCore.updateKnockoutMatch(knockout: KnockoutState, matchId: string, scoreData: object | null): KnockoutState`

- [ ] **Step 1: Add knockout tests**

Append to `tests/tournament-core.test.js`:

```js
test('creates knockout bracket from locked A and B seeds', () => {
  const locks = {
    A: { confirmedAt: '2026-06-23T00:00:00.000Z', seeds: [
      { seed: 'A1', teamId: 'a1' }, { seed: 'A2', teamId: 'a2' }, { seed: 'A3', teamId: 'a3' }, { seed: 'A4', teamId: 'a4' },
    ] },
    B: { confirmedAt: '2026-06-23T00:00:00.000Z', seeds: [
      { seed: 'B1', teamId: 'b1' }, { seed: 'B2', teamId: 'b2' }, { seed: 'B3', teamId: 'b3' }, { seed: 'B4', teamId: 'b4' },
    ] },
  };
  const knockout = TournamentCore.createKnockout(locks, '2026-06-23T01:00:00.000Z');
  assert.strictEqual(knockout.generatedAt, '2026-06-23T01:00:00.000Z');
  assert.deepStrictEqual(knockout.rounds.quarterfinals.map(match => [match.id, match.team1Id, match.team2Id]), [
    ['QF1', 'a1', 'b4'],
    ['QF2', 'a2', 'b3'],
    ['QF3', 'a3', 'b2'],
    ['QF4', 'a4', 'b1'],
  ]);
});

test('advances knockout winners and semifinal losers', () => {
  const locks = {
    A: { confirmedAt: 'x', seeds: [{ seed: 'A1', teamId: 'a1' }, { seed: 'A2', teamId: 'a2' }, { seed: 'A3', teamId: 'a3' }, { seed: 'A4', teamId: 'a4' }] },
    B: { confirmedAt: 'x', seeds: [{ seed: 'B1', teamId: 'b1' }, { seed: 'B2', teamId: 'b2' }, { seed: 'B3', teamId: 'b3' }, { seed: 'B4', teamId: 'b4' }] },
  };
  let knockout = TournamentCore.createKnockout(locks, 'x');
  knockout = TournamentCore.updateKnockoutMatch(knockout, 'QF1', { score: { team1: 21, team2: 10 } });
  knockout = TournamentCore.updateKnockoutMatch(knockout, 'QF2', { score: { team1: 21, team2: 11 } });
  knockout = TournamentCore.updateKnockoutMatch(knockout, 'QF3', { score: { team1: 12, team2: 21 } });
  knockout = TournamentCore.updateKnockoutMatch(knockout, 'QF4', { score: { team1: 15, team2: 21 } });
  assert.deepStrictEqual(knockout.rounds.semifinals.map(match => [match.team1Id, match.team2Id]), [['a1', 'a2'], ['b2', 'b1']]);

  knockout = TournamentCore.updateKnockoutMatch(knockout, 'SF1', { score: { team1: 21, team2: 19 } });
  knockout = TournamentCore.updateKnockoutMatch(knockout, 'SF2', { score: { team1: 18, team2: 21 } });
  assert.deepStrictEqual(knockout.rounds.final.map(match => [match.team1Id, match.team2Id]), [['a1', 'b1']]);
  assert.deepStrictEqual(knockout.rounds.thirdPlace.map(match => [match.team1Id, match.team2Id]), [['a2', 'b2']]);
});

test('validates best-of-three final scoring', () => {
  assert.deepStrictEqual(
    TournamentCore.validateBestOfThree([{ team1: 21, team2: 18 }, { team1: 19, team2: 21 }, { team1: 21, team2: 19 }]),
    { valid: true, complete: true, winnerSide: 'team1', message: '' }
  );
  assert.strictEqual(TournamentCore.validateBestOfThree([{ team1: 21, team2: 18 }]).complete, false);
  assert.strictEqual(TournamentCore.validateBestOfThree([{ team1: 21, team2: 20 }, { team1: 21, team2: 18 }]).valid, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node tests/tournament-core.test.js
```

Expected: failure because knockout exports are not implemented.

- [ ] **Step 3: Implement knockout functions**

Add these functions to `js/tournament-core.js` before the `return` block, then add them to the returned API:

```js
function seedMapFromLocks(rankingLocks) {
  const map = {};
  ['A', 'B'].forEach(groupName => {
    (((rankingLocks || {})[groupName] || {}).seeds || []).forEach(seed => {
      map[seed.seed] = seed.teamId;
    });
  });
  return map;
}

function knockoutMatch(id, label, source1, source2, team1Id, team2Id, scoreMode) {
  return {
    id,
    label,
    source1,
    source2,
    team1Id: team1Id || null,
    team2Id: team2Id || null,
    scoreMode,
    score: null,
    games: null,
    winnerId: null,
    loserId: null,
  };
}

function createKnockout(rankingLocks, now) {
  const seeds = seedMapFromLocks(rankingLocks);
  return {
    generatedAt: now || new Date().toISOString(),
    rounds: {
      quarterfinals: [
        knockoutMatch('QF1', '1/4 决赛 1', 'A1', 'B4', seeds.A1, seeds.B4, 'single'),
        knockoutMatch('QF2', '1/4 决赛 2', 'A2', 'B3', seeds.A2, seeds.B3, 'single'),
        knockoutMatch('QF3', '1/4 决赛 3', 'A3', 'B2', seeds.A3, seeds.B2, 'single'),
        knockoutMatch('QF4', '1/4 决赛 4', 'A4', 'B1', seeds.A4, seeds.B1, 'single'),
      ],
      semifinals: [
        knockoutMatch('SF1', '半决赛 1', 'QF1 胜者', 'QF2 胜者', null, null, 'single'),
        knockoutMatch('SF2', '半决赛 2', 'QF3 胜者', 'QF4 胜者', null, null, 'single'),
      ],
      thirdPlace: [
        knockoutMatch('TP', '季军赛', 'SF1 负者', 'SF2 负者', null, null, 'bestOfThree'),
      ],
      final: [
        knockoutMatch('F', '决赛', 'SF1 胜者', 'SF2 胜者', null, null, 'bestOfThree'),
      ],
    },
  };
}

function cloneKnockout(knockout) {
  return JSON.parse(JSON.stringify(knockout));
}

function allKnockoutMatches(knockout) {
  return [
    ...(knockout.rounds.quarterfinals || []),
    ...(knockout.rounds.semifinals || []),
    ...(knockout.rounds.thirdPlace || []),
    ...(knockout.rounds.final || []),
  ];
}

function sideWinner(match, side) {
  return side === 'team1' ? match.team1Id : match.team2Id;
}

function sideLoser(match, side) {
  return side === 'team1' ? match.team2Id : match.team1Id;
}

function evaluateSingleMatch(match) {
  if (!match.team1Id || !match.team2Id || !validateSingleScore(match.score).valid) {
    return { winnerId: null, loserId: null };
  }
  const team1Won = Number(match.score.team1) > Number(match.score.team2);
  return {
    winnerId: team1Won ? match.team1Id : match.team2Id,
    loserId: team1Won ? match.team2Id : match.team1Id,
  };
}

function validateBestOfThree(games) {
  const list = (games || []).filter(game => game && (game.team1 !== '' || game.team2 !== ''));
  if (list.length === 0) return { valid: false, complete: false, winnerSide: null, message: '请输入比分' };
  let team1Wins = 0;
  let team2Wins = 0;
  for (const game of list.slice(0, 3)) {
    const validation = validateSingleScore(game);
    if (!validation.valid) return { valid: false, complete: false, winnerSide: null, message: validation.message };
    if (Number(game.team1) > Number(game.team2)) team1Wins += 1;
    else team2Wins += 1;
    if (team1Wins === 2) return { valid: true, complete: true, winnerSide: 'team1', message: '' };
    if (team2Wins === 2) return { valid: true, complete: true, winnerSide: 'team2', message: '' };
  }
  return { valid: true, complete: false, winnerSide: null, message: '' };
}

function evaluateBestOfThreeMatch(match) {
  if (!match.team1Id || !match.team2Id) return { winnerId: null, loserId: null };
  const validation = validateBestOfThree(match.games);
  if (!validation.valid || !validation.complete) return { winnerId: null, loserId: null };
  return {
    winnerId: sideWinner(match, validation.winnerSide),
    loserId: sideLoser(match, validation.winnerSide),
  };
}

function resetMatchResult(match) {
  match.score = null;
  match.games = null;
  match.winnerId = null;
  match.loserId = null;
}

function assignAdvancedTeams(knockout) {
  const qf = knockout.rounds.quarterfinals;
  const sf = knockout.rounds.semifinals;
  const third = knockout.rounds.thirdPlace[0];
  const final = knockout.rounds.final[0];

  sf[0].team1Id = qf[0].winnerId;
  sf[0].team2Id = qf[1].winnerId;
  sf[1].team1Id = qf[2].winnerId;
  sf[1].team2Id = qf[3].winnerId;

  final.team1Id = sf[0].winnerId;
  final.team2Id = sf[1].winnerId;
  third.team1Id = sf[0].loserId;
  third.team2Id = sf[1].loserId;
}

function clearInvalidDownstreamResults(knockout) {
  allKnockoutMatches(knockout).forEach(match => {
    if ((match.score || match.games) && (!match.team1Id || !match.team2Id)) {
      resetMatchResult(match);
    }
  });
}

function recalculateKnockout(knockout) {
  allKnockoutMatches(knockout).forEach(match => {
    const result = match.scoreMode === 'bestOfThree' ? evaluateBestOfThreeMatch(match) : evaluateSingleMatch(match);
    match.winnerId = result.winnerId;
    match.loserId = result.loserId;
  });
  assignAdvancedTeams(knockout);
  clearInvalidDownstreamResults(knockout);
  allKnockoutMatches(knockout).forEach(match => {
    const result = match.scoreMode === 'bestOfThree' ? evaluateBestOfThreeMatch(match) : evaluateSingleMatch(match);
    match.winnerId = result.winnerId;
    match.loserId = result.loserId;
  });
  assignAdvancedTeams(knockout);
  return knockout;
}

function updateKnockoutMatch(knockout, matchId, scoreData) {
  const next = cloneKnockout(knockout);
  const match = allKnockoutMatches(next).find(item => item.id === matchId);
  if (!match) return next;
  if (!scoreData) {
    resetMatchResult(match);
  } else if (match.scoreMode === 'bestOfThree') {
    match.games = Array.isArray(scoreData.games) ? scoreData.games.slice(0, 3) : null;
    match.score = null;
  } else {
    match.score = scoreData.score || null;
    match.games = null;
  }
  return recalculateKnockout(next);
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
node tests/tournament-core.test.js
```

Expected: all tests print `PASS`.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add js/tournament-core.js tests/tournament-core.test.js
git commit -m "feat: add tournament knockout core"
```

---

## Task 3: Wire Tournament Page State And Persistence

**Files:**
- Modify: `tournament.html`

**Interfaces:**
- Consumes:
  - `window.TournamentCore.generateGroupMatches(groups)`
  - `window.TournamentCore.ensureTournamentState(payload)`
  - `window.TournamentCore.createKnockout(rankingLocks)`
- Produces:
  - Page state variables: `groupMatches`, `rankingLocks`, `knockout`
  - Extended `currentPayload()`
  - Migrating `applyPayload(payload)`

- [ ] **Step 1: Add script include**

In `tournament.html`, change the script block from:

```html
<script src="js/lz-string.min.js"></script>
<script src="js/share.js"></script>
<script>
```

to:

```html
<script src="js/lz-string.min.js"></script>
<script src="js/share.js"></script>
<script src="js/tournament-core.js"></script>
<script>
```

- [ ] **Step 2: Add page state variables**

Near existing state:

```js
let shareId = null;
let groups = null;
let metrics = null;
let generatedAt = null;
let latestRemoteUpdatedAt = null;
```

replace with:

```js
let shareId = null;
let groups = null;
let metrics = null;
let generatedAt = null;
let latestRemoteUpdatedAt = null;
let groupMatches = { A: [], B: [] };
let rankingLocks = { A: null, B: null };
let knockout = null;
const Core = window.TournamentCore;
```

- [ ] **Step 3: Extend payload saving**

In `currentPayload()`, return:

```js
return {
  type: 'tournament_grouping',
  name: nameInput.value.trim() || '羽毛球比赛分组',
  candidateCount: Number(candidateInput.value) || 500,
  teams,
  groups,
  metrics,
  generatedAt,
  groupMatches,
  rankingLocks,
  knockout,
  rulesVersion: 2,
};
```

- [ ] **Step 4: Extend payload loading and migration**

In `applyPayload(payload)`, normalize first and assign new state:

```js
function applyPayload(payload) {
  if (!payload) return;
  const normalized = Core.ensureTournamentState(payload);
  nameInput.value = normalized.name || '';
  candidateInput.value = normalized.candidateCount || 500;
  renderTeamInputs(normalizeTeamsFromPayload(normalized));
  groups = normalized.groups || null;
  metrics = normalized.metrics || null;
  generatedAt = normalized.generatedAt || null;
  groupMatches = normalized.groupMatches || { A: [], B: [] };
  rankingLocks = normalized.rankingLocks || { A: null, B: null };
  knockout = normalized.knockout || null;
  latestRemoteUpdatedAt = normalized.updatedAt || null;
  renderResult();
}
```

- [ ] **Step 5: Reset tournament state on generation and clear**

In `generate()`, after `groups = { A: result.A, B: result.B };`, add:

```js
groupMatches = Core.generateGroupMatches(groups);
rankingLocks = { A: null, B: null };
knockout = null;
```

In the clear button handler, add:

```js
groupMatches = { A: [], B: [] };
rankingLocks = { A: null, B: null };
knockout = null;
```

- [ ] **Step 6: Run syntax and core tests**

Run:

```bash
node tests/tournament-core.test.js
```

Expected: all tests print `PASS`.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add tournament.html
git commit -m "feat: persist tournament scoring state"
```

---

## Task 4: Render Group Matches, Scoring, And Standings

**Files:**
- Modify: `tournament.html`

**Interfaces:**
- Consumes:
  - Page state from Task 3
  - `Core.validateSingleScore(score)`
  - `Core.computeStandings(groupName, groups[groupName], groupMatches[groupName])`
  - `Core.canConfirmGroup(standings, matches)`
  - `Core.createRankingLock(groupName, standings)`

- [ ] **Step 1: Add CSS for scoring UI**

Add styles near existing group/bracket styles:

```css
.stage-section { margin-top: 1rem; border-top: 1px solid var(--gray-100); padding-top: 1rem; }
.stage-header { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: .75rem; flex-wrap: wrap; }
.stage-title { font-weight: 800; color: var(--gray-900); }
.stage-meta { color: var(--gray-500); font-size: .86rem; }
.schedule-list { display: flex; flex-direction: column; gap: .55rem; }
.schedule-match { border: 1px solid var(--gray-100); border-radius: 8px; padding: .65rem; background: #fff; display: grid; grid-template-columns: 1fr auto; gap: .65rem; align-items: center; }
.schedule-match.locked { background: var(--gray-50); }
.match-title { font-weight: 750; color: var(--gray-900); }
.match-subtitle { margin-top: .18rem; color: var(--gray-500); font-size: .82rem; }
.score-editor { display: flex; align-items: center; gap: .35rem; }
.score-editor input { width: 3.8rem; padding: .45rem .35rem; border: 1px solid var(--gray-200); border-radius: 8px; text-align: center; font-weight: 800; }
.score-editor .sep { color: var(--gray-400); font-weight: 800; }
.score-error { grid-column: 1 / -1; color: var(--danger); font-size: .82rem; }
.standings-table { width: 100%; border-collapse: collapse; margin-top: .75rem; font-size: .88rem; }
.standings-table th, .standings-table td { border-bottom: 1px solid var(--gray-100); padding: .48rem .35rem; text-align: left; }
.standings-table th { color: var(--gray-500); font-weight: 800; background: var(--gray-50); }
.standings-table .rank-cell { font-weight: 900; color: var(--primary); }
.standings-table .manual-flag { color: var(--danger); font-size: .78rem; }
.lock-banner { margin-top: .75rem; padding: .65rem .75rem; border-radius: 8px; background: #ecfdf5; color: #047857; font-weight: 700; }
@media (max-width: 640px) {
  .schedule-match { grid-template-columns: 1fr; }
  .score-editor { justify-content: flex-start; }
}
```

- [ ] **Step 2: Add render helpers**

Add these functions after `renderGroup()`:

```js
function teamById(id) {
  const all = [...((groups || {}).A || []), ...((groups || {}).B || [])];
  return all.find(team => team.id === id) || null;
}

function shortTeamName(team) {
  if (!team || !Array.isArray(team.players)) return '待定';
  return team.players.map(player => player.name).join(' / ');
}

function handicapText(team1, team2) {
  if (!team1 || !team2) return '';
  const diff = (team1.femaleCount || 0) - (team2.femaleCount || 0);
  if (diff === 0) return '无让分';
  if (diff > 0) return `${shortTeamName(team1)} 开局 +${diff * 4}`;
  return `${shortTeamName(team2)} 开局 +${Math.abs(diff) * 4}`;
}

function renderScoreInputs(match, disabled) {
  const score = match.score || {};
  return `
    <div class="score-editor">
      <input type="number" min="0" max="30" data-score-side="team1" value="${score.team1 ?? ''}" ${disabled ? 'disabled' : ''}>
      <span class="sep">:</span>
      <input type="number" min="0" max="30" data-score-side="team2" value="${score.team2 ?? ''}" ${disabled ? 'disabled' : ''}>
    </div>
  `;
}

function renderGroupStage(groupName) {
  const matches = (groupMatches || {})[groupName] || [];
  const standings = Core.computeStandings(groupName, groups[groupName] || [], matches);
  const completion = matches.filter(match => Core.validateSingleScore(match.score).valid).length;
  const lock = rankingLocks[groupName];
  const confirmState = Core.canConfirmGroup(standings, matches);
  return `
    <div class="stage-section" data-group-stage="${groupName}">
      <div class="stage-header">
        <div>
          <div class="stage-title">${groupName} 组小组赛</div>
          <div class="stage-meta">${completion} / ${matches.length} 场已完成</div>
        </div>
        ${lock
          ? `<button class="btn btn-secondary unlock-ranking-btn" data-group="${groupName}">解锁排名</button>`
          : `<button class="btn btn-primary confirm-ranking-btn" data-group="${groupName}" ${confirmState.ok ? '' : 'disabled'}>确认排名</button>`}
      </div>
      <div class="schedule-list">
        ${matches.map(match => {
          const team1 = teamById(match.team1Id);
          const team2 = teamById(match.team2Id);
          const validation = match.score ? Core.validateSingleScore(match.score) : { valid: true, message: '' };
          return `
            <div class="schedule-match ${lock ? 'locked' : ''}" data-group="${groupName}" data-match-id="${match.id}">
              <div>
                <div class="match-title">${escapeHtml(shortTeamName(team1))} vs ${escapeHtml(shortTeamName(team2))}</div>
                <div class="match-subtitle">${escapeHtml(handicapText(team1, team2))}</div>
              </div>
              ${renderScoreInputs(match, !!lock)}
              ${validation.valid ? '' : `<div class="score-error">${escapeHtml(validation.message)}</div>`}
            </div>`;
        }).join('')}
      </div>
      ${renderStandings(groupName, standings)}
      ${lock ? `<div class="lock-banner">${groupName} 组排名已确认：${lock.seeds.map(seed => `${seed.seed} ${escapeHtml(shortTeamName(teamById(seed.teamId)))}`).join('，')}</div>` : ''}
      ${!lock && !confirmState.ok ? `<div class="hint" style="margin-top:.65rem;">${escapeHtml(confirmState.message)}</div>` : ''}
    </div>
  `;
}

function renderStandings(groupName, standings) {
  return `
    <table class="standings-table">
      <thead>
        <tr><th colspan="8">${groupName} 组排名 · ${Core.RANKING_RULE_LABEL}</th></tr>
        <tr><th>#</th><th>队伍</th><th>场</th><th>胜</th><th>负</th><th>得分</th><th>失分</th><th>净胜分</th></tr>
      </thead>
      <tbody>
        ${standings.map(row => `
          <tr>
            <td class="rank-cell">${row.rank}</td>
            <td>${escapeHtml(shortTeamName(row.team))}${row.needsManualDecision ? '<div class="manual-flag">需手动裁定</div>' : ''}</td>
            <td>${row.played}</td>
            <td>${row.wins}</td>
            <td>${row.losses}</td>
            <td>${row.pointsFor}</td>
            <td>${row.pointsAgainst}</td>
            <td>${row.pointDiff}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
```

- [ ] **Step 3: Include group stages in `renderGroup()`**

At the end of each group card, before `</div>`, add:

```js
${groupMatches && groupMatches[name] && groupMatches[name].length ? renderGroupStage(name) : ''}
```

- [ ] **Step 4: Add event delegation**

After existing event listeners, add:

```js
resultPanel.addEventListener('input', (event) => {
  const input = event.target.closest('input[data-score-side]');
  if (!input) return;
  const card = input.closest('.schedule-match');
  if (!card) return;
  const groupName = card.dataset.group;
  const matchId = card.dataset.matchId;
  if (rankingLocks[groupName]) return;
  const match = (groupMatches[groupName] || []).find(item => item.id === matchId);
  if (!match) return;
  const team1Raw = card.querySelector('input[data-score-side="team1"]').value;
  const team2Raw = card.querySelector('input[data-score-side="team2"]').value;
  match.score = team1Raw === '' && team2Raw === '' ? null : {
    team1: Number(team1Raw),
    team2: Number(team2Raw),
  };
  knockout = null;
  persistDraft();
  renderResult();
});

resultPanel.addEventListener('click', (event) => {
  const confirmBtn = event.target.closest('.confirm-ranking-btn');
  if (confirmBtn) {
    const groupName = confirmBtn.dataset.group;
    const standings = Core.computeStandings(groupName, groups[groupName] || [], groupMatches[groupName] || []);
    const state = Core.canConfirmGroup(standings, groupMatches[groupName] || []);
    if (!state.ok) {
      showToast(state.message, 'error');
      return;
    }
    rankingLocks[groupName] = Core.createRankingLock(groupName, standings);
    if (rankingLocks.A && rankingLocks.B) {
      knockout = Core.createKnockout(rankingLocks);
      showToast('淘汰赛已根据 A1-A4 / B1-B4 生成', 'success');
    }
    persistDraft();
    renderResult();
    return;
  }

  const unlockBtn = event.target.closest('.unlock-ranking-btn');
  if (unlockBtn) {
    const groupName = unlockBtn.dataset.group;
    const ok = !knockout || window.confirm('解锁排名会重置已生成的淘汰赛和淘汰赛比分，确定继续吗？');
    if (!ok) return;
    rankingLocks[groupName] = null;
    knockout = null;
    persistDraft();
    renderResult();
  }
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
node tests/tournament-core.test.js
```

Expected: all tests print `PASS`.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add tournament.html
git commit -m "feat: add group stage scoring UI"
```

---

## Task 5: Render Knockout Bracket And Scoring

**Files:**
- Modify: `tournament.html`

**Interfaces:**
- Consumes:
  - `Core.updateKnockoutMatch(knockout, matchId, scoreData)`
  - `Core.validateSingleScore(score)`
  - `Core.validateBestOfThree(games)`

- [ ] **Step 1: Add knockout CSS**

Add:

```css
.knockout-section { margin-top: 1rem; border-top: 1px solid var(--gray-100); padding-top: 1rem; }
.knockout-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
.round-card { border: 1px solid var(--gray-100); border-radius: 8px; background: #fff; padding: .75rem; }
.round-card h4 { margin: 0 0 .65rem; font-size: .95rem; }
.ko-match { border-top: 1px solid var(--gray-100); padding: .65rem 0; }
.ko-match:first-of-type { border-top: none; padding-top: 0; }
.ko-title { font-weight: 800; color: var(--gray-900); margin-bottom: .35rem; }
.ko-teams { color: var(--gray-700); margin-bottom: .45rem; }
.game-row { display: flex; align-items: center; gap: .35rem; margin-top: .35rem; }
.game-row span { min-width: 2.8rem; color: var(--gray-500); font-size: .82rem; }
.podium { margin-top: .75rem; padding: .8rem; border-radius: 8px; background: #fff7ed; color: #9a3412; font-weight: 800; }
@media (max-width: 800px) { .knockout-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 2: Add knockout render helpers**

Add:

```js
function renderKnockout() {
  if (!knockout) return '';
  return `
    <div class="knockout-section">
      <div class="stage-header">
        <div>
          <div class="stage-title">淘汰赛</div>
          <div class="stage-meta">由已确认的小组排名自动生成</div>
        </div>
      </div>
      <div class="knockout-grid">
        ${renderKnockoutRound('1/4 决赛', knockout.rounds.quarterfinals)}
        ${renderKnockoutRound('半决赛', knockout.rounds.semifinals)}
        ${renderKnockoutRound('季军赛', knockout.rounds.thirdPlace)}
        ${renderKnockoutRound('决赛', knockout.rounds.final)}
      </div>
      ${renderPodium()}
    </div>
  `;
}

function renderKnockoutRound(title, matches) {
  return `
    <div class="round-card">
      <h4>${title}</h4>
      ${(matches || []).map(renderKnockoutMatch).join('')}
    </div>
  `;
}

function renderKnockoutMatch(match) {
  const team1 = teamById(match.team1Id);
  const team2 = teamById(match.team2Id);
  const disabled = !match.team1Id || !match.team2Id;
  const scoreHtml = match.scoreMode === 'bestOfThree'
    ? renderBestOfThreeInputs(match, disabled)
    : renderScoreInputs(match, disabled);
  return `
    <div class="ko-match" data-ko-match-id="${match.id}" data-score-mode="${match.scoreMode}">
      <div class="ko-title">${escapeHtml(match.label)}</div>
      <div class="ko-teams">${escapeHtml(shortTeamName(team1))} vs ${escapeHtml(shortTeamName(team2))}</div>
      ${scoreHtml}
      ${match.winnerId ? `<div class="match-subtitle">胜者：${escapeHtml(shortTeamName(teamById(match.winnerId)))}</div>` : ''}
    </div>
  `;
}

function renderBestOfThreeInputs(match, disabled) {
  const games = match.games || [];
  return [0, 1, 2].map(index => {
    const game = games[index] || {};
    const thirdDisabled = disabled || (index === 2 && !needsThirdGame(games));
    return `
      <div class="game-row">
        <span>第 ${index + 1} 局</span>
        <div class="score-editor">
          <input type="number" min="0" max="30" data-game-index="${index}" data-score-side="team1" value="${game.team1 ?? ''}" ${thirdDisabled ? 'disabled' : ''}>
          <span class="sep">:</span>
          <input type="number" min="0" max="30" data-game-index="${index}" data-score-side="team2" value="${game.team2 ?? ''}" ${thirdDisabled ? 'disabled' : ''}>
        </div>
      </div>`;
  }).join('');
}

function needsThirdGame(games) {
  const first = games && games[0] && Core.validateSingleScore(games[0]).valid ? Math.sign(Number(games[0].team1) - Number(games[0].team2)) : 0;
  const second = games && games[1] && Core.validateSingleScore(games[1]).valid ? Math.sign(Number(games[1].team1) - Number(games[1].team2)) : 0;
  return first !== 0 && second !== 0 && first !== second;
}

function renderPodium() {
  const final = knockout.rounds.final[0];
  const thirdPlace = knockout.rounds.thirdPlace[0];
  if (!final.winnerId || !thirdPlace.winnerId) return '';
  return `
    <div class="podium">
      冠军：${escapeHtml(shortTeamName(teamById(final.winnerId)))} ·
      亚军：${escapeHtml(shortTeamName(teamById(final.loserId)))} ·
      季军：${escapeHtml(shortTeamName(teamById(thirdPlace.winnerId)))}
    </div>
  `;
}
```

- [ ] **Step 3: Render knockout below group grid**

In `renderResult()`, after the group grid, append:

```js
${renderKnockout()}
```

- [ ] **Step 4: Add knockout input handler**

Extend the `resultPanel` input listener before the group-stage branch returns:

```js
const koCard = input.closest('.ko-match');
if (koCard) {
  if (!knockout) return;
  const matchId = koCard.dataset.koMatchId;
  const scoreMode = koCard.dataset.scoreMode;
  if (scoreMode === 'bestOfThree') {
    const games = [0, 1, 2].map(index => {
      const t1 = koCard.querySelector(`input[data-game-index="${index}"][data-score-side="team1"]`);
      const t2 = koCard.querySelector(`input[data-game-index="${index}"][data-score-side="team2"]`);
      if (!t1 || !t2 || (t1.value === '' && t2.value === '')) return null;
      return { team1: Number(t1.value), team2: Number(t2.value) };
    }).filter(Boolean);
    knockout = Core.updateKnockoutMatch(knockout, matchId, { games });
  } else {
    const team1Raw = koCard.querySelector('input[data-score-side="team1"]').value;
    const team2Raw = koCard.querySelector('input[data-score-side="team2"]').value;
    knockout = Core.updateKnockoutMatch(knockout, matchId, team1Raw === '' && team2Raw === '' ? null : {
      score: { team1: Number(team1Raw), team2: Number(team2Raw) },
    });
  }
  persistDraft();
  renderResult();
  return;
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
node tests/tournament-core.test.js
```

Expected: all tests print `PASS`.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add tournament.html
git commit -m "feat: add knockout scoring UI"
```

---

## Task 6: Documentation And Browser Verification

**Files:**
- Modify: `README.md`
- Verify: `tournament.html`

**Interfaces:**
- Consumes all prior tasks.

- [ ] **Step 1: Update README feature text**

Change the tournament feature bullet to:

```md
- **比赛分组与赛程**：支持 12 支双打队伍均衡分为 A/B 两组，自动生成组内单循环赛程、录入比分、确认排名并生成淘汰赛。
```

Add under sharing notes:

```md
- 分组记录会保存小组赛比分、确认后的排名、淘汰赛比分与晋级结果；旧分组链接会在打开时自动补齐新的赛程字段。
```

- [ ] **Step 2: Run pure function tests**

Run:

```bash
node tests/tournament-core.test.js
```

Expected: all tests print `PASS`.

- [ ] **Step 3: Start a safe local preview**

Run:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Keep the session ID so it can be stopped after testing.

- [ ] **Step 4: Confirm the bind address**

Run:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

Expected: the listener shows `127.0.0.1:8080`, not `*:8080`, `0.0.0.0:8080`, or `[::]:8080`.

- [ ] **Step 5: Manual browser verification**

Open:

```text
http://127.0.0.1:8080/tournament.html
```

Verify:

- 12 teams can generate A/B groups.
- Each group shows 15 matches.
- Ranking table header includes `排序：胜场 > 净胜分 > 总得分 > 相互胜负 > 手动裁定`.
- Incomplete group ranking cannot be confirmed.
- Complete valid scores allow ranking confirmation.
- Both group locks create QF matches `A1 vs B4`, `A2 vs B3`, `A3 vs B2`, `A4 vs B1`.
- QF and SF winners advance.
- SF losers populate the third-place match.
- Final and third-place best-of-three winners produce podium text.
- Saving and reloading a share URL restores scores, locks, and knockout state.

- [ ] **Step 6: Stop the preview and verify the port is closed**

Stop the server session, then run:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

Expected: no output.

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add README.md
git commit -m "docs: describe tournament scoring flow"
```

---

## Self-Review Notes

- Spec coverage: tasks cover pure data model, group match generation, ranking rules and label, manual confirmation, knockout bracket generation, knockout scoring, persistence, old link migration, README, and safe local verification.
- Type consistency: the same state names are used throughout: `groupMatches`, `rankingLocks`, `knockout`, `GroupMatch.score`, `KnockoutMatch.score`, `KnockoutMatch.games`.
- Scope: the plan keeps the feature on `tournament.html` while extracting rule logic to `js/tournament-core.js`, matching the approved design.
