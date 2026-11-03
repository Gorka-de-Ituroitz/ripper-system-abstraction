const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

const COINS = { gc: { value: 240, name: "NAME.GC" }, ss: { value: 12, name: "NAME.SS" }, bp: { value: 1, name: "NAME.BP" } };

function findCoin(actor, key) {
  const money = actor.items.filter((item) => item.type === "money");
  const name = game.i18n.localize(COINS[key].name).toLowerCase();
  return money.find((item) => item.name.toLowerCase() === name) ?? money.find((item) => item.system.coinValue?.value === COINS[key].value);
}

export default async function wfrp4e() {
  for (const packId of ["wfrp4e-core.items", "wfrp4e.basic"]) {
    try {
      const pack = game.packs?.get?.(packId);
      if (pack && !pack.indexed) await pack.getIndex();
    } catch (err) {}
  }


  class WFRP4eCheckInput extends DataModel {
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

  class WFRP4eDCInput extends DataModel {
    static defineSchema() {
      return {
        value: new fields.StringField({
          label: "ripper-system-abstraction.tests.Difficulty",
          required: true,
          initial: "challenging",
          choices: {
            veasy: game.i18n.localize("DIFFICULTY.VEasy"),
            easy: game.i18n.localize("DIFFICULTY.Easy"),
            average: game.i18n.localize("DIFFICULTY.Average"),
            challenging: game.i18n.localize("DIFFICULTY.Challenging"),
            difficult: game.i18n.localize("DIFFICULTY.Difficult"),
            hard: game.i18n.localize("DIFFICULTY.Hard"),
            vhard: game.i18n.localize("DIFFICULTY.VHard"),
          },
        }),
      };
    }
  }

  function normalizeTest(test) {
    if (!test?.result) {
      return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
    }

    const result = test.result;
    const success = result.outcome === "success";
    const sl = Number(result.SL) || 0;

    return {
      canceled: false,
      result: result.roll,
      target: result.target,
      success,
      levelOfSuccess: Math.clamp(50 + sl * 10, 0, 100),
      criticalSuccess: test.isCriticalFumble === "critical",
      criticalFailure: test.isCriticalFumble === "fumble",
    };
  }

  const price = (denomination) => ({
    get: (item) => (item.type === "cargo" ? undefined : item.system.price?.[denomination]),
    set: (item, value) => ({ [`system.price.${denomination}`]: value }),
  });

  return {
    dataPaths: {
    actor: {
      type: "",
      subtype: "details.species.subspecies",
      size: "details.size.value",
      level: "",
      role: "",
    },

    health: {
      current: "status.wounds.value",
      maximum: "status.wounds.max",
      temporary: "",
      minimum: "",

      wounds: "status.criticalWounds.value",
      maximumWounds: "status.criticalWounds.max",
      primary: "health",
    },

    item: {
      quantity: "quantity.value",
      weight: "encumbrance.value",

      equipped: "equipped.value",
      attuned: "",

      uses: "loaded.amt",
      maximumUses: "loaded.max",
    },

    currency: {
      base: "bp",

      actor: {
        denominations: { gc: "", ss: "", bp: "" },
        handler: {
          get: (actor) => {
            if (!actor.items.some((item) => item.type === "money")) return {};
            return Object.fromEntries(Object.keys(COINS).map((key) => [key, Number(findCoin(actor, key)?.system.quantity?.value) || 0]));
          },
          set: async (actor, amounts) => {
            const updates = [];
            const create = [];
            for (const [key, target] of Object.entries(amounts)) {
              const coin = findCoin(actor, key);
              if (coin) {
                updates.push({ _id: coin.id, "system.quantity.value": target });
                continue;
              }
              const found = await game.wfrp4e.utility.find(game.i18n.localize(COINS[key].name), "money");
              const source = found?.toObject?.() ?? { name: game.i18n.localize(COINS[key].name), type: "money", system: { coinValue: { value: COINS[key].value } } };
              foundry.utils.setProperty(source, "system.quantity.value", target);
              create.push(source);
            }
            if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
            if (create.length) await actor.createEmbeddedDocuments("Item", create);
          },
        },
      },

      item: {
        single: {
          value: "",
          denomination: "",
        },

        denominations: { gc: price("gc"), ss: price("ss"), bp: price("bp") },
      },

      denominations: {
        bp: { value: 1, label: "NAME.BP", abbreviation: "MARKET.Abbrev.BP" },
        ss: { value: 12, label: "NAME.SS", abbreviation: "MARKET.Abbrev.SS" },
        gc: { value: 240, label: "NAME.GC", abbreviation: "MARKET.Abbrev.GC" },
      },
    },

    updateOptions: { skipExperienceChecks: true },

    experience: {
      current: {
        get: (actor) => actor.system.details?.experience?.current,
        set: (actor, value) => ({ "system.details.experience.total": actor.system.details.experience.spent + value }),
      },
      maximum: "",
    },

    features: {
      supportsHealth: true,
      supportsTemporaryHealth: false,
      supportsWounds: true,
      supportsCurrency: true,
      supportsWeight: true,
      supportsEquipment: true,
    },
    },
    testsInterface: {
    resultType: "rollUnder",
    initiativeNeedsToken: true,
    buildInputs: () => {
      const choices = {};
      const group = {
        characteristic: game.i18n.localize("ripper-system-abstraction.tests.Characteristic"),
        skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
      };

      for (const [key, label] of Object.entries(game.wfrp4e.config.characteristics)) {
        choices[`characteristic.${key}`] = { label: game.i18n.localize(label), group: group.characteristic };
      }

      for (const packId of ["wfrp4e-core.items", "wfrp4e.basic"]) {
        const pack = game.packs.get(packId);
        if (!pack?.indexed) continue;
        const index = pack.index instanceof Map ? pack.index.values() : pack.index;
        for (const entry of index) {
          if (entry.type === "skill") choices[`skill.${entry.name}`] = { label: entry.name, group: group.skill };
        }
      }

      class CheckInput extends WFRP4eCheckInput {
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
        dc: WFRP4eDCInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      if (!actor.system.characteristics || actor.type === "vehicle") throw new Error(`WFRP4e actors of type "${actor.type}" cannot perform checks.`);
      const [type, key] = inputs.check.split(".");
      const context = {
        skipDialog: options.fastForward ?? false,
        skipTargets: true,
        event: options.event,
        fields: {
          difficulty: inputs.dc ?? "challenging",
          modifier: 0,
          successBonus: 0,
          slBonus: 0,
        },
      };

      let test;
      if (type === "characteristic") {
        test = await actor.setupCharacteristic(key, { ...context, hitloc: false }, { resolveClose: true });
      } else if (type === "skill") {
        const skill = actor.itemTags?.skill?.find((s) => s.name === key) ?? key;
        test = await actor.setupSkill(skill, context, { resolveClose: true });
      } else {
        throw new Error(`Unsupported WFRP4e check type: ${type}`);
      }

      if (!test) {
        return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      await test.roll();
      return normalizeTest(test);
    },
    },
  };
};
