/**
 * Local Receipt Store — IndexedDB-backed storage for platform-signed event receipts.
 *
 * Layer 4 of the trust model: "can't omit".
 * At the moment a user signs an action, the platform returns a receipt containing
 * the event hash, sequence, and a platform ECDSA signature. The client stores it
 * here. If the platform later omits the event, the user holds cryptographic proof
 * of the platform's commitment.
 *
 * Storage: IndexedDB database "sme-receipts", object store "receipts"
 * Key: eventId (UUID)
 * Indexes: entityId, actorId, eventType, timestamp
 */

export interface StoredReceipt {
  /** Receipt format version */
  version: "1.0";
  /** The event's unique ID (primary key in IndexedDB) */
  eventId: string;
  /** Entity this event belongs to */
  entityId: string;
  /** Entity type */
  entityType: string;
  /** Event type */
  eventType: string;
  /** Per-entity sequence number */
  entitySequence: number;
  /** SHA-256 hash of the event */
  eventHash: string;
  /** Previous hash in entity chain */
  previousHash: string;
  /** Actor who triggered the event */
  actorId: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** SHA-256 of the canonical payload */
  payloadHash: string;
  /** Whether the event was passkey-signed */
  signed: boolean;
  /** Intent hash (if passkey-signed) */
  intentHash: string | null;
  /** Platform attestation */
  platformAttestation: {
    receiptHash: string;
    signature: string;
    publicKey: string;
    signedAt: string;
  };
  /** When this receipt was stored locally */
  storedAt: string;
}

const DB_NAME = "sme-receipts";
const DB_VERSION = 1;
const STORE_NAME = "receipts";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "eventId",
        });
        store.createIndex("entityId", "entityId", { unique: false });
        store.createIndex("actorId", "actorId", { unique: false });
        store.createIndex("eventType", "eventType", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Store a receipt from an API response.
 * Extracts the `_receipt` field if present.
 */
export async function storeReceipt(
  apiResponse: Record<string, unknown>,
): Promise<StoredReceipt | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return null;

  const receipt = apiResponse._receipt as StoredReceipt | undefined;
  if (!receipt || !receipt.eventId) return null;

  const stored: StoredReceipt = {
    ...receipt,
    storedAt: new Date().toISOString(),
  };

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(stored);
      tx.oncomplete = () => {
        db.close();
        resolve(stored);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // IndexedDB failures should never block the UI
    console.warn("[receipt-store] Failed to store receipt:", receipt.eventId);
    return null;
  }
}

/**
 * Get all receipts for the current user.
 */
export async function getReceipts(actorId?: string): Promise<StoredReceipt[]> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return [];

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);

      let request: IDBRequest<StoredReceipt[]>;
      if (actorId) {
        const index = store.index("actorId");
        request = index.getAll(actorId);
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => {
        db.close();
        // Sort by timestamp descending
        const results = request.result.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
        resolve(results);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch {
    return [];
  }
}

/**
 * Get receipts for a specific entity (e.g., a PO).
 */
export async function getReceiptsByEntity(
  entityId: string,
): Promise<StoredReceipt[]> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return [];

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("entityId");
      const request = index.getAll(entityId);
      request.onsuccess = () => {
        db.close();
        const results = request.result.sort(
          (a, b) => a.entitySequence - b.entitySequence,
        );
        resolve(results);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch {
    return [];
  }
}

/**
 * Get the total count of stored receipts.
 */
export async function getReceiptCount(): Promise<number> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return 0;

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).count();
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch {
    return 0;
  }
}

/**
 * Export all receipts as a JSON array (for external verification / backup).
 */
export async function exportReceipts(): Promise<string> {
  const receipts = await getReceipts();
  return JSON.stringify(receipts, null, 2);
}
