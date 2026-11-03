const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function demonlord() {

  class DemonlordCheckInput extends DataModel {
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

  class DemonlordModifierInput extends DataModel {
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

  const DEMONLORD_ATTRIBUTES = {
    strength: "DL.AttributeStrength",
    agility: "DL.AttributeAgility",
    intellect: "DL.AttributeIntellect",
    will: "DL.AttributeWill",
    perception: "DL.AttributePerception",
  };

  return {
    dataPaths: {
    actor: {
      type: "",
      subtype: "isPC",
      size: "characteristics.size",
      level: "level",
      role: "",
    },

    health: {
      current: "characteristics.health.value",
      maximum: "characteristics.health.max",
      temporary: "",
      minimum: "",

      useWounds: false,
      wounds: "",
      maximumWounds: "",

      invert: true,
    },

    item: {
      quantity: "quantity",
      weight: "",

      equipped: "wear",
      attuned: "",

      uses: "activatedEffect.uses.value",
      maximumUses: "activatedEffect.uses.max",
    },

    currency: {
      base: "gc",

      actor: {
        denominations: {
          gc: "wealth.gc",
          ss: "wealth.ss",
          cp: "wealth.cp",
          bits: "wealth.bits",
        },
      },

      item: {
        single: {
          value: "",
          denomination: "",
        },

        denominations: {},
      },

      denominations: {
        gc: { value: 1 },
        ss: { value: 0.1 },
        cp: { value: 0.01 },
        bits: { value: 0.001 },
      },
    },

    experience: {
      current: "",
      maximum: "",
      level: "level",
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
    rollInitiative: async (actor, combatant) => {
      const combat = combatant.combat;
      if (game.settings.get("demonlord", "optionalRuleInitiativeMode") !== "s") {
        await combat.rollInitiative([combatant.id], { updateTurn: false });
        return;
      }
      await combat.setInitiative(combatant.id, combat.getInitiativeValue(combatant));
    },
    buildInputs: () => {
      const choices = {};

      for (const [key, label] of Object.entries(DEMONLORD_ATTRIBUTES)) {
        choices[key] = game.i18n.localize(label);
      }

      class CheckInput extends DemonlordCheckInput {
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
        modifier: DemonlordModifierInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      const attribute = actor.getAttribute(inputs.check);
      if (!attribute) throw new Error(`Unknown Demon Lord attribute: ${inputs.check}`);

      const roll = await actor.rollAttributeChallenge(
        attribute,
        undefined,
        inputs.modifier ?? 0,
      );

      const target = game.settings.get("demonlord", "optionalRuleDieRollsMode") === "b" ? 11 : 10;
      const success = !attribute.immune && roll.total >= target;

      return {
        canceled: false,
        result: roll.total,
        target,
        success,
        levelOfSuccess: success ? 100 : 0,
        criticalSuccess: false,
        criticalFailure: false,
      };
    },
    },
  };
};
