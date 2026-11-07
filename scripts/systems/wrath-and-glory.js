const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

/*
 * Warhammer 40,000: Wrath & Glory (moo-man) — system id "wrath-and-glory".
 *
 * Built on warhammer-lib, like wfrp4e and impmal.
 *
 * Actor types: agent (player characters), threat (adversaries), vehicle.
 *
 * Health: W&G tracks damage taken. `combat.wounds.value` counts Wounds
 * suffered up to `combat.wounds.max` (hence `invert`). Shock is a second
 * damage track that also counts up, so it is exposed as the wounds track.
 *
 * Tests: dice pools of d6, successes are "icons" compared against a DN.
 * The roll is made through the system's own `setupAttributeTest`,
 * `setupSkillTest` and `setupGenericTest`, so dialogs, effects, scripts,
 * Wrath dice and chat cards behave exactly as when rolling from the sheet.
 */

const SIZES = {
  tiny: 0.5,
  small: 1,
  average: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
};

// Generic tests offered next to attributes and skills: [key, i18n label, group i18n label]
const GENERIC_TESTS = [
  ["fear", "ROLL.FEAR", "ROLL.RESOLVE"],
  ["terror", "ROLL.TERROR", "ROLL.RESOLVE"],
  ["corruption", "ROLL.CORRUPTION", "ROLL.CONVICTION"],
  ["mutation", "ROLL.MUTATION", "ROLL.CONVICTION"],
];

const CANCELED = {
  canceled: true,
  result: null,
  target: null,
  success: null,
  levelOfSuccess: null,
  criticalSuccess: false,
  criticalFailure: false,
};

function normalizeTest(test) {
  const result = test?.result;
  if (!result || result.success == null) return { ...CANCELED };

  const icons = Number(result.success) || 0;
  // `dn` is false for tests rolled without a DN; it may also arrive as a numeric string.
  const rawDn = result.dn;
  const dn = typeof rawDn !== "boolean" && rawDn !== "" && rawDn != null && Number.isFinite(Number(rawDn)) ? Number(rawDn) : null;
  const success = dn == null ? null : !!result.isSuccess;

  // Every icon over the DN is a possible Shift; every icon short of it a step further from success.
  let levelOfSuccess = null;
  if (dn != null) {
    const margin = icons - dn;
    levelOfSuccess = success ? Math.clamp(60 + margin * 10, 60, 100) : Math.clamp(40 + (margin + 1) * 10, 0, 40);
  }

  return {
    canceled: false,
    result: icons,
    target: dn,
    success,
    levelOfSuccess,
    criticalSuccess: !!result.isWrathCritical,
    criticalFailure: !!result.isWrathComplication,
  };
}

export default async function wrathAndGlory() {
  class WNGCheckInput extends DataModel {
    static defineSchema() {
      return {
        value: new fields.StringField({
          label: "ripper-system-abstraction.tests.Check",
          required: true,
          choices: {},
        }),
      };
    }
  }

  class WNGDifficultyInput extends DataModel {
    static defineSchema() {
      return {
        value: new fields.NumberField({
          label: "ripper-system-abstraction.tests.Difficulty",
          required: true,
          nullable: false,
          integer: true,
          min: 0,
          initial: 3,
        }),
      };
    }
  }

  return {
    dataPaths: {
      actor: {
        type: "bio.species",
        subtype: "",
        size: "combat.size",
        sizes: SIZES,
        // Agents store their Tier; threats read the world Tier through a getter.
        level: "advances.tier",
        role: "bio.archetype",
      },

      health: {
        current: "combat.wounds.value",
        maximum: "combat.wounds.max",
        temporary: "",
        minimum: "",

        wounds: "combat.shock.value",
        maximumWounds: "combat.shock.max",
        primary: "health",

        invert: true,
      },

      item: {
        quantity: "quantity",
        weight: "",

        equipped: "equipped",
        attuned: "",

        // Only weapons and armour carry an equipped state.
        equippable: (item) => item.system?.equippable === true,

        // Talents with limited uses (max may be a formula string).
        uses: "uses.current",
        maximumUses: (item) => {
          const max = Number(item.system?.uses?.max);
          return Number.isFinite(max) && max > 0 ? max : null;
        },
      },

      // W&G has no coinage: Wealth is an abstract rating checked against an
      // item's Value, and is not spent when acquiring gear.
      currency: {
        base: "",
        actor: { denominations: {} },
        item: {
          single: { value: "", denomination: "" },
          denominations: {},
        },
        denominations: {},
      },

      experience: {
        // `current` (unspent XP) is derived as total - spent; writes go to `total`.
        current: {
          get: (actor) => actor.system.experience?.current,
          set: (actor, value) => ({ "system.experience.total": (actor.system.experience?.spent ?? 0) + value }),
        },
        maximum: "",
      },

      overrides: {
        Actor: {
          threat: {
            experience: { current: "" },
          },
          vehicle: {
            actor: { type: "", level: "", role: "" },
            health: { wounds: "", maximumWounds: "", primary: "health" },
            experience: { current: "" },
          },
        },
      },

      features: {
        supportsHealth: true,
        supportsTemporaryHealth: false,
        supportsWounds: true,
        supportsCurrency: false,
        supportsWeight: false,
        supportsEquipment: true,
        supportsAttunement: false,
      },
    },

    testsInterface: {
      resultType: "successes",
      supportsAdvantage: false,

      buildInputs: () => {
        const config = game.wng?.config ?? {};
        const choices = {};
        const group = {
          attribute: game.i18n.localize("ripper-system-abstraction.tests.Attribute"),
          skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
        };

        for (const [key, label] of Object.entries(config.attributes ?? {})) {
          choices[`attribute.${key}`] = { label: game.i18n.localize(label), group: group.attribute };
        }

        for (const [key, label] of Object.entries(config.skills ?? {})) {
          choices[`skill.${key}`] = { label: game.i18n.localize(label), group: group.skill };
        }

        for (const [key, label, groupLabel] of GENERIC_TESTS) {
          choices[`generic.${key}`] = { label: game.i18n.localize(label), group: game.i18n.localize(groupLabel) };
        }

        class CheckInput extends WNGCheckInput {
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
          dn: WNGDifficultyInput,
        };
      },

      processCheck: async (actor, inputs, options = {}) => {
        if (actor.type === "vehicle" || !actor.system.attributes) {
          throw new Error(`Wrath & Glory actors of type "${actor.type}" cannot perform checks.`);
        }

        const [type, key] = String(inputs.check ?? "").split(".");
        const context = {
          skipDialog: options.fastForward ?? false,
          skipTargets: true,
          event: options.event,
          fields: {},
        };
        if (Number.isNumeric(inputs.dn)) context.fields.difficulty = Number(inputs.dn);

        // Closing the roll dialog resolves the pending test with nothing (canceled).
        const testOptions = { resolveClose: true };

        let test;
        switch (type) {
          case "attribute":
            test = await actor.setupAttributeTest(key, context, testOptions);
            break;

          case "skill":
            test = await actor.setupSkillTest(key, context, testOptions);
            break;

          case "generic":
            if (!GENERIC_TESTS.some(([k]) => k === key)) throw new Error(`Unsupported Wrath & Glory test: ${key}`);
            test = await actor.setupGenericTest(key, context, testOptions);
            break;

          default:
            throw new Error(`Unsupported Wrath & Glory check type: ${type}`);
        }

        return normalizeTest(test);
      },
    },
  };
}
