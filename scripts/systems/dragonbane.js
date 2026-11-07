const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

/*
 * Dragonbane / Drakar och Demoner (pafvel) — system id "dragonbane".
 *
 * Actor types: character, npc, monster.
 *
 * Tests: d20 roll-under against an attribute or a skill value. Boons and
 * banes (roll extra d20s and keep the lowest/highest) map to advantage and
 * disadvantage. A natural 1 is a Dragon (critical success) and a natural 20
 * a Demon (critical failure). The roll goes through the system's own test
 * classes (`game.dragonbane.rollAttribute` and `Actor#testSkill`), so the
 * banes/boons dialog, conditions, pushing and chat cards work as on the sheet.
 *
 * Skills are embedded Items identified by name, so check choices are built
 * from the skills the system would give a new actor (core module compendium,
 * then world items), falling back to the English core skill names.
 *
 * Currency: 1 gold = 10 silver = 100 copper. Item cost is free text in
 * Dragonbane ("3 silver", "1 gold 5 silver"...), so it is parsed and
 * rewritten through an accessor. A bare number is read as silver.
 */

const ATTRIBUTES = ["str", "con", "agl", "int", "wil", "cha"];

const FALLBACK_SKILLS = [
  "Acrobatics", "Awareness", "Bartering", "Beast Lore", "Bluffing", "Bushcraft", "Crafting", "Evade",
  "Healing", "Hunting & Fishing", "Languages", "Myths & Legends", "Performance", "Persuasion", "Riding",
  "Seamanship", "Sleight of Hand", "Sneaking", "Spot Hidden", "Swimming",
  "Axes", "Bows", "Brawling", "Crossbows", "Hammers", "Knives", "Slings", "Spears", "Staves", "Swords",
];

const SIZES = {
  small: 1,
  normal: 1,
  large: 2,
  huge: 3,
};

const EQUIPPABLE_TYPES = new Set(["weapon", "armor", "helmet"]);

// ---------------------------------------------------------------------------
// Currency helpers
// ---------------------------------------------------------------------------

const COIN_VALUE = { gc: 100, sc: 10, cc: 1 };
const COIN_LABEL = { gc: "DoD.currency.gold", sc: "DoD.currency.silver", cc: "DoD.currency.copper" };

// Coin words in every language Dragonbane ships, plus common abbreviations.
const COIN_WORDS = {
  gc: ["gc", "gm", "gp", "gold", "guld", "oro", "or", "ouro", "złoto", "zloto", "金"],
  sc: ["sc", "sm", "sp", "silver", "silber", "plata", "argent", "argento", "srebro", "prata", "銀"],
  cc: ["cc", "km", "cp", "copper", "kupfer", "koppar", "cobre", "cuivre", "rame", "miedź", "miedz", "銅"],
};

function coinWords() {
  const words = foundry.utils.deepClone(COIN_WORDS);
  for (const [key, label] of Object.entries(COIN_LABEL)) {
    const localized = game.i18n.localize(label).toLowerCase();
    if (localized && localized !== label.toLowerCase()) words[key].push(localized);
  }
  return words;
}

function coinFromWord(word, words) {
  const w = word.toLowerCase().replace(/[.:]$/, "");
  if (!w) return null;
  if (["g"].includes(w)) return "gc";
  if (["s"].includes(w)) return "sc";
  if (["c", "k"].includes(w)) return "cc";
  for (const [key, list] of Object.entries(words)) {
    if (list.some((name) => w === name || (name.length > 2 && w.startsWith(name)))) return key;
  }
  return null;
}

/**
 * Parse a Dragonbane cost string into copper. Returns undefined when the
 * string is empty or holds no amount.
 */
function parseCost(cost) {
  if (typeof cost === "number") return cost * COIN_VALUE.sc;
  const text = String(cost ?? "").trim();
  if (!text) return undefined;
  const words = coinWords();
  let total = 0;
  let found = false;
  for (const match of text.matchAll(/(\d+(?:[.,]\d+)?)\s*([^\d\s,;+/]*)/g)) {
    const amount = Number(match[1].replace(",", "."));
    if (!Number.isFinite(amount)) continue;
    const coin = coinFromWord(match[2], words) ?? "sc";
    total += amount * COIN_VALUE[coin];
    found = true;
  }
  return found ? Math.round(total) : undefined;
}

/** Write an amount in copper back as a localized cost string. */
function formatCost(copper) {
  let rest = Math.max(0, Math.round(Number(copper) || 0));
  if (!rest) return "";
  const parts = [];
  for (const coin of ["gc", "sc", "cc"]) {
    const amount = Math.floor(rest / COIN_VALUE[coin]);
    rest -= amount * COIN_VALUE[coin];
    if (amount) parts.push(`${amount} ${game.i18n.localize(COIN_LABEL[coin])}`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Skill choices
// ---------------------------------------------------------------------------

async function loadSkillNames() {
  const names = new Map();
  const add = (item) => {
    if (item?.type !== "skill") return;
    if (!["core", "weapon"].includes(item.system?.skillType)) return;
    const key = item.name?.trim().toLowerCase();
    if (key && !names.has(key)) names.set(key, { name: item.name, skillType: item.system.skillType });
  };

  // Skills from the core module compendium, as the system does for new actors.
  try {
    const compendium = game.settings.get("dragonbane", "coreModuleCompendium");
    const pack = compendium ? game.packs.get(`${compendium}.${compendium}`) : null;
    if (pack) {
      const index = await pack.getIndex();
      for (const entry of index) {
        const document = await pack.getDocument(entry._id);
        for (const item of document?.items ?? []) add(item);
      }
    }
  } catch (err) {
    console.warn("[Ripper System Abstraction] Could not read Dragonbane skills from the core compendium.", err);
  }

  // World skills (used when the system is set to use world skills).
  for (const item of game.items ?? []) add(item);

  if (!names.size) {
    FALLBACK_SKILLS.forEach((name, i) => names.set(name.toLowerCase(), { name, skillType: i < 20 ? "core" : "weapon" }));
  }

  return [...names.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name, game.i18n.lang))
    .map(([key, value]) => ({ key, ...value }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const CANCELED = {
  canceled: true,
  result: null,
  target: null,
  success: null,
  levelOfSuccess: null,
  criticalSuccess: false,
  criticalFailure: false,
};

function normalizeTest(test) {
  const post = test?.postRollData;
  if (!post || post.result == null || Number.isNaN(post.result)) return { ...CANCELED };

  const isDragon = !!post.isDragon;
  const isDemon = !!post.isDemon;
  const success = !!post.success;

  let levelOfSuccess;
  if (isDragon) levelOfSuccess = 100;
  else if (isDemon) levelOfSuccess = 0;
  else levelOfSuccess = success ? 67 : 33;

  const target = Number(test.preRollData?.target);

  return {
    canceled: false,
    result: Number(post.result),
    target: Number.isFinite(target) ? target : null,
    success,
    levelOfSuccess,
    criticalSuccess: isDragon,
    criticalFailure: isDemon,
  };
}

export default async function dragonbane() {
  const skills = await loadSkillNames();

  class DragonbaneCheckInput extends DataModel {
    static defineSchema() {
      return {
        value: new fields.StringField({
          label: "ripper-system-abstraction.tests.Check",
          required: true,
          choices: {},
        }),
      };
    }
  }

  return {
    dataPaths: {
      actor: {
        type: "kin",
        subtype: "",
        size: "size",
        sizes: SIZES,
        level: "",
        role: "profession",
      },

      health: {
        current: "hitPoints.value",
        maximum: "hitPoints.max",
        temporary: "",
        minimum: "",

        wounds: "",
        maximumWounds: "",
        primary: "health",
      },

      item: {
        quantity: "quantity",
        weight: "weight",

        equipped: "worn",
        attuned: "",

        equippable: (item) => EQUIPPABLE_TYPES.has(item.type),

        // Willpower stored in enchanted items (only meaningful when the item holds spells).
        uses: {
          get: (item) => (item.system?.enchantments?.spells?.length ? item.system.enchantments.charge : undefined),
          set: (item, value) => ({ "system.enchantments.charge": Math.max(0, Math.round(value)) }),
        },
        maximumUses: "",
      },

      currency: {
        base: "cc",

        actor: {
          denominations: {
            gc: "currency.gc",
            sc: "currency.sc",
            cc: "currency.cc",
          },
        },

        item: {
          single: {
            value: {
              get: (item) => parseCost(item.system?.cost),
              set: (item, value) => ({ "system.cost": formatCost(value) }),
            },
            denomination: "cc",
          },
          denominations: {},
        },

        denominations: {
          cc: { value: 1, label: "DoD.currency.copper" },
          sc: { value: 10, label: "DoD.currency.silver" },
          gc: { value: 100, label: "DoD.currency.gold" },
        },
      },

      experience: {
        current: "",
        maximum: "",
      },

      overrides: {
        Actor: {
          monster: {
            actor: { type: "", role: "" },
          },
        },
      },

      features: {
        supportsHealth: true,
        supportsTemporaryHealth: false,
        supportsWounds: false,
        supportsCurrency: true,
        supportsWeight: true,
        supportsEquipment: true,
        supportsAttunement: false,
      },
    },

    testsInterface: {
      resultType: "rollUnder",
      supportsAdvantage: true,

      buildInputs: () => {
        const choices = {};
        const group = {
          attribute: game.i18n.localize("ripper-system-abstraction.tests.Attribute"),
          skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
        };

        for (const key of ATTRIBUTES) {
          choices[`attribute.${key}`] = { label: game.i18n.localize(`DoD.attributes.${key}`), group: group.attribute };
        }

        for (const skill of skills) {
          choices[`skill.${skill.key}`] = { label: skill.name, group: group.skill };
        }

        class CheckInput extends DragonbaneCheckInput {
          static defineSchema() {
            return {
              value: new fields.StringField({
                label: "ripper-system-abstraction.tests.Check",
                required: true,
                choices,
              }),
            };
          }
        }

        return {
          check: CheckInput,
        };
      },

      processCheck: async (actor, inputs, options = {}) => {
        const check = String(inputs.check ?? "");
        const dot = check.indexOf(".");
        const type = check.slice(0, dot);
        const key = check.slice(dot + 1);

        // Fast forward rolls with the default banes/boons, as the system's macros do.
        const testOptions = {
          defaultBanesBoons: !!options.fastForward,
          skipDialog: !!options.fastForward,
        };
        if (options.advantage && !options.disadvantage) {
          testOptions.boons = [{ source: game.i18n.localize("ripper-system-abstraction.tests.Advantage"), value: true }];
        } else if (options.disadvantage && !options.advantage) {
          testOptions.banes = [{ source: game.i18n.localize("ripper-system-abstraction.tests.Disadvantage"), value: true }];
        }

        let test;
        if (type === "attribute") {
          if (!ATTRIBUTES.includes(key)) throw new Error(`Unsupported Dragonbane attribute: ${key}`);
          test = await game.dragonbane.rollAttribute(actor, key, testOptions);
        } else if (type === "skill") {
          const skill = actor.findSkill?.(key);
          if (!skill) throw new Error(`This Dragonbane actor has no "${key}" skill.`);
          test = await actor.testSkill(skill.name, testOptions);
        } else {
          throw new Error(`Unsupported Dragonbane check type: ${type}`);
        }

        return normalizeTest(test);
      },
    },
  };
}
