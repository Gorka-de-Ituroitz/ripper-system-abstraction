const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function a5e() {

  function scrollFromSpell(spell) {
    const { attackBonus, cost, craftingComponent, saveDC, rarity } = CONFIG.A5E.scrollData[spell.system.level];
    const effects = [];
    const actions = {};
    for (const source of spell.actions.values()) {
      const action = { ...source };
      action.effects = [...(source.effects ?? [])].flatMap((id) => {
        const effect = spell.effects.get(id)?.toObject();
        if (!effect) return [];
        effect._id = foundry.utils.randomID();
        effects.push(effect);
        return [effect._id];
      });
      action.prompts = Object.fromEntries(Object.entries(action.prompts ?? {}).map(([id, prompt]) => {
        const copy = { ...prompt };
        if (copy.type === "savingThrow") copy.saveDC = { ...copy.saveDC, type: "custom", bonus: saveDC };
        return [id, copy];
      }));
      action.rolls = Object.fromEntries(Object.entries(action.rolls ?? {}).map(([id, roll]) => {
        const copy = { ...roll };
        if (copy.type === "attack") Object.assign(copy, { ability: "none", bonus: String(attackBonus) });
        delete copy.scaling;
        return [id, copy];
      }));
      action.consumers = { [foundry.utils.randomID()]: { itemId: "", quantity: 1, type: "quantity" } };
      actions[foundry.utils.randomID()] = action;
    }
    return {
      name: `Spell Scroll (${spell.name})`,
      img: "icons/sundries/scrolls/scroll-writing-brown-gold.webp",
      type: "object",
      effects,
      system: {
        actions,
        craftingComponents: craftingComponent,
        description: spell.system.description,
        price: { value: cost.value, denomination: cost.denomination, special: "" },
        objectType: "consumable",
        rarity,
      },
    };
  }

  class A5ECheckInput extends DataModel {
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

  class A5EDCInput extends DataModel {
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

  function normalizeRoll(message, dc) {
    if (!message) {
      return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
    }

    const roll = message.rolls?.[0];
    const d20 = roll?.dice?.[0];
    const active = d20?.results?.filter((r) => r.active) ?? [];
    const criticalSuccess = active.some((r) => r.result >= 20);
    const criticalFailure = active.some((r) => r.result === 1);
    const target = Number.isNumeric(dc) ? dc : null;
    const success = target != null ? roll.total >= target : null;

    return {
      canceled: false,
      result: roll?.total ?? null,
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
      type: "details.creatureTypes",
      typeChoices: () => CONFIG.A5E.creatureTypes,
      subtype: "",
      size: "traits.size",
      sizes: () => CONFIG.A5E.tokenDimensions,
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
      weight: "weight",

      equipped: "equippedState",
      equippedValue: 2,
      unequippedValue: 0,
      attuned: "attuned",
      attunable: (item) => item.system.requiresAttunement === true,

      uses: "uses.value",
      maximumUses: "uses.max",

      fromSpell: {
        isSpell: (item) => item.type === "spell" && !!CONFIG.A5E.scrollData?.[item.system.level],
        create: async (spell) => scrollFromSpell(spell),
      },
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
          cr: "currency.cr",
        },
      },

      item: {
        single: {
          value: "price.value",
          denomination: "price.denomination",
        },

        denominations: {},
      },

      denominations: Object.fromEntries(Object.entries(CONFIG.A5E.currencyDenominations).map(([key, label]) => [key, {
        value: CONFIG.A5E.currencyToCopper[key](1) / 100,
        label,
        change: !["ep", "cr"].includes(key),
      }])),
    },

    experience: {
      current: "details.xp",
      maximum: "",
    },

    overrides: {
      Actor: {
        npc: {
          actor: { level: "details.cr" },
          experience: { current: "" },
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
    buildInputs: () => {
      const choices = {};
      const group = {
        abilityCheck: game.i18n.localize("ripper-system-abstraction.tests.AbilityCheck"),
        savingThrow: game.i18n.localize("ripper-system-abstraction.tests.SavingThrow"),
        skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
      };

      for (const [key, value] of Object.entries(CONFIG.A5E.abilities)) {
        choices[`check.${key}`] = { label: game.i18n.localize(value), group: group.abilityCheck };
        choices[`save.${key}`] = { label: game.i18n.localize(value), group: group.savingThrow };
      }

      choices["save.death"] = { label: game.i18n.localize("A5E.deathSavingThrow.title"), group: group.savingThrow };

      for (const [key, value] of Object.entries(CONFIG.A5E.skills)) {
        choices[`skill.${key}`] = { label: game.i18n.localize(value), group: group.skill };
      }

      class CheckInput extends A5ECheckInput {
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
        dc: A5EDCInput,
      };
    },

    initiativeOptions: (options = {}) => ({ rollOptions: { skipRollDialog: options.fastForward ?? false } }),

    processCheck: async (actor, inputs, options = {}) => {
      const [type, key] = inputs.check.split(".");
      const rollOptions = {
        skipRollDialog: options.fastForward ?? false,
        event: options.event,
      };

      if (!actor.system.abilities) {
        throw new Error(`A5E actors of type "${actor.type}" cannot perform checks.`);
      }

      const unsupported = type === "skill" ? !actor.system.skills?.[key] : type === "save" && key === "death" && !actor.system.attributes?.death;
      if (unsupported) throw new Error(`This A5E actor cannot perform "${inputs.check}" checks.`);

      let message;
      switch (type) {
        case "skill":
          message = await actor.rollSkillCheck(key, rollOptions);
          break;

        case "save":
          if (key === "death") {
            message = await actor.rollSavingThrow(undefined, {
              ...rollOptions,
              saveType: "death",
            });
          } else {
            message = await actor.rollSavingThrow(key, rollOptions);
          }
          break;

        case "check":
          message = await actor.rollAbilityCheck(key, rollOptions);
          break;

        default:
          throw new Error(`Unsupported A5E check type: ${type}`);
      }

      return normalizeRoll(message ?? options.suppressedMessages?.at(-1), inputs.dc);
    },
    },
  };
};
