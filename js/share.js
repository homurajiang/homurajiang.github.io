/**
 * 羽毛球分享模块
 *  - URL hash 快照编解码（LZString 压缩）
 *  - Cloudflare Workers KV 存取
 *  - Owner / Viewer 角色判断（基于本地 localStorage 标记）
 *  - 带 debounce 和重试的自动同步器
 */
(function () {
  'use strict';

  // ── 配置 ───────────────────────────────────────────────────────────
  const KV_ENDPOINT = 'https://github-kv-api.homurajiang.workers.dev';
  const API_KEY = '42da0738-6e16-4024-8f92-ce920c047b59';
  const KEY_PREFIX = 'bad_match/';
  const OWNER_STORAGE_KEY = 'badminton_owned_share_ids';
  const SCHEMA_VERSION = 1;

  // ── Owner 标记 ─────────────────────────────────────────────────────
  function getOwnedMap() {
    try {
      return JSON.parse(localStorage.getItem(OWNER_STORAGE_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function markAsOwner(id, meta) {
    if (!id) return;
    const m = getOwnedMap();
    m[id] = { createdAt: Date.now(), ...(meta || {}) };
    localStorage.setItem(OWNER_STORAGE_KEY, JSON.stringify(m));
  }

  function removeOwnerMark(id) {
    if (!id) return;
    const m = getOwnedMap();
    if (id in m) {
      delete m[id];
      localStorage.setItem(OWNER_STORAGE_KEY, JSON.stringify(m));
    }
  }

  function isOwner(id) {
    if (!id) return false;
    return !!getOwnedMap()[id];
  }

  function countOwned() {
    return Object.keys(getOwnedMap()).length;
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

  function buildShareURL({ id, data }) {
    const base = location.origin + location.pathname;
    const parts = [];
    if (id) parts.push('id=' + encodeURIComponent(id));
    if (data) parts.push('d=' + compressData(data));
    return parts.length ? base + '#' + parts.join('&') : base;
  }

  function updateAddressBar({ id, data }) {
    const parts = [];
    if (id) parts.push('id=' + encodeURIComponent(id));
    if (data) parts.push('d=' + compressData(data));
    const newHash = parts.length ? '#' + parts.join('&') : '';
    if (location.hash !== newHash) {
      history.replaceState(null, '', location.pathname + location.search + newHash);
    }
  }

  // ── KV 存取 ────────────────────────────────────────────────────────
  function kvUrl(id) {
    return `${KV_ENDPOINT}/${KEY_PREFIX}${encodeURIComponent(id)}`;
  }

  async function uploadToKV(id, data) {
    const payload = {
      version: SCHEMA_VERSION,
      ...data,
      updatedAt: new Date().toISOString(),
    };
    const res = await fetch(kvUrl(id), {
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

  async function fetchFromKV(id) {
    const res = await fetch(kvUrl(id), {
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

  async function deleteFromKV(id) {
    const res = await fetch(kvUrl(id), {
      method: 'DELETE',
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    return true;
  }

  // 并发拉取所有"我拥有的"记录，返回 [{id, data, error}]
  async function listOwnedRecords() {
    const ids = Object.keys(getOwnedMap());
    if (ids.length === 0) return [];
    const results = await Promise.allSettled(ids.map(id => fetchFromKV(id)));
    return ids.map((id, i) => ({
      id,
      data: results[i].status === 'fulfilled' ? results[i].value : null,
      error: results[i].status === 'rejected' ? results[i].reason : null,
    }));
  }

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
        await uploadToKV(id, data);
        retryCount = 0;
        callbacks.onSuccess && callbacks.onSuccess();
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

    return { schedule, flush, cancel };
  }

  // ── 轮询器：访客端定时拉取 ─────────────────────────────────────────
  function createPoller({ getId, onUpdate, onError, intervalMs = 20000 }) {
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
        if (str !== lastPayloadStr) {
          lastPayloadStr = str;
          onUpdate && onUpdate(data);
        }
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
    SCHEMA_VERSION,
    compressData,
    decompressData,
    parseHash,
    buildShareURL,
    updateAddressBar,
    generateShortId,
    markAsOwner,
    removeOwnerMark,
    isOwner,
    countOwned,
    uploadToKV,
    fetchFromKV,
    deleteFromKV,
    listOwnedRecords,
    createSyncer,
    createPoller,
  };
})();
