import type { SavedRecord, SavedStore } from "./types";

// Saved investigations (Requirement 5). The browser adapter keeps one object store, `investigations`, in the IndexedDB
// database `hauntmap`, keyed by the label. The memory adapter serves the tests and is never used by the app.

const DATABASE = "hauntmap";
const STORE = "investigations";

/** The UTF-8 byte length of the JSON text of the record (5.2). */
export function recordSize(record: SavedRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).length;
}

const newestFirst = (a: SavedRecord, b: SavedRecord): number => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0);

/** An error that carries only a name, the way a failed request reports it. */
function named(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

const nameOf = (error: unknown): string => {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" && name !== "" ? name : "Error";
};

export function createMemorySavedStore(): SavedStore {
  const records = new Map<string, SavedRecord>();
  return {
    list: async () => [...records.values()].map((record) => structuredClone(record)).sort(newestFirst),
    put: async (record) => {
      records.set(record.label, structuredClone(record));
    },
    delete: async (label) => {
      records.delete(label);
    },
  };
}

/** Runs one request of a transaction and settles with its result, or with the error name. */
function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(named(nameOf(source.error)));
  });
}

export function createSavedStore(idb: IDBFactory | undefined): SavedStore | null {
  if (idb === undefined) return null;
  let opened: Promise<IDBDatabase> | null = null;

  const database = (): Promise<IDBDatabase> => {
    if (opened !== null) return opened;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      try {
        const open = idb.open(DATABASE, 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: "label" });
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(named(nameOf(open.error)));
        open.onblocked = () => reject(named("BlockedError"));
      } catch (error) {
        reject(named(nameOf(error)));
      }
    });
    // A failed open is tried again by the next call.
    opened = attempt;
    attempt.catch(() => {
      if (opened === attempt) opened = null;
    });
    return attempt;
  };

  /** One transaction on the object store; resolves when it completes. */
  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T> => {
    const db = await database();
    try {
      const transaction = db.transaction(STORE, mode);
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(named(nameOf(transaction.error)));
        transaction.onabort = () => reject(named(nameOf(transaction.error ?? { name: "AbortError" })));
      });
      const value = await work(transaction.objectStore(STORE));
      await done;
      return value;
    } catch (error) {
      throw named(nameOf(error));
    }
  };

  return {
    list: () => run("readonly", (store) => request(store.getAll() as IDBRequest<SavedRecord[]>)).then((all) => [...all].sort(newestFirst)),
    put: (record) => run("readwrite", (store) => request(store.put(record))).then(() => undefined),
    delete: (label) => run("readwrite", (store) => request(store.delete(label))).then(() => undefined),
  };
}
