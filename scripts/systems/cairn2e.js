import { captureRollMessage } from "./_shared.js";

const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function cairn2e() {
  const { applyGold } = await import(/* webpackIgnore: true */ foundry.utils.getRoute("systems/cairn2e/module/coin.js"));
  const { goldTotal } = await import(/* webpackIgnore: true */ foundry.utils.getRoute("systems/cairn2e/module/coin-rules.js"));

  const CAIRN_ABILITIES = ["STR", "DEX", "WIL"];

  function savePasses(face, target) {
    if (face === 1) return true;
    if (face === 20) return false;
    return face <= target;
  }

  return {
    dataPaths: {
    actor: {
      type: "",
      subtype: "",
      size: "",
      level: "",
      role: "role",
    },

    health: {
      current: "hp.value",
      maximum: "hp.max",
      temporary: "",
      minimum: "",

      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "",
      weight: "slots",

      equipped: "equipped",
      equippable: (item) => !item.system.bodily,
      attuned: "",

      uses: "uses.value",
      maximumUses: "uses.max",
    },

    currency: {
      base: "gp",

      actor: {
        denominations: {
          gp: "",
        },
        handler: {
          get: (actor) => ({ gp: goldTotal(actor.items) }),
          set: async (actor, amounts) => {
            if (amounts.gp == null) return;
            await applyGold(actor, amounts.gp - goldTotal(actor.items));
          },
        },
      },

      item: {
        single: {
          value: "cost",
          denomination: "gp",
        },

        denominations: {},
      },

      denominations: {
        gp: { value: 1 },
      },
    },

    experience: {
      current: "",
      maximum: "",
    },

    overrides: {
      Item: {
        coin: {
          currency: { item: { single: { value: "value" } } },
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
    buildInputs: () => {
      const choices = {};
      for (const key of CAIRN_ABILITIES) choices[key] = game.i18n.localize(key);

      class CheckInput extends DataModel {
        static defineSchema() {
          return {
            value: new fields.StringField({
              label: "ripper-system-abstraction.tests.SavingThrow",
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
      const target = actor.system.abilities?.[inputs.check]?.value;
      if (target == null) throw new Error(`Cairn actors of type "${actor.type}" cannot perform checks.`);

      const message = await captureRollMessage(async () => {
        await game.cairn2e.rolls.rollSave(actor, inputs.check);
      }, options);
      const face = message?.rolls?.[0]?.total;
      if (face == null) {
        return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      const success = savePasses(face, target);
      return {
        canceled: false,
        result: face,
        target,
        success,
        levelOfSuccess: success ? 100 : 0,
        criticalSuccess: face === 1,
        criticalFailure: face === 20,
      };
    },
    },
  };
};
