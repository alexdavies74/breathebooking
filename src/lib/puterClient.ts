const FALLBACK_KEY_PREFIX = "breathe-book:";

function getStorageKey(key: string): string {
  return `${FALLBACK_KEY_PREFIX}${key}`;
}

async function loadPuter() {
  const module = await import("@heyputer/puter.js");
  return module.default;
}

export async function getPuterProfile() {
  try {
    const puter = await loadPuter();
    return await puter.auth.getUser();
  } catch {
    return null;
  }
}

export async function loadPreference<T>(key: string): Promise<T | null> {
  try {
    const puter = await loadPuter();
    const value = await puter.kv.get(getStorageKey(key));
    return value ? (JSON.parse(String(value)) as T) : null;
  } catch {
    const value = window.localStorage.getItem(getStorageKey(key));
    return value ? (JSON.parse(value) as T) : null;
  }
}

export async function savePreference(key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);

  try {
    const puter = await loadPuter();
    await puter.kv.set(getStorageKey(key), serialized);
    return;
  } catch {
    window.localStorage.setItem(getStorageKey(key), serialized);
  }
}
