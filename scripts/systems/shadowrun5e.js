const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function shadowrun5e() {

  class Shadowrun5eThresholdInput extends DataModel {
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

  const SR5_ATTRIBUTES = ["body", "agility", "reaction", "strength", "willpower", "logic", "intuition", "charisma", "edge", "magic", "resonance"];

  function buildAction(actor, type, key) {
    if (type === "attribute") {
      if (!actor.getAttribute?.(key)) return null;
      return game.shadowrun5e.data.createData("action_roll", { attribute: key, test: "AttributeOnlyTest" });
    }
    if (type === "skill") {
      if (!actor.getSkill?.(key)) return null;
      return actor.skillActionData(key);
    }
    throw new Error(`Unsupported Shadowrun 5e check type: ${type}`);
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
      current: "track.physical.value",
      maximum: "track.physical.max",
      temporary: "",
      minimum: "",

      wounds: "",
      maximumWounds: "",

      invert: true,
    },

    item: {
      quantity: "technology.quantity",
      weight: "",

      equipped: "technology.equipped",
      attuned: "",

      uses: "",
      maximumUses: "",
    },

    currency: {
      base: "nuyen",

      actor: {
        denominations: {
          nuyen: "nuyen",
        },
      },

      item: {
        single: {
          value: "technology.cost",
          denomination: "nuyen",
        },

        denominations: {},
      },

      denominations: {
        nuyen: { value: 1, label: "SR5.Nuyen" },
      },
    },

    experience: {
      current: "karma.value",
      maximum: "",
    },

    overrides: {
      Actor: {
        ic: {
          health: { current: "track.matrix.value", maximum: "track.matrix.max" },
        },
        sprite: {
          health: { current: "track.matrix.value", maximum: "track.matrix.max" },
        },
      },
      Item: {
        weapon: {
          item: { uses: "ammo.current.value", maximumUses: "ammo.current.max" },
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
      supportsAttunement: false,
    },
    },
    testsInterface: {
    resultType: "successes",
    buildInputs: () => {
      const choices = {};
      const group = {
        attribute: game.i18n.localize("ripper-system-abstraction.tests.Attribute"),
        skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
      };

      for (const key of SR5_ATTRIBUTES) {
        choices[`attribute.${key}`] = { label: game.i18n.localize(CONFIG.SR5.attributes[key] ?? key), group: group.attribute };
      }

      for (const [key, label] of Object.entries(CONFIG.SR5.activeSkills)) {
        choices[`skill.${key}`] = { label: game.i18n.localize(label), group: group.skill };
      }

      class CheckInput extends DataModel {
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
        threshold: Shadowrun5eThresholdInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      const [type, key] = inputs.check.split(".");
      const action = buildAction(actor, type, key);
      if (!action) throw new Error(`This Shadowrun 5e actor cannot perform "${inputs.check}" checks.`);
      if (inputs.threshold) action.threshold = { base: inputs.threshold, value: inputs.threshold };

      const test = await actor.tests.fromAction(action, actor, { showDialog: !options.fastForward });
      if (test) await test.execute();
      if (!test?.evaluated) {
        return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      const hits = test.hits.value;
      const threshold = test.hasThreshold ? test.threshold.value : null;
      const scale = threshold ?? test.pool.value;
      return {
        canceled: false,
        result: hits,
        target: threshold,
        success: threshold != null ? test.success : hits > 0,
        levelOfSuccess: scale > 0 ? Math.clamp(Math.round((hits / scale) * 100), 0, 100) : 0,
        criticalSuccess: false,
        criticalFailure: test.criticalGlitched,
        rolls: test.rolls,
      };
    },
    },
  };
};
