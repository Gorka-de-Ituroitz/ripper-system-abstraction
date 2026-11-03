const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function exaltedthird() {

  class ExaltedThirdCheckInput extends DataModel {
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

  class ExaltedThirdDifficultyInput extends DataModel {
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
      type: (actor) => (actor.type === "npc" ? actor.system.creaturetype : actor.system.details?.exalt === "mortal" ? "mortal" : "exalt"),
      typeChoices: () => CONFIG.exaltedthird.selects.creatureTypes,
      subtype: "details.exalt",
      size: "",
      level: "essence.value",
      role: "",
    },

    health: {
      current: {
        get: (actor) => actor.system.health?.value,
        set: (actor, value) => {
          const health = actor.system.health;
          const next = { bashing: health.bashing, lethal: health.lethal, aggravated: health.aggravated };
          let delta = Math.max(0, health.max - value) - (next.bashing + next.lethal + next.aggravated);
          if (delta > 0) next.lethal += delta;
          for (const key of ["bashing", "lethal", "aggravated"]) {
            const healed = Math.min(next[key], Math.max(0, -delta));
            next[key] -= healed;
            delta += healed;
          }
          return Object.fromEntries(Object.entries(next).map(([key, amount]) => [`system.health.${key}`, amount]));
        },
      },
      maximum: "health.max",
      temporary: "",
      minimum: "",

      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "quantity",
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
      current: {
        get: (actor) => actor.system.experience?.standard?.remaining,
        set: (actor, value) => ({ "system.experience.standard.total": actor.system.experience.standard.value + value }),
      },
      maximum: "",
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
    resultType: "successes",
    buildInputs: () => {
      const choices = {};
      const group = {
        ability: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
        pool: game.i18n.localize("ripper-system-abstraction.tests.Pool"),
      };

      for (const [key, label] of Object.entries(CONFIG.exaltedthird.selects.abilities)) {
        if (!key) continue;
        choices[`ability.${key}`] = { label: game.i18n.localize(label), group: group.ability };
      }
      for (const [key, label] of Object.entries(CONFIG.exaltedthird.npcpools)) {
        choices[`pool.${key}`] = { label: game.i18n.localize(label), group: group.pool };
      }

      class CheckInput extends ExaltedThirdCheckInput {
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
        difficulty: ExaltedThirdDifficultyInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      const RollForm = game.exaltedthird?.RollForm;
      if (!RollForm) {
        return { canceled: false, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      const [kind, key] = inputs.check.split(".");
      const isNpc = actor.type === "npc";
      if (kind === "pool" && !isNpc) throw new Error(`Exalted characters cannot perform "${key}" pool checks.`);
      if (kind === "ability" && isNpc) throw new Error(`Exalted NPCs cannot perform "${key}" ability checks; they roll pools.`);
      if (isNpc && actor.system.pools && !actor.system.pools[key]) throw new Error(`This Exalted NPC cannot perform "${inputs.check}" checks.`);

      const form = new RollForm(actor, {}, {}, {
        rollType: "ability",
        ...(isNpc ? { pool: key } : { ability: key, attribute: actor.system.abilities[key]?.prefattribute }),
        difficulty: inputs.difficulty ?? 0,
        skipDialog: !!options.fastForward,
      });
      if ((await form.roll()) === false) {
        return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      const object = form.object;
      const total = object.diceRollTotal;
      const difficulty = object.difficulty ?? 0;
      const botch = total === 0 && (object.roll?.dice?.[0]?.results ?? []).some((die) => die.result === 1);
      const success = difficulty > 0 ? total >= difficulty : null;

      return {
        canceled: false,
        result: total,
        target: difficulty > 0 ? difficulty : null,
        success,
        levelOfSuccess: difficulty > 0 ? Math.clamp(50 + (total - difficulty) * 10, 0, 100) : null,
        criticalSuccess: false,
        criticalFailure: botch,
      };
    },
    },
  };
};
