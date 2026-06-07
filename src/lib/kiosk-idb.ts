const DB_NAME = "kiosk-offline";
const DB_VERSION = 1;

export interface PunchQueueEntry {
  id?: number;
  workerId: string;
  pin: string;
  photoBase64: string | null;
  workDate: string;
  queuedAt: number;
  terminalId: string;
}

interface WorkerCacheRecord {
  terminalId: string;
  date: string;
  workers: unknown[];
  cachedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("worker_cache")) {
          db.createObjectStore("worker_cache", { keyPath: "terminalId" });
        }
        if (!db.objectStoreNames.contains("punch_queue")) {
          db.createObjectStore("punch_queue", { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function cacheWorkers(
  terminalId: string,
  date: string,
  workers: unknown[]
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("worker_cache", "readwrite");
    const store = tx.objectStore("worker_cache");
    const record: WorkerCacheRecord = { terminalId, date, workers, cachedAt: Date.now() };
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedWorkers(
  terminalId: string,
  date: string
): Promise<unknown[] | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("worker_cache", "readonly");
    const store = tx.objectStore("worker_cache");
    const req = store.get(terminalId);
    req.onsuccess = () => {
      const record = req.result as WorkerCacheRecord | undefined;
      if (record && record.date === date) {
        resolve(record.workers);
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function enqueuePunch(entry: Omit<PunchQueueEntry, "id">): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("punch_queue", "readwrite");
    const store = tx.objectStore("punch_queue");
    const req = store.add(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingPunches(): Promise<PunchQueueEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("punch_queue", "readonly");
    const store = tx.objectStore("punch_queue");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as PunchQueueEntry[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removePunch(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("punch_queue", "readwrite");
    const store = tx.objectStore("punch_queue");
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getPunchQueueCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("punch_queue", "readonly");
    const store = tx.objectStore("punch_queue");
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
