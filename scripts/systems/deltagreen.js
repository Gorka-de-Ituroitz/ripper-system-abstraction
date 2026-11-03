const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function deltagreen() {

  class DeltaGreenCheckInput extends DataModel {
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

  class DeltaGreenModifierInput extends DataModel {
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
      type: "",
      subtype: "",
      size: "",
      level: "",
      role: "",
    },

    health: {
      current: "health.value",
      maximum: "health.max",
      temporary: "",
      minimum: "health.min",

      useWounds: false,
      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "",
      weight: "",

      equipped: "equipped",
      attuned: "",

      uses: "",
      maximumUses: "",
    },

    currency: {
      base: "",

      actor: {
        denominations: {},
      },

      item: {
        single: {
          value: "",
          denomination: "",
        },

        denominations: {},
      },

      denominations: {},
    },

    experience: {
      current: "",
      maximum: "",
      level: "",
    },

    features: {
      supportsHealth: true,
      supportsTemporaryHealth: false,
      supportsWounds: false,
      supportsCurrency: false,
      supportsWeight: false,
      supportsEquipment: true,
    },
    },
    testsInterface: {
    resultType: "rollUnder",
    buildInputs: () => {
      const choices = {};
      const group = {
        stat: game.i18n.localize("ripper-system-abstraction.tests.Stat"),
        skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
      };

      const attributes = game.i18n.translations?.DG?.Attributes ?? {};
      for (const key of Object.keys(attributes)) {
        if (!/^[a-z]{3}$/.test(key)) continue;
        choices[`stat.${key}`] = { label: game.i18n.localize(`DG.Attributes.${key}`), group: group.stat };
      }

      const skills = game.i18n.translations?.DG?.Skills ?? {};
      for (const key of Object.keys(skills)) {
        if (["flight", "ritual"].includes(key)) continue;
        choices[`skill.${key}`] = { label: game.i18n.localize(`DG.Skills.${key}`), group: group.skill };
      }

      class CheckInput extends DeltaGreenCheckInput {
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
        modifier: DeltaGreenModifierInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      if (!actor.system.statistics) throw new Error(`Delta Green actors of type "${actor.type}" cannot perform checks.`);
      const DGPercentileRoll = CONFIG.Dice.rolls.find((roll) => roll.name === "DGPercentileRoll");
      if (!DGPercentileRoll) {
        return { canceled: false, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      const [type, key] = inputs.check.split(".");
      const roll = new DGPercentileRoll("1D100", {}, {
        rollType: type === "stat" ? "stat" : "skill",
        key,
        actor,
      });

      if (inputs.modifier != null) roll.modifier = inputs.modifier;

      await roll.evaluate();
      await roll.toChat();

      return {
        canceled: false,
        result: roll.total,
        target: roll.effectiveTarget ?? roll.target,
        success: roll.isSuccess === true,
        levelOfSuccess: Math.clamp(50 + ((roll.effectiveTarget ?? roll.target) - roll.total), 0, 100),
        criticalSuccess: roll.isCritical === true && roll.isSuccess === true,
        criticalFailure: roll.isCritical === true && roll.isSuccess !== true,
      };
    },
    },
  };
};
