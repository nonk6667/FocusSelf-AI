import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
const sdk =
  env.ANDROID_HOME ||
  env.ANDROID_SDK_ROOT ||
  (process.platform === "darwin"
    ? join(homedir(), "Library/Android/sdk")
    : process.platform === "win32"
      ? join(homedir(), "AppData/Local/Android/Sdk")
      : join(homedir(), "Android/Sdk"));
if (!existsSync(sdk))
  throw Error(
    "Android SDK 未找到，请在 Android Studio 安装 SDK，并设置 ANDROID_HOME。",
  );
if (!env.JAVA_HOME && process.platform === "darwin") {
  const bundled = "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
  const detected = spawnSync("/usr/libexec/java_home", ["-v", "21"], {
    encoding: "utf8",
  });
  env.JAVA_HOME = existsSync(bundled) ? bundled : detected.stdout?.trim();
}
env.ANDROID_HOME = sdk;
if (env.JAVA_HOME)
  env.PATH =
    join(env.JAVA_HOME, "bin") +
    (process.platform === "win32" ? ";" : ":") +
    (env.PATH || "");
const npm = process.platform === "win32" ? "npm.cmd" : "npm",
  npx = process.platform === "win32" ? "npx.cmd" : "npx";
function run(command, args, cwd = root) {
  const r = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}
run(npm, ["run", "build"]);
run(npx, ["cap", "sync", "android"]);
writeFileSync(
  join(root, "android/local.properties"),
  `sdk.dir=${sdk.replaceAll("\\", "\\\\").replaceAll(":", "\\:")}\n`,
);
run(
  process.platform === "win32" ? "gradlew.bat" : "./gradlew",
  ["assembleDebug", "--no-daemon", "--console=plain"],
  join(root, "android"),
);
const destination = join(root, "releases");
mkdirSync(destination, { recursive: true });
copyFileSync(
  join(root, "android/app/build/outputs/apk/debug/app-debug.apk"),
  join(destination, "focus-dashboard-debug.apk"),
);
console.log("\nAPK: releases/focus-dashboard-debug.apk");
if (process.argv.includes("--install")) {
  const adb = join(
    sdk,
    "platform-tools",
    process.platform === "win32" ? "adb.exe" : "adb",
  );
  const result = spawnSync(adb, ["devices"], { env, encoding: "utf8" });
  const devices = result.stdout
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((v) => v[1] === "device");
  if (devices.length !== 1)
    throw Error(
      "需要连接且授权一台设备（或仅启动一个模拟器）。请检查 adb devices。",
    );
  run(adb, [
    "-s",
    devices[0][0],
    "install",
    "-r",
    join(destination, "focus-dashboard-debug.apk"),
  ]);
  run(adb, [
    "-s",
    devices[0][0],
    "shell",
    "am",
    "start",
    "-n",
    "io.focusworkspace.app/.MainActivity",
  ]);
}
