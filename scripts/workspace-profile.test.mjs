import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { workspaceType, WORKSPACE_PRIORITIES } from "../src/components/modules/settings/workspace-profile.ts";
import { PRIVATE_SCHOOL_TYPES, isPrivateSchool, supportsPrivateSchools } from "../src/components/modules/settings/private-school-types.ts";

const nursery = { id: "n", center_type: "nursery" };
const therapy = { id: "t", center_type: "therapy_center" };

test("single-section establishments receive their profile without a selected section", () => {
  assert.equal(workspaceType([nursery], null), "nursery");
});
test("mixed establishments use an overview and respect an explicit selection", () => {
  assert.equal(workspaceType([nursery, therapy], null), "mixed");
  assert.equal(workspaceType([nursery, therapy], "t"), "therapy_center");
});
test("multiple sections of the same type retain their shared profile", () => {
  assert.equal(workspaceType([nursery, { ...nursery, id: "n2" }], null), "nursery");
});
test("missing, stale and unknown sections fall back without inventing a kindergarten", () => {
  assert.equal(workspaceType([], null), "mixed");
  assert.equal(workspaceType([nursery, therapy], "deleted"), "mixed");
  assert.equal(workspaceType([{ id: "future", center_type: "school" }], null), "mixed");
});
test("each profile has four distinct priorities", () => {
  for (const keys of Object.values(WORKSPACE_PRIORITIES)) {
    assert.equal(keys.length, 4);
    assert.equal(new Set(keys).size, 4);
  }
});

test("private-school cycles remain distinct from tutoring and kindergarten", () => {
  for (const type of PRIVATE_SCHOOL_TYPES) {
    assert.equal(workspaceType([{ id: "school", center_type: type }], null), type);
    assert.equal(isPrivateSchool(type), true);
  }
  assert.equal(isPrivateSchool("edu_center"), false);
  assert.equal(isPrivateSchool("kindergarten"), false);
  assert.equal(workspaceType(PRIVATE_SCHOOL_TYPES.map((type) => ({ id: type, center_type: type })), null), "mixed");
});

test("school creation stays unavailable on old, partial or malformed capability responses", () => {
  for (const response of [null, {}, "private_primary", [], ["kindergarten"], ["private_primary"]]) {
    assert.equal(supportsPrivateSchools(response), false);
  }
  assert.equal(supportsPrivateSchools([...PRIVATE_SCHOOL_TYPES, "nursery"]), true);
});

test("all dynamic profile and navigation labels exist in every supported language", () => {
  for (const locale of ["ar", "fr", "en"]) {
    const base = new URL(`../messages/${locale}/`, import.meta.url);
    const dashboard = JSON.parse(readFileSync(new URL("dashboard.json", base), "utf8"));
    const common = JSON.parse(readFileSync(new URL("common.json", base), "utf8"));
    const auth = JSON.parse(readFileSync(new URL("auth.json", base), "utf8"));
    const settings = JSON.parse(readFileSync(new URL("settings.json", base), "utf8"));
    const learning = JSON.parse(readFileSync(new URL("learning.json", base), "utf8"));
    for (const type of PRIVATE_SCHOOL_TYPES) {
      assert.deepEqual(auth.centerTypes[type], settings.centerTypes[type]);
      assert.ok(auth.centerTypes[type].name);
      assert.ok(auth.centerTypes[type].desc);
    }
    for (const [type, keys] of Object.entries(WORKSPACE_PRIORITIES)) {
      assert.ok(dashboard.workspace[type].title, `${locale}: ${type} title`);
      assert.ok(dashboard.workspace[type].description, `${locale}: ${type} description`);
      for (const key of keys) assert.ok(key === "learning" ? learning.title : common.nav[key], `${locale}: ${key}`);
    }
  }
});
