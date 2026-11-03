const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function castlesAndCrusades() {

  class CastlesAndCrusadesCheckInput extends DataModel {
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

  class CastlesAndCrusadesChallengeLevelInput extends DataModel {
    static defineSchema() {
      return {
        value: new fields.NumberField({
          label: "ripper-system-abstraction.tests.ChallengeLevel",
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
      type: "type.value",
      subtype: "",
      size: (actor) => String(actor.system.size?.value ?? "").trim().charAt(0).toUpperCase(),
      sizes: { T: 0.5, S: 1, M: 1, L: 2, H: 3, G: 4 },
      level: "level.value",
      role: "",
    },

    health: {
      current: "hitPoints.value",
      maximum: "hitPoints.max",
      temporary: "",
      minimum: "",

      useWounds: false,
      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "quantity.value",
      weight: "weight.value",

      equipped: "equipped.value",
      attuned: "",

      uses: "",
      maximumUses: "",
    },

    currency: {
      base: "gp",

      actor: {
        denominations: {
          pp: "money.pp.value",
          gp: "money.gp.value",
          sp: "money.sp.value",
          cp: "money.cp.value",
        },
      },

      item: {
        single: {
          value: "price.value",
          denomination: "",
        },

        denominations: {},
      },

      denominations: {
        pp: { value: 10 },
        gp: { value: 1 },
        sp: { value: 0.1 },
        cp: { value: 0.01 },
      },
    },

    experience: {
      current: "xp.value",
      maximum: "xp.next",
    },

    overrides: {
      Actor: {
        monster: {
          actor: { level: "hitDice.number" },
          experience: { current: "", maximum: "" },
        },
      },
    },

    features: {
      supportsHealth: true,
      supportsTemporaryHealth: false,
      supportsWounds: false,
      supportsCurrency: true,
      supportsWeight: true,
      supportsEquipment: true,
    },
    },
    testsInterface: {
    resultType: "total",
    buildInputs: () => {
      const choices = {};

      for (const [key, label] of Object.entries(CONFIG.TLGCC.abilities)) {
        choices[key] = game.i18n.localize(label);
      }

      class CheckInput extends CastlesAndCrusadesCheckInput {
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
        dc: CastlesAndCrusadesChallengeLevelInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      const data = actor.getRollData();
      const ability = data.abilities?.[inputs.check];
      if (!ability) throw new Error(`C&C actors of type "${actor.type}" cannot perform checks.`);

      const roll = await new Roll(
        `1d20 + ${ability.bonus ?? 0} + ${data.level?.value ?? 0}`,
        data,
      ).evaluate();

      const isPrime = Boolean(ability.ccprimary);
      const base = isPrime
        ? game.settings.get("castles-and-crusades", "primeSiegeChallengeBase") ?? 12
        : game.settings.get("castles-and-crusades", "secondarySiegeChallengeBase") ?? 18;
      const challengeClass = base + (inputs.dc ?? 0);

      if (!options.silent) {
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor: `${game.i18n.localize(`TLGCC.Ability${inputs.check.capitalize()}`)} - CL ${challengeClass}`,
        });
      }

      return {
        canceled: false,
        result: roll.total,
        target: challengeClass,
        success: roll.total >= challengeClass,
        levelOfSuccess: roll.total >= challengeClass ? 100 : 0,
        criticalSuccess: false,
        criticalFailure: false,
      };
    },
    },
  };
};
