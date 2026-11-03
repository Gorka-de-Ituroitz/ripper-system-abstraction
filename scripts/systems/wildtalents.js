import { captureRollMessage } from "./_shared.js";

const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function wildtalents() {

  const WILD_TALENTS_STATS = {
    body: "WT.Stat.Body",
    coordination: "WT.Stat.Coordination",
    sense: "WT.Stat.Sense",
    mind: "WT.Stat.Mind",
    charm: "WT.Stat.Charm",
    command: "WT.Stat.Command",
  };

  class WildTalentsCheckInput extends DataModel {
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

  class WildTalentsDifficultyInput extends DataModel {
    static defineSchema() {
      return {
        value: new fields.NumberField({
          label: "ripper-system-abstraction.tests.Difficulty",
          required: false,
          nullable: true,
          integer: true,
          min: 1,
          max: 10,
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
      current: "",
      maximum: "",
      temporary: "",
      minimum: "",

      useWounds: true,
      wounds: "silhouette",
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
      current: "xp",
      maximum: "",
      level: "",
    },

    features: {
      supportsHealth: false,
      supportsTemporaryHealth: false,
      supportsWounds: true,
      supportsCurrency: false,
      supportsWeight: false,
      supportsEquipment: false,
    },
    },
    testsInterface: {
    resultType: "successes",
    buildInputs: () => {
      const choices = {};

      for (const [key, label] of Object.entries(WILD_TALENTS_STATS)) {
        choices[key] = game.i18n.localize(label);
      }

      class CheckInput extends WildTalentsCheckInput {
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
        difficulty: WildTalentsDifficultyInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      if (!actor.system.stats) throw new Error(`Wild Talents actors of type "${actor.type}" cannot perform checks.`);
      const dice = actor.system.stats[inputs.check];
      if (!dice) throw new Error(`This Wild Talents actor cannot perform "${inputs.check}" checks.`);

      const message = await captureRollMessage(async () => {
        await game.wildtalents.quickRoll(dice, {
          flavor: game.i18n.localize(WILD_TALENTS_STATS[inputs.check]),
          minHeight: inputs.difficulty ?? 1,
          speaker: { actor: actor.id },
        });
      }, options);

      let success = null;
      let result = null;
      try {
        const data = JSON.parse(message.rolls[0].terms[0].flavor);
        result = Math.max(0, ...(data.sets ?? []).map((set) => set.length));
        const minWidth = data.minWidth ?? 2;
        const minHeight = data.minHeight ?? 1;
        success = (data.sets ?? []).some((set) => {
          const height = set.find((d) => d.face !== "*")?.face ?? "*";
          return set.length >= minWidth && (height === "*" || height >= minHeight);
        });
      } catch (err) {
        success = null;
      }

      return {
        canceled: false,
        result,
        target: inputs.difficulty ?? 1,
        success,
        levelOfSuccess: success == null ? null : success ? 100 : 0,
        criticalSuccess: false,
        criticalFailure: false,
      };
    },
    },
  };
};
