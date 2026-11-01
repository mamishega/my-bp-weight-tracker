// Optional at-rest encryption for records in IndexedDB.
// AES-256-GCM with a key derived from the user's passcode (PBKDF2-SHA-256).
// The key exists only in memory while the app is unlocked; it is never stored.

export const KDF_ITERATIONS = 310_000;
const VERIFIER_TEXT = 'my-bp-weight-tracker:unlock-check';

export interface Sealed {
  iv: string; // base64
  ct: string; // base64
}

export interface LockRecord {
  id: 'lock';
  version: 1;
  salt: string; // base64
  iterations: number;
  verifier: Sealed;
  createdAt: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function cryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.getRandomValues === 'function';
}

export async function deriveKey(passcode: string, saltB64: string, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passcode.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function open<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.ct));
  return JSON.parse(dec.decode(pt)) as T;
}

export async function createLock(passcode: string): Promise<{ lock: LockRecord; key: CryptoKey }> {
  const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(passcode, salt, KDF_ITERATIONS);
  const verifier = await seal(key, VERIFIER_TEXT);
  return { lock: { id: 'lock', version: 1, salt, iterations: KDF_ITERATIONS, verifier, createdAt: new Date().toISOString() }, key };
}

/** Returns the key if the passcode is correct, otherwise null. */
export async function unlockWith(lock: LockRecord, passcode: string): Promise<CryptoKey | null> {
  try {
    const key = await deriveKey(passcode, lock.salt, lock.iterations);
    const v = await open<string>(key, lock.verifier);
    return v === VERIFIER_TEXT ? key : null;
  } catch {
    return null;
  }
}

export function passcodeProblem(p: string): string | null {
  if (p.length < 6) return 'Use at least 6 characters.';
  if (/^(\d)\1+$/.test(p) || ['123456', '1234567', '12345678', '654321', 'password', 'qwerty'].includes(p.toLowerCase())) return 'Choose something harder to guess.';
  return null;
}
