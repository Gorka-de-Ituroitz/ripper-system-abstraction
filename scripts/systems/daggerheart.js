const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

const COIN_VALUES = { coins: 1, handfuls: 10, bags: 100, chests: 1000 };

export default async function daggerheart() {
  const homebrewCurrency = game.settings.get(CONFIG.DH.id, CONFIG.DH.SETTINGS.gameSettings.Homebrew)?.currency ?? {};
  const coins = Object.entries(COIN_VALUES).filter(([key]) => homebrewCurrency[key]?.enabled !== false);
  const [base = "coins", baseValue = 1] = coins[0] ?? [];

  class DaggerheartCheckInput extends DataModel {
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

  class DaggerheartDifficultyInput extends DataModel {
    static defineSchema() {
      return {
        value: new fields.NumberField({
          label: "ripper-system-abstraction.tests.Difficulty",
          required: false,
          nullable: true,
          integer: true,
          min: 0,
        }),
      };
    }
  }

  return {
    dataPaths: {
    actor: {
      type: "",
      subtype: "",
      size: "size",
      sizes: () => game.settings.get(CONFIG.DH.id, CONFIG.DH.SETTINGS.gameSettings.Homebrew)?.tokenSizes ?? {},
      level: "levelData.level.current",
      role: "",
    },

    health: {
      current: "resources.hitPoints.value",
      maximum: "resources.hitPoints.max",
      temporary: "",
      minimum: "",

      wounds: "",
      maximumWounds: "",

      invert: true,
    },

    item: {
      quantity: "quantity",
      weight: "",

      equipped: "equipped",
      attuned: "",

      uses: "resource.value",
      maximumUses: "resource.max",
    },

    currency: {
      base,

      actor: {
        denominations: Object.fromEntries(coins.map(([key]) => [key, `gold.${key}`])),
      },

      item: {
        single: {
          value: "",
          denomination: "",
        },

        denominations: {},
      },

      denominations: Object.fromEntries(
        coins.map(([key, value]) => [key, { value: value / baseValue, label: homebrewCurrency[key]?.label || undefined }]),
      ),
    },

    experience: {
      current: "",
      maximum: "",
    },

    overrides: {
      Actor: {
        adversary: {
          actor: { level: "tier", role: "type" },
        },
      },
    },

    features: {
      supportsHealth: true,
      supportsTemporaryHealth: false,
      supportsWounds: false,
      supportsCurrency: true,
      supportsWeight: false,
      supportsEquipment: true,
    },
    },
    testsInterface: {
    resultType: "total",
    buildInputs: () => {
      const choices = {};

      for (const [key, value] of Object.entries(CONFIG.DH.ACTOR.abilities)) {
        choices[key] = game.i18n.localize(value.label);
      }

      class CheckInput extends DaggerheartCheckInput {
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
        difficulty: DaggerheartDifficultyInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      if (!["character", "companion", "adversary"].includes(actor.type)) {
        throw new Error(`Daggerheart actors of type "${actor.type}" cannot perform checks.`);
      }
      const rollOptions = { event: options.event };
      if (options.fastForward) rollOptions.dialog = { configure: false };
      if (inputs.difficulty != null) {
        rollOptions.roll = {
          trait: inputs.check,
          type: "trait",
          difficulty: inputs.difficulty,
        };
      }

      const result = await actor.rollTrait(inputs.check, rollOptions);
      if (!result) {
        return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      const roll = result.roll;
      const difficulty = inputs.difficulty ?? null;
      const criticalSuccess = roll?.isCritical === true;
      const success = criticalSuccess ? true : difficulty != null ? (roll?.total ?? 0) >= difficulty : null;

      return {
        canceled: false,
        result: roll?.total ?? null,
        target: difficulty,
        success,
        levelOfSuccess: success == null ? null : criticalSuccess ? 100 : roll?.result?.duality === 1 ? (success ? 100 : 33) : roll?.result?.duality === -1 ? (success ? 66 : 0) : success ? 100 : 0,
        criticalSuccess,
        criticalFailure: false,
      };
    },
    },
  };
};
