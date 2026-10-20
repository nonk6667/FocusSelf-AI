import { spawnSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
const sdk = process.env.ANDROID_HOME || join(homedir(), "Library/Android/sdk"),
  adb = join(sdk, "platform-tools", "adb");
const serialArg = process.argv.indexOf("--serial");
const devices = spawnSync(adb, ["devices"], { encoding: "utf8" })
  .stdout.split("\n")
  .map((line) => line.trim().split(/\s+/))
  .filter((d) => d[1] === "device");
const serial =
  serialArg >= 0
    ? process.argv[serialArg + 1]
    : devices.find((d) => d[0].startsWith("emulator-"))?.[0];
if (!serial || !devices.some((d) => d[0] === serial))
  throw Error("请启动模拟器，或用 --serial 明确指定已授权的真机。");
function run(...args) {
  const r = spawnSync(adb, ["-s", serial, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw Error(r.stderr);
  return r.stdout.trim();
}
const pid = run("shell", "pidof", "io.focusworkspace.app");
if (!pid) throw Error("请先打开 Focus 工作台");
run("forward", "tcp:9223", `localabstract:webview_devtools_remote_${pid}`);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
try {
  const page = browser.contexts()[0].pages()[0];
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const hash = async () =>
    createHash("sha256")
      .update(
        (await page.evaluate(
          async () =>
            (
              await window.Capacitor.Plugins.Preferences.get({
                key: "focus-dashboard:v1",
              })
            ).value,
        )) || "",
      )
      .digest("hex");
  const before = await hash();
  const scroller = page.locator("[data-main-scroll]");
  await expect(scroller).toHaveCSS("overflow-y", "auto");
  const size = run("shell", "wm", "size").match(
    /(?:Override|Physical) size: (\d+)x(\d+)/,
  );
  if (!size) throw Error("无法读取屏幕尺寸");
  const viewport = await page.evaluate(() => ({
    w: innerWidth,
    h: innerHeight,
  }));
  const scaleX = Number(size[1]) / viewport.w,
    scaleY = Number(size[2]) / viewport.h;
  async function swipe(direction = "up") {
    const box = await scroller.boundingBox(),
      x = Math.round((box.x + box.width * 0.65) * scaleX),
      a = Math.round((box.y + box.height * 0.8) * scaleY),
      b = Math.round((box.y + box.height * 0.28) * scaleY);
    run(
      "shell",
      "input",
      "swipe",
      String(x),
      String(direction === "up" ? a : b),
      String(x),
      String(direction === "up" ? b : a),
      "500",
    );
  }
  await scroller.evaluate((el) => el.scrollTo(0, 0));
  await swipe();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(80);
  console.log("PASS: native upward swipe scrolls content down");
  await scroller.evaluate((el) => el.scrollTo(0, 600));
  const start = await scroller.evaluate((el) => el.scrollTop);
  await swipe("down");
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeLessThan(start - 80);
  console.log("PASS: native downward swipe scrolls content up");
  const max = await scroller.evaluate(
    (el) => el.scrollHeight - el.clientHeight,
  );
  await scroller.evaluate((el, max) => el.scrollTo(0, max), max);
  await swipe("down");
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeLessThan(max - 80);
  console.log("PASS: swipe from chart/footer region is not trapped");
  await scroller.evaluate((el) => el.scrollTo(0, 0));
  await page
    .getByRole("button", { name: "新建任务", exact: false })
    .first()
    .click();
  await expect(scroller).toHaveCSS("overflow-y", "hidden");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(scroller).toHaveCSS("overflow-y", "auto");
  await swipe();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(80);
  console.log("PASS: scrolling restored after dialog cancellation");
  if (before !== (await hash())) throw Error("验证期间持久数据发生变化");
  await scroller.evaluate((el) => el.scrollTo(0, 0));
  console.log("PASS: persistent task data unchanged");
} finally {
  await browser.close();
  run("forward", "--remove", "tcp:9223");
}
