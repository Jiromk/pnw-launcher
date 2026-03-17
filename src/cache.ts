export type CachedResource = {
  id: string;
  html: string;
  updatedAt: number;
};

const DB_NAME = "pnw-cache";
const DB_VERSION = 1;
const STORE_NAME = "resources";

let dbPromise: Promise<IDBDatabase> | null = null;

function isIndexedDBSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDBSupported()) {
    return Promise.reject(new Error("IndexedDB non supporté"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "id" });
          }
        } catch (err) {
          reject(err);
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        reject(request.error ?? new Error("IndexedDB: ouverture échouée"));
      };

      request.onblocked = () => {
        console.warn("[cache] Ouverture IndexedDB bloquée par une autre instance");
      };
    });
  }
  return dbPromise;
}

export async function getCachedResource(id: string): Promise<CachedResource | null> {
  try {
    const db = await openDatabase();
    return await new Promise<CachedResource | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve((request.result as CachedResource | undefined) ?? null);
      };
      request.onerror = () => reject(request.error ?? new Error("Lecture cache échouée"));
      tx.onabort = () => reject(tx.error ?? new Error("Transaction lecture annulée"));
    });
  } catch (err) {
    console.warn("[cache] Lecture échouée", err);
    return null;
  }
}

export async function setCachedResource(resource: CachedResource): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(resource);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Écriture cache échouée"));
      tx.onabort = () => reject(tx.error ?? new Error("Transaction écriture annulée"));
    });
  } catch (err) {
    console.warn("[cache] Écriture échouée", err);
  }
}

export async function removeCachedResource(id: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Suppression cache échouée"));
      tx.onabort = () => reject(tx.error ?? new Error("Transaction suppression annulée"));
    });
  } catch (err) {
    console.warn("[cache] Suppression échouée", err);
  }
}

export async function clearCachedResources(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Nettoyage cache échoué"));
      tx.onabort = () => reject(tx.error ?? new Error("Transaction nettoyage annulée"));
    });
  } catch (err) {
    console.warn("[cache] Nettoyage échoué", err);
  }
}









