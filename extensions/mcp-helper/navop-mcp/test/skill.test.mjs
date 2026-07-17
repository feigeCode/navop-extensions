import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installSkill, printSkill } from "../dist/bin.js";

test("skill has stable frontmatter and installs without silent overwrite", async () => {
  const text = await printSkill();
  assert.match(text, /^---\nname: navop\n/);
  assert.match(text, /Agent.*--json/s);

  const home = await mkdtemp(path.join(os.tmpdir(), "navop-skill-"));
  const installed = await installSkill({ target: "codex", scope: "user", home, cwd: home, force: false });
  assert.equal(installed, path.join(home, ".codex", "skills", "navop"));
  assert.match(await readFile(path.join(installed, "SKILL.md"), "utf8"), /name: navop/);
  await assert.rejects(
    installSkill({ target: "codex", scope: "user", home, cwd: home, force: false }),
    (error) => error.code === "skill_exists",
  );
});

test("project agents target installs beneath the current project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "navop-skill-project-"));
  assert.equal(
    await installSkill({ target: "agents", scope: "project", home: root, cwd: root, force: false }),
    path.join(root, ".agents", "skills", "navop"),
  );
});
