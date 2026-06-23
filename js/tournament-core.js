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
