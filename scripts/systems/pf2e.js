const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function pf2e() {

  class PF2ECheckInput extends DataModel {
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

  class PF2EDCInput extends DataModel {
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

  const DEGREE_TO_LEVEL = [0, 33, 66, 100];

  const price = (denomination) => ({
    get: (item) => (item.isOfType?.("treasure") && item.isCurrency ? undefined : item.system.price?.value?.[denomination]),
    set: (item, value) => ({ [`system.price.value.${denomination}`]: value }),
  });

  function normalizeRoll(roll, dc) {
    if (!roll) {
      return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
    }

    const degree = roll.degreeOfSuccess;
    const target = Number.isNumeric(dc) ? dc : null;

    return {
      canceled: false,
      result: roll.total,
      target,
      success: degree != null ? degree >= 2 : null,
      levelOfSuccess: degree != null ? DEGREE_TO_LEVEL[degree] : null,
      criticalSuccess: degree === 3,
      criticalFailure: degree === 0,
    };
  }

  function spellItemCategories(spell) {
    return Object.entries(CONFIG.PF2E.spellcastingItems ?? {}).filter(([, c]) => !!c?.cantripsOnly === spell.isCantrip);
  }

  function spellItemRanks(spell, category) {
    if (!category) return [];
    if (category.cantripsOnly) return category.compendiumUuids[1] ? [1] : [];
    return Object.keys(category.compendiumUuids).map(Number).filter((rank) => rank >= spell.baseRank && !!category.compendiumUuids[rank]);
  }

  async function consumableFromSpell(spell, { type, rank, mystified = false }) {
    const category = CONFIG.PF2E.spellcastingItems[type];
    const base = await fromUuid(category?.compendiumUuids[rank]);
    if (!base?.isOfType?.("consumable")) return null;
    const data = base.toObject();
    delete data._id;
    const traits = data.system.traits;
    traits.value = [...new Set([...traits.value, ...spell.system.traits.value])];
    traits.rarity = spell.rarity;
    const traditions = Object.keys(CONFIG.PF2E.magicTraditions);
    if (traits.value.includes("magical") && traits.value.some((t) => traditions.includes(t))) traits.value.splice(traits.value.indexOf("magical"), 1);
    traits.value.sort();
    data.name = category.nameTemplate
      ? game.i18n.format(category.nameTemplate, { name: spell.name, level: rank })
      : `${type} of ${spell.name} (Rank ${rank})`;
    const link = spell.sourceId ?? spell.uuid;
    data.system.description.value = `<p>@UUID[${link}]{${spell.name}}</p><hr />${data.system.description.value}`;
    if (!category.cantripsOnly) {
      data.system.spell = foundry.utils.mergeObject(spell._source, {
        _id: foundry.utils.randomID(),
        system: { location: { value: null, heightenedLevel: rank } },
      }, { inplace: false });
    }
    if (mystified) data.system.identification.status = "unidentified";
    return data;
  }

  async function itemFromSpell(spell, { dialog }) {
    const categories = spellItemCategories(spell);
    const firstRank = (type) => spellItemRanks(spell, CONFIG.PF2E.spellcastingItems[type])[0];
    if (!dialog) {
      const [type] = categories.find(([t]) => firstRank(t) != null) ?? [];
      return type ? consumableFromSpell(spell, { type, rank: firstRank(type) }) : null;
    }
    const { createFormGroup, createSelectInput, createCheckboxInput } = foundry.applications.fields;
    const rankOptions = (type) => spellItemRanks(spell, CONFIG.PF2E.spellcastingItems[type]).map((r) => ({ value: String(r), label: String(r) }));
    const [firstType] = categories[0] ?? [];
    const typeGroup = createFormGroup({
      label: "PF2E.SpellcastingItemCreator.ItemType",
      localize: true,
      input: createSelectInput({ name: "type", options: categories.map(([value, c]) => ({ value, label: c.name })), localize: true }),
    });
    const rankGroup = createFormGroup({
      label: "PF2E.Item.Spell.Rank.Label",
      localize: true,
      input: createSelectInput({ name: "rank", options: rankOptions(firstType) }),
    });
    rankGroup.hidden = !!CONFIG.PF2E.spellcastingItems[firstType]?.cantripsOnly;
    const mystifyGroup = createFormGroup({
      label: "PF2E.identification.Mystify",
      localize: true,
      input: createCheckboxInput({ name: "mystified" }),
    });
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: "PF2E.SpellcastingItemCreator.Title", icon: "fa-solid fa-scroll" },
      content: `<p>${game.i18n.format("PF2E.SpellcastingItemCreator.Label", { name: spell.name })}</p>${typeGroup.outerHTML}${rankGroup.outerHTML}${mystifyGroup.outerHTML}`,
      ok: { label: "PF2E.CreateItemTitle", icon: "fa-solid fa-plus" },
      render: (event, dialog) => {
        const form = dialog.element.querySelector("form");
        form.elements.type.addEventListener("change", () => {
          const type = form.elements.type.value;
          form.elements.rank.replaceChildren(...rankOptions(type).map(({ value, label }) => new Option(label, value)));
          form.elements.rank.closest(".form-group").hidden = !!CONFIG.PF2E.spellcastingItems[type]?.cantripsOnly;
        });
      },
      rejectClose: false,
    });
    if (!result) return null;
    const rank = Number(result.rank) || firstRank(result.type);
    if (rank == null) return null;
    return consumableFromSpell(spell, { type: result.type, rank, mystified: !!result.mystified });
  }

  return {
    dataPaths: {
    actor: {
      type: "traits.value",
      typeChoices: () => CONFIG.PF2E.creatureTraits,
      subtype: "",
      size: "traits.size.value",
      sizes: { tiny: 0.5, sm: 1, med: 1, lg: 2, huge: 3, grg: 4 },
      level: "details.level.value",
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
      weight: "bulk.value",

      equipped: {
        get: (item) => item.isEquipped,
        set: (item, value) => {
          if (!value) return { "system.equipped.carryType": "worn", "system.equipped.handsHeld": 0, "system.equipped.inSlot": false };
          const usage = item.system.usage;
          if (usage?.type === "held") return { "system.equipped.carryType": "held", "system.equipped.handsHeld": usage.hands ?? 1 };
          return { "system.equipped.carryType": "worn", ...(usage?.where ? { "system.equipped.inSlot": true } : {}) };
        },
      },
      equippable: (item) => !!item.actor && item.isOfType?.("physical") && item.system.usage?.type !== "carried" && !item.actor?.isOfType("loot", "party"),
      attuned: "equipped.invested",
      attunable: (item) => item.system.equipped?.invested != null,

      uses: "uses.value",
      maximumUses: "uses.max",

      fromSpell: {
        isSpell: (item) => item.type === "spell" && !item.isRitual && spellItemCategories(item).length > 0,
        create: itemFromSpell,
      },
    },

    currency: {
      base: "cp",

      actor: {
        denominations: {
          cp: "currency.cp",
          sp: "currency.sp",
          gp: "currency.gp",
          pp: "currency.pp",
        },
        handler: {
          get: (actor) => {
            if (!actor.allowedItemTypes?.includes("physical")) return {};
            const coins = actor.inventory.currency;
            return { cp: coins.cp, sp: coins.sp, gp: coins.gp, pp: coins.pp };
          },
          set: async (actor, amounts) => {
            const coins = actor.inventory.currency;
            const add = {};
            const remove = {};
            for (const [name, target] of Object.entries(amounts)) {
              const delta = target - (coins[name] ?? 0);
              if (delta > 0) add[name] = delta;
              else if (delta < 0) remove[name] = -delta;
            }
            if (Object.keys(remove).length) await actor.inventory.removeCurrency(remove, { byValue: false });
            if (Object.keys(add).length) await actor.inventory.addCurrency(add, { combineStacks: true });
          },
        },
      },

      item: {
        single: {
          value: "",
          denomination: "",
        },

        denominations: { cp: price("cp"), sp: price("sp"), gp: price("gp"), pp: price("pp") },
      },

      denominations: {
        cp: { value: 1, abbreviation: "PF2E.CurrencyAbbreviations.cp" },
        sp: { value: 10, abbreviation: "PF2E.CurrencyAbbreviations.sp" },
        gp: { value: 100, abbreviation: "PF2E.CurrencyAbbreviations.gp" },
        pp: { value: 1000, abbreviation: "PF2E.CurrencyAbbreviations.pp" },
      },
    },

    experience: {
      current: "details.xp.value",
      maximum: "details.xp.max",
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

      for (const [slug, value] of Object.entries(CONFIG.PF2E.skills)) {
        choices[`skill.${slug}`] = game.i18n.localize(value.label);
      }

      for (const save of ["fortitude", "reflex", "will"]) {
        choices[`save.${save}`] = game.i18n.localize(`PF2E.Saves${save.capitalize()}`);
      }

      choices["perception"] = game.i18n.localize("PF2E.PerceptionCheck");

      class CheckInput extends PF2ECheckInput {
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
        dc: PF2EDCInput,
      };
    },

    processCheck: async (actor, inputs, options = {}) => {
      const [type, key] = inputs.check.split(".");
      const rollOptions = {
        skipDialog: options.fastForward ?? false,
        event: options.event,
      };
      if (inputs.dc != null) rollOptions.dc = inputs.dc;

      if (!["skill", "save", "perception"].includes(type)) throw new Error(`Unsupported PF2E check type: ${type}`);
      const statistic = type === "perception" ? actor.perception : actor.getStatistic?.(key);
      if (!statistic) {
        if (!actor.perception && !actor.saves) throw new Error(`PF2E actors of type "${actor.type}" cannot perform checks.`);
        throw new Error(`This PF2E actor cannot perform "${inputs.check}" checks.`);
      }
      const roll = await statistic.roll(rollOptions);

      return normalizeRoll(roll, inputs.dc);
    },
    },
  };
};
