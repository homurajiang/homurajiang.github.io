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

  return {
    RANKING_RULE_LABEL,
    generateGroupMatches,
    ensureTournamentState,
    validateSingleScore,
    computeStandings,
    canConfirmGroup,
    createRankingLock,
    createKnockout,
    validateBestOfThree,
    updateKnockoutMatch,
  };
});
