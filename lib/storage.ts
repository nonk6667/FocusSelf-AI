import { parseState, State } from "./model";
import { isNative, readStoredRaw, writeStoredRaw } from "./native";
export const STORAGE_KEY = "focus-dashboard:v1";
export const BACKUP_KEY = "focus-dashboard:backup:v1";
export interface DashboardRepository {
  load(): State | null | Promise<State | null>;
  save(state: State): void | Promise<void>;
}
export class LocalRepository implements DashboardRepository {
  private lastRead: string | null | undefined = undefined;
  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? parseState(JSON.parse(raw)) : null;
    this.lastRead = raw;
    return parsed;
  }
  save(state: State) {
    const json = JSON.stringify(parseState(state));
    const previous = localStorage.getItem(STORAGE_KEY);
    if (this.lastRead !== undefined && previous !== this.lastRead)
      throw Error("数据已在另一个标签页更新，请刷新后重试。");
    if (previous) localStorage.setItem(BACKUP_KEY, previous);
    localStorage.setItem(STORAGE_KEY, json);
    this.lastRead = json;
  }
}
// Android uses SharedPreferences as the source of truth, not WebView localStorage.
export class NativeRepository implements DashboardRepository {
  private lastRead: string | null | undefined = undefined;
  async load() {
    let raw = await readStoredRaw(STORAGE_KEY);
    if (raw === null) {
      const legacy = localStorage.getItem(STORAGE_KEY);
      if (legacy) {
        parseState(JSON.parse(legacy));
        await writeStoredRaw(STORAGE_KEY, legacy);
        raw = legacy;
      }
    }
    const parsed = raw ? parseState(JSON.parse(raw)) : null;
    this.lastRead = raw;
    return parsed;
  }
  async save(state: State) {
    const json = JSON.stringify(parseState(state));
    const previous = await readStoredRaw(STORAGE_KEY);
    if (this.lastRead !== undefined && previous !== this.lastRead)
      throw Error("数据已更新，请重新打开应用后重试。");
    if (previous) await writeStoredRaw(BACKUP_KEY, previous);
    await writeStoredRaw(STORAGE_KEY, json);
    this.lastRead = json;
  }
}
export function createRepository(): DashboardRepository {
  return isNative() ? new NativeRepository() : new LocalRepository();
}
export async function downloadState(state: State) {
  const data = JSON.stringify(parseState(state), null, 2),
    name = `focus-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (isNative()) {
    const { registerPlugin } = await import("@capacitor/core");
    const BackupFiles = registerPlugin<{
      save(options: {
        name: string;
        data: string;
      }): Promise<{ saved: boolean }>;
    }>("BackupFiles");
    await BackupFiles.save({ name, data });
    return;
  }
  const blob = new Blob([data], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
