import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createSystemTimeExtension, getSystemTime } = await jiti.import("./system-time-tool.ts");

test("system time tool reports the host-local calendar date instead of UTC date", () => {
  const date = new Date(2026, 7, 30, 0, 5, 6);
  const time = getSystemTime(date);

  assert.equal(time.date, "2026-08-30");
  assert.equal(time.time, "00:05:06");
  assert.match(time.utcOffset, /^[+-]\d{2}:\d{2}$/);
  assert.equal(time.iso8601, date.toISOString());
});

test("system time extension registers a parameterless read-only tool", async () => {
  let registeredTool;
  createSystemTimeExtension().factory({
    registerTool(tool) {
      registeredTool = tool;
    },
  });

  assert.equal(registeredTool.name, "system_time");
  assert.match(registeredTool.description, /today, tomorrow, yesterday/);
  assert.deepEqual(registeredTool.parameters.properties, {});

  const result = await registeredTool.execute();
  const reportedTime = JSON.parse(result.content[0].text);
  assert.match(reportedTime.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(reportedTime.time, /^\d{2}:\d{2}:\d{2}$/);
});
