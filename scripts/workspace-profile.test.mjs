import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { workspaceType } from "../src/components/modules/settings/workspace-profile.ts";
import { CENTER_TYPES } from "../src/components/modules/settings/center-types.ts";
import { PRIVATE_SCHOOL_TYPES, isPrivateSchool, supportsPrivateSchools } from "../src/components/modules/settings/private-school-types.ts";
import { NAV_GROUPS, NAV_FOOTER, navFor, scopedCenterTypes } from "../src/components/shell/nav-items.ts";
import { rosterNoun } from "../src/lib/vocabulary.ts";

const nursery = { id: "n", center_type: "nursery" };
const therapy = { id: "t", center_type: "therapy_center" };
const school = { id: "s", center_type: "private_primary" };

test("single-structure establishments receive their profile without a selected structure", () => {
  assert.equal(workspaceType([nursery], null), "nursery");
});
test("mixed establishments use an overview and respect an explicit selection", () => {
  assert.equal(workspaceType([nursery, therapy], null), "mixed");
  assert.equal(workspaceType([nursery, therapy], "t"), "therapy_center");
});
test("multiple structures of the same type retain their shared profile", () => {
  assert.equal(workspaceType([nursery, { ...nursery, id: "n2" }], null), "nursery");
});
test("missing, stale and unknown structures fall back without inventing a kindergarten", () => {
  assert.equal(workspaceType([], null), "mixed");
  assert.equal(workspaceType([nursery, therapy], "deleted"), "mixed");
  assert.equal(workspaceType([{ id: "future", center_type: "school" }], null), "mixed");
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

// The map is one map: the scope narrows what the roster is called, never
// which pages exist or in what order.
test("the navigation is the same list in the same order for every role's subset", () => {
  const all = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER].map((i) => i.key);
  assert.equal(new Set(all).size, all.length, "no page is listed twice");
  for (const role of ["owner", "admin", "educator", "staff", "accountant"]) {
    const keys = navFor(role).map((i) => i.key);
    assert.deepEqual(keys, all.filter((k) => keys.includes(k)), `${role}: same order as the full map`);
    assert.ok(keys.includes("dashboard") && keys.includes("children") && keys.includes("attendance"), `${role}: the day pages`);
  }
});

test("the roster noun follows the scope: pupils only when every structure in scope is a school", () => {
  assert.equal(rosterNoun(scopedCenterTypes([nursery, school], null)), "children");
  assert.equal(rosterNoun(scopedCenterTypes([nursery, school], "s")), "pupils");
  assert.equal(rosterNoun(scopedCenterTypes([nursery, school], "n")), "children");
  assert.equal(rosterNoun(scopedCenterTypes([school], null)), "pupils");
  assert.equal(rosterNoun(scopedCenterTypes([], null)), "children");
});

test("every navigation label, group eyebrow and workspace profile exists in every supported language", () => {
  for (const locale of ["ar", "fr", "en"]) {
    const base = new URL(`../messages/${locale}/`, import.meta.url);
    const dashboard = JSON.parse(readFileSync(new URL("dashboard.json", base), "utf8"));
    const common = JSON.parse(readFileSync(new URL("common.json", base), "utf8"));
    const auth = JSON.parse(readFileSync(new URL("auth.json", base), "utf8"));
    const settings = JSON.parse(readFileSync(new URL("settings.json", base), "utf8"));
    for (const type of PRIVATE_SCHOOL_TYPES) {
      assert.deepEqual(auth.centerTypes[type], settings.centerTypes[type]);
      assert.ok(auth.centerTypes[type].name);
      assert.ok(auth.centerTypes[type].desc);
    }
    // The onboarding preview describes each type; the shell no longer does.
    for (const type of CENTER_TYPES) {
      assert.ok(dashboard.workspace[type].title, `${locale}: ${type} title`);
      assert.ok(dashboard.workspace[type].description, `${locale}: ${type} description`);
    }
    for (const group of NAV_GROUPS) {
      assert.ok(common.navGroups[group.key], `${locale}: group ${group.key}`);
      for (const item of group.items) assert.ok(common.nav[item.key], `${locale}: nav.${item.key}`);
    }
    for (const item of NAV_FOOTER) assert.ok(common.nav[item.key], `${locale}: nav.${item.key}`);
    assert.ok(common.nouns.children && common.nouns.pupils, `${locale}: roster nouns`);
  }
});
