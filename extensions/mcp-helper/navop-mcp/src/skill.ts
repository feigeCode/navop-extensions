import { cp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NavopError } from "./errors.js";

export interface SkillInstallOptions {
  target: "codex" | "agents";
  scope: "user" | "project";
  force: boolean;
  home?: string;
  cwd?: string;
}

const SKILL_ROOT = fileURLToPath(new URL("../skills/navop", import.meta.url));

export async function printSkill(): Promise<string> {
  return readFile(path.join(SKILL_ROOT, "SKILL.md"), "utf8");
}

export async function installSkill(options: SkillInstallOptions): Promise<string> {
  const root = options.scope === "user" ? options.home ?? os.homedir() : options.cwd ?? process.cwd();
  const target = path.join(root, options.target === "codex" ? ".codex" : ".agents", "skills", "navop");
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await mkdir(target, { recursive: false });
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    if (!options.force) throw new NavopError("skill_exists", `Navop Skill already exists at ${target}`);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
  }
  await cp(SKILL_ROOT, target, { recursive: true, force: false });
  return target;
}
