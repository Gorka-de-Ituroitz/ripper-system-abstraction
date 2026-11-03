const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function CoC7() {
  try {
    const skillPack = game.packs?.get?.("CoC7.skills");
    if (skillPack && !skillPack.indexed) await skillPack.getIndex();
  } catch (err) {}

  class CoC7CheckInput extends DataModel {
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

  class CoC7DCInput extends DataModel {
    static defineSchema() {
      return {
        value: new fields.StringField({
          label: "ripper-system-abstraction.tests.Difficulty",
          required: true,
          initial: "regular",
          choices: {
            regular: game.i18n.localize("CoC7.RollDifficultyRegular"),
            hard: game.i18n.localize("CoC7.RollDifficultyHard"),
            extreme: game.i18n.localize("CoC7.RollDifficultyExtreme"),
            critical: game.i18n.localize("CoC7.RollDifficultyCritical"),
          },
        }),
      };
    }
  }

  const SUCCESS_LEVEL_MAP = { 4: 100, 3: 75, 2: 50, 1: 25, 0: 0, "-99": 0 };

  return {
    dataPaths: {
  actor: {
    type: "infos.type",
    subtype: "",
    size: "characteristics.siz.value",
    level: "",
    role: "",
  },

  health: {
    current: "attribs.hp.value",
    maximum: "attribs.hp.max",
    temporary: "",
    minimum: "",

    useWounds: false,
    wounds: "",
    maximumWounds: "",
  },

  item: {
    quantity: "quantity",
    weight: "weight",

    equipped: "",
    attuned: "",

    uses: "ammo",
    maximumUses: "bullets",
  },

  currency: {
    base: "cash",

    actor: {
      denominations: { cash: "monetary.cash" },
    },

    item: {
      single: {
        value: "",
        denomination: "",
      },

      denominations: {},
    },

    denominations: {

      cash: { value: 1, label: "CoC7.MonetaryCash" },

    },
  },

  experience: {
    current: "",
    maximum: "",
  },

  features: {
    supportsHealth: true,
    supportsTemporaryHealth: false,
    supportsWounds: false,
    supportsCurrency: true,
    supportsWeight: true,
    supportsEquipment: false,
  },
    },
    testsInterface: {
  resultType: "rollUnder",
  buildInputs: () => {
    const choices = {};
    const group = {
      characteristic: game.i18n.localize("ripper-system-abstraction.tests.Characteristic"),
      attribute: game.i18n.localize("ripper-system-abstraction.tests.Attribute"),
      skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
    };

    const characterSchema = CONFIG.Actor.dataModels.character?.schema;
    const characteristicFields = Object.values(characterSchema?.get("characteristics")?.fields ?? {});
    for (const field of characteristicFields) {
      choices[`characteristic.${field.name}`] = { label: game.i18n.localize(field.hint), group: group.characteristic };
    }

    const attribFields = Object.values(characterSchema?.get("attribs")?.fields ?? {});
    for (const field of attribFields) {
      if (!["lck", "san"].includes(field.name)) continue;
      choices[`attribute.${field.name}`] = { label: game.i18n.localize(field.hint), group: group.attribute };
    }

    const pack = game.packs.get("CoC7.skills");
    if (pack?.indexed) {
      const index = pack.index instanceof Map ? pack.index.values() : pack.index;
      for (const entry of index) {
        if (entry.type === "skill") choices[`skill.${entry.name}`] = { label: entry.name, group: group.skill };
      }
    }

    class CheckInput extends CoC7CheckInput {
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
      dc: CoC7DCInput,
    };
  },

  processCheck: async (actor, inputs, options = {}) => {
    const [type, key] = inputs.check.split(".");
    const DIFFICULTY_LEVELS = { regular: 1, hard: 2, extreme: 3, critical: 4 };
    const difficulty = DIFFICULTY_LEVELS[inputs.dc] ?? 1;

    let value;
    let label = key;
    if (type === "characteristic") {
      value = actor.system.characteristics?.[key]?.value;
      label = game.i18n.localize(actor.system.schema?.getField("characteristics")?.getField(key)?.hint ?? key);
    } else if (type === "attribute") {
      value = actor.system.attribs?.[key]?.value;
      label = game.i18n.localize(actor.system.schema?.getField("attribs")?.getField(key)?.hint ?? key);
    } else if (type === "skill") {
      value = actor.items.find((i) => i.type === "skill" && i.name === key)?.system?.value ?? 0;
    } else {
      throw new Error(`Unsupported CoC7 check type: ${type}`);
    }

    if (typeof value !== "number") {
      if (!actor.system.characteristics) throw new Error(`CoC7 actors of type "${actor.type}" cannot perform checks.`);
      throw new Error(`This CoC7 actor cannot perform "${inputs.check}" checks.`);
    }

    const regular = value;
    const hard = Math.floor(value / 2);
    const extreme = Math.floor(value / 5);
    const effective = difficulty === 2 ? hard : difficulty === 3 ? extreme : difficulty === 4 ? 1 : regular;
    const fumbleAt = effective < 50 ? 96 : 100;

    const roll = await new Roll("1d100").evaluate();
    const total = roll.total;

    const successLevel =
      total >= fumbleAt ? -99
      : total === 1 ? (regular > 1 ? 4 : 1)
      : total <= extreme ? 3
      : total <= hard ? 2
      : total <= regular ? 1
      : 0;

    if (!options.silent) {
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: label,
      });
    }

    return {
      canceled: false,
      result: total,
      target: effective,
      success: successLevel >= difficulty,
      levelOfSuccess: SUCCESS_LEVEL_MAP[successLevel] ?? 0,
      criticalSuccess: successLevel === 4,
      criticalFailure: successLevel === -99,
    };
  },
},
  };
};
