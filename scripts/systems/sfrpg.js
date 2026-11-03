const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function sfrpg() {

  class SFRPGCeckInput extends DataModel {
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

  class SFRPGDCInput extends DataModel {
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

  function normalizeRoll(result, dc) {
    if (!result) {
      return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
    }

    const roll = result.roll;
    const target = Number.isNumeric(dc) ? dc : null;
    let success = null;
    if (target != null) {
      if (roll.d20Critical) success = true;
      else if (roll.d20Fumble) success = false;
      else success = roll.total >= target;
    }

    return {
      canceled: false,
      result: roll.total,
      target,
      success,
      levelOfSuccess: success == null ? null : success ? 100 : 0,
      criticalSuccess: roll.d20Critical === true,
      criticalFailure: roll.d20Fumble === true,
    };
  }

  return {
    dataPaths: {
    actor: {
      type: "details.type",
      subtype: "details.subtype",
      size: "traits.size",
      sizes: { fine: 0.5, diminutive: 0.5, tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4, colossal: 6 },
      level: "details.level.value",
      role: "",
    },

    health: {
      current: "attributes.hp.value",
      maximum: "attributes.hp.max",
      temporary: "attributes.hp.temp",
      minimum: "",

      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "quantity",
      weight: (item) => {
        const bulk = item.system.bulk;
        if (bulk == null || bulk === "") return null;
        if (bulk === "L") return 0.1;
        if (bulk === "-") return 0;
        return Number.isFinite(Number(bulk)) ? Number(bulk) : null;
      },

      equipped: "equipped",
      attuned: "",

      uses: "uses.value",
      maximumUses: "uses.max",
    },

    currency: {
      base: "credit",

      actor: {
        denominations: {
          credit: "currency.credit",
          upb: "currency.upb",
        },
      },

      item: {
        single: {
          value: "price",
          denomination: "credit",
        },

        denominations: {},
      },

      denominations: {
        credit: { value: 1, label: "SFRPG.Currencies.Credits", abbreviation: "SFRPG.Combat.Difficulty.Units.Credits" },
        upb: { value: 1, label: "SFRPG.Currencies.UPBs", change: false },
      },
    },

    experience: {
      current: "details.xp.value",
      maximum: "details.xp.max",
    },

    overrides: {
      Actor: {
        npc: { experience: { current: "", maximum: "" } },
        npc2: { experience: { current: "", maximum: "" } },
        hazard: { experience: { current: "", maximum: "" } },
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
    initiativeNeedsToken: true,
    buildInputs: () => {
      const choices = {};
      const group = {
        abilityCheck: game.i18n.localize("ripper-system-abstraction.tests.AbilityCheck"),
        savingThrow: game.i18n.localize("ripper-system-abstraction.tests.SavingThrow"),
        skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
      };

      for (const [key, value] of Object.entries(CONFIG.SFRPG.skills)) {
        choices[`skill.${key}`] = { label: game.i18n.localize(value), group: group.skill };
      }

      for (const [key, value] of Object.entries(CONFIG.SFRPG.abilities)) {
        choices[`ability.${key}`] = { label: game.i18n.localize(value), group: group.abilityCheck };
      }

      for (const [key, value] of Object.entries(CONFIG.SFRPG.saves)) {
        choices[`save.${key}`] = { label: game.i18n.localize(value), group: group.savingThrow };
      }

      class CheckInput extends SFRPGCeckInput {
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
        dc: SFRPGDCInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      const [type, key] = inputs.check.split(".");
      const { skills, abilities, attributes } = actor.system;
      if (!skills && !abilities) throw new Error(`SFRPG actors of type "${actor.type}" cannot perform checks.`);
      const available = { skill: skills?.[key], ability: abilities?.[key], save: attributes?.[key] }[type];
      if (!available) throw new Error(`This SFRPG actor cannot perform "${inputs.check}" checks.`);
      const rollOptions = {
        skipUI: options.fastForward ?? false,
        event: options.event,
      };
      if (inputs.dc != null) rollOptions.dc = inputs.dc;

      let result;
      switch (type) {
        case "skill":
          result = options.fastForward
            ? await actor.rollSkillCheck(key, rollOptions)
            : await actor.rollSkill(key, rollOptions);
          break;

        case "ability":
          result = await actor.rollAbility(key, rollOptions);
          break;

        case "save":
          result = await actor.rollSave(key, rollOptions);
          break;

        default:
          throw new Error(`Unsupported SFRPG check type: ${type}`);
      }

      return normalizeRoll(result, inputs.dc);
    },
    },
  };
};
