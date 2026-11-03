const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

const COIN_BY_VALUE = { 10: "dukaten", 1: "silbertaler", 0.1: "heller", 0.01: "kreuzer" };
const COIN_LABELS = { dukaten: "Money-D", silbertaler: "Money-S", heller: "Money-H", kreuzer: "Money-K" };

export default async function dsa5() {
  try {
    const pack = game.packs?.get?.(game.i18n.lang === "de" ? "dsa5.skills" : "dsa5.skillsen");
    if (pack && !pack.indexed) await pack.getIndex();
  } catch (err) {}


  class DSA5CheckInput extends DataModel {
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

  class DSA5ModifierInput extends DataModel {
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

  return {
    dataPaths: {
    actor: {
      type: "creatureClass.value",
      subtype: "",
      size: "status.size.value",
      level: "",
      role: "",
    },

    health: {
      current: "status.wounds.value",
      maximum: "status.wounds.max",
      temporary: "",
      minimum: "",

      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "quantity.value",
      weight: "weight.value",

      equipped: "worn.value",
      attuned: "",

      uses: "",
      maximumUses: "",
    },

    currency: {
      base: "silbertaler",

      actor: {
        denominations: { dukaten: "", silbertaler: "", heller: "", kreuzer: "" },
        handler: {
          get: (actor) => {
            if (!actor.items.some((item) => item.type === "money")) return {};
            const wallet = { dukaten: 0, silbertaler: 0, heller: 0, kreuzer: 0 };
            for (const coin of actor.items) {
              const key = coin.type === "money" && COIN_BY_VALUE[coin.system.price?.value];
              if (key) wallet[key] += Number(coin.system.quantity?.value) || 0;
            }
            return wallet;
          },
          set: async (actor, amounts) => {
            const updates = [];
            const create = [];
            for (const [key, target] of Object.entries(amounts)) {
              const coin = actor.items.find((item) => item.type === "money" && COIN_BY_VALUE[item.system.price?.value] === key);
              if (!coin) {
                const value = Number(Object.keys(COIN_BY_VALUE).find((v) => COIN_BY_VALUE[v] === key));
                create.push({ name: game.i18n.localize(COIN_LABELS[key]), type: "money", img: `systems/dsa5/icons/${COIN_LABELS[key]}.webp`, system: { price: { value }, quantity: { value: target } } });
                continue;
              }
              updates.push({ _id: coin.id, "system.quantity.value": target });
            }
            if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
            if (create.length) await actor.createEmbeddedDocuments("Item", create);
          },
        },
      },

      item: {
        single: {
          value: "price.value",
          denomination: "",
        },

        denominations: {},
      },

      denominations: {
        dukaten: { value: 10, label: "Money-D", icon: "systems/dsa5/icons/money-D.webp" },
        silbertaler: { value: 1, label: "Money-S", icon: "systems/dsa5/icons/money-S.webp" },
        heller: { value: 0.1, label: "Money-H", icon: "systems/dsa5/icons/money-H.webp" },
        kreuzer: { value: 0.01, label: "Money-K", icon: "systems/dsa5/icons/money-K.webp" },
      },
    },

    experience: {
      current: "details.experience.total",
      maximum: "",
      },

    features: {
      supportsHealth: true,
      supportsTemporaryHealth: false,
      supportsWounds: false,
      supportsCurrency: true,
      supportsWeight: true,
      supportsEquipment: true,
    },
    },
    testsInterface: {
    resultType: "rollUnder",
    buildInputs: () => {
      const choices = {};
      const group = {
        attribute: game.i18n.localize("ripper-system-abstraction.tests.Attribute"),
        skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
      };

      for (const [key, label] of Object.entries(game.dsa5.config.characteristics)) {
        choices[`attribute.${key}`] = { label: game.i18n.localize(label), group: group.attribute };
      }

      const packId = game.i18n.lang === "de" ? "dsa5.skills" : "dsa5.skillsen";
      const pack = game.packs.get(packId);
      if (pack?.indexed) {
        const index = pack.index instanceof Map ? pack.index.values() : pack.index;
        for (const entry of index) {
          if (entry.type === "skill") choices[`skill.${entry.name}`] = { label: entry.name, group: group.skill };
        }
      }

      class CheckInput extends DSA5CheckInput {
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
        modifier: DSA5ModifierInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      if (!actor.system.characteristics) throw new Error(`DSA5 actors of type "${actor.type}" cannot perform checks.`);
      const rollOptions = {
        bypass: options.fastForward ?? false,
        event: options.event,
      };
      if (inputs.modifier != null) rollOptions.modifier = inputs.modifier;

      let setupData;
      if (inputs.check.startsWith("skill.")) {
        const name = inputs.check.slice("skill.".length);
        let skill = actor.items.find((i) => i.name === name && i.type === "skill");
        if (!skill) {
          const packId = game.i18n.lang === "de" ? "dsa5.skills" : "dsa5.skillsen";
          const pack = game.packs.get(packId);
          if (!pack) throw new Error(`Unknown DSA5 skill: ${name}`);
          const index = pack.index instanceof Map ? pack.index.values() : pack.index;
          const entry = [...index].find((e) => e.type === "skill" && e.name === name);
          if (!entry) throw new Error(`Unknown DSA5 skill: ${name}`);
          skill = await pack.getDocument(entry._id);
        }

        setupData = await actor.setupSkill(skill, rollOptions);
        if (setupData?.testData && rollOptions.bypass) {
          setupData.testData.advancedModifiers = { chars: [0, 0, 0], fws: 0, qls: 0 };
          setupData.testData.testDifficulty = 0;
        }
      } else {
        const key = Object.keys(game.dsa5.config.characteristics).find((k) => {
          const label = game.i18n.localize(game.dsa5.config.characteristics[k]);
          const name = inputs.check.replace(/^attribute\./, "");
          return k === name || label === name;
        });
        if (!key) {
          throw new Error(`Unknown DSA5 characteristic: ${inputs.check}`);
        }

        setupData = await actor.setupCharacteristic(key, rollOptions);
      }

      if (!setupData) {
        return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      const outcome = await actor.basicTest(setupData, options.silent ? { suppressMessage: true } : {});
      if (!outcome) {
        return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      const result = outcome.result;
      const success = result.successLevel > 0;
      const levelOfSuccess = success
        ? result.qualityStep != null
          ? Math.clamp(Math.round((result.qualityStep / 6) * 100), 1, 100)
          : 100
        : 0;

      return {
        canceled: false,
        result: result.characteristics?.[0]?.res ?? null,
        target: result.characteristics?.[0]?.tar ?? null,
        success,
        levelOfSuccess,
        criticalSuccess: result.successLevel > 1,
        criticalFailure: result.successLevel < -1,
      };
    },
    },
  };
};
