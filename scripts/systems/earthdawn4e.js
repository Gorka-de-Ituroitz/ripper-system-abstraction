const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function earthdawn4e() {
  const rate = Number(game.settings.get("earthdawn4e", "moneyConversionRate")) || 10;

  const EARTHDAWN_ATTRIBUTES = {
    dexterityStep: "earthdawn.d.dexterity",
    strengthStep: "earthdawn.s.strength",
    toughnessStep: "earthdawn.t.toughness",
    perceptionStep: "earthdawn.p.perception",
    willpowerStep: "earthdawn.w.willpower",
    charismaStep: "earthdawn.c.charisma",
  };

  class EarthdawnCheckInput extends DataModel {
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

  class EarthdawnDifficultyInput extends DataModel {
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

  class EarthdawnModifierInput extends DataModel {
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
      type: "actorType",
      subtype: "",
      size: "",
      level: (actor) => {
        const circles = actor.items.filter((item) => item.type === "discipline").map((item) => Number(item.system.circle) || 0);
        return circles.length ? Math.max(...circles) : null;
      },
      role: "",
    },

    health: {
      current: "damage.value",
      maximum: "damage.max",
      temporary: "",
      minimum: "damage.min",

      useWounds: true,
      wounds: "wounds",
      maximumWounds: "",

      invert: true,
    },

    item: {
      quantity: "amount",
      weight: (item) => (item.system.weight === "" || item.system.weight == null ? null : Number(item.system.weight)),

      equipped: "worn",
      attuned: "",

      uses: "",
      maximumUses: "",
    },

    currency: {
      base: "silver",

      actor: {
        denominations: {
          gold: "money.gold",
          silver: "money.silver",
          copper: "money.copper",
        },
      },

      item: {
        single: {
          value: "cost",
          denomination: "",
        },

        denominations: {},
      },

      denominations: {
        gold: { value: rate, label: "earthdawn.c.coinGoldGold" },
        silver: { value: 1, label: "earthdawn.c.coinSilverSilver" },
        copper: { value: 1 / rate, label: "earthdawn.c.coinCopperCopper" },
      },
    },

    experience: {
      current: "legendpointcurrent",
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
    resultType: "total",
    buildInputs: () => {
      const choices = {};

      for (const [key, label] of Object.entries(EARTHDAWN_ATTRIBUTES)) {
        choices[key] = game.i18n.localize(label);
      }

      class CheckInput extends EarthdawnCheckInput {
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
        difficulty: EarthdawnDifficultyInput,
        modifier: EarthdawnModifierInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      if (!options.fastForward) {
        const { rollPrep } = await import(/* webpackIgnore: true */ foundry.utils.getRoute("systems/earthdawn4e/modules/helpers/roll-prep.js"));
        const rolled = await rollPrep(actor, {
          attribute: inputs.check,
          name: game.i18n.localize(EARTHDAWN_ATTRIBUTES[inputs.check]),
          modifier: inputs.modifier ?? 0,
          difficulty: inputs.difficulty ?? 0,
        });
        if (!rolled) {
          return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
        }
        const target = rolled.difficulty > 0 ? Number(rolled.difficulty) : null;
        return {
          canceled: false,
          result: rolled.total,
          target,
          success: target ? rolled.total >= target : null,
          levelOfSuccess: target ? Math.clamp(50 + (rolled.total - target) * 2, 0, 100) : null,
          criticalSuccess: false,
          criticalFailure: false,
        };
      }

      const wounds = actor.woundCalc?.((Number(actor.system.wounds) || 0) + (Number(actor.system.bloodMagicWounds) || 0)) ?? 0;
      const finalstep = Math.max(
        1,
        (actor.system[inputs.check] ?? 0) +
          (inputs.modifier ?? 0) -
          wounds +
          (Number(actor.system.bonuses?.allRollsStepFinal) || 0)
      );

      const dice = actor.getDice(finalstep);
      const roll = await new Roll(dice ? dice.replace(/(d\d+)/g, "$1x") : "0").evaluate();
      const total = Math.max(1, roll.total);

      if (!options.silent) {
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor: game.i18n.localize(EARTHDAWN_ATTRIBUTES[inputs.check]),
        });
      }

      const margin = inputs.difficulty > 0 ? total - inputs.difficulty : undefined;
      const result = { total, margin };

      const difficulty = inputs.difficulty ?? 0;
      const success = difficulty > 0 ? result.total >= difficulty : null;

      return {
        canceled: false,
        result: result.total,
        target: difficulty > 0 ? difficulty : null,
        success,
        levelOfSuccess: difficulty > 0 ? Math.clamp(50 + (result.margin ?? 0) * 2, 0, 100) : null,
        criticalSuccess: false,
        criticalFailure: false,
      };
    },
    },
  };
};
