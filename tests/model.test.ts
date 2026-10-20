import test from "node:test";
import assert from "node:assert/strict";
import {
  id,
  capacity,
  chartBuckets,
  dateKey,
  daysBetween,
  goalTasks,
  parseState,
  progress,
  protectedConflict,
  rangeFor,
  rollOver,
  seedState,
  shiftDate,
  stepPeriod,
  tasksInRange,
  validateTask,
} from "../lib/model";
import { LocalRepository, STORAGE_KEY, BACKUP_KEY } from "../lib/storage";
const today = "2026-10-20";
const seed = () => seedState(today);

test("seed is fully valid and contains six requested editable categories", () => {
  const s = parseState(seed());
  assert.equal(s.projects.length, 6);
  assert.equal(s.tasks.length, 9);
  assert.equal(s.settings.timezone, "Europe/London");
});
test("week starts on Monday including Sunday boundary", () => {
  assert.deepEqual(rangeFor("2026-10-25", "weekly"), [
    "2026-10-19",
    "2026-10-25",
  ]);
  assert.deepEqual(rangeFor("2026-10-26", "weekly"), [
    "2026-10-26",
    "2026-11-01",
  ]);
});
test("month supports leap years and year crossings", () => {
  assert.deepEqual(rangeFor("2028-02-15", "monthly"), [
    "2028-02-01",
    "2028-02-29",
  ]);
  assert.equal(stepPeriod("2026-12-31", "monthly", 1), "2027-01-01");
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
});
test("timezone determines today across midnight and daylight saving", () => {
  const d = new Date("2026-10-20T23:30:00Z");
  assert.equal(dateKey(d, "Europe/London"), "2026-10-21");
  assert.equal(dateKey(d, "America/New_York"), "2026-10-20");
  assert.equal(
    dateKey(new Date("2026-10-26T00:30Z"), "Europe/London"),
    "2026-10-26",
  );
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2);
});
test("goal progress derives only from linked milestone tasks", () => {
  const s = seed();
  assert.equal(progress(goalTasks(s, "g-ai")), 33);
  s.tasks.find((t) => t.id === "t3")!.completedAt = new Date().toISOString();
  assert.equal(progress(goalTasks(s, "g-ai")), 67);
  assert.equal(progress([]), 0);
});
test("work cannot overlap protected evening including crossing 20:00", () => {
  const s = seed(),
    t = s.tasks[1],
    p = s.projects[1];
  for (const startTime of ["20:00", "21:30", "19:30"])
    assert.match(protectedConflict({ ...t, startTime }, p), /受保护/);
  assert.equal(protectedConflict({ ...t, startTime: "18:30" }, p), "");
  assert.equal(
    protectedConflict({ ...t, startTime: "23:00", estimate: 60 }, p),
    "",
  );
  assert.match(protectedConflict({ ...t, startTime: "23:30" }, p), /午夜/);
});
test("life projects can use protected hours; unscheduled work is allowed", () => {
  const s = seed();
  assert.equal(protectedConflict(s.tasks[4], s.projects[4]), "");
  assert.equal(
    protectedConflict({ ...s.tasks[1], startTime: "" }, s.projects[1]),
    "",
  );
});
test("capacity excludes all life projects and calculates remaining actual time", () => {
  const s = seed(),
    c = capacity(s, today);
  assert.deepEqual(c, { planned: 285, remaining: 195, actual: 80, limit: 360 });
  s.tasks[1].actual = 30;
  assert.equal(capacity(s, today).remaining, 165);
});
test("range filtering includes tasks regardless of cadence but excludes outside anchor", () => {
  const s = seed();
  assert.equal(tasksInRange(s.tasks, today, "daily").length, 7);
  assert.equal(tasksInRange(s.tasks, today, "weekly").length, 8);
});
test("rollover respects each period, preserves DDL and completion, and is idempotent", () => {
  const s = seed();
  s.tasks[1].plannedDate = "2026-10-19";
  s.tasks[6].plannedDate = "2026-10-19";
  s.tasks[7].plannedDate = "2026-10-01";
  const n = rollOver(s, today);
  assert.equal(n.tasks[1].plannedDate, today);
  assert.equal(n.tasks[1].dueDate, s.tasks[1].dueDate);
  assert.equal(n.tasks[1].rollovers[0].from, "2026-10-19");
  assert.equal(n.tasks[6].plannedDate, "2026-10-19");
  assert.equal(n.tasks[7].plannedDate, "2026-10-01");
  assert.equal(rollOver(n, today), n);
  assert.equal(n.tasks[0].completedAt, s.tasks[0].completedAt);
});
test("weekly and monthly rollover happens only after period end", () => {
  const s = seed();
  s.tasks[6].plannedDate = "2026-10-19";
  s.tasks[7].plannedDate = "2026-10-01";
  assert.equal(rollOver(s, "2026-10-26").tasks[6].plannedDate, "2026-10-26");
  assert.equal(rollOver(s, "2026-11-01").tasks[7].plannedDate, "2026-11-01");
});
test("charts calculate real rates, not cumulative synthetic values", () => {
  const s = seed(),
    daily = chartBuckets(s.tasks, today, "daily");
  assert.equal(daily.length, 1);
  assert.equal(daily[0].rate, 29);
  assert.equal(daily[0].total, 7);
  const weekly = chartBuckets(s.tasks, today, "weekly");
  assert.equal(weekly.length, 7);
  assert.equal(weekly[1].rate, 29);
  assert.equal(weekly[0].rate, 0);
  assert.equal(chartBuckets(s.tasks, today, "monthly").length, 5);
});
test("invalid backups reject version, impossible dates, IDs and foreign references", () => {
  assert.throws(() => parseState({ ...seed(), version: 2 }));
  const s = seed();
  s.tasks[0].dueDate = "2026-02-30";
  assert.throws(() => parseState(s));
  const a = seed();
  a.tasks[0].projectId = "missing";
  assert.throws(() => parseState(a));
  const b = seed();
  b.tasks.push(b.tasks[0]);
  assert.throws(() => parseState(b));
});
test("import and task validation reject mismatched goal/project and protected conflicts", () => {
  const s = seed();
  assert.throws(() =>
    validateTask({ ...s.tasks[1], milestoneId: "m-ai-1" }, s),
  );
  s.tasks[1].startTime = "20:00";
  assert.throws(() => parseState(s));
  const b = seed();
  b.settings.timezone = "Not/A_Zone";
  assert.throws(() => parseState(b));
});
test("repository saves, restores, backs up and blocks stale writes", () => {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => entries.get(k) ?? null,
      setItem: (k: string, v: string) => entries.set(k, v),
    },
  });
  const a = new LocalRepository(),
    b = new LocalRepository();
  assert.equal(a.load(), null);
  a.save(seed());
  assert.equal(b.load()?.tasks.length, 9);
  const n = seed();
  n.tasks = [];
  a.save(n);
  assert.equal(JSON.parse(entries.get(BACKUP_KEY)!).tasks.length, 9);
  assert.throws(() => b.save(seed()), /另一个标签页/);
  assert.equal(JSON.parse(entries.get(STORAGE_KEY)!).tasks.length, 0);
  assert.equal(b.load()?.tasks.length, 0);
});
test("corrupt storage never overwrites original data during load", () => {
  const entries = new Map([[STORAGE_KEY, "broken json"]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => entries.get(k) ?? null,
      setItem: (k: string, v: string) => entries.set(k, v),
    },
  });
  assert.throws(() => new LocalRepository().load());
  assert.equal(entries.get(STORAGE_KEY), "broken json");
});

test("IDs work on insecure LAN origins without crypto.randomUUID", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues: (bytes: Uint8Array) => {
          for (let i = 0; i < bytes.length; i++) bytes[i] = i;
          return bytes;
        },
      },
    });
    assert.match(id(), /^[a-f0-9]{32}$/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
  }
});
test("storage write failure preserves the current data", () => {
  const entries = new Map<string, string>();
  let fail = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => entries.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (fail && k === STORAGE_KEY) throw Error("QuotaExceededError");
        entries.set(k, v);
      },
    },
  });
  const r = new LocalRepository();
  r.load();
  r.save(seed());
  const before = entries.get(STORAGE_KEY);
  fail = true;
  assert.throws(() => r.save({ ...seed(), tasks: [] }), /Quota/);
  assert.equal(entries.get(STORAGE_KEY), before);
});
