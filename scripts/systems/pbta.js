const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function pbta() {

  class PbtACheckInput extends DataModel {
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

  const PBTa_OUTCOME_LEVELS = { failure: 0, partial: 50, success: 100, critical: 100 };

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

      useWounds: false,
      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "quantity",
      weight: "weight",

      equipped: "",
      attuned: "",

      uses: "uses",
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
      supportsHealth: false,
      supportsTemporaryHealth: false,
      supportsWounds: false,
      supportsCurrency: false,
      supportsWeight: true,
      supportsEquipment: false,
    },
    },
    testsInterface: {
    resultType: "outcome",
    buildInputs: () => {
      const choices = {};

      const stats = game.pbta?.sheetConfig?.actorTypes?.character?.stats ?? {};
      for (const [key, stat] of Object.entries(stats)) {
        choices[key] = stat.label ?? key;
      }

      class CheckInput extends PbtACheckInput {
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
      if (!Object.keys(actor.system.stats ?? {}).length) throw new Error(`PbtA actors of type "${actor.type}" cannot perform checks.`);
      if (!(inputs.check in actor.system.stats)) throw new Error(`This PbtA actor cannot perform "${inputs.check}" checks.`);

      const roll = new CONFIG.Dice.RollPbtA(
        actor._getStatFormula(inputs.check),
        actor.getRollData(),
        { rollType: "stat", stat: inputs.check },
      );
      await roll.evaluate();
      if (!options.silent) await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });

      const rollResults = game.pbta?.sheetConfig?.rollResults ?? {};
      let outcome = null;
      for (const [key, range] of Object.entries(rollResults)) {
        if ((!range.start || roll.total >= range.start) && (!range.end || roll.total <= range.end)) {
          outcome = key;
          break;
        }
      }

      const success = outcome === "success" || outcome === "critical";

      return {
        canceled: false,
        result: roll.total,
        target: null,
        success,
        levelOfSuccess: outcome != null ? (PBTa_OUTCOME_LEVELS[outcome] ?? null) : null,
        criticalSuccess: outcome === "critical",
        criticalFailure: false,
      };
    },
    },
  };
};
