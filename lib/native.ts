import { Capacitor } from "@capacitor/core";
export const isNative = () => Capacitor.isNativePlatform();
export async function readStoredRaw(key: string): Promise<string | null> {
  if (isNative()) {
    const { Preferences } = await import("@capacitor/preferences");
    return (await Preferences.get({ key })).value;
  }
  return localStorage.getItem(key);
}
export async function writeStoredRaw(
  key: string,
  value: string,
): Promise<void> {
  if (isNative()) {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key, value });
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Native storage is authoritative. */
    }
    return;
  }
  localStorage.setItem(key, value);
}
export async function removeStoredRaw(key: string): Promise<void> {
  if (isNative()) {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key });
  }
  localStorage.removeItem(key);
}
