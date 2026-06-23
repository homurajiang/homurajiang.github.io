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
    { team1: 21, team2: 10 },
    { team1: 21, team2: 11 },
    { team1: 21, team2: 12 },
    { team1: 21, team2: 13 },
    { team1: 21, team2: 14 },
    { team1: 21, team2: 18 },
    { team1: 21, team2: 19 },
    { team1: 21, team2: 17 },
    { team1: 21, team2: 16 },
    { team1: 21, team2: 15 },
    { team1: 21, team2: 16 },
    { team1: 21, team2: 17 },
    { team1: 21, team2: 19 },
    { team1: 21, team2: 20 },
    { team1: 21, team2: 18 },
  ]);
  const standings = TournamentCore.computeStandings('A', groups.A, matches);
  assert.deepStrictEqual(standings.slice(0, 4).map(row => row.teamId), ['a1', 'a2', 'a3', 'a4']);
  assert.strictEqual(standings[0].wins, 5);
  assert.strictEqual(standings[0].played, 5);
  assert.strictEqual(standings.find(row => row.teamId === 'a4').played, 4);
});

test('confirms ranking only after all matches have valid scores', () => {
  const groups = groupsFixture();
  const generated = TournamentCore.generateGroupMatches(groups).A;
  const incompleteStandings = TournamentCore.computeStandings('A', groups.A, generated);
  assert.strictEqual(TournamentCore.canConfirmGroup(incompleteStandings, generated).ok, false);
  const completeMatches = withScores(generated, [
    { team1: 21, team2: 10 },
    { team1: 21, team2: 11 },
    { team1: 21, team2: 12 },
    { team1: 21, team2: 13 },
    { team1: 21, team2: 14 },
    { team1: 21, team2: 18 },
    { team1: 21, team2: 19 },
    { team1: 21, team2: 17 },
    { team1: 21, team2: 16 },
    { team1: 21, team2: 15 },
    { team1: 21, team2: 16 },
    { team1: 21, team2: 17 },
    { team1: 21, team2: 19 },
    { team1: 22, team2: 20 },
    { team1: 21, team2: 18 },
  ]);
  const standings = TournamentCore.computeStandings('A', groups.A, completeMatches);
  assert.strictEqual(TournamentCore.canConfirmGroup(standings, completeMatches).ok, true);
  const lock = TournamentCore.createRankingLock('A', standings, '2026-06-23T00:00:00.000Z');
  assert.strictEqual(lock.confirmedAt, '2026-06-23T00:00:00.000Z');
  assert.deepStrictEqual(lock.seeds.map(seed => seed.seed), ['A1', 'A2', 'A3', 'A4']);
});
