const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function dnd5e() {
  const toolNames = new Map();
  try {
    const toolPack = game.packs?.get?.("dnd5e.equipment24");
    if (toolPack) {
      if (!toolPack.indexed) await toolPack.getIndex();
      for (const entry of toolPack.index.values()) toolNames.set(entry._id, entry.name);
    }
  } catch (err) {}


  class DND5ECheckInput extends DataModel {
    static defineSchema() {
      return {
        value: new fields.StringField({
          label: "ripper-system-abstraction.tests.Check",
          required: true,
        }),
      };
    }
  }

  class DND5EDCInput extends DataModel {
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

  function normalizeRoll(roll, dc) {
    if (!roll) {
      return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
    }

    const target = Number.isNumeric(dc) ? dc : null;
    const criticalSuccess = roll.isCritical === true;
    const criticalFailure = roll.isFumble === true;
    const success = target != null ? roll.total >= target : null;

    return {
      canceled: false,
      result: roll.total,
      target,
      success,
      levelOfSuccess: success == null ? null : success ? 100 : 0,
      criticalSuccess,
      criticalFailure,
    };
  }

  return {
    dataPaths: {
    actor: {
      type: (actor) => {
        const type = actor.system.details?.type;
        return type?.value === "custom" ? type.custom : type?.value;
      },
      typeChoices: () => CONFIG.DND5E.creatureTypes,
      subtype: "details.type.subtype",
      size: "traits.size",
      sizes: () => Object.fromEntries(Object.entries(CONFIG.DND5E.actorSizes).map(([key, size]) => [key, size.token ?? 1])),
      level: "details.level",
      role: "",
    },

    health: {
      current: "attributes.hp.value",
      maximum: "attributes.hp.max",
      temporary: "attributes.hp.temp",
      minimum: "",

      wounds: "",
      maximumWounds: "",
    },

    item: {
      quantity: "quantity",
      stackable: (item) => item.type !== "container",
      weight: "weight.value",

      equipped: "equipped",
      attuned: "attuned",
      attunable: (item) => !!item.system.attunement,

      uses: "uses.value",
      usesSpent: "uses.spent",
      maximumUses: "uses.max",
    },

    currency: {
      base: "gp",

      actor: {
        denominations: {
          cp: "currency.cp",
          sp: "currency.sp",
          ep: "currency.ep",
          gp: "currency.gp",
          pp: "currency.pp",
        },
      },

      item: {
        single: {
          value: {
            get: (item) => (item.type === "facility" && item.system.type?.value === "basic" ? undefined : item.system.price?.value),
            set: (item, value) => ({ "system.price.value": value }),
          },
          denomination: "price.denomination",
        },

        denominations: {},
      },

      denominations: Object.fromEntries(Object.entries(CONFIG.DND5E.currencies).map(([key, entry]) => [key, {
        value: 1 / entry.conversion,
        label: entry.label,
        icon: entry.icon ?? null,
        change: key !== "ep",
      }])),
    },

    experience: {
      current: "details.xp.value",
      maximum: "details.xp.max",
    },

    overrides: {
      Actor: {
        npc: {
          actor: { level: "details.cr" },
          experience: { current: "", maximum: "" },
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
      supportsAttunement: true,
    },
    },
    testsInterface: {
    resultType: "total",
    supportsAdvantage: true,
    buildInputs: () => {
      const choices = {};
      const group = {
        abilityCheck: game.i18n.localize("ripper-system-abstraction.tests.AbilityCheck"),
        savingThrow: game.i18n.localize("DND5E.SavingThrow"),
        skill: game.i18n.localize("DND5E.Skill"),
        tool: game.i18n.localize("ripper-system-abstraction.tests.Tool"),
      };

      for (const [key, value] of Object.entries(CONFIG.DND5E.abilities)) {
        choices[`check.${key}`] = { label: value.label, group: group.abilityCheck };
        choices[`save.${key}`] = { label: value.label, group: group.savingThrow };
      }

      choices["save.death"] = { label: game.i18n.localize("DND5E.DeathSave"), group: group.savingThrow };

      for (const [key, value] of Object.entries(CONFIG.DND5E.skills)) {
        choices[`skill.${key}`] = { label: value.label, group: group.skill };
      }

      const tools = Object.entries({ ...CONFIG.DND5E.toolProficiencies, ...CONFIG.DND5E.vehicleTypes })
        .map(([key, label]) => ({ key, label: game.i18n.localize(label) }));
      for (const [key, entry] of Object.entries(CONFIG.DND5E.tools ?? {})) {
        if (!entry || typeof entry !== "object" || !entry.id) continue;
        const toolId = String(entry.id).split(".").at(-1);
        tools.push({ key, label: toolNames.get(toolId) ?? key });
      }
      tools.sort((a, b) => a.label.localeCompare(b.label));
      for (const { key, label } of tools) choices[`tool.${key}`] = { label, group: group.tool };

      class CheckInput extends DND5ECheckInput {
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
        dc: DND5EDCInput,
      };
    },

    rollInitiative: async (actor, combatant, options = {}) => {
      const roller = combatant.actor ?? actor;
      if (options.advantage || options.disadvantage) {
        roller._cachedInitiativeRoll = roller.getInitiativeRoll({ advantage: !!options.advantage, disadvantage: !!options.disadvantage });
      }
      try {
        await combatant.combat.rollInitiative([combatant.id], { updateTurn: false });
      } finally {
        delete roller._cachedInitiativeRoll;
      }
    },

    processCheck: async (actor, inputs, options = {}) => {
      const [type, key] = inputs.check.split(".");
      const config = { event: options.event };
      if (options.advantage || options.disadvantage) {
        config.rolls = [{ options: { advantage: !!options.advantage, disadvantage: !!options.disadvantage } }];
      }
      const dialog = options.fastForward ? { configure: false } : {};
      const message = options.silent ? { create: false } : {};

      const unsupported = type === "skill" ? !actor.system.skills?.[key] : type === "tool" ? !actor.system.tools : type === "save" ? (key === "death" ? !actor.system.attributes?.death : !actor.system.abilities) : false;
      if (unsupported) throw new Error(`This D&D 5e actor cannot perform "${inputs.check}" checks.`);

      let rolls;
      switch (type) {
        case "skill":
          rolls = await actor.rollSkill({ skill: key, ...config }, dialog, message);
          break;

        case "save":
          if (key === "death") {
            rolls = await actor.rollDeathSave(config, dialog, message);
          } else {
            rolls = await actor.rollSavingThrow({ ability: key, ...config }, dialog, message);
          }
          break;

        case "check":
          rolls = await actor.rollAbilityCheck({ ability: key, ...config }, dialog, message);
          break;

        case "tool":
          rolls = await actor.rollToolCheck({ tool: key, ...config }, dialog, message);
          break;

        default:
          throw new Error(`Unsupported D&D 5e check type: ${type}`);
      }

      return normalizeRoll(rolls?.[0], inputs.dc);
    },
    },
  };
};
