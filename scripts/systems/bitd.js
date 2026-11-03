const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function bitd() {
  const { default: BitdRolls } = await import(/* webpackIgnore: true */ foundry.utils.getRoute("systems/bitd/module/applications/roll.mjs"));

  const canceled = { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };

  function normalize(rollResult) {
    const total = rollResult.total;
    const critical = rollResult.data?.countAs?.key === "critical";
    return {
      canceled: false,
      result: total,
      target: null,
      success: total >= 4,
      levelOfSuccess: total >= 6 ? 100 : total >= 4 ? 50 : 0,
      criticalSuccess: critical,
      criticalFailure: false,
    };
  }

  async function rollWithDialog(actor, type, key) {
    let rolled = null;
    const app = new BitdRolls({ actor, type, note: key });
    const original = app.roll.bind(app);
    app.roll = async (formData) => (rolled = await original(formData));
    await app.render(true);
    while (app.rendered) await new Promise((r) => setTimeout(r, 100));
    return rolled;
  }

  return {
    dataPaths: {
    actor: {
      type: "",
      subtype: "",
      size: "",
      level: "",
      role: (actor) => actor.items.find((item) => item.type === (actor.type === "crew" ? "crewType" : "playbook"))?.name,
    },

    health: {
      current: "",
      maximum: "",
      temporary: "",
      minimum: "",

      useWounds: false,
      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "",
      weight: "loadout",

      equipped: "equipped",
      attuned: "",

      uses: "",
      maximumUses: "",
    },

    currency: {
      base: "coin",

      actor: {
        denominations: {
          coin: "coins.value",
        },
      },

      item: {
        single: {
          value: "price",
          denomination: "",
        },

        denominations: {},
      },

      denominations: {
        coin: { value: 1 },
      },
    },

    experience: {
      current: "exp.value",
      maximum: "exp.max",
    },

    features: {
      supportsHealth: false,
      supportsTemporaryHealth: false,
      supportsWounds: false,
      supportsCurrency: true,
      supportsWeight: true,
      supportsEquipment: true,
    },
    },

    testsInterface: {
      resultType: "outcome",
      buildInputs: () => {
        const choices = {};
        const group = {
          action: game.i18n.localize(CONFIG.BITD.rolls.type.action),
          resistance: game.i18n.localize(CONFIG.BITD.rolls.type.resistance),
        };
        for (const [key, label] of Object.entries(CONFIG.BITD.rolls.actions)) {
          choices[`action.${key}`] = { label: game.i18n.localize(label), group: group.action };
        }
        for (const [key, label] of Object.entries(CONFIG.BITD.rolls.attributes)) {
          choices[`resistance.${key}`] = { label: game.i18n.localize(label), group: group.resistance };
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

        return { check: CheckInput };
      },

      processCheck: async (actor, inputs, options = {}) => {
        const [type, key] = inputs.check.split(".");
        const source = type === "action" ? actor.system.actions : actor.system.attributes;
        if (!source) throw new Error(`BitD actors of type "${actor.type}" cannot perform checks.`);
        if (!(key in source)) throw new Error(`Unknown BitD ${type}: ${key}`);

        if (!options.fastForward) {
          const rolled = await rollWithDialog(actor, type, key);
          return rolled ? normalize(rolled) : canceled;
        }

        const app = new BitdRolls({ actor, type, note: key });
        const formData = {
          rollType: type,
          action: key,
          attribute: key,
          diceNumber: source[key].value ?? 0,
          modifier: 0,
          position: "risky",
          effect: "standard",
          harm: "",
        };
        const rollResult = await app.roll(formData);
        rollResult.name = game.i18n.localize(app.rollConfig.type[type]);
        await (type === "action" ? app._actionRoll(rollResult, formData) : app._resistanceRoll(rollResult, formData));
        await app.renderRoll(rollResult);
        return normalize(rollResult);
      },
    },
  };
};
