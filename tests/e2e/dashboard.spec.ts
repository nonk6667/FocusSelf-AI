import { test, expect, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const storageKey = "focus-dashboard:v1";
async function navigate(page: Page, label: string) {
  const toggle = page.getByRole("button", { name: "打开导航" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("button", { name: label, exact: true }).click();
}
async function state(page: Page) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), storageKey);
}
async function addTask(page: Page, title: string) {
  await page
    .getByRole("button", { name: "新建任务", exact: false })
    .first()
    .click();
  await page.getByLabel("任务名称").fill(title);
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "让今天，向前一点。",
  );
});
test("create, edit, complete, persist, and delete a task", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await addTask(page, "验证我的新任务");
  await page.getByLabel("预计用时 / 分钟").fill("45");
  await page.getByLabel("实际用时 / 分钟").fill("20");
  await page.getByRole("button", { name: "保存任务" }).click();
  await expect(
    page.getByRole("button", { name: /验证我的新任务/ }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /验证我的新任务/ })
    .filter({ hasText: "验证我的新任务" })
    .first()
    .click();
  await page.getByLabel("任务名称").fill("已编辑的任务");
  await page.getByRole("button", { name: "保存任务" }).click();
  await page
    .getByRole("button", { name: "完成 已编辑的任务", exact: true })
    .click();
  expect(
    (await state(page)).tasks.find((t: any) => t.title === "已编辑的任务")
      .completedAt,
  ).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "重新打开 已编辑的任务", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "删除任务 已编辑的任务", exact: true })
    .click({ force: true });
  await page.getByRole("button", { name: "确认", exact: true }).click();
  expect(
    (await state(page)).tasks.some((t: any) => t.title === "已编辑的任务"),
  ).toBe(false);
  expect(errors).toEqual([]);
});
test("protected hours are enforced and Goal progress updates", async ({
  page,
}) => {
  await addTask(page, "晚间工作冲突");
  await page.getByLabel("开始时间（可选）").fill("20:30");
  await page.getByRole("button", { name: "保存任务" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "受保护时段",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  const before = await state(page);
  await page
    .getByRole("button", { name: "完成 完成线性回归练习与笔记", exact: true })
    .click();
  const card = page
    .locator(".goal-card")
    .filter({ hasText: "建立扎实的机器学习基础" });
  await expect(card).toContainText("67%");
  expect(
    (await state(page)).tasks.filter((t: any) => t.completedAt).length,
  ).toBe(before.tasks.filter((t: any) => t.completedAt).length + 1);
});
test("create goal, milestone, associated task and delete goal without deleting task", async ({
  page,
}) => {
  await navigate(page, "目标与里程碑");
  await page.getByRole("button", { name: "新建目标" }).click();
  await page.getByLabel("Goal 名称").fill("新的测试目标");
  await page.getByLabel("里程碑 1", { exact: true }).fill("阶段一");
  await page.getByRole("button", { name: "保存目标" }).click();
  await expect(
    page.locator(".goal-card").filter({ hasText: "新的测试目标" }),
  ).toContainText("阶段一");
  await navigate(page, "工作台");
  await addTask(page, "关联阶段一的任务");
  await page
    .getByLabel("关联 Goal → Milestone")
    .selectOption({ label: "阶段一" });
  await page.getByRole("button", { name: "保存任务" }).click();
  await page
    .getByRole("button", { name: "完成 关联阶段一的任务", exact: true })
    .click();
  await navigate(page, "目标与里程碑");
  const card = page.locator(".goal-card").filter({ hasText: "新的测试目标" });
  await expect(card).toContainText("100%");
  await page.getByRole("button", { name: "删除目标 新的测试目标" }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  const task = (await state(page)).tasks.find(
    (t: any) => t.title === "关联阶段一的任务",
  );
  expect(task.milestoneId).toBe("");
});
test("export, import, validation, project edit and overload warning", async ({
  page,
}) => {
  await navigate(page, "偏好与数据");
  await page.getByRole("button", { name: "编辑项目 AI 课程" }).click();
  await page.getByLabel("项目名称").fill("机器学习课程");
  await page.getByRole("button", { name: "保存项目" }).click();
  await expect(
    page.locator(".project-settings-row").filter({ hasText: "机器学习课程" }),
  ).toBeVisible();
  await page.getByLabel("每天工作容量 / 分钟").fill("60");
  await page.getByRole("button", { name: "保存偏好" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(backup.tasks.length).toBe(9);
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":2}'),
    });
  await expect(page.getByRole("status")).toContainText("数据格式无效");
  expect((await state(page)).tasks.length).toBe(9);
  backup.tasks[0].title = "从备份导入的任务";
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await navigate(page, "工作台");
  await expect(page.getByText("超载 3.8h")).toBeVisible();
  await expect(
    page.locator(".task-list").getByText("从备份导入的任务", { exact: true }),
  ).toBeVisible();
});
test("daily, weekly, monthly views and narrow screen stay usable", async ({
  page,
}) => {
  for (const name of ["每周", "每月", "每日"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("img", { name: "柱状完成率图" })).toBeVisible();
  }
  await navigate(page, "所有任务");
  await page.getByLabel("搜索任务").fill("Harness");
  await expect(page.locator(".task-row")).toHaveCount(1);
  await page.getByLabel("完成状态筛选").selectOption("done");
  await expect(page.locator(".task-row")).toHaveCount(0);
  await navigate(page, "工作台");
  await expect(page.locator(".task-row")).toHaveCount(1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
test("manual rollover preserves deadline and automatic rollover works on reopen", async ({
  page,
}) => {
  await page.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k)!);
    const t = s.tasks.find((t: any) => t.id === "t2");
    t.plannedDate = "2020-01-01";
    localStorage.setItem(k, JSON.stringify(s));
  }, storageKey);
  await page.reload();
  await page.getByRole("button", { name: "结转到当前周期" }).click();
  let s = await state(page);
  expect(s.tasks.find((t: any) => t.id === "t2").rollovers.length).toBe(1);
  expect(s.tasks.find((t: any) => t.id === "t2").dueDate).not.toBe(
    "2020-01-01",
  );
  await page.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k)!);
    s.tasks.find((t: any) => t.id === "t3").plannedDate = "2020-01-01";
    s.settings.autoRollover = true;
    localStorage.setItem(k, JSON.stringify(s));
  }, storageKey);
  await page.reload();
  await expect
    .poll(
      async () =>
        (await state(page)).tasks.find((t: any) => t.id === "t3").rollovers
          .length,
    )
    .toBe(1);
});
test("corrupt data is preserved and recoverable", async ({ page }) => {
  await page.evaluate((k) => {
    localStorage.setItem("focus-dashboard:backup:v1", localStorage.getItem(k)!);
    localStorage.setItem(k, "broken-json");
  }, storageKey);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "本地数据暂时无法读取" }),
  ).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), storageKey)).toBe(
    "broken-json",
  );
  await page.getByRole("button", { name: "恢复自动备份" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "让今天，向前一点。",
  );
});
