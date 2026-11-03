const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function vaesen() {

  class VaesenCheckInput extends DataModel {
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

  const VAESEN_ATTRIBUTES = ["physique", "precision", "logic", "empathy", "might", "bodyControl", "magic", "manipulation"];

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
      current: "",
      maximum: "",
      temporary: "",
      minimum: "",

      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "",
      weight: "",

      equipped: "",
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
      current: "experience",
      maximum: "",
      level: "",
    },

    features: {
      supportsHealth: false,
      supportsTemporaryHealth: false,
      supportsWounds: false,
      supportsCurrency: false,
      supportsWeight: false,
      supportsEquipment: false,
    },
    },
    testsInterface: {
    resultType: "successes",
    buildInputs: () => {
      const choices = {};
      const group = {
        skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
        attribute: game.i18n.localize("ripper-system-abstraction.tests.Attribute"),
      };

      for (const key of Object.keys(CONFIG.vaesen?.skills ?? {})) {
        choices[`skill.${key}`] = { label: game.i18n.localize(CONFIG.vaesen.skills[key]), group: group.skill };
      }

      for (const key of VAESEN_ATTRIBUTES) {
        choices[`attribute.${key}`] = { label: game.i18n.localize(`ATTRIBUTE.${key.replace(/([A-Z])/g, "_$1").toUpperCase()}_ROLL`), group: group.attribute };
      }

      class CheckInput extends VaesenCheckInput {
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
      const YearZeroRoll = CONFIG.Dice.rolls.find((roll) => roll.name === "YearZeroRoll");
      if (!YearZeroRoll) {
        return { canceled: false, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      if (!actor.system.attribute) throw new Error(`Vaesen actors of type "${actor.type}" cannot perform checks.`);
      const [type, key] = inputs.check.split(".");
      if (!(type === "skill" ? actor.system.skill?.[key] : actor.system.attribute[key])) {
        throw new Error(`This Vaesen actor cannot perform "${inputs.check}" checks.`);
      }
      let pool = 0;
      let name = key;

      if (type === "skill") {
        const skill = actor.system.skill[key];
        const attribute = actor.system.attribute[skill.attribute];
        pool = (skill.value ?? 0) + (attribute?.value ?? 0);
        name = game.i18n.localize(skill.label ?? key);
      } else if (type === "attribute") {
        pool = actor.system.attribute[key]?.value ?? 0;
        name = game.i18n.localize(`ATTRIBUTE.${key.replace(/([A-Z])/g, "_$1").toUpperCase()}_ROLL`);
      } else {
        throw new Error(`Unsupported Vaesen check type: ${type}`);
      }

      const roll = await YearZeroRoll.forge(
        { term: "s", number: Math.max(1, pool) },
        { yzGame: "vae" },
        { name, event: options.event },
      ).evaluate();
      if (!options.silent) await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });

      const successCount = roll.successCount ?? 0;
      const diceCount = Math.max(1, pool);

      return {
        canceled: false,
        result: successCount,
        target: null,
        success: successCount > 0,
        levelOfSuccess: Math.round((successCount / diceCount) * 100),
        criticalSuccess: false,
        criticalFailure: false,
      };
    },
    },
  };
};
