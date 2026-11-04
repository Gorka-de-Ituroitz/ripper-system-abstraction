import { api } from "./api/index.js";
import { serialize, buildInputs, processCheck } from "./testsInterfaceCustomElement.js";
import { resolveDataPaths, resolvePath } from "./api/core.js";

/*
 * Live test runner for the agnostic API.
 *
 * Triggered from the module's debug dialog ("Run API Tests").
 *
 * WARNING: this performs REAL updates on the chosen actor and its items
 * (health, currency, item quantities/equipment/uses). Values are NOT
 * restored. Only run this on a throwaway character.
 *
 * Results are logged to the console with colored Pass/Fail/Skip markers.
 * A copy-pasteable summary is printed at the end.
 */

const results = [];

function logResult(state, name, message = "") {
  const label = state === "pass" ? "Pass" : state === "fail" ? "Fail" : "Skip";
  const color = state === "pass" ? "#2ecc71" : state === "fail" ? "#e74c3c" : "#f39c12";
  const line = `[${label}] ${name}${message ? ` — ${message}` : ""}`;
  results.push({ state, line });
  console.log(`%c${label}`, `color:${color};font-weight:bold;`, `${name}${message ? ` — ${message}` : ""}`);
}

function pass(name, message = "") {
  logResult("pass", name, message);
}

function fail(name, message = "") {
  logResult("fail", name, message);
}

function skip(name, message = "") {
  logResult("skip", name, message);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function round(value) {
  return Math.round(value * 1e4) / 1e4;
}

function getTestActor() {
  return game.user?.character ?? game.actors?.contents?.[0] ?? null;
}

function pickItem(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function fieldChoices(field) {
  if (!(field instanceof foundry.data.fields.StringField)) return null;
  let choices = field.options?.choices ?? field.choices;
  if (typeof choices === "function") choices = choices();
  if (!choices || typeof choices !== "object") return null;
  return Array.isArray(choices) ? choices : Object.keys(choices);
}

function sampleFieldValue(field) {
  if (field instanceof foundry.data.fields.StringField) return fieldChoices(field)?.[0] ?? "1d20+5";
  if (field instanceof foundry.data.fields.NumberField) {
    return typeof field.options.min === "number" ? field.options.min : 10;
  }
  if (field instanceof foundry.data.fields.BooleanField) return false;
  return "";
}

/* ------------------------------------------------------------------------- */
/* data                                                                      */
/* ------------------------------------------------------------------------- */

async function testData(actor) {
  const spec = resolveDataPaths(actor)?.health?.current;
  const testPath = api.health.getCurrent(actor) != null && (typeof spec === "string" || Array.isArray(spec))
    ? resolvePath(spec, actor)
    : null;

  if (testPath) {
    const original = api.data.get(actor, testPath);
    pass("data.get", `path ${testPath} = ${original}`);

    const dry = api.data.set(actor, testPath, original, { update: false });
    const unchanged = api.data.get(actor, testPath) === original;
    if (dry[`system.${testPath}`] === original && unchanged) {
      pass("data.set update:false", "payload returned, document unchanged");
    } else {
      fail("data.set update:false", "payload or no-mutation contract broken");
    }

    const maximum = api.health.getMaximum(actor);
    const next = typeof original === "number" && original < maximum
      ? original + 1
      : Math.max(0, original - 1);
    await api.data.set(actor, testPath, next);
    if (api.data.get(actor, testPath) === next) {
      pass("data.set update:true", `value now ${next}`);
    } else {
      fail("data.set update:true", "value not applied");
    }
    await api.data.set(actor, testPath, original);
  } else {
    skip("data", "no numeric health path to round-trip on this actor");
  }
}

/* ------------------------------------------------------------------------- */
/* health                                                                    */
/* ------------------------------------------------------------------------- */

async function testHealth(actor) {
  const current = api.health.getCurrent(actor);
  const maximum = api.health.getMaximum(actor);
  const temporary = api.health.getTemporary(actor);
  const percent = api.health.getPercent(actor);

  if (current == null && percent == null) {
    skip("health", "system exposes no primary health track");
    return;
  }

  const isWoundMapped = current == null && percent != null;

  if (isWoundMapped) {
    const before = percent;
    await api.health.damage(actor, 1);
    const after = api.health.getPercent(actor);
    if (after < before) {
      pass("health.damage (wounds)", `percent ${round(before)} -> ${round(after)}`);
    } else {
      fail("health.damage (wounds)", `percent did not decrease (${round(before)} -> ${round(after)})`);
    }

    await api.health.heal(actor, 1);
    const healed = api.health.getPercent(actor);
    if (healed >= after) {
      pass("health.heal (wounds)", `percent ${round(after)} -> ${round(healed)}`);
    } else {
      fail("health.heal (wounds)", `percent did not recover (${round(after)} -> ${round(healed)})`);
    }

    try {
      await api.health.set(actor, 5, { update: false });
      fail("health.set (wounds) should throw", "set did not throw on wound-mapped system");
    } catch (err) {
      pass("health.set (wounds) throws", "unsupported operation rejected");
    }
    return;
  }

  if (current == null || maximum == null) {
    skip("health", "no current/maximum health paths");
    return;
  }

  if (!(maximum > 0)) {
    skip("health", `maximum health is ${maximum}`);
    return;
  }

  if (typeof current === "number" && typeof maximum === "number" && typeof temporary === "number") {
    pass("health.getCurrent", `current ${current}`);
    pass("health.getMaximum", `maximum ${maximum}`);
    pass("health.getTemporary", `temporary ${temporary}`);
  } else {
    fail("health getters", "non-numeric getter results");
  }

  const total = api.health.getTotal(actor);
  if (total === current + temporary) {
    pass("health.getTotal", `total ${total}`);
  } else {
    fail("health.getTotal", `expected ${current + temporary}, got ${total}`);
  }

  if (percent >= 0 && percent <= 1) {
    pass("health.getPercent", `percent ${round(percent)}`);
  } else {
    fail("health.getPercent", `out of range: ${percent}`);
  }

  const baseline = clamp(current, 0, Math.max(0, maximum - 2));
  await api.health.set(actor, baseline);
  if (api.health.getCurrent(actor) === baseline) {
    pass("health.set", `current ${baseline}`);
  } else {
    fail("health.set", `expected ${baseline}, got ${api.health.getCurrent(actor)}`);
  }

  await api.health.add(actor, 2);
  if (api.health.getCurrent(actor) === baseline + 2) {
    pass("health.add", `current ${baseline + 2}`);
  } else {
    fail("health.add", `expected ${baseline + 2}, got ${api.health.getCurrent(actor)}`);
  }

  await api.health.remove(actor, 2);
  if (api.health.getCurrent(actor) === baseline) {
    pass("health.remove", `current ${baseline}`);
  } else {
    fail("health.remove", `expected ${baseline}, got ${api.health.getCurrent(actor)}`);
  }

  await api.health.heal(actor, 1000);
  if (api.health.getCurrent(actor) === maximum) {
    pass("health.heal clamps to maximum", `current ${maximum}`);
  } else {
    fail("health.heal clamps to maximum", `expected ${maximum}, got ${api.health.getCurrent(actor)}`);
  }

  await api.health.setPercent(actor, 0.5);
  const half = api.health.getPercent(actor);
  const targetPercent = Math.round(maximum * 0.5);
  const expectedPercent = (targetPercent + api.health.getTemporary(actor)) / maximum;
  if (Math.abs(half - expectedPercent) <= 0.05) {
    pass("health.setPercent", `percent ${round(half)}`);
  } else {
    fail("health.setPercent", `expected ~${round(expectedPercent)}, got ${round(half)}`);
  }

  const beforeDamage = api.health.getTotal(actor);
  const damage = Math.min(5, beforeDamage);
  await api.health.damage(actor, damage);
  const afterDamage = api.health.getTotal(actor);
  if (round(beforeDamage - afterDamage) === damage) {
    pass("health.damage (temp-first)", `total ${round(beforeDamage)} -> ${round(afterDamage)}`);
  } else {
    fail("health.damage (temp-first)", `total decreased by ${round(beforeDamage - afterDamage)}, expected ${damage}`);
  }
}

/* ------------------------------------------------------------------------- */
/* currency (actor + item)                                                   */
/* ------------------------------------------------------------------------- */

async function testCurrencyActor(actor) {
  const dp = resolveDataPaths(actor);
  const config = dp?.currency ?? {};
  const base = config.base;
  const actorDenoms = config.actor?.denominations ?? {};

  if (!base || (!Object.keys(actorDenoms).length && !config.actor?.handler)) {
    skip("currency.actor", "system stores no actor currency");
    return;
  }

  const got = api.currency.get(actor);
  if (!Object.keys(got).length) {
    skip("currency.actor", "this actor stores no currency");
    return;
  }
  pass("currency.get", JSON.stringify(got));
  const unit = base in got ? base : Object.keys(got)[0];
  const step = config.denominations?.[unit]?.value ?? 1;

  const denominations = api.currency.getDenominations();
  if (denominations.length && denominations.every((d) => typeof d.label === "string" && d.value > 0)) {
    pass("currency.getDenominations", denominations.map((d) => `${d.id}=${d.label}`).join(", "));
  } else {
    fail("currency.getDenominations", JSON.stringify(denominations));
  }

  const beforeTotal = api.currency.getTotal(actor);
  if (typeof beforeTotal === "number") {
    pass("currency.getTotal", `total ${round(beforeTotal)} ${base}`);
  } else {
    fail("currency.getTotal", "non-numeric total");
  }

  const addResult = await api.currency.add(actor, { [unit]: 1 });
  if (round(api.currency.getTotal(actor)) === round(beforeTotal + step)) {
    pass("currency.add", `total ${round(beforeTotal)} -> ${round(api.currency.getTotal(actor))}`);
  } else {
    fail("currency.add", `expected ${round(beforeTotal + step)}, got ${round(api.currency.getTotal(actor))}`);
  }

  const removeResult = await api.currency.remove(actor, { [unit]: 1 });
  if (round(api.currency.getTotal(actor)) === round(beforeTotal)) {
    pass("currency.remove", `total ${round(api.currency.getTotal(actor))}`);
  } else {
    fail("currency.remove", `expected ${round(beforeTotal)}, got ${round(api.currency.getTotal(actor))}`);
  }

  await api.currency.set(actor, { [unit]: 1 });
  const afterSet = api.currency.get(actor);
  if (afterSet[unit] === 1) {
    pass("currency.set (partial)", `${unit} = 1, others untouched`);
  } else {
    fail("currency.set (partial)", `expected ${unit}=1, got ${JSON.stringify(afterSet)}`);
  }

  const conversionDenom = Object.keys(got).find((d) => d !== base);
  if (conversionDenom && config.denominations?.[conversionDenom]) {
    const ratio = config.denominations[conversionDenom].value ?? 1;
    await api.currency.add(actor, { [conversionDenom]: 200 });
    const totalBeforeConvert = api.currency.getTotal(actor);
    await api.currency.remove(actor, { [conversionDenom]: 100 });
    const afterConvert = api.currency.getTotal(actor);
    const allNonNegative = Object.values(api.currency.get(actor)).every((v) => v >= 0);
    if (round(totalBeforeConvert - afterConvert) === round(100 * ratio) && allNonNegative) {
      pass("currency.remove conversion", `removed 100 ${conversionDenom}, no negatives`);
    } else {
      fail("currency.remove conversion", `delta ${round(totalBeforeConvert - afterConvert)} (expected ${round(100 * ratio)}), negatives=${!allNonNegative}`);
    }
  } else {
    skip("currency.remove conversion", "no secondary denomination available");
  }

  const ordered = Object.keys(api.currency.get(actor))
    .filter((d) => config.denominations?.[d])
    .sort((a, b) => config.denominations[a].value - config.denominations[b].value);
  if (ordered.length >= 2) {
    const [low, high] = ordered;
    const ratio = config.denominations[high].value / config.denominations[low].value;
    await api.currency.set(actor, Object.fromEntries(ordered.map((d) => [d, d === high ? 2 : 0])));
    await api.currency.remove(actor, { [high]: 1, [low]: 1 });
    const wallet = api.currency.get(actor);
    const whole = Object.values(wallet).every((v) => Number.isInteger(v) && v >= 0);
    const expected = round((2 * ratio - ratio - 1) * config.denominations[low].value);
    if (whole && round(api.currency.getTotal(actor)) === expected) {
      pass("currency.remove multi + change", JSON.stringify(wallet));
    } else {
      fail("currency.remove multi + change", `expected total ${expected} in whole coins, got ${JSON.stringify(wallet)}`);
    }

    try {
      await api.currency.remove(actor, { [high]: 1000000 });
      fail("currency.remove insufficient", "did not throw");
    } catch (err) {
      pass("currency.remove insufficient", "throws");
    }
  } else {
    skip("currency.remove multi + change", "needs two denominations");
  }
}

async function testCurrencyItem(item) {
  if (!item) {
    skip("currency.item", "no item with a monetary value found");
    return;
  }

  const dp = resolveDataPaths(item);
  const config = dp?.currency ?? {};
  const base = config.base;

  const valueBefore = api.currency.getItemValue(item);
  if (!Object.keys(valueBefore).length) {
    skip("currency.item", "item has no monetary value");
    return;
  }
  pass("currency.getItemValue", JSON.stringify(valueBefore));

  if (!base) {
    skip("currency.setItemValue", "no base denomination configured");
    return;
  }

  await api.currency.setItemValue(item, { [base]: 5 });
  const valueAfter = api.currency.getItemValue(item);
  if (valueAfter[base] === 5) {
    pass("currency.setItemValue", `${base} = 5`);
  } else {
    fail("currency.setItemValue", `expected ${base}=5, got ${JSON.stringify(valueAfter)}`);
  }
}

/* ------------------------------------------------------------------------- */
/* item                                                                      */
/* ------------------------------------------------------------------------- */

async function testItemQuantity(item) {
  if (!item) {
    skip("item.quantity", "no item with a quantity found");
    return;
  }

  const original = api.item.getQuantity(item);
  if (typeof original !== "number") {
    skip("item.quantity", "item has no quantity");
    return;
  }
  pass("item.getQuantity", `quantity ${original}`);

  await api.item.setQuantity(item, 3);
  if (api.item.getQuantity(item) === 3) {
    pass("item.setQuantity", "quantity 3");
  } else {
    fail("item.setQuantity", `expected 3, got ${api.item.getQuantity(item)}`);
  }

  await api.item.addQuantity(item, 2);
  if (api.item.getQuantity(item) === 5) {
    pass("item.addQuantity", "quantity 5");
  } else {
    fail("item.addQuantity", `expected 5, got ${api.item.getQuantity(item)}`);
  }

  await api.item.removeQuantity(item, 2);
  if (api.item.getQuantity(item) === 3) {
    pass("item.removeQuantity", "quantity 3");
  } else {
    fail("item.removeQuantity", `expected 3, got ${api.item.getQuantity(item)}`);
  }

  await api.item.removeQuantity(item, 1000);
  const floor = api.item.getQuantity(item);
  if (floor === 0 || floor === 1) {
    pass("item.removeQuantity clamps", `quantity ${floor}${floor ? " (system minimum)" : ""}`);
  } else {
    fail("item.removeQuantity clamps", `expected 0 (or the system minimum), got ${floor}`);
  }
}

async function testItemEquipment(item) {
  if (!item) {
    skip("item.equipment", "no equippable item found");
    return;
  }

  const equipped = api.item.isEquipped(item);
  pass("item.isEquipped", `equipped ${equipped}`);

  await api.item.equip(item);
  if (api.item.isEquipped(item) === true) {
    pass("item.equip", "equipped");
  } else {
    fail("item.equip", "isEquipped did not become true");
  }

  await api.item.unequip(item);
  if (api.item.isEquipped(item) === false) {
    pass("item.unequip", "unequipped");
  } else {
    fail("item.unequip", "isEquipped did not become false");
  }

  const beforeToggle = api.item.isEquipped(item);
  await api.item.toggleEquipped(item);
  if (api.item.isEquipped(item) === !beforeToggle) {
    pass("item.toggleEquipped", `flipped ${beforeToggle} -> ${!beforeToggle}`);
  } else {
    fail("item.toggleEquipped", "state did not flip");
  }
  await api.item.toggleEquipped(item);
}

async function testItemUses(item) {
  if (!item) {
    skip("item.uses", "no item with uses found");
    return;
  }

  const maximum = api.item.getMaximumUses(item);
  const uses = api.item.getUses(item);
  if (uses == null || maximum == null) {
    skip("item.uses", "item has no uses/maximumUses");
    return;
  }
  pass("item.getUses", `uses ${uses}`);
  pass("item.getMaximumUses", `maximum ${maximum}`);

  await api.item.setUses(item, maximum);
  await api.item.consumeUses(item, 1);
  if (api.item.getUses(item) === maximum - 1 || (maximum === 1 && api.item.getUses(item) === 1)) {
    pass("item.consumeUses", `uses ${api.item.getUses(item)}`);
  } else {
    fail("item.consumeUses", `expected ${maximum - 1}, got ${api.item.getUses(item)}`);
  }

  await api.item.consumeUses(item, 1000);
  const floor = api.item.getUses(item);
  if (floor === 0 || floor === 1) {
    pass("item.consumeUses clamps", `uses ${floor}${floor ? " (system minimum)" : ""}`);
  } else {
    fail("item.consumeUses clamps", `expected 0 (or the system minimum), got ${floor}`);
  }

  await api.item.restoreUses(item);
  if (api.item.getUses(item) === maximum) {
    pass("item.restoreUses", `uses ${maximum}`);
  } else {
    fail("item.restoreUses", `expected ${maximum}, got ${api.item.getUses(item)}`);
  }
}

async function testItemAttunement(item) {
  if (!item) {
    skip("item.attunement", "no attunable item found");
    return;
  }

  pass("item.isAttuned", `attuned ${api.item.isAttuned(item)}`);

  await api.item.attune(item);
  if (api.item.isAttuned(item) === true) {
    pass("item.attune", "attuned");
  } else {
    fail("item.attune", "isAttuned did not become true");
  }

  await api.item.unattune(item);
  if (api.item.isAttuned(item) === false) {
    pass("item.unattune", "unattuned");
  } else {
    fail("item.unattune", "isAttuned did not become false");
  }
}

function testItemWeight(item) {
  if (!item) {
    skip("item.weight", "no item with a weight found");
    return;
  }

  const weight = api.item.getWeight(item);
  const total = api.item.getTotalWeight(item);
  const quantity = api.item.getQuantity(item) ?? 1;
  pass("item.getWeight", `weight ${weight}`);
  if (round(total) === round(weight * quantity)) {
    pass("item.getTotalWeight", `total ${round(total)} (x${quantity})`);
  } else {
    fail("item.getTotalWeight", `expected ${round(weight * quantity)}, got ${total}`);
  }
}

async function testItemFromSpell(actor) {
  const spell = [...(actor.items ?? []), ...game.items].find((i) => api.item.canCreateFromSpell(i));
  if (!spell) {
    skip("item.createFromSpell", "no supported spell found on the actor or in the world");
    return;
  }
  const data = await api.item.createFromSpell(spell, { dialog: false });
  const created = data && !(data instanceof Item) ? new Item.implementation(data) : null;
  if (created) {
    pass("item.createFromSpell", `${spell.name} -> ${created.name} (${created.type})`);
  } else {
    fail("item.createFromSpell", `no item data returned for ${spell.name}`);
  }
}

/* ------------------------------------------------------------------------- */
/* actor + experience                                                        */
/* ------------------------------------------------------------------------- */

function testActor(actor) {
  const types = api.actor.getTypes(actor);
  if (Array.isArray(types) && types.every((t) => typeof t === "string")) {
    pass("actor.getTypes", JSON.stringify(types));
  } else {
    fail("actor.getTypes", `not a string array: ${JSON.stringify(types)}`);
  }

  const all = api.actor.getAllTypes();
  if (Array.isArray(all) && all.every((t) => typeof t.id === "string" && typeof t.label === "string")) {
    pass("actor.getAllTypes", `${all.length} types${all.length ? `, e.g. ${all[0].id}=${all[0].label}` : ""}`);
  } else {
    fail("actor.getAllTypes", "not an array of {id, label}");
  }

  const size = api.actor.getSize(actor);
  if (typeof size === "number" && size > 0) {
    pass("actor.getSize", `${size} squares`);
  } else {
    fail("actor.getSize", `expected a positive number, got ${size}`);
  }

  pass("actor.getLevel", `level ${api.actor.getLevel(actor)}`);
  pass("actor.getSubtype", `subtype ${api.actor.getSubtype(actor)}`);
  pass("actor.getRole", `role ${api.actor.getRole(actor)}`);
}

async function testExperience(actor) {
  const current = api.experience.getCurrent(actor);
  if (current == null) {
    skip("experience", "actor has no experience value");
    return;
  }
  pass("experience.getCurrent", `xp ${current}, next ${api.experience.getMaximum(actor)}`);

  await api.experience.add(actor, 10);
  if (api.experience.getCurrent(actor) === current + 10) {
    pass("experience.add", `xp ${current + 10}`);
  } else {
    fail("experience.add", `expected ${current + 10}, got ${api.experience.getCurrent(actor)}`);
  }

  await api.experience.set(actor, current);
  if (api.experience.getCurrent(actor) === current) {
    pass("experience.set", `xp ${current}`);
  } else {
    fail("experience.set", `expected ${current}, got ${api.experience.getCurrent(actor)}`);
  }
}

/* ------------------------------------------------------------------------- */
/* tests interface                                                           */
/* ------------------------------------------------------------------------- */

async function testTestsInterface(actor) {
  let inputClasses;
  try {
    inputClasses = buildInputs();
  } catch (err) {
    fail("tests.buildInputs", err.message);
    return;
  }

  if (!Object.keys(inputClasses).length) {
    skip("tests", "system defines no check inputs");
    return;
  }
  pass("tests.buildInputs", `inputs: ${Object.keys(inputClasses).join(", ")}`);

  const inputs = {};
  let variants = null;
  for (const [key, model] of Object.entries(inputClasses)) {
    const fields = model.schema?.fields ?? {};
    const names = Object.keys(fields);
    const data = {};
    for (const name of names) {
      data[name] = sampleFieldValue(fields[name]);
    }
    inputs[key] = names.length === 1 ? data.value : data;
    const choices = names.length === 1 ? fieldChoices(fields.value) : null;
    if (!variants && choices?.length > 1) variants = { key, choices };
  }

  let value;
  try {
    value = serialize(inputs);
  } catch (err) {
    fail("tests.serialize", err.message);
    return;
  }

  let result;
  for (const choice of variants?.choices ?? [inputs[variants?.key]]) {
    if (variants) value = serialize({ ...inputs, [variants.key]: choice });
    try {
      result = await processCheck(actor, value, { fastForward: true });
      break;
    } catch (err) {
      if (/cannot perform/i.test(err.message) && choice !== variants?.choices.at(-1)) continue;
      if (/cannot perform/i.test(err.message)) skip("tests.processCheck", err.message);
      else fail("tests.processCheck", `fastForward check failed: ${err.message}`);
      return;
    }
  }

  const required = ["canceled", "result", "target", "success", "levelOfSuccess", "criticalSuccess", "criticalFailure"];
  const missing = required.filter((key) => !(key in result));
  if (missing.length) {
    fail("tests.processCheck", `missing keys: ${missing.join(", ")}`);
    return;
  }

  if (result.canceled === true) {
    fail("tests.processCheck", "fastForward check was canceled");
    return;
  }

  const summary = [
    `result ${result.result}`,
    `target ${result.target}`,
    `success ${result.success}`,
    `level ${result.levelOfSuccess}`,
    `crit ${result.criticalSuccess}`,
    `fumble ${result.criticalFailure}`,
  ].join(", ");
  pass("tests.processCheck (fastForward)", summary);
}

/* ------------------------------------------------------------------------- */
/* runner                                                                    */
/* ------------------------------------------------------------------------- */

export async function runAPITests(actor) {
  results.length = 0;

  actor ??= getTestActor();
  if (!actor) {
    fail("setup", "no actor available (game.user.character or first game.actors entry)");
    return printSummary();
  }
  pass("setup", `actor: ${actor.name} (${actor.id})`);

  pass("setup", `items available: ${actor.items?.size ?? 0}`);

  testActor(actor);
  await testExperience(actor);
  await testData(actor);
  await testHealth(actor);
  await testCurrencyActor(actor);

  const items = actor.items?.contents ?? [];
  const quantityItem = pickItem(items.filter((i) => api.item.isStackable(i) === true));
  const withUses = items.filter((i) => api.item.getUses(i) != null && api.item.getMaximumUses(i) != null);
  const usesItem = pickItem(withUses.filter((i) => api.item.getMaximumUses(i) > 1)) ?? pickItem(withUses);
  const equipmentItem = items.find((i) => api.item.isEquipped(i) != null) ?? null;
  const attunementItem = items.find((i) => api.item.isAttuned(i) != null) ?? null;
  const weightItem = items.find((i) => api.item.getWeight(i) != null) ?? null;
  const currencyItem = pickItem(items.filter((i) => Object.keys(api.currency.getItemValue(i)).length > 0));

  await testCurrencyItem(currencyItem);
  await testItemQuantity(quantityItem);
  await testItemEquipment(equipmentItem);
  await testItemUses(usesItem);
  await testItemAttunement(attunementItem);
  testItemWeight(weightItem);
  await testItemFromSpell(actor);
  await testTestsInterface(actor);

  return printSummary();
}

function printSummary() {
  const passed = results.filter((r) => r.state === "pass").length;
  const failed = results.filter((r) => r.state === "fail").length;
  const skipped = results.filter((r) => r.state === "skip").length;

  const lines = [
    "==== API TEST LOG ====",
    ...results.map((r) => r.line),
    "----------------------",
    `Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`,
    failed ? "RESULT: FAILED" : "RESULT: PASSED",
    "======================",
  ];

  console.log(lines.join("\n"));
  return lines.join("\n");
}
