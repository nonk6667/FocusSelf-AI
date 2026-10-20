import { spawnSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { join } from "node:path";
import { homedir } from "node:os";
import assert from "node:assert/strict";
const sdk = process.env.ANDROID_HOME || join(homedir(), "Library/Android/sdk");
const adb = join(sdk, "platform-tools", "adb");
const devices = spawnSync(adb, ["devices"], { encoding: "utf8" })
  .stdout.split("\n")
  .map((l) => l.split(/\s+/))
  .filter((v) => v[0].startsWith("emulator-") && v[1] === "device");
if (devices.length !== 1)
  throw Error("请仅启动一台安卓模拟器。此测试不会选择真机。");
const serial = devices[0][0],
  app = "io.focusworkspace.app",
  key = "focus-dashboard:v1";
function shell(...args) {
  const r = spawnSync(adb, ["-s", serial, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw Error(r.stderr);
  return r.stdout.trim();
}
async function connect() {
  for (let i = 0; i < 30; i++) {
    const pid = spawnSync(adb, ["-s", serial, "shell", "pidof", app], {
      encoding: "utf8",
    }).stdout.trim();
    if (pid) {
      shell(
        "forward",
        "tcp:9222",
        `localabstract:webview_devtools_remote_${pid}`,
      );
      try {
        const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
        const p = b.contexts()[0].pages()[0];
        await expect(p.getByRole("heading", { level: 1 })).toBeVisible();
        return { browser: b, page: p };
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("无法连接调试版 WebView");
}
async function stored(page) {
  return page.evaluate(
    async (k) =>
      JSON.parse(
        (await window.Capacitor.Plugins.Preferences.get({ key: k })).value,
      ),
    key,
  );
}
shell("shell", "am", "start", "-n", `${app}/.MainActivity`);
let { browser, page } = await connect();
const native = await page.evaluate(() => window.Capacitor.isNativePlatform());
assert.equal(native, true);
const permissions = shell("shell", "dumpsys", "package", app);
assert.equal(permissions.includes("android.permission.INTERNET"), false);
console.log("PASS: APK uses bundled assets and has no Internet permission");
const title = `安卓持久化验证 ${Date.now()}`;
await page
  .getByRole("button", { name: "新建任务", exact: false })
  .first()
  .click();
await page.getByLabel("任务名称").fill(title);
await page.getByLabel("实际用时 / 分钟").fill("15");
await page.getByRole("button", { name: "保存任务" }).click();
await expect(page.getByRole("dialog")).toHaveCount(0);
assert.ok((await stored(page)).tasks.some((t) => t.title === title));
await page.getByRole("button", { name: `完成 ${title}`, exact: true }).click();
await expect
  .poll(
    async () =>
      (await stored(page)).tasks.find((t) => t.title === title)?.completedAt,
  )
  .toBeTruthy();
console.log(
  "PASS: create and complete task persisted in native SharedPreferences",
);
await page.evaluate(() => localStorage.clear());
await browser.close();
shell("shell", "am", "force-stop", app);
shell("shell", "am", "start", "-n", `${app}/.MainActivity`);
({ browser, page } = await connect());
await expect(
  page.getByRole("button", { name: `重新打开 ${title}`, exact: true }),
).toBeVisible();
console.log(
  "PASS: task survives force-stop and removal of WebView localStorage",
);
await page
  .getByRole("button", { name: "新建任务", exact: false })
  .first()
  .click();
shell("shell", "input", "keyevent", "4");
await expect(page.getByRole("dialog")).toHaveCount(0);
console.log("PASS: Android Back dismisses modal");
await page
  .getByRole("button", { name: `删除任务 ${title}`, exact: true })
  .click();
await page.getByRole("button", { name: "确认", exact: true }).click();
await expect
  .poll(async () => (await stored(page)).tasks.some((t) => t.title === title))
  .toBe(false);
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
);
console.log("PASS: native layout fits phone width");
await page.getByRole("button", { name: "打开导航" }).click();
await page.getByRole("button", { name: "偏好与数据", exact: true }).click();
const backup = await stored(page);
const imported = structuredClone(backup);
imported.tasks[0].notes = "安卓导入验证";
await page
  .locator("input[type=file]")
  .setInputFiles({
    name: "native-test.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
await page.getByRole("button", { name: "确认", exact: true }).click();
await expect
  .poll(async () => (await stored(page)).tasks[0].notes)
  .toBe("安卓导入验证");
console.log("PASS: native JSON import is validated and persisted");
// Restore the original data after the import test; leave the emulator ready for export QA.
await page
  .locator("input[type=file]")
  .setInputFiles({
    name: "restore-test.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
await page.getByRole("button", { name: "确认", exact: true }).click();
await expect
  .poll(async () => (await stored(page)).tasks[0].notes)
  .toBe(backup.tasks[0].notes);
await browser.close();
shell("forward", "--remove", "tcp:9222");
console.log("Android smoke tests passed. No physical phone was modified.");
