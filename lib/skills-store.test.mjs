import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  enrichSkillsWithUsage,
  findSkillInvocation,
  getCachedSkills,
  recordSkillUsage,
  replaceCachedSkills,
} = await jiti.import("./skills-store.ts");

function response(skills) {
  return { skills, diagnostics: [], projectResourcesLoaded: true };
}

function skill(name) {
  return {
    name,
    description: `${name} description`,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    disableModelInvocation: false,
    sourceInfo: {},
  };
}

test("replaces cached discovery results instead of retaining deleted skills", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-desktop-skills-store-"));
  const databasePath = join(directory, "pi.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  replaceCachedSkills("/project", response([skill("old"), skill("current")]), databasePath);
  replaceCachedSkills("/project", response([skill("current")]), databasePath);

  assert.deepEqual(getCachedSkills("/project", databasePath)?.skills.map((item) => item.name), ["current"]);
});

test("orders skills by recorded explicit usage", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-desktop-skills-store-"));
  const databasePath = join(directory, "pi.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const alpha = skill("alpha");
  const beta = skill("beta");

  recordSkillUsage({ name: alpha.name, filePath: alpha.filePath }, databasePath);
  recordSkillUsage({ name: beta.name, filePath: beta.filePath }, databasePath);
  recordSkillUsage({ name: beta.name, filePath: beta.filePath }, databasePath);

  const ranked = enrichSkillsWithUsage(response([alpha, beta]), databasePath).skills;
  assert.deepEqual(ranked.map((item) => item.name), ["beta", "alpha"]);
  assert.equal(ranked[0].usageCount, 2);
});

test("only resolves an existing explicit skill command", () => {
  const known = skill("known");
  assert.deepEqual(findSkillInvocation("/skill:known with args", [known]), {
    name: "known",
    filePath: known.filePath,
  });
  assert.equal(findSkillInvocation("/skill:missing", [known]), null);
  assert.equal(findSkillInvocation("use /skill:known", [known]), null);
});
