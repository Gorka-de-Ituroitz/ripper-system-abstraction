const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function ars() {

  class ARSCheckInput extends DataModel {
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

  function normalizeRoll(roll) {
    if (!roll) {
      return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
    }

    return {
      canceled: false,
      result: roll.total,
      target: roll.checkTarget != null ? Number(roll.checkTarget) : null,
      success: roll.success === true,
      levelOfSuccess: roll.success === true ? 100 : 0,
      criticalSuccess: roll.critical === true,
      criticalFailure: roll.fumble === true,
    };
  }

  const ARS = game.ars.config;
  const coinValues = ARS.currencyValue[ARS.settings.systemVariant] ?? ARS.currencyValue[0];
  // Coins count unless stored ("nocarried"): ars creates coins with an empty location state and treats that as carried
  const coinItems = (actor) => actor.items.filter((item) => item.type === "currency"
    && (actor.type === "lootable" || item.system.location?.state !== "nocarried"));

  return {
    dataPaths: {
    actor: {
      type: "",
      subtype: "",
      size: "attributes.size",
      sizes: () => (String(ARS.settings.systemVariant) === "0" ? ARS.tokenSizeMappingVariant0 : ARS.tokenSizeMapping),
      level: (actor) => (actor.classes?.length ? Math.max(...actor.classes.map((c) => Object.keys(c.system.advancement ?? {}).length)) : null),
      role: "",
    },

    health: {
      current: "attributes.hp.value",
      maximum: "attributes.hp.max",
      temporary: "attributes.hp.temp.hp.value",
      minimum: "attributes.hp.min",

      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "quantity",
      weight: "weight",

      equipped: "location.state",
      equippedValue: "equipped",
      unequippedValue: "carried",
      attuned: "",

      uses: "charges.value",
      maximumUses: "charges.max",
    },

    currency: {
      base: "gp",

      actor: {
        denominations: { pp: "", ep: "", gp: "", sp: "", cp: "" },
        handler: {
          get: (actor) => {
            const wallet = Object.fromEntries(Object.keys(coinValues).map((key) => [key, 0]));
            for (const coin of coinItems(actor)) {
              const key = coin.system.cost.currency.toLowerCase();
              if (key in wallet) wallet[key] += parseInt(coin.system.quantity) || 0;
            }
            return wallet;
          },
          set: async (actor, amounts) => {
            const updates = [];
            const create = {};
            for (const [key, target] of Object.entries(amounts)) {
              const [first, ...rest] = coinItems(actor).filter((coin) => coin.system.cost.currency.toLowerCase() === key);
              if (!first) {
                if (target > 0) create[key] = target;
                continue;
              }
              updates.push({ _id: first.id, "system.quantity": target });
              for (const extra of rest) updates.push({ _id: extra.id, "system.quantity": 0 });
            }
            if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
            // ars creates one coin type per call
            for (const [key, amount] of Object.entries(create)) await actor.giveSpecificCurrency(amount, key);
          },
        },
      },

      item: {
        single: {
          value: "cost.value",
          denomination: "cost.currency",
        },

        denominations: {},
      },

      denominations: Object.fromEntries(Object.entries(coinValues).map(([key, copper]) => [key, {
        value: copper / coinValues.gp,
        label: ARS.currency[key],
        icon: ARS.icons?.general?.currency?.[key] ?? null,
        change: key !== "ep",
      }])),
    },

    experience: {
      current: "",
      maximum: "",
    },

    overrides: {
      Actor: {
        npc: {
          actor: { level: (actor) => parseInt(actor.system.hitdice) || null },
        },
      },
    },

    features: {
      supportsHealth: true,
      supportsTemporaryHealth: true,
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

      for (const [key, label] of Object.entries(CONFIG.ARS.abilityTypes)) {
        if (key === "none") continue;
        choices[`ability.${key}`] = game.i18n.localize(label);
      }

      for (const [key, label] of Object.entries(CONFIG.ARS.saveTypes)) {
        if (key === "none") continue;
        choices[`save.${key}`] = game.i18n.localize(label);
      }

      class CheckInput extends ARSCheckInput {
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
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      const [type, key] = inputs.check.split(".");

      if (options.fastForward) {
        const target = type === "ability"
          ? Number(actor.system.abilities[key]?.value ?? 10)
          : Number(actor.system.saves[key]?.value ?? 0);
        const roll = await new game.ars.ARSDice(actor).makeGenericRoll("d20", target, type === "ability" ? "descending" : "ascending", true);

        return normalizeRoll(roll);
      }

      let roll;
      switch (type) {
        case "ability":
          roll = await new game.ars.ARSDice(actor, null, { event: options.event }).makeAbilityCheckRollAsync(key, "d20");
          break;

        case "save":
          roll = await new game.ars.ARSDice(actor, null, { event: options.event }).makeSaveRollAsync(key);
          break;

        default:
          throw new Error(`Unsupported ARS check type: ${type}`);
      }

      return normalizeRoll(roll);
    },
    },
  };
};
