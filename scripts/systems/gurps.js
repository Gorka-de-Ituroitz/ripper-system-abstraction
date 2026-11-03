const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function gurps() {

  const GURPS_ATTRIBUTES = {
    ST: "GURPS.attributesSTNAME",
    DX: "GURPS.attributesDXNAME",
    IQ: "GURPS.attributesIQNAME",
    HT: "GURPS.attributesHTNAME",
    WILL: "GURPS.attributesWILLNAME",
    PER: "GURPS.attributesPERNAME",
  };

  const usesField = (key) => ({
    get: (item) => {
      const value = item.system.eqt?.[key];
      return value === "" || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
    },
    set: (item, value) => ({ [`system.eqt.${key}`]: String(value) }),
  });

  // eqt.cost is usually a number but imports/edits can leave strings such as "1,200" or "$50".
  const costField = {
    get: (item) => {
      const value = item.system.eqt?.cost;
      if (typeof value === "number") return value;
      const cost = Number(String(value ?? "").replace(/[$,\s]/g, ""));
      return value === "" || value == null || !Number.isFinite(cost) ? undefined : cost;
    },
    set: (item, value) => ({ "system.eqt.cost": value }),
  };

  class GURPSCheckInput extends DataModel {
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

  class GURPSModifierInput extends DataModel {
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
      type: "",
      subtype: "",
      size: (actor) => Number(actor.system.traits?.sizemod) || 0,
      sizes: { 2: 2, 3: 3, 4: 5, 5: 7, 6: 10 },
      level: "",
      role: "",
    },

    health: {
      current: "HP.value",
      maximum: "HP.max",
      temporary: "",
      minimum: "HP.min",

      useWounds: false,
      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "eqt.count",
      weight: "eqt.weight",

      equipped: {
        get: (item) => item.system.eqt?.equipped,
        set: (item, value) => ({ "system.equipped": value, "system.eqt.equipped": value }),
      },
      attuned: "",

      uses: usesField("uses"),
      maximumUses: usesField("maxuses"),
    },

    currency: {
      base: "$",

      actor: {
        denominations: {},
      },

      item: {
        single: {
          value: costField,
          denomination: "$",
        },

        denominations: {},
      },

      denominations: {},
    },

    experience: {
      current: "totalpoints.unspent",
      maximum: "",
    },

    features: {
      supportsHealth: true,
      supportsTemporaryHealth: false,
      supportsWounds: false,
      supportsCurrency: false,
      supportsWeight: true,
      supportsEquipment: true,
    },

    afterUpdate: async (document) => {
      const actor = document.parent;
      if (document.documentName !== "Item" || document.type !== "equipment" || !actor?._findEqtkeyForId?.("itemid", document.id)) return;
      await actor._updateItemFromForm(document);
    },
    },
    testsInterface: {
    resultType: "rollUnder",
    buildInputs: () => {
      const choices = {};

      for (const [key, label] of Object.entries(GURPS_ATTRIBUTES)) {
        choices[key] = game.i18n.localize(label);
      }

      class CheckInput extends GURPSCheckInput {
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
        modifier: GURPSModifierInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      let modifier = "";
      if (inputs.modifier != null && inputs.modifier !== 0) {
        modifier = inputs.modifier > 0 ? `+${inputs.modifier}` : `${inputs.modifier}`;
      }

      const target = actor.system.attributes?.[inputs.check]?.value;
      const otf = options.fastForward
        ? `${inputs.check}${Number.isNumeric(target) ? target : ""}${modifier}`
        : `${inputs.check}${modifier}`;

      const bucketWasEmpty = GURPS.ModifierBucket.currentSum() === 0;
      GURPS.lastTargetedRoll = null;
      await GURPS.performAction(
        GURPS.parselink(otf).action,
        options.fastForward ? null : actor,
        options.event,
      );

      // performAction returns false for a failed roll too; only a missing roll means it was canceled
      const last = GURPS.lastTargetedRoll;
      if (!last) {
        if (bucketWasEmpty) GURPS.ModifierBucket.clear();
        return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      const success = !last.failure;
      const levelOfSuccess = last.isCritSuccess
        ? 100
        : last.isCritFailure
          ? 0
          : Math.clamp(50 + (last.margin ?? 0), 0, 100);

      return {
        canceled: false,
        result: last.rtotal ?? null,
        target: last.finaltarget ?? null,
        success,
        levelOfSuccess,
        criticalSuccess: last.isCritSuccess === true,
        criticalFailure: last.isCritFailure === true,
      };
    },
    },
  };
};
