/**
 * Browser storage layer for saved games & autosave snapshots (`xq_games_v1` IndexedDB)
 * with automatic in-memory fallback when IndexedDB is unavailable or quota is exceeded.
 * Never throws unhandled rejections into the UI loop; surfaces issues via `onError`.
 */
import { createGameRecord, sanitizeNote, RECORD_SCHEMA_VERSION } from './gameRecord.js';
import { validateAndNormalizeRecord } from './validate.js';

export const DB_NAME = 'xq_games_v1';
export const DB_VERSION = 2;
export const MAX_SAVED_GAMES = 200;
export const MAX_SAVED_ANALYSES = 100;

export const AUTOSAVE_SLOTS = [
  'xiangqi:local',
  'xiangqi:ai',
  'jieqi:local',
  'jieqi:ai',
];

export const FALLBACK_BANNER_MSG =
  'Trình duyệt này không cho lưu dữ liệu: ván chỉ giữ trong phiên hiện tại.';
export const QUOTA_ERR_MSG =
  'Bộ nhớ trình duyệt đã đầy: không thể lưu thêm ván cờ. Hãy xóa bớt ván cũ trong Thư viện.';

function isQuotaError(err) {
  if (!err) return false;
  const name = err.name || '';
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22;
}

export class GameStore {
  /**
   * @param {{
   *   memoryOnly?: boolean,
   *   maxGames?: number,
   *   onError?: (info: { code: string, message: string }) => void,
   *   simulateQuotaError?: boolean,
   * }} [opts]
   */
  constructor(opts = {}) {
    this.maxGames = opts.maxGames ?? MAX_SAVED_GAMES;
    this.maxAnalyses = opts.maxAnalyses ?? MAX_SAVED_ANALYSES;
    this.onError = opts.onError || (() => {});
    this.simulateQuotaError = Boolean(opts.simulateQuotaError);
    this.memoryFallback = Boolean(opts.memoryOnly);
    this._fallbackNotified = false;
    /** @type {IDBDatabase | null} */
    this._db = null;
    /** @type {Promise<IDBDatabase | null> | null} */
    this._openPromise = null;
    /** @type {Map<string, any>} */
    this._memGames = new Map();
    /** @type {Map<string, any>} */
    this._memAutosave = new Map();
    /** @type {Map<string, any>} */
    this._memAnalysis = new Map();
  }

  _notifyFallback(code = 'IDB_UNAVAILABLE', message = FALLBACK_BANNER_MSG) {
    this.memoryFallback = true;
    if (!this._fallbackNotified) {
      this._fallbackNotified = true;
      try {
        this.onError({ code, message });
      } catch {
        // ignore
      }
    }
  }

  _notifyError(code, message) {
    try {
      this.onError({ code, message });
    } catch {
      // ignore
    }
  }

  async _getDb() {
    if (this.memoryFallback) return null;
    if (this._db) return this._db;
    if (typeof globalThis.indexedDB === 'undefined' || !globalThis.indexedDB) {
      this._notifyFallback('IDB_UNAVAILABLE', FALLBACK_BANNER_MSG);
      return null;
    }
    if (!this._openPromise) {
      this._openPromise = new Promise((resolve) => {
        try {
          const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('games')) {
              const store = db.createObjectStore('games', { keyPath: 'id' });
              store.createIndex('updatedAt', 'updatedAt', { unique: false });
              store.createIndex('variant', 'variant', { unique: false });
              store.createIndex('result', 'result', { unique: false });
            }
            if (!db.objectStoreNames.contains('autosave')) {
              db.createObjectStore('autosave', { keyPath: 'slot' });
            }
            if (!db.objectStoreNames.contains('analysis')) {
              const aStore = db.createObjectStore('analysis', { keyPath: 'key' });
              aStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }
          };
          req.onsuccess = () => {
            this._db = req.result;
            this._db.onclose = () => {
              this._db = null;
              this._openPromise = null;
            };
            resolve(this._db);
          };
          req.onerror = () => {
            this._notifyFallback('IDB_OPEN_FAILED', FALLBACK_BANNER_MSG);
            resolve(null);
          };
          req.onblocked = () => {
            this._notifyFallback('IDB_BLOCKED', FALLBACK_BANNER_MSG);
            resolve(null);
          };
        } catch {
          this._notifyFallback('IDB_EXCEPTION', FALLBACK_BANNER_MSG);
          resolve(null);
        }
      });
    }
    return this._openPromise;
  }

  async _idbTx(storeName, mode, fn) {
    if (this.simulateQuotaError && mode === 'readwrite') {
      const err = new Error('Simulated QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    const db = await this._getDb();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const result = fn(store, tx);
        tx.oncomplete = () => resolve(result?._val ?? result);
        tx.onerror = () => reject(tx.error || new Error('IDB tx error'));
        tx.onabort = () => reject(tx.error || new Error('IDB tx aborted'));
      } catch (err) {
        reject(err);
      }
    });
  }

  async _readAllGamesRaw() {
    if (this.memoryFallback) {
      return [...this._memGames.values()];
    }
    try {
      const db = await this._getDb();
      if (!db) return [...this._memGames.values()];
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('games', 'readonly');
        const req = tx.objectStore('games').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      this._notifyFallback('IDB_READ_ERROR', FALLBACK_BANNER_MSG);
      return [...this._memGames.values()];
    }
  }

  /**
   * Save a game record. Returns `{ ok: true, id, record }` or `{ ok: false, needsPrune: true, count, cap }`.
   */
  async saveGame(rawRecord, { forcePruneOldest = false } = {}) {
    const clean = createGameRecord(rawRecord);
    clean.updatedAt = clean.updatedAt || new Date().toISOString();

    try {
      if (this.simulateQuotaError) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }

      const all = await this._readAllGamesRaw();
      const exists = all.some((g) => g && g.id === clean.id);
      if (!exists && all.length >= this.maxGames) {
        if (!forcePruneOldest) {
          return { ok: false, needsPrune: true, count: all.length, cap: this.maxGames };
        }
        // Delete oldest by updatedAt
        const sorted = all
          .filter((g) => g && g.id)
          .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
        if (sorted[0]) {
          await this.deleteGame(sorted[0].id);
        }
      }

      if (this.memoryFallback || !(await this._getDb())) {
        this._memGames.set(clean.id, structuredClone(clean));
        return { ok: true, id: clean.id, record: clean };
      }

      await this._idbTx('games', 'readwrite', (store) => {
        store.put(clean);
      });
      return { ok: true, id: clean.id, record: clean };
    } catch (err) {
      if (isQuotaError(err)) {
        this._notifyError('QUOTA_EXCEEDED', QUOTA_ERR_MSG);
        return { ok: false, error: { code: 'QUOTA_EXCEEDED', message: QUOTA_ERR_MSG } };
      }
      this._notifyFallback('IDB_WRITE_ERROR', FALLBACK_BANNER_MSG);
      this._memGames.set(clean.id, structuredClone(clean));
      return { ok: true, id: clean.id, record: clean, memoryFallback: true };
    }
  }

  async getGame(id) {
    if (!id) return null;
    if (this.memoryFallback || !(await this._getDb())) {
      const hit = this._memGames.get(id);
      return hit ? structuredClone(hit) : null;
    }
    try {
      const db = await this._getDb();
      return await new Promise((resolve) => {
        const tx = db.transaction('games', 'readonly');
        const req = tx.objectStore('games').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return this._memGames.get(id) || null;
    }
  }

  /**
   * List saved games sorted newest-first, skipping any corrupted records gracefully.
   */
  async listGames({ variant = 'all', result = 'all', query = '', limit = 50, cursor = 0 } = {}) {
    const raw = await this._readAllGamesRaw();
    const valid = [];
    let skippedCorrupt = 0;

    for (const item of raw) {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.id !== 'string' ||
        !item.start?.fen ||
        !Array.isArray(item.moves)
      ) {
        skippedCorrupt++;
        continue;
      }
      valid.push(item);
    }

    if (skippedCorrupt > 0) {
      this._notifyError('CORRUPT_ENTRIES', `Đã bỏ qua ${skippedCorrupt} bản ghi ván cờ bị hỏng.`);
    }

    const q = String(query || '').trim().toLowerCase();
    const filtered = valid.filter((g) => {
      if (variant && variant !== 'all' && g.variant !== variant) return false;
      if (result && result !== 'all' && g.result !== result) return false;
      if (q) {
        const hay = `${g.red?.name || ''} ${g.black?.name || ''} ${g.note || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const start = Math.max(0, Number(cursor) || 0);
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));
    const items = filtered.slice(start, start + lim);
    const nextCursor = start + items.length < filtered.length ? start + items.length : null;

    return {
      items,
      total: filtered.length,
      nextCursor,
      skippedCorrupt,
    };
  }

  async deleteGame(id) {
    if (!id) return false;
    this._memGames.delete(id);
    if (this.memoryFallback || !(await this._getDb())) return true;
    try {
      await this._idbTx('games', 'readwrite', (store) => {
        store.delete(id);
      });
      return true;
    } catch {
      return false;
    }
  }

  async deleteAllGames() {
    this._memGames.clear();
    if (this.memoryFallback || !(await this._getDb())) return true;
    try {
      await this._idbTx('games', 'readwrite', (store) => {
        store.clear();
      });
      return true;
    } catch {
      return false;
    }
  }

  async updateNote(id, note) {
    const rec = await this.getGame(id);
    if (!rec) return { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy ván cờ.' } };
    const cleaned = sanitizeNote(note);
    if (cleaned) rec.note = cleaned;
    else delete rec.note;
    rec.updatedAt = new Date().toISOString();
    return this.saveGame(rec);
  }

  async exportAll() {
    const { items } = await this.listGames({ limit: this.maxGames + 50, cursor: 0 });
    return {
      v: RECORD_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      games: items.map((g) => createGameRecord(g)),
    };
  }

  async importBundle(bundleObj, { forcePruneOldest = false } = {}) {
    if (!bundleObj || typeof bundleObj !== 'object' || !Array.isArray(bundleObj.games)) {
      return {
        ok: false,
        imported: 0,
        failed: 1,
        errors: ['Định dạng gói sao lưu không hợp lệ.'],
        warnings: [],
      };
    }
    let imported = 0;
    let failed = 0;
    const errors = [];
    const warnings = [];

    for (let i = 0; i < bundleObj.games.length; i++) {
      const res = validateAndNormalizeRecord(bundleObj.games[i], { isImport: true });
      if (!res.ok) {
        failed++;
        errors.push(`Ván #${i + 1}: ${res.error.message}`);
        continue;
      }
      if (res.warnings.length > 0) warnings.push(...res.warnings);
      const saved = await this.saveGame(res.record, { forcePruneOldest });
      if (!saved.ok) {
        failed++;
        errors.push(
          saved.needsPrune
            ? `Ván #${i + 1}: Thư viện đã đạt giới hạn ${saved.cap} ván.`
            : saved.error?.message || `Ván #${i + 1}: Không thể lưu.`
        );
      } else {
        imported++;
      }
    }
    return { ok: imported > 0 || failed === 0, imported, failed, errors, warnings };
  }

  // ---- Autosave snapshots (local/ai only; never online) ----

  async putAutosave(slot, snapshot) {
    if (!AUTOSAVE_SLOTS.includes(slot)) return { ok: false };
    const entry = { slot, savedAt: new Date().toISOString(), ...snapshot };
    try {
      if (this.simulateQuotaError) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      if (this.memoryFallback || !(await this._getDb())) {
        this._memAutosave.set(slot, structuredClone(entry));
        return { ok: true };
      }
      await this._idbTx('autosave', 'readwrite', (store) => {
        store.put(entry);
      });
      return { ok: true };
    } catch (err) {
      if (isQuotaError(err)) {
        this._notifyError('QUOTA_EXCEEDED', QUOTA_ERR_MSG);
        return { ok: false, error: { code: 'QUOTA_EXCEEDED', message: QUOTA_ERR_MSG } };
      }
      this._notifyFallback('IDB_AUTOSAVE_ERR', FALLBACK_BANNER_MSG);
      this._memAutosave.set(slot, structuredClone(entry));
      return { ok: true, memoryFallback: true };
    }
  }

  async getAutosave(slot) {
    if (!slot) return null;
    if (this.memoryFallback || !(await this._getDb())) {
      const hit = this._memAutosave.get(slot);
      return hit ? structuredClone(hit) : null;
    }
    try {
      const db = await this._getDb();
      return await new Promise((resolve) => {
        const tx = db.transaction('autosave', 'readonly');
        const req = tx.objectStore('autosave').get(slot);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return this._memAutosave.get(slot) || null;
    }
  }

  async listAutosaves() {
    const out = [];
    for (const slot of AUTOSAVE_SLOTS) {
      const snap = await this.getAutosave(slot);
      if (snap && snap.record && Array.isArray(snap.record.moves) && snap.record.moves.length > 0) {
        out.push(snap);
      }
    }
    out.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
    return out;
  }

  async clearAutosave(slot) {
    if (!slot) return;
    this._memAutosave.delete(slot);
    if (this.memoryFallback || !(await this._getDb())) return;
    try {
      await this._idbTx('autosave', 'readwrite', (store) => {
        store.delete(slot);
      });
    } catch {
      // ignore
    }
  }

  async _readAllAnalysesRaw() {
    if (this.memoryFallback) return [...this._memAnalysis.values()];
    try {
      const db = await this._getDb();
      if (!db) return [...this._memAnalysis.values()];
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('analysis', 'readonly');
        const req = tx.objectStore('analysis').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [...this._memAnalysis.values()];
    }
  }

  async listAnalyses() {
    const all = await this._readAllAnalysesRaw();
    all.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return all;
  }

  async getAnalysis(key) {
    if (!key) return null;
    if (this.memoryFallback || !(await this._getDb())) {
      const hit = this._memAnalysis.get(key);
      return hit ? structuredClone(hit) : null;
    }
    try {
      const db = await this._getDb();
      return await new Promise((resolve) => {
        const tx = db.transaction('analysis', 'readonly');
        const req = tx.objectStore('analysis').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return this._memAnalysis.get(key) || null;
    }
  }

  async putAnalysis(entry, { pruneOldest = true } = {}) {
    if (!entry || !entry.key) return { ok: false, error: 'INVALID_KEY' };
    const clean = { ...entry, updatedAt: entry.updatedAt || new Date().toISOString() };
    const all = await this._readAllAnalysesRaw();
    const exists = all.some((a) => a.key === clean.key);
    if (!exists && all.length >= this.maxAnalyses) {
      if (!pruneOldest) {
        return { ok: false, error: 'CAP_REACHED', cap: this.maxAnalyses };
      }
      all.sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
      const toRemove = all.slice(0, all.length - this.maxAnalyses + 1);
      for (const old of toRemove) {
        await this.deleteAnalysis(old.key);
      }
    }
    this._memAnalysis.set(clean.key, structuredClone(clean));
    if (this.memoryFallback || !(await this._getDb())) {
      return { ok: true, key: clean.key };
    }
    try {
      await this._idbTx('analysis', 'readwrite', (store) => {
        store.put(clean);
      });
      return { ok: true, key: clean.key };
    } catch (err) {
      if (isQuotaError(err)) {
        this._notifyError('QUOTA_EXCEEDED', QUOTA_ERR_MSG);
        return { ok: false, error: 'QUOTA_EXCEEDED' };
      }
      return { ok: true, key: clean.key };
    }
  }

  async deleteAnalysis(key) {
    if (!key) return;
    this._memAnalysis.delete(key);
    if (this.memoryFallback || !(await this._getDb())) return;
    try {
      await this._idbTx('analysis', 'readwrite', (store) => {
        store.delete(key);
      });
    } catch {
      // ignore
    }
  }

  async clearAll() {
    this._memGames.clear();
    this._memAutosave.clear();
    this._memAnalysis.clear();
    if (this.memoryFallback || !(await this._getDb())) return;
    try {
      await this._idbTx('games', 'readwrite', (s) => s.clear());
      await this._idbTx('autosave', 'readwrite', (s) => s.clear());
      await this._idbTx('analysis', 'readwrite', (s) => s.clear());
    } catch {
      // ignore
    }
  }

  async usage() {
    const all = await this._readAllGamesRaw();
    let approxBytes = 0;
    for (const g of all) {
      try {
        approxBytes += JSON.stringify(g).length * 2;
      } catch {
        // ignore
      }
    }
    return {
      count: all.length,
      cap: this.maxGames,
      approxBytes,
      memoryFallback: this.memoryFallback,
    };
  }
}

export const gameStore = new GameStore();
