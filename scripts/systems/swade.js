const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function swade() {
  try {
    const pack = game.packs?.get?.("swade.skills");
    if (pack && !pack.indexed) await pack.getIndex();
  } catch (err) {}


  class SwadeCheckInput extends DataModel {
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

  class SwadeModifierInput extends DataModel {
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

  function normalizeRoll(roll) {
    if (!roll) {
      return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
    }

    const successes = roll.successes ?? 0;
    const success = successes >= 1;

    return {
      canceled: false,
      result: roll.total,
      target: roll.targetNumber ?? 4,
      success,
      levelOfSuccess: successes <= 0 ? 0 : Math.min(50 + (successes - 1) * 25, 100),
      criticalSuccess: false,
      criticalFailure: successes === -1,
    };
  }

  return {
    dataPaths: {
    actor: {
      type: "",
      subtype: "",
      size: "stats.size",
      level: "advances.value",
      role: "",
    },

    health: {
      current: "",
      maximum: "",
      temporary: "",
      minimum: "",

      wounds: "wounds.value",
      maximumWounds: "wounds.max",
    },

    item: {
      quantity: "quantity",
      weight: "weight",

      equipped: "equipStatus",
      equippedValue: 2,
      unequippedValue: 0,
      attuned: "",

      uses: "",
      maximumUses: "",
    },

    currency: {
      base: "$",

      actor: {
        denominations: {
          "$": "details.currency",
        },
      },

      item: {
        single: {
          value: "price",
          denomination: "$",
        },

        denominations: {},
      },

      denominations: {
        "$": { value: 1 },
      },
    },

    experience: {
      current: "",
      maximum: "",
    },

    features: {
      supportsHealth: false,
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

      for (const [key, value] of Object.entries(CONFIG.SWADE.attributes)) {
        choices[key] = game.i18n.localize(value.long);
      }

      const pack = game.packs.get("swade.skills");
      if (pack?.indexed) {
        const index = pack.index instanceof Map ? pack.index.values() : pack.index;
        for (const entry of index) {
          if (entry.type !== "skill") continue;
          choices[entry.system?.swid ?? entry.name] = entry.name;
        }
      }

      class CheckInput extends SwadeCheckInput {
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
        modifier: SwadeModifierInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      const isAttribute = inputs.check in CONFIG.SWADE.attributes;
      if (!actor.system.attributes) throw new Error(`SWADE actors of type "${actor.type}" cannot perform checks.`);
      if (!isAttribute && ["vehicle", "group"].includes(actor.type)) throw new Error(`SWADE ${actor.type} actors cannot perform "${inputs.check}" skill checks.`);
      const rollOptions = { event: options.event };
      if (inputs.modifier != null) {
        rollOptions.additionalMods = [
          {
            label: game.i18n.localize("SWADE.Modifier"),
            value: inputs.modifier,
          },
        ];
      }
      if (options.silent || options.fastForward) rollOptions.suppressChat = true;

      let roll;
      if (isAttribute) {
        roll = await actor.rollAttribute(inputs.check, rollOptions);
      } else {
        const item = actor.getSingleItemBySwid?.(inputs.check, "skill");
        roll = item
          ? await item.roll(rollOptions)
          : await actor.rollSkill(inputs.check, rollOptions);
      }

      if (roll && options.fastForward) {
        const evaluated = await new roll.constructor(roll.formula, actor.getRollData()).evaluate();
        evaluated.targetNumber ??= 4;
        if (!options.silent) await evaluated.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });
        return normalizeRoll(evaluated);
      }

      return normalizeRoll(roll);
    },
    },
  };
};
