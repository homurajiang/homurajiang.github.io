# Tournament Stage Scoring Design

## Goal

Extend the existing tournament grouping page so a 12-team badminton tournament can be managed from grouping through group-stage scoring, ranking confirmation, knockout seeding, knockout scoring, and sharing.

The feature stays inside `tournament.html` for the user experience. The implementation should keep the tournament rules as small, testable functions so they can later move to `js/tournament.js` if the inline script becomes too large.

## Current State

`tournament.html` currently supports:

- entering 12 doubles teams,
- balancing them into A/B groups,
- rendering group cards and tournament rules,
- saving and sharing the grouping payload through `js/share.js` and Cloudflare KV.

The page already stores `teams`, `groups`, `metrics`, `generatedAt`, and `rulesVersion` in `currentPayload()`. The new feature should extend that payload instead of introducing a second storage path.

## Product Flow

1. User enters 12 teams and generates balanced A/B groups.
2. The page automatically creates group-stage matches for each group, where every pair of teams in the same group plays once.
3. The user enters group-stage scores.
4. The page recalculates each group ranking after every score change.
5. When all group-stage matches are complete, the user manually confirms group rankings.
6. The page locks A1-A4 and B1-B4, then creates the knockout bracket:
   - QF1: A1 vs B4
   - QF2: A2 vs B3
   - QF3: A3 vs B2
   - QF4: A4 vs B1
7. The user enters knockout scores.
8. Winners advance automatically through semifinals, final, and third-place match.
9. The full state can be saved, shared, restored, and viewed read-only.

## Data Model

Add these fields to the tournament payload:

```js
{
  type: 'tournament_grouping',
  rulesVersion: 2,
  teams,
  groups,
  metrics,
  generatedAt,
  groupMatches: {
    A: [GroupMatch],
    B: [GroupMatch],
  },
  rankingLocks: {
    A: RankingLock | null,
    B: RankingLock | null,
  },
  knockout: KnockoutState | null,
}
```

### GroupMatch

```js
{
  id: 'A-1-2',
  group: 'A',
  team1Id: 'team-1',
  team2Id: 'team-7',
  score: { team1: 21, team2: 18 } | null,
}
```

Group matches are deterministic from the current group order. For a 6-team group, create 15 matches with pair indexes `(0,1)` through `(4,5)`.

### RankingLock

```js
{
  confirmedAt: '2026-06-23T...',
  seeds: [
    { seed: 'A1', teamId: 'team-1' },
    { seed: 'A2', teamId: 'team-3' },
    { seed: 'A3', teamId: 'team-5' },
    { seed: 'A4', teamId: 'team-6' },
  ],
}
```

Ranking locks are created only after the user confirms the group ranking. If the user unlocks a group after knockout matches exist, the UI must warn that knockout seeding and scores can become stale. The first implementation should reset `knockout` when either group is unlocked or reconfirmed.

### KnockoutState

```js
{
  generatedAt: '2026-06-23T...',
  rounds: {
    quarterfinals: [KnockoutMatch, KnockoutMatch, KnockoutMatch, KnockoutMatch],
    semifinals: [KnockoutMatch, KnockoutMatch],
    thirdPlace: [KnockoutMatch],
    final: [KnockoutMatch],
  },
}
```

### KnockoutMatch

```js
{
  id: 'QF1',
  label: '1/4 决赛 1',
  team1Id: 'team-1' | null,
  team2Id: 'team-8' | null,
  source1: 'A1',
  source2: 'B4',
  scoreMode: 'single' | 'bestOfThree',
  score: { team1: 21, team2: 18 } | null,
  games: [
    { team1: 21, team2: 18 },
    { team1: 16, team2: 21 },
    { team1: 21, team2: 19 },
  ] | null,
  winnerId: 'team-1' | null,
  loserId: 'team-8' | null,
}
```

Quarterfinals and semifinals use `scoreMode: 'single'`. Final and third-place match use `scoreMode: 'bestOfThree'`.

## Ranking Rules

Group standings are derived from `groupMatches` and team metadata. Do not manually store `groupStandings`; compute it during render.

Table header or caption must show the sorting rule:

`排序：胜场 > 净胜分 > 总得分 > 相互胜负 > 手动裁定`

For each team, compute:

- matches played,
- wins,
- losses,
- points for,
- points against,
- point differential.

Sort by:

1. wins descending,
2. point differential descending,
3. points for descending,
4. head-to-head winner when exactly two tied teams have played a completed match,
5. stable current group order.

If a tie remains after the automatic rules, the UI should visually mark it as needing manual裁定 before confirmation. The first implementation can block confirmation when an unresolved tie affects top-four ordering or seed order.

## Score Validation

Group-stage and single-match knockout scores:

- both scores must be non-negative integers,
- scores cannot be equal,
- the winning score should normally be at least 21,
- if both teams reach 20, the winner must lead by at least 2 unless the winner has 30,
- no score may exceed 30.

Best-of-three scores:

- each completed game follows the same validation,
- a match is complete when one team wins two games,
- game three is enabled only when the first two games are split,
- extra games after a team already has two wins are ignored or cleared.

The UI should show inline validation and avoid saving invalid scores.

## Knockout Advancement

After quarterfinal score changes:

- QF1 winner -> SF1 team1
- QF2 winner -> SF1 team2
- QF3 winner -> SF2 team1
- QF4 winner -> SF2 team2

After semifinal score changes:

- SF1 winner -> Final team1
- SF2 winner -> Final team2
- SF1 loser -> Third-place team1
- SF2 loser -> Third-place team2

If an upstream score is cleared or changed, downstream matches that include affected teams should be reset to avoid inconsistent brackets.

## UI Design

### Group Result Area

Keep the current group summary and group cards. Under each group card add:

- group-stage match list,
- score inputs for each match,
- completion count such as `12 / 15 场已完成`,
- ranking table with the sorting rule in the header.

Each group card should have a clear "确认排名" action. Confirmation is disabled until all 15 group matches have valid scores and no unresolved seed-affecting tie exists.

### Ranking Confirmation

When the user confirms a group:

- store the top-four seeds in `rankingLocks[groupName]`,
- render the group as locked,
- keep scores visible,
- show an "解锁排名" button.

When both groups are locked:

- generate the knockout bracket automatically,
- display a toast explaining the bracket was created from A1-A4 and B1-B4.

### Knockout Area

Show a bracket-style section below the group-stage area:

- quarterfinals,
- semifinals,
- third-place match,
- final,
- podium summary once final and third-place are complete.

Use compact match cards rather than a decorative oversized bracket so mobile remains usable.

### Read-Only Mode

The existing owner/viewer behavior should continue:

- owner or local draft can edit scores and locks,
- viewer can see scores, standings, locks, and knockout results but cannot edit.

## Persistence And Migration

For old shared links with `rulesVersion: 1`:

- load existing `teams`, `groups`, and `metrics`,
- generate missing `groupMatches` from `groups`,
- set `rankingLocks` to `{ A: null, B: null }`,
- set `knockout` to `null`,
- preserve the original team order inside each group.

When groups are regenerated:

- clear `groupMatches`,
- clear `rankingLocks`,
- clear `knockout`,
- generate fresh group matches.

The draft and KV payload should save all new fields through `currentPayload()`.

## Testing

Add focused tests for pure tournament functions if a test harness is introduced. If the repo stays testless, verify manually in browser with local static preview bound to `127.0.0.1`.

Manual verification should cover:

- generating groups creates 30 group-stage matches,
- score entry updates standings with the displayed sorting rule,
- incomplete groups cannot be confirmed,
- completed groups can be confirmed and generate the seeded bracket,
- changing or unlocking rankings resets stale knockout state,
- knockout winners advance correctly,
- final and third-place best-of-three matches identify winners,
- saved links restore scores, locks, and knockout results,
- viewer mode is read-only.

Local preview must follow `AGENTS.md`: bind only to `127.0.0.1`, confirm with `lsof`, and stop the server after testing.
