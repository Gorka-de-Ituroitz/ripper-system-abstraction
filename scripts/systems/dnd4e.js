const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function dnd4e() {

  class DND4ECheckInput extends DataModel {
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

  class DND4EDCInput extends DataModel {
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
    if (roll === false || !roll) {
      return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
    }

    const target = Number.isNumeric(dc) ? dc : null;
    const success = target != null ? roll.total >= target : null;

    return {
      canceled: false,
      result: roll.total,
      target,
      success,
      levelOfSuccess: success == null ? null : success ? 100 : 0,
      criticalSuccess: false,
      criticalFailure: false,
    };
  }

  return {
    dataPaths: {
    actor: {
      type: "details.type",
      typeChoices: () => CONFIG.DND4E.creatureType,
      subtype: "details.origin",
      size: "details.size",
      sizes: { tiny: 0.5, sm: 1, med: 1, lg: 2, huge: 3, grg: 4 },
      level: "details.level",
      role: "details.role.primary",
    },

    health: {
      current: "attributes.hp.value",
      maximum: "attributes.hp.max",
      temporary: "attributes.temphp.value",
      minimum: "attributes.hp.min",

      useWounds: false,
      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "quantity",
      weight: "weight",

      equipped: "equipped",
      attuned: "attuned",

      uses: "uses.value",
      maximumUses: "uses.max",
    },

    currency: {
      base: "gp",

      actor: {
        denominations: {
          ad: "currency.ad",
          pp: "currency.pp",
          gp: "currency.gp",
          sp: "currency.sp",
          cp: "currency.cp",
        },
      },

      item: {
        single: {
          value: "price",
          denomination: "gp",
        },

        denominations: {},
      },

      denominations: {
        ad: { value: 10000 },
        pp: { value: 100 },
        gp: { value: 1 },
        sp: { value: 0.1 },
        cp: { value: 0.01 },
      },
    },

    experience: {
      current: "details.exp",
      maximum: "",
      },

    overrides: {
      Actor: {
        NPC: { experience: { current: "" } },
        Hazard: { experience: { current: "" } },
      },
    },

    features: {
      supportsHealth: true,
      supportsTemporaryHealth: true,
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
      const group = {
        abilityCheck: game.i18n.localize("ripper-system-abstraction.tests.AbilityCheck"),
        skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
      };

      for (const [key, value] of Object.entries(CONFIG.DND4E.abilities)) {
        choices[`ability.${key}`] = { label: value, group: group.abilityCheck };
      }

      for (const [key, value] of Object.entries(CONFIG.DND4E.skills)) {
        choices[`skill.${key}`] = { label: value.label, group: group.skill };
      }

      class CheckInput extends DND4ECheckInput {
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
        dc: DND4EDCInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      const [type, key] = inputs.check.split(".");
      const rollOptions = {
        fastForward: options.fastForward ?? false,
        event: options.event,
      };
      if (inputs.dc != null) rollOptions.dc = inputs.dc;

      let roll;
      switch (type) {
        case "skill":
          roll = await actor.rollSkill(key, rollOptions);
          break;

        case "ability":
          roll = await actor.rollAbility(key, rollOptions);
          break;

        default:
          throw new Error(`Unsupported D&D 4e check type: ${type}`);
      }

      return normalizeRoll(roll, inputs.dc);
    },
    },
  };
};
