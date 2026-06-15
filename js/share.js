/**
 * 羽毛球分享模块
 *  - URL hash 快照编解码（LZString 压缩）
 *  - Cloudflare Workers KV 存取（含重试）
 *  - 本地"我的对局"列表（含 owner / viewer 角色）
 *  - 带 debounce 和重试的自动同步器 & 轮询器
 */
(function () {
  'use strict';

  // ── 配置 ───────────────────────────────────────────────────────────
  const KV_ENDPOINT = 'https://github-kv-api.homurajiang.workers.dev';
  const API_KEY = '42da0738-6e16-4024-8f92-ce920c047b59';
  const KEY_PREFIX = 'bad_match/';
  const TOURNAMENT_KEY_PREFIX = 'badminton_tournament/';
  const MY_MATCHES_KEY = 'badminton_my_matches';
  const MY_TOURNAMENTS_KEY = 'badminton_my_tournaments';
  const LEGACY_OWNER_KEY = 'badminton_owned_share_ids';
  const LEGACY_TOURNAMENT_OWNER_KEY = 'badminton_tournament_owned_ids';
  const MAX_RECORDS = 50;
  const SCHEMA_VERSION = 1;

  // ── 本地"我的对局"存储（含角色） ──────────────────────────────────
  //
  // 结构：{ [id]: { role: 'owner' | 'viewer', addedAt: number, lastSeenAt: number } }
  // - owner：我创建或已升级为可编辑
  // - viewer：只读访问过（点"申请编辑权限"可升级）
  // 容量：最多 MAX_RECORDS 条，溢出按 lastSeenAt 升序淘汰

  function readMap(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function trimRecordMap(map) {
    const entries = Object.entries(map);
    if (entries.length > MAX_RECORDS) {
      entries.sort((a, b) => (b[1].lastSeenAt || 0) - (a[1].lastSeenAt || 0));
      return Object.fromEntries(entries.slice(0, MAX_RECORDS));
    }
    return map;
  }

  function saveRecordMap(key, map) {
    localStorage.setItem(key, JSON.stringify(trimRecordMap(map)));
  }

  function migrateLegacyOwners(map, key, legacyKey, state) {
    if (state.done) return map;
    state.done = true;
    const legacy = readMap(legacyKey);
    let changed = false;
    for (const id of Object.keys(legacy)) {
      if (!map[id]) {
        const createdAt = (legacy[id] && legacy[id].createdAt) || Date.now();
        map[id] = { role: 'owner', addedAt: createdAt, lastSeenAt: Date.now() };
        changed = true;
      }
    }
    if (changed) saveRecordMap(key, map);
    return map;
  }

  const matchMigrationState = { done: false };
  const tournamentMigrationState = { done: false };

  function getMyMatches() {
    return migrateLegacyOwners(readMap(MY_MATCHES_KEY), MY_MATCHES_KEY, LEGACY_OWNER_KEY, matchMigrationState);
  }

  function saveMyMatches(map) {
    saveRecordMap(MY_MATCHES_KEY, map);
  }

  function getMyTournaments() {
    return migrateLegacyOwners(readMap(MY_TOURNAMENTS_KEY), MY_TOURNAMENTS_KEY, LEGACY_TOURNAMENT_OWNER_KEY, tournamentMigrationState);
  }

  function saveMyTournaments(map) {
    saveRecordMap(MY_TOURNAMENTS_KEY, map);
  }

  function addOrUpdateRecordIn(mapGetter, mapSaver, id, role, meta) {
    if (!id) return;
    const map = mapGetter();
    const now = Date.now();
    const existing = map[id];
    let finalRole = role;
    if (existing) {
      finalRole = existing.role === 'owner' ? 'owner' : role;
    }
    map[id] = {
      ...(existing || {}),
      role: finalRole,
      addedAt: (existing && existing.addedAt) || now,
      lastSeenAt: now,
      ...(meta || {}),
    };
    mapSaver(map);
  }

  function addOrUpdateRecord(id, role, meta) {
    addOrUpdateRecordIn(getMyMatches, saveMyMatches, id, role, meta);
  }

  function markAsOwner(id, meta) {
    addOrUpdateRecord(id, 'owner', meta);
  }

  function markAsViewed(id, meta) {
    addOrUpdateRecord(id, 'viewer', meta);
  }

  function touchRecord(id) {
    if (!id) return;
    const map = getMyMatches();
    if (map[id]) {
      map[id].lastSeenAt = Date.now();
      saveMyMatches(map);
    }
  }

  function removeRecord(id) {
    if (!id) return;
    const map = getMyMatches();
    if (id in map) {
      delete map[id];
      saveMyMatches(map);
    }
  }

  function markTournamentAsOwner(id, meta) {
    addOrUpdateRecordIn(getMyTournaments, saveMyTournaments, id, 'owner', meta);
  }

  function markTournamentAsViewed(id, meta) {
    addOrUpdateRecordIn(getMyTournaments, saveMyTournaments, id, 'viewer', meta);
  }

  function touchTournamentRecord(id) {
    if (!id) return;
    const map = getMyTournaments();
    if (map[id]) {
      map[id].lastSeenAt = Date.now();
      saveMyTournaments(map);
    }
  }

  function removeTournamentRecord(id) {
    if (!id) return;
    const map = getMyTournaments();
    if (id in map) {
      delete map[id];
      saveMyTournaments(map);
    }
  }

  function getRole(id) {
    if (!id) return null;
    const map = getMyMatches();
    return (map[id] && map[id].role) || null;
  }

  function isOwner(id) {
    return getRole(id) === 'owner';
  }

  function isInMyMatches(id) {
    return !!getRole(id);
  }

  function getTournamentRole(id) {
    if (!id) return null;
    const map = getMyTournaments();
    return (map[id] && map[id].role) || null;
  }

  function isTournamentOwner(id) {
    return getTournamentRole(id) === 'owner';
  }

  function countByRole() {
    const map = getMyMatches();
    let owner = 0, viewer = 0;
    for (const id of Object.keys(map)) {
      if (map[id].role === 'owner') owner++;
      else if (map[id].role === 'viewer') viewer++;
    }
    return { owner, viewer, total: owner + viewer };
  }

  function countTournamentsByRole() {
    const map = getMyTournaments();
    let owner = 0, viewer = 0;
    for (const id of Object.keys(map)) {
      if (map[id].role === 'owner') owner++;
      else if (map[id].role === 'viewer') viewer++;
    }
    return { owner, viewer, total: owner + viewer };
  }

  // 向后兼容（旧入口还在用）
  function countOwned() {
    return countByRole().total;
  }

  function removeOwnerMark(id) {
    removeRecord(id);
  }

  // ── 短 ID 生成：timestamp(base36) + 4 位随机 ───────────────────────
  function generateShortId() {
    const t = Date.now().toString(36);
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let r = '';
    for (let i = 0; i < 4; i++) {
      r += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return (t + r).toLowerCase();
  }

  // ── URL 压缩编解码 ─────────────────────────────────────────────────
  function compressData(data) {
    const json = JSON.stringify(data);
    return LZString.compressToEncodedURIComponent(json);
  }

  function decompressData(str) {
    if (!str) return null;
    try {
      const json = LZString.decompressFromEncodedURIComponent(str);
      return json ? JSON.parse(json) : null;
    } catch (_) {
      return null;
    }
  }

  function parseHash() {
    const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    const params = new URLSearchParams(raw);
    return {
      id: params.get('id'),
      d: params.get('d'),
    };
  }

  // URL 快照都会带上 updatedAt，加载时用来和 KV 比较"谁更新"
  function stampSnapshot(data) {
    if (!data) return data;
    if (data.updatedAt) return data;
    return { ...data, updatedAt: new Date().toISOString() };
  }

  function buildShareURL({ id, data }) {
    const base = location.origin + location.pathname;
    const parts = [];
    if (id) parts.push('id=' + encodeURIComponent(id));
    if (data) parts.push('d=' + compressData(stampSnapshot(data)));
    return parts.length ? base + '#' + parts.join('&') : base;
  }

  function updateAddressBar({ id, data }) {
    const parts = [];
    if (id) parts.push('id=' + encodeURIComponent(id));
    if (data) parts.push('d=' + compressData(stampSnapshot(data)));
    const newHash = parts.length ? '#' + parts.join('&') : '';
    if (location.hash !== newHash) {
      history.replaceState(null, '', location.pathname + location.search + newHash);
    }
  }

  // ── KV 存取 ────────────────────────────────────────────────────────
  function normalizeKeyPrefix(options) {
    if (typeof options === 'string') return options;
    return (options && options.keyPrefix) || KEY_PREFIX;
  }

  function kvUrl(id, options) {
    return `${KV_ENDPOINT}/${normalizeKeyPrefix(options)}${encodeURIComponent(id)}`;
  }

  async function uploadToKV(id, data, options) {
    const payload = {
      version: SCHEMA_VERSION,
      ...data,
      updatedAt: new Date().toISOString(),
    };
    const res = await fetch(kvUrl(id, options), {
      method: 'PUT',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Upload failed (${res.status}): ${text}`);
    }
    return payload;
  }

  // 带指数退避重试的上传（1s → 2s → 4s），用于手动触发的场景
  async function uploadToKVWithRetry(id, data, options) {
    const opts = options || {};
    const maxRetries = opts.maxRetries || 3;
    const onAttempt = opts.onAttempt || (() => {});
    let lastErr;
    for (let i = 0; i < maxRetries; i++) {
      try {
        onAttempt(i + 1, maxRetries);
        return await uploadToKV(id, data, opts);
      } catch (err) {
        lastErr = err;
        if (i < maxRetries - 1) {
          const backoff = 1000 * Math.pow(2, i);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }
    throw lastErr;
  }

  async function fetchFromKV(id, options) {
    const res = await fetch(kvUrl(id, options), {
      method: 'GET',
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed (${res.status})`);
    }
    const text = await res.text();
    if (!text || text === 'null') return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  async function deleteFromKV(id, options) {
    const res = await fetch(kvUrl(id, options), {
      method: 'DELETE',
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    return true;
  }

  // 并发拉取所有"我的对局"（owner + viewer），返回 [{id, role, addedAt, lastSeenAt, data, error}]
  async function listAllRecords() {
    const map = getMyMatches();
    const ids = Object.keys(map);
    if (ids.length === 0) return [];
    const results = await Promise.allSettled(ids.map(id => fetchFromKV(id)));
    return ids.map((id, i) => ({
      id,
      role: map[id].role,
      addedAt: map[id].addedAt,
      lastSeenAt: map[id].lastSeenAt,
      data: results[i].status === 'fulfilled' ? results[i].value : null,
      error: results[i].status === 'rejected' ? results[i].reason : null,
    }));
  }

  async function listAllTournamentRecords() {
    const map = getMyTournaments();
    const ids = Object.keys(map);
    if (ids.length === 0) return [];
    const results = await Promise.allSettled(ids.map(id => fetchFromKV(id, { keyPrefix: TOURNAMENT_KEY_PREFIX })));
    return ids.map((id, i) => ({
      id,
      role: map[id].role,
      addedAt: map[id].addedAt,
      lastSeenAt: map[id].lastSeenAt,
      data: results[i].status === 'fulfilled' ? results[i].value : null,
      error: results[i].status === 'rejected' ? results[i].reason : null,
    }));
  }

  // 向后兼容（如果有地方还在用）
  const listOwnedRecords = listAllRecords;

  // ── 自动同步器：debounce + 指数退避重试 ────────────────────────────
  function createSyncer({ getId, getData, callbacks = {} }) {
    let timer = null;
    let retryTimer = null;
    let retryCount = 0;
    const DEBOUNCE_MS = 2500;
    const MAX_RETRY = 3;

    async function doSync() {
      clearRetry();
      const id = getId();
      const data = getData();
      if (!id || !data) return;
      try {
        callbacks.onStart && callbacks.onStart();
        const payload = await uploadToKV(id, data);
        retryCount = 0;
        callbacks.onSuccess && callbacks.onSuccess(payload);
      } catch (err) {
        retryCount += 1;
        callbacks.onError && callbacks.onError(err, retryCount, retryCount < MAX_RETRY);
        if (retryCount < MAX_RETRY) {
          const backoff = Math.min(2000 * Math.pow(2, retryCount - 1), 10000);
          retryTimer = setTimeout(doSync, backoff);
        }
      }
    }

    function clearRetry() {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      retryCount = 0;
      clearRetry();
      timer = setTimeout(doSync, DEBOUNCE_MS);
    }

    async function flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await doSync();
    }

    function cancel() {
      if (timer) clearTimeout(timer);
      clearRetry();
      timer = null;
      retryCount = 0;
    }

    function hasPending() {
      return timer !== null || retryTimer !== null;
    }

    return { schedule, flush, cancel, hasPending };
  }

  // ── 轮询器：定时拉取 KV 比对并触发更新 ─────────────────────────────
  function createPoller({ getId, onUpdate, onError, intervalMs = 20000, shouldMerge }) {
    let timer = null;
    let running = false;
    let lastPayloadStr = '';

    async function tick() {
      const id = getId();
      if (!id) return;
      try {
        const data = await fetchFromKV(id);
        if (!data) return;
        const str = JSON.stringify(data);
        if (str === lastPayloadStr) return;
        // 允许外部决定是否合并（例如 owner 在本地有 pending 改动时跳过）
        if (shouldMerge && !shouldMerge(data)) return;
        lastPayloadStr = str;
        onUpdate && onUpdate(data);
      } catch (err) {
        onError && onError(err);
      }
    }

    function start() {
      if (running) return;
      running = true;
      tick();
      timer = setInterval(tick, intervalMs);
    }

    function stop() {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function refreshNow() {
      return tick();
    }

    function setBaseline(data) {
      lastPayloadStr = data ? JSON.stringify(data) : '';
    }

    return { start, stop, refreshNow, setBaseline, get running() { return running; } };
  }

  // ── 导出 ───────────────────────────────────────────────────────────
  window.BadmintonShare = {
    KV_ENDPOINT,
    KEY_PREFIX,
    TOURNAMENT_KEY_PREFIX,
    SCHEMA_VERSION,
    MAX_RECORDS,
    compressData,
    decompressData,
    parseHash,
    buildShareURL,
    updateAddressBar,
    generateShortId,
    // 本地"我的对局"
    getMyMatches,
    markAsOwner,
    markAsViewed,
    touchRecord,
    removeRecord,
    removeOwnerMark,    // 兼容旧调用
    getRole,
    isOwner,
    isInMyMatches,
    countByRole,
    countOwned,         // 兼容旧调用
    // 本地"我的分组"
    getMyTournaments,
    markTournamentAsOwner,
    markTournamentAsViewed,
    touchTournamentRecord,
    removeTournamentRecord,
    getTournamentRole,
    isTournamentOwner,
    countTournamentsByRole,
    listAllTournamentRecords,
    // KV
    uploadToKV,
    uploadToKVWithRetry,
    fetchFromKV,
    deleteFromKV,
    listAllRecords,
    listOwnedRecords,   // 兼容旧调用
    // 组件
    createSyncer,
    createPoller,
  };
})();
