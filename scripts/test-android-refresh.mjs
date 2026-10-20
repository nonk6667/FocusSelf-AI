// Finite, read-only frame scheduling sample during real Android swipes.
// This measures WebView rAF cadence, not every frame presented by SurfaceFlinger.
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
const adb = join(process.env.ANDROID_HOME || join(homedir(), "Library/Android/sdk"), "platform-tools", "adb");
const arg = process.argv.indexOf("--serial");
const devices = execFileSync(adb, ["devices"], { encoding: "utf8" }).split("\n")
  .map(line => line.trim().split(/\s+/)).filter(d => d[1] === "device");
const serial = arg >= 0 ? process.argv[arg + 1] : devices.find(d => d[0].startsWith("emulator-"))?.[0];
if (!serial || !devices.some(d => d[0] === serial)) throw Error("请用 --serial 指定已授权手机，或启动模拟器。");
const run = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8" }).trim();
const pid = run("shell", "pidof", "io.focusworkspace.app");
if (!pid) throw Error("请先打开 Focus 工作台");
run("forward", "tcp:9224", `localabstract:webview_devtools_remote_${pid}`);
let browser;
try {
  browser = await chromium.connectOverCDP("http://127.0.0.1:9224", { timeout: 10000 });
  const page = browser.contexts()[0].pages()[0];
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.visibilityState), { timeout: 5000 }).toBe("visible");
  const hash = async () => createHash("sha256").update((await page.evaluate(async () =>
    (await window.Capacitor.Plugins.Preferences.get({ key: "focus-dashboard:v1" })).value)) || "").digest("hex");
  const before = await hash();
  const scroller = page.locator("[data-main-scroll]");
  const original = await scroller.evaluate(el => el.scrollTop);
  try {
    await scroller.evaluate(el => el.scrollTo(0, 0));
    const box = await scroller.boundingBox();
    // WebView fills the edge-to-edge window. DPR tracks the active foldable display.
    const dpr = await page.evaluate(() => devicePixelRatio);
    const x = Math.round((box.x + box.width * .65) * dpr);
    const from = Math.round((box.y + box.height * .8) * dpr);
    const to = Math.round((box.y + box.height * .28) * dpr);
    // Start sampling before touch input. The timer and rAF stop after 4 seconds.
    const sample = page.evaluate(() => new Promise(resolve => {
      const stamps = [];
      const start = performance.now();
      let frame;
      function finish() {
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        const intervals = stamps.slice(1).map((t, i) => t - stamps[i]).sort((a,b) => a-b);
        resolve({ samples: intervals.length, averageFps: intervals.length > 0
          ? 1000 * intervals.length / (stamps.at(-1) - stamps[0]) : 0,
          medianMs: intervals[Math.floor(intervals.length * .5)], p95Ms: intervals[Math.floor(intervals.length * .95)],
          viewport: [innerWidth, innerHeight], dpr: devicePixelRatio });
      }
      function tick(t) {
        stamps.push(t);
        if (t - start < 4000) frame = requestAnimationFrame(tick);
        else finish();
      }
      const timer = setTimeout(finish, 5000);
      frame = requestAnimationFrame(tick);
    }));
    for (const direction of [true, false, true]) {
      await promisify(execFile)(adb, ["-s", serial, "shell", "input", "swipe", String(x),
        String(direction ? from : to), String(x), String(direction ? to : from), "850"]);
    }
    const result = await sample;
    result.scrolled = await scroller.evaluate(el => el.scrollTop > 80);
    result.dataUnchanged = before === await hash();
    console.log(JSON.stringify(result, null, 2));
    if (!result.dataUnchanged || !result.scrolled) throw Error("持久数据或真实手势回归失败");
  } finally {
    await scroller.evaluate((el, top) => el.scrollTo(0, top), original);
  }
} finally {
  await browser?.close();
  run("forward", "--remove", "tcp:9224");
}
