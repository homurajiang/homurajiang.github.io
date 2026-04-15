/**
 * Badminton Match Generator
 * Card-dealing algorithm guaranteeing equal games per player.
 * Supports: random doubles, mixed doubles (with relaxed mode), singles robin.
 */

const Matching = (() => {

    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // ── Valid k computation ──────────────────────────────────────────────

    function getPossibleK(players, mode) {
        const n = players.length;
        const M = players.filter(p => p.gender === 'M').length;
        const F = players.filter(p => p.gender === 'F').length;
        const maxK = 20;
        const options = [];

        if (mode === 'singles_robin') {
            if (n < 2) return [];
            for (let k = 1; k <= maxK; k++) {
                if ((n * k) % 2 === 0) options.push(k);
            }
            return options;
        }

        if (n < 4) return [];

        for (let k = 1; k <= maxK; k++) {
            if (mode === 'mixed') {
                if (M < 2 || F < 2) continue;
                if ((M + F) * k % 4 !== 0) continue;
                if (Math.abs(M - F) * k % 2 !== 0) continue;
                const dist = matchTypeDistribution(M, F, k);
                if (!dist) continue;
                options.push(k);
            } else {
                if (n * k % 4 === 0) options.push(k);
            }
        }
        return options;
    }

    // ── Match-type distribution for mixed mode ───────────────────────────

    function matchTypeDistribution(M, F, k) {
        const T = (M + F) * k / 4;
        if (!Number.isInteger(T)) return null;

        const diff = (M - F) * k / 2;
        if (!Number.isInteger(diff)) return null;

        // b - c = diff, a + b + c = T, a >= 0, b >= 0, c >= 0
        // Maximize a (standard mixed matches)
        let b, c;
        if (diff >= 0) {
            c = 0;
            b = diff;
        } else {
            b = 0;
            c = -diff;
        }
        const a = T - b - c;
        if (a < 0 || b < 0 || c < 0) return null;
        return { a, b, c, T };
    }

    // ── Random Doubles ───────────────────────────────────────────────────

    function generateRandomDoubles(players, k) {
        const n = players.length;
        const totalMatches = (n * k) / 4;
        const MAX_RETRIES = 50;

        for (let retry = 0; retry < MAX_RETRIES; retry++) {
            const deck = [];
            for (let i = 0; i < k; i++) {
                for (const p of players) deck.push(p);
            }
            const shuffled = shuffle(deck);

            const groups = [];
            for (let i = 0; i < totalMatches; i++) {
                groups.push(shuffled.slice(i * 4, i * 4 + 4));
            }

            if (repairDuplicates(groups)) {
                return groups.map(g => assignTeams(g, null));
            }
        }
        return fallbackGreedyRandom(players, k);
    }

    function repairDuplicates(groups) {
        const MAX_SWAPS = groups.length * 20;
        let swaps = 0;
        for (let gi = 0; gi < groups.length && swaps < MAX_SWAPS; gi++) {
            while (hasDuplicate(groups[gi]) && swaps < MAX_SWAPS) {
                const dupIdx = findDuplicateIndex(groups[gi]);
                let fixed = false;
                const targets = shuffle(Array.from({ length: groups.length }, (_, i) => i));
                for (const gj of targets) {
                    if (gj === gi) continue;
                    for (let sj = 0; sj < groups[gj].length; sj++) {
                        if (!wouldCreateDuplicate(groups[gi], dupIdx, groups[gj], sj)) {
                            const tmp = groups[gi][dupIdx];
                            groups[gi][dupIdx] = groups[gj][sj];
                            groups[gj][sj] = tmp;
                            fixed = true;
                            swaps++;
                            break;
                        }
                    }
                    if (fixed) break;
                }
                if (!fixed) return false;
            }
        }
        return groups.every(g => !hasDuplicate(g));
    }

    function hasDuplicate(group) {
        const names = group.map(p => p.name);
        return new Set(names).size !== names.length;
    }

    function findDuplicateIndex(group) {
        const seen = new Set();
        for (let i = 0; i < group.length; i++) {
            if (seen.has(group[i].name)) return i;
            seen.add(group[i].name);
        }
        return -1;
    }

    function wouldCreateDuplicate(groupA, idxA, groupB, idxB) {
        const nameFromB = groupB[idxB].name;
        const nameFromA = groupA[idxA].name;
        for (let i = 0; i < groupA.length; i++) {
            if (i !== idxA && groupA[i].name === nameFromB) return true;
        }
        for (let i = 0; i < groupB.length; i++) {
            if (i !== idxB && groupB[i].name === nameFromA) return true;
        }
        return false;
    }

    // ── Mixed Doubles ────────────────────────────────────────────────────

    function generateMixedDoubles(players, k) {
        const males = players.filter(p => p.gender === 'M');
        const females = players.filter(p => p.gender === 'F');
        const M = males.length, F = females.length;

        if (M < 2 || F < 2) throw new Error('男女队员人数必须都至少为2人。');

        const dist = matchTypeDistribution(M, F, k);
        if (!dist) throw new Error('无法为当前人数和局数找到有效的对阵方案。');

        const { a, b, c, T } = dist;
        const MAX_RETRIES = 50;

        for (let retry = 0; retry < MAX_RETRIES; retry++) {
            const result = tryBuildMixedMatches(males, females, k, a, b, c, T);
            if (result) return result;
        }
        return fallbackGreedyMixed(players, k);
    }

    function tryBuildMixedMatches(males, females, k, a, b, c, T) {
        const maleDeck = shuffle(buildDeck(males, k));
        const femaleDeck = shuffle(buildDeck(females, k));

        const matches = [];
        let mi = 0, fi = 0;

        for (let i = 0; i < a; i++) {
            matches.push({
                mSlots: [maleDeck[mi++], maleDeck[mi++]],
                fSlots: [femaleDeck[fi++], femaleDeck[fi++]],
                type: 'mixed'
            });
        }
        for (let i = 0; i < b; i++) {
            matches.push({
                mSlots: [maleDeck[mi++], maleDeck[mi++], maleDeck[mi++]],
                fSlots: [femaleDeck[fi++]],
                type: 'relaxed'
            });
        }
        for (let i = 0; i < c; i++) {
            matches.push({
                mSlots: [maleDeck[mi++]],
                fSlots: [femaleDeck[fi++], femaleDeck[fi++], femaleDeck[fi++]],
                type: 'relaxed'
            });
        }

        if (!repairGenderedDuplicates(matches)) return null;

        return matches.map(m => {
            const allPlayers = [...m.mSlots, ...m.fSlots];
            return assignTeams(allPlayers, m.type);
        });
    }

    function buildDeck(playerList, k) {
        const deck = [];
        for (let i = 0; i < k; i++) {
            for (const p of playerList) deck.push(p);
        }
        return deck;
    }

    function repairGenderedDuplicates(matches) {
        const MAX_SWAPS = matches.length * 30;
        let swaps = 0;

        for (let gi = 0; gi < matches.length && swaps < MAX_SWAPS; gi++) {
            for (const slotKey of ['mSlots', 'fSlots']) {
                const slots = matches[gi][slotKey];
                while (hasNameDuplicate(slots) && swaps < MAX_SWAPS) {
                    const dupIdx = findNameDuplicateIndex(slots);
                    let fixed = false;
                    const targets = shuffle(Array.from({ length: matches.length }, (_, i) => i));
                    for (const gj of targets) {
                        if (gj === gi) continue;
                        const targetSlots = matches[gj][slotKey];
                        for (let sj = 0; sj < targetSlots.length; sj++) {
                            const allGi = [...matches[gi].mSlots, ...matches[gi].fSlots];
                            const allGj = [...matches[gj].mSlots, ...matches[gj].fSlots];
                            const nameIn = targetSlots[sj].name;
                            const nameOut = slots[dupIdx].name;

                            const giOtherNames = allGi.filter((_, idx2) => {
                                if (slotKey === 'mSlots') return idx2 !== dupIdx;
                                return idx2 !== (matches[gi].mSlots.length + dupIdx);
                            }).map(p => p.name);
                            const gjOtherNames = allGj.filter((_, idx2) => {
                                if (slotKey === 'mSlots') return idx2 !== sj;
                                return idx2 !== (matches[gj].mSlots.length + sj);
                            }).map(p => p.name);

                            if (!giOtherNames.includes(nameIn) && !gjOtherNames.includes(nameOut)) {
                                const tmp = slots[dupIdx];
                                slots[dupIdx] = targetSlots[sj];
                                targetSlots[sj] = tmp;
                                fixed = true;
                                swaps++;
                                break;
                            }
                        }
                        if (fixed) break;
                    }
                    if (!fixed) return false;
                }
            }
        }
        return true;
    }

    function hasNameDuplicate(arr) {
        const names = arr.map(p => p.name);
        return new Set(names).size !== names.length;
    }

    function findNameDuplicateIndex(arr) {
        const seen = new Set();
        for (let i = 0; i < arr.length; i++) {
            if (seen.has(arr[i].name)) return i;
            seen.add(arr[i].name);
        }
        return -1;
    }

    // ── Singles Robin ────────────────────────────────────────────────────

    function generateSinglesRobin(players, k) {
        const n = players.length;
        const names = players.map(p => p.name);
        const totalMatches = (n * k) / 2;
        const gamesPlayed = {};
        const opponents = {};
        names.forEach(name => {
            gamesPlayed[name] = 0;
            opponents[name] = {};
        });

        const allPairs = [];
        for (let i = 0; i < names.length; i++) {
            for (let j = i + 1; j < names.length; j++) {
                allPairs.push([names[i], names[j]]);
            }
        }

        const matches = [];
        const maxAttempts = totalMatches * 5;
        let attempts = 0;

        while (matches.length < totalMatches && attempts < maxAttempts) {
            attempts++;
            allPairs.sort((a, b) =>
                (opponents[a[0]][a[1]] || 0) - (opponents[b[0]][b[1]] || 0)
            );

            let added = false;
            for (const [p1, p2] of allPairs) {
                if (gamesPlayed[p1] < k && gamesPlayed[p2] < k) {
                    matches.push({ team1: [p1], team2: [p2], type: 'singles' });
                    gamesPlayed[p1]++;
                    gamesPlayed[p2]++;
                    opponents[p1][p2] = (opponents[p1][p2] || 0) + 1;
                    opponents[p2][p1] = (opponents[p2][p1] || 0) + 1;
                    added = true;
                    break;
                }
            }
            if (!added) break;
        }
        return matches;
    }

    // ── Team Assignment ──────────────────────────────────────────────────

    const partnershipTracker = { counts: {} };

    function resetPartnerships() {
        partnershipTracker.counts = {};
    }

    function getPartnership(a, b) {
        const key = [a, b].sort().join('|');
        return partnershipTracker.counts[key] || 0;
    }

    function incPartnership(a, b) {
        const key = [a, b].sort().join('|');
        partnershipTracker.counts[key] = (partnershipTracker.counts[key] || 0) + 1;
    }

    function assignTeams(group, matchType) {
        if (matchType === 'relaxed') {
            return assignRelaxedTeams(group, matchType);
        }

        if (matchType === 'mixed') {
            return assignMixedTeams(group, matchType);
        }

        const names = group.map(p => p.name);
        const splits = [
            [[0, 1], [2, 3]],
            [[0, 2], [1, 3]],
            [[0, 3], [1, 2]]
        ];

        let bestSplit = splits[0];
        let bestScore = Infinity;

        for (const [t1Idx, t2Idx] of splits) {
            const score = getPartnership(names[t1Idx[0]], names[t1Idx[1]])
                        + getPartnership(names[t2Idx[0]], names[t2Idx[1]]);
            if (score < bestScore) {
                bestScore = score;
                bestSplit = [t1Idx, t2Idx];
            }
        }

        const [t1Idx, t2Idx] = bestSplit;
        incPartnership(names[t1Idx[0]], names[t1Idx[1]]);
        incPartnership(names[t2Idx[0]], names[t2Idx[1]]);

        let team1 = [names[t1Idx[0]], names[t1Idx[1]]];
        let team2 = [names[t2Idx[0]], names[t2Idx[1]]];
        if (Math.random() < 0.5) [team1, team2] = [team2, team1];
        return { team1, team2, type: 'normal' };
    }

    function assignMixedTeams(group, matchType) {
        const males = group.filter(p => p.gender === 'M');
        const females = group.filter(p => p.gender === 'F');

        if (males.length !== 2 || females.length !== 2) {
            return assignRelaxedTeams(group, 'relaxed');
        }

        const scoreA = getPartnership(males[0].name, females[0].name)
                     + getPartnership(males[1].name, females[1].name);
        const scoreB = getPartnership(males[0].name, females[1].name)
                     + getPartnership(males[1].name, females[0].name);

        let team1, team2;
        if (scoreA <= scoreB) {
            team1 = [males[0].name, females[0].name];
            team2 = [males[1].name, females[1].name];
        } else {
            team1 = [males[0].name, females[1].name];
            team2 = [males[1].name, females[0].name];
        }
        incPartnership(team1[0], team1[1]);
        incPartnership(team2[0], team2[1]);
        if (Math.random() < 0.5) [team1, team2] = [team2, team1];
        return { team1, team2, type: matchType };
    }

    function assignRelaxedTeams(group, matchType) {
        const males = group.filter(p => p.gender === 'M');
        const females = group.filter(p => p.gender === 'F');

        let team1, team2;

        if (males.length === 3 && females.length === 1) {
            const shuffledMales = shuffle(males);
            const bestIdx = pickBestPartner(shuffledMales, females[0]);
            team1 = [shuffledMales[bestIdx].name, females[0].name];
            const rest = shuffledMales.filter((_, i) => i !== bestIdx);
            team2 = [rest[0].name, rest[1].name];
            incPartnership(team1[0], team1[1]);
            incPartnership(team2[0], team2[1]);
        } else if (females.length === 3 && males.length === 1) {
            const shuffledFemales = shuffle(females);
            const bestIdx = pickBestPartner(shuffledFemales, males[0]);
            team1 = [males[0].name, shuffledFemales[bestIdx].name];
            const rest = shuffledFemales.filter((_, i) => i !== bestIdx);
            team2 = [rest[0].name, rest[1].name];
            incPartnership(team1[0], team1[1]);
            incPartnership(team2[0], team2[1]);
        } else {
            return assignTeams(group, null);
        }

        if (Math.random() < 0.5) [team1, team2] = [team2, team1];
        return { team1, team2, type: matchType };
    }

    function pickBestPartner(candidates, partner) {
        let bestIdx = 0;
        let bestScore = Infinity;
        for (let i = 0; i < candidates.length; i++) {
            const score = getPartnership(candidates[i].name, partner.name);
            if (score < bestScore) {
                bestScore = score;
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    // ── Fallback greedy algorithms (safety net) ──────────────────────────

    function fallbackGreedyRandom(players, k) {
        const n = players.length;
        const totalMatches = (n * k) / 4;
        const gamesPlayed = {};
        players.forEach(p => gamesPlayed[p.name] = 0);
        const matches = [];

        for (let m = 0; m < totalMatches; m++) {
            const available = players.filter(p => gamesPlayed[p.name] < k);
            if (available.length < 4) break;
            available.sort((a, b) => gamesPlayed[a.name] - gamesPlayed[b.name]);
            const picked = available.slice(0, 4);
            picked.forEach(p => gamesPlayed[p.name]++);
            matches.push(assignTeams(picked, null));
        }
        return matches;
    }

    function fallbackGreedyMixed(players, k) {
        const males = players.filter(p => p.gender === 'M');
        const females = players.filter(p => p.gender === 'F');
        const gamesPlayed = {};
        players.forEach(p => gamesPlayed[p.name] = 0);
        const T = ((males.length + females.length) * k) / 4;
        const matches = [];

        for (let m = 0; m < T; m++) {
            const em = males.filter(p => gamesPlayed[p.name] < k)
                .sort((a, b) => gamesPlayed[a.name] - gamesPlayed[b.name]);
            const ef = females.filter(p => gamesPlayed[p.name] < k)
                .sort((a, b) => gamesPlayed[a.name] - gamesPlayed[b.name]);

            let picked, type;
            if (em.length >= 2 && ef.length >= 2) {
                picked = [em[0], em[1], ef[0], ef[1]];
                type = 'mixed';
            } else if (em.length >= 3 && ef.length >= 1) {
                picked = [em[0], em[1], em[2], ef[0]];
                type = 'relaxed';
            } else if (ef.length >= 3 && em.length >= 1) {
                picked = [em[0], ef[0], ef[1], ef[2]];
                type = 'relaxed';
            } else {
                break;
            }
            picked.forEach(p => gamesPlayed[p.name]++);
            if (type === 'relaxed') {
                matches.push(assignRelaxedTeams(picked, type));
            } else {
                matches.push(assignTeams(picked, type));
            }
        }
        return matches;
    }

    // ── Public API ───────────────────────────────────────────────────────

    function generate(players, mode, k) {
        resetPartnerships();
        if (mode === 'mixed') {
            return generateMixedDoubles(players, k);
        }
        if (mode === 'singles_robin') {
            return generateSinglesRobin(players, k);
        }
        return generateRandomDoubles(players, k);
    }

    return { getPossibleK, generate };
})();
