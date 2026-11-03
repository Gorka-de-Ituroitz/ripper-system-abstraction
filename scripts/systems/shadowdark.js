const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function shadowdark() {

  class ShadowdarkCheckInput extends DataModel {
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

  class ShadowdarkDCInput extends DataModel {
    static defineSchema() {
      return {
        value: new fields.NumberField({
          label: "ripper-system-abstraction.tests.DC",
          required: false,
          nullable: true,
          integer: true,
          min: 0,
        }),
      };
    }
  }

  function normalizeRoll(roll, dc) {
    if (!roll) {
      return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
    }

    const target = Number.isNumeric(roll.options?.dc) ? Number(roll.options.dc) : Number.isNumeric(dc) ? dc : null;
    const success = target != null ? roll.total >= target : null;

    return {
      canceled: false,
      result: roll.total,
      target,
      success,
      levelOfSuccess: success == null ? null : success ? 100 : 0,
      criticalSuccess: roll.criticalSuccess === true,
      criticalFailure: roll.criticalFailure === true,
    };
  }

  return {
    dataPaths: {
    actor: {
      type: "",
      subtype: "",
      size: "",
      level: "level.value",
      role: "",
    },

    health: {
      current: "attributes.hp.value",
      maximum: "attributes.hp.max",
      temporary: "",
      minimum: "",

      useWounds: false,
      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "quantity",
      weight: "slots.slots_used",

      equipped: "equipped",
      attuned: "",

      uses: "uses.available",
      maximumUses: "uses.max",
    },

    currency: {
      base: "gp",

      actor: {
        denominations: {
          gp: "coins.gp",
          sp: "coins.sp",
          cp: "coins.cp",
        },
      },

      item: {
        single: {
          value: "",
          denomination: "",
        },

        denominations: {
          gp: "cost.gp",
          sp: "cost.sp",
          cp: "cost.cp",
        },
      },

      denominations: {
        cp: { value: 0.01 },
        sp: { value: 0.1 },
        gp: { value: 1 },
      },
    },

    experience: {
      current: "level.xp",
      maximum: "",
      level: "level.value",
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
    resultType: "total",
    buildInputs: () => {
      const choices = {};

      for (const key of CONFIG.SHADOWDARK.ABILITY_KEYS) {
        choices[key] = game.i18n.localize(CONFIG.SHADOWDARK.ABILITIES_LONG[key]);
      }

      class CheckInput extends ShadowdarkCheckInput {
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
        dc: ShadowdarkDCInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      if (typeof actor.system.rollStatCheck !== "function") throw new Error(`Shadowdark actors of type "${actor.type}" cannot perform checks.`);
      const config = {
        skipPrompt: options.fastForward ?? false,
        event: options.event,
      };
      if (inputs.dc != null) config.mainRoll = { dc: inputs.dc };

      const roll = await actor.system.rollStatCheck(inputs.check, config);
      return normalizeRoll(roll, inputs.dc);
    },
    },
  };
};
