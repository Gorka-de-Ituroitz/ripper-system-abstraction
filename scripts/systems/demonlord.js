const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function demonlord() {

  class DemonlordCheckInput extends DataModel {
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

  class DemonlordModifierInput extends DataModel {
    static defineSchema() {
      return {
        value: new fields.NumberField({
          label: "ripper-system-abstraction.tests.Modifier",
          required: false,
          nullable: true,
          integer: true,
        }),
      };
    }
  }

  const DEMONLORD_ATTRIBUTES = {
    strength: "DL.AttributeStrength",
    agility: "DL.AttributeAgility",
    intellect: "DL.AttributeIntellect",
    will: "DL.AttributeWill",
    perception: "DL.AttributePerception",
  };

  const DEMONLORD_COINS = {
    gc: { value: 1, label: "DL.WealthCoinsGC", aliases: ["gc"] },
    ss: { value: 0.1, label: "DL.WealthCoinsSS", aliases: ["ss"] },
    cp: { value: 0.01, label: "DL.WealthCoinsCP", aliases: ["cp"] },
    bits: { value: 0.001, label: "DL.WealthCoinsBits", aliases: ["bits", "bit"] },
  };

  const normalizeUnit = (unit) => unit.toLowerCase().replace(/[\s.:：]+$/u, "").trim();

  const localizedUnit = (key) => {
    const label = game.i18n.localize(DEMONLORD_COINS[key].label);
    return label === DEMONLORD_COINS[key].label ? key : normalizeUnit(label);
  };

  // Localized abbreviations take priority, since they can collide with English ones (e.g. es "CP" is ss).
  const coinAliases = () => {
    const aliases = new Map();
    for (const key of Object.keys(DEMONLORD_COINS)) aliases.set(localizedUnit(key), key);
    for (const [key, coin] of Object.entries(DEMONLORD_COINS)) {
      for (const alias of coin.aliases) if (!aliases.has(alias)) aliases.set(alias, key);
    }
    return aliases;
  };

  // Item prices are free-form strings such as "5 ss", "1 gc 5 ss" or "10"; read them as a gc total.
  const parsePrice = (text) => {
    if (typeof text === "number") return text;
    if (typeof text !== "string") return undefined;
    const aliases = coinAliases();
    let total = 0;
    let found = false;
    for (const [, amount, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*([^\d\s,;+]*)/gu)) {
      const key = unit ? aliases.get(normalizeUnit(unit)) : "gc";
      if (!key) return undefined;
      total += Number(amount) * DEMONLORD_COINS[key].value;
      found = true;
    }
    return found ? Math.round(total * 1e6) / 1e6 : undefined;
  };

  // Write a gc total back using the largest coin that represents it as a whole number.
  const formatPrice = (value) => {
    const coins = Object.keys(DEMONLORD_COINS);
    const key = coins.find((k) => {
      const amount = value / DEMONLORD_COINS[k].value;
      return Math.abs(amount - Math.round(amount)) < 1e-6;
    }) ?? coins.at(-1);
    return `${Math.round(value / DEMONLORD_COINS[key].value)} ${localizedUnit(key)}`;
  };

  const itemPrice = {
    get: (item) => parsePrice(item.system.value),
    set: (item, value) => ({ "system.value": value ? formatPrice(value) : "" }),
  };

  return {
    dataPaths: {
    actor: {
      type: "",
      subtype: "isPC",
      size: "characteristics.size",
      level: "level",
      role: "",
    },

    health: {
      current: "characteristics.health.value",
      maximum: "characteristics.health.max",
      temporary: "",
      minimum: "",

      wounds: "",
      maximumWounds: "",

      invert: true,
    },

    item: {
      quantity: "quantity",
      weight: "",

      equipped: "wear",
      attuned: "",

      uses: "activatedEffect.uses.value",
      maximumUses: "activatedEffect.uses.max",
    },

    currency: {
      base: "gc",

      actor: {
        denominations: {
          gc: "wealth.gc",
          ss: "wealth.ss",
          cp: "wealth.cp",
          bits: "wealth.bits",
        },
      },

      item: {
        single: {
          value: itemPrice,
          denomination: "",
        },

        denominations: {},
      },

      denominations: {
        gc: { value: 1, label: "DL.WealthCoinsGC", abbreviation: "DL.MacroWealthManager.CoinsGC" },
        ss: { value: 0.1, label: "DL.WealthCoinsSS", abbreviation: "DL.MacroWealthManager.CoinsSS" },
        cp: { value: 0.01, label: "DL.WealthCoinsCP", abbreviation: "DL.MacroWealthManager.CoinsCP" },
        bits: { value: 0.001, label: "DL.WealthCoinsBits" },
      },
    },

    experience: {
      current: "",
      maximum: "",
      level: "level",
    },

    features: {
      supportsHealth: true,
      supportsTemporaryHealth: false,
      supportsWounds: false,
      supportsCurrency: true,
      supportsWeight: false,
      supportsEquipment: true,
    },
    },
    testsInterface: {
    resultType: "total",
    rollInitiative: async (actor, combatant) => {
      const combat = combatant.combat;
      if (game.settings.get("demonlord", "optionalRuleInitiativeMode") !== "s") {
        await combat.rollInitiative([combatant.id], { updateTurn: false });
        return;
      }
      await combat.setInitiative(combatant.id, combat.getInitiativeValue(combatant));
    },
    buildInputs: () => {
      const choices = {};

      for (const [key, label] of Object.entries(DEMONLORD_ATTRIBUTES)) {
        choices[key] = game.i18n.localize(label);
      }

      class CheckInput extends DemonlordCheckInput {
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
        modifier: DemonlordModifierInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      const attribute = actor.getAttribute(inputs.check);
      if (!attribute) throw new Error(`Unknown Demon Lord attribute: ${inputs.check}`);

      const roll = await actor.rollAttributeChallenge(
        attribute,
        undefined,
        inputs.modifier ?? 0,
      );

      const target = game.settings.get("demonlord", "optionalRuleDieRollsMode") === "b" ? 11 : 10;
      const success = !attribute.immune && roll.total >= target;

      return {
        canceled: false,
        result: roll.total,
        target,
        success,
        levelOfSuccess: success ? 100 : 0,
        criticalSuccess: false,
        criticalFailure: false,
      };
    },
    },
  };
};
