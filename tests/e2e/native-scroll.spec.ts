import { test, expect } from "@playwright/test";
test("Android scroll container handles touch and unlocks after closing a dialog", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "让今天，向前一点。",
  );
  // Exercise the native-only layout in Chromium as well as on the real device.
  await page.evaluate(() => {
    document.documentElement.dataset.platform = "android";
  });
  const main = page.locator("[data-main-scroll]");
  await expect(main).toHaveCSS("overflow-y", "auto");
  const metrics = await main.evaluate((el) => ({
    height: el.clientHeight,
    content: el.scrollHeight,
  }));
  expect(metrics.content).toBeGreaterThan(metrics.height);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  async function swipe() {
    const box = (await main.boundingBox())!;
    const x = box.x + box.width * 0.65,
      start = box.y + box.height * 0.8,
      end = box.y + box.height * 0.28;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: start }],
    });
    for (let i = 1; i <= 12; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: start + ((end - start) * i) / 12 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await swipe();
  await expect
    .poll(() => main.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(80);
  await main.evaluate((el) => el.scrollTo(0, 0));
  await page
    .getByRole("button", { name: "新建任务", exact: false })
    .first()
    .click();
  await expect(main).toHaveCSS("overflow-y", "hidden");
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(main).toHaveCSS("overflow-y", "auto");
  await swipe();
  await expect
    .poll(() => main.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(80);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await cdp.detach();
});
