const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function starwarsffg() {

  class StarWarsFFGCheckInput extends DataModel {
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

  class StarWarsFFGDifficultyInput extends DataModel {
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
      size: "",
      level: "",
      role: "",
    },

    health: {
      current: "stats.wounds.value",
      maximum: "stats.wounds.max",
      temporary: "",
      minimum: "",

      useWounds: true,
      wounds: "stats.wounds.value",
      maximumWounds: "stats.wounds.max",

      invert: true,
    },

    item: {
      quantity: "quantity.value",
      weight: "encumbrance.value",

      equipped: "equippable.equipped",
      attuned: "",

      uses: "",
      maximumUses: "",
    },

    currency: {
      base: "credits",

      actor: {
        denominations: {
          credits: "stats.credits.value",
        },
      },

      item: {
        single: {
          value: "price.value",
          denomination: "credits",
        },

        denominations: {},
      },

      denominations: {
        credits: { value: 1 },
      },
    },

    experience: {
      current: "experience.available",
      maximum: "",
      level: "",
    },

    overrides: {
      Actor: {
        vehicle: {
          health: {
            current: "stats.hullTrauma.value",
            maximum: "stats.hullTrauma.max",
            wounds: "stats.hullTrauma.value",
            maximumWounds: "stats.hullTrauma.max",
          },
        },
      },
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
    resultType: "successes",
    buildInputs: () => {
      const choices = {};
      const group = {
        characteristic: game.i18n.localize("ripper-system-abstraction.tests.Characteristic"),
        skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
      };

      for (const [key, characteristic] of Object.entries(CONFIG.FFG.characteristics)) {
        choices[`characteristic.${key}`] = { label: characteristic.label ?? key, group: group.characteristic };
      }

      for (const [key, skill] of Object.entries(CONFIG.FFG.skills)) {
        choices[`skill.${key}`] = { label: skill.label ?? key, group: group.skill };
      }

      class CheckInput extends StarWarsFFGCheckInput {
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
        difficulty: StarWarsFFGDifficultyInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      const DicePoolFFG = window.DicePoolFFG;
      if (!DicePoolFFG || !game.ffg?.RollFFG) {
        return { canceled: false, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      if (!actor.system.characteristics) throw new Error(`Star Wars FFG actors of type "${actor.type}" cannot perform checks.`);
      const [type, key] = inputs.check.split(".");
      const pool = new DicePoolFFG({ difficulty: inputs.difficulty ?? 2 });

      let flavor;
      if (type === "characteristic") {
        const characteristic = actor.system.characteristics[key];
        if (!characteristic) throw new Error(`Unknown Star Wars FFG characteristic: ${key}`);

        pool.ability = characteristic.value ?? 0;
        flavor = characteristic.label ?? key;
      } else if (type === "skill") {
        const skill = actor.system.skills[key];
        if (!skill) throw new Error(`Unknown Star Wars FFG skill: ${key}`);

        const characteristic = actor.system.characteristics[skill.characteristic];
        if (!characteristic) throw new Error(`Unknown Star Wars FFG characteristic: ${skill.characteristic}`);

        const charValue = characteristic.value ?? 0;
        const rank = skill.rank ?? 0;
        pool.ability = Math.max(charValue, rank);
        pool.boost = skill.boost ?? 0;
        pool.setback = skill.setback ?? 0;
        if (Math.min(charValue, rank) + (pool.upgrades ?? 0) > 0) {
          pool.upgrade(Math.min(charValue, rank) + (pool.upgrades ?? 0));
        }
        flavor = skill.label ?? key;
      } else {
        throw new Error(`Unsupported Star Wars FFG check type: ${type}`);
      }

      const roll = new game.ffg.RollFFG(pool.renderDiceExpression(), null, pool, flavor);
      if (!options.silent) await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });

      const netSuccesses = roll.ffg?.success ?? 0;

      return {
        canceled: false,
        result: netSuccesses,
        target: null,
        success: netSuccesses > 0,
        levelOfSuccess: Math.clamp(50 + netSuccesses * 15, 0, 100),
        criticalSuccess: (roll.ffg?.triumph ?? 0) > 0,
        criticalFailure: (roll.ffg?.despair ?? 0) > 0,
      };
    },
    },
  };
};
