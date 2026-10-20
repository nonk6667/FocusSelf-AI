import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "io.focusworkspace.app",
  appName: "Focus 工作台",
  webDir: "out",
  loggingBehavior: "none",
  backgroundColor: "#141417",
  plugins: { SystemBars: { style: "DARK", insetsHandling: "css" } },
  android: { backgroundColor: "#141417", allowMixedContent: false },
};
export default config;
