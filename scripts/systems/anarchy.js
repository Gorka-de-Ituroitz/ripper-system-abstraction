const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

export default async function anarchy() {

  class AnarchyCheckInput extends DataModel {
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

  const ANARCHY_ATTRIBUTES = ["strength", "agility", "willpower", "logic", "charisma", "edge"];

  async function rollDirect(anarchy, payload, options) {
    payload.parameters = anarchy.rollParameters.build(payload);
    const manager = anarchy.rollManager;
    if (options.silent) manager._displayRollInChat = async () => {};
    try {
      await manager.roll(payload);
    } finally {
      if (options.silent) delete manager._displayRollInChat;
    }
    return payload;
  }

  async function rollWithDialog(actor, type, key, payload) {
    let dialog = null;
    let closed = false;
    const onRender = (app) => { if (!dialog && app.roll !== undefined) dialog = app; };
    const onClose = (app) => { if (app === dialog) closed = true; };
    const hooks = [
      ["renderApplication", Hooks.on("renderApplication", onRender)],
      ["renderApplicationV2", Hooks.on("renderApplicationV2", onRender)],
      ["closeApplication", Hooks.on("closeApplication", onClose)],
      ["closeApplicationV2", Hooks.on("closeApplicationV2", onClose)],
    ];
    try {
      if (type === "attribute") await actor.rollAttribute(key);
      else await actor.rollSkill(payload.skill);
      for (let i = 0; !closed && (dialog || i < 50); i++) await new Promise((r) => setTimeout(r, 100));
      for (let i = 0; i < 30 && dialog && !dialog.roll?.roll; i++) await new Promise((r) => setTimeout(r, 100));
    } finally {
      for (const [name, id] of hooks) Hooks.off(name, id);
    }
    return dialog?.roll ?? null;
  }

  return {
    dataPaths: {
    actor: {
      type: "",
      subtype: "",
      size: "",
      level: "",
      role: "",
    },

    health: {
      current: "monitors.physical.value",
      maximum: "monitors.physical.max",
      temporary: "",
      minimum: "",

      useWounds: false,
      wounds: "",
      maximumWounds: "",

      invert: true,
    },

    item: {
      quantity: "",
      weight: "",

      equipped: "inactive",
      equippedValue: false,
      unequippedValue: true,
      attuned: "",

      uses: "",
      maximumUses: "",
    },

    currency: {
      base: "",

      actor: {
        denominations: {},
      },

      item: {
        single: {
          value: "",
          denomination: "",
        },

        denominations: {},
      },

      denominations: {},
    },

    experience: {
      current: "counters.karma.value",
      maximum: "",
    },

    overrides: {
      Actor: {
        vehicle: {
          health: { current: "monitors.structure.value", maximum: "monitors.structure.max" },
        },
      },
    },

    features: {
      supportsHealth: true,
      supportsTemporaryHealth: false,
      supportsWounds: false,
      supportsCurrency: false,
      supportsWeight: false,
      supportsEquipment: true,
    },
    },
    testsInterface: {
    resultType: "successes",
    buildInputs: () => {
      const choices = {};
      const group = {
        attribute: game.i18n.localize("ripper-system-abstraction.tests.Attribute"),
        skill: game.i18n.localize("ripper-system-abstraction.tests.Skill"),
      };

      for (const key of ANARCHY_ATTRIBUTES) {
        choices[`attribute.${key}`] = { label: game.i18n.localize(key), group: group.attribute };
      }

      const skills = game.system.anarchy?.skills?.getSkills?.({ withKnowledge: true }) ?? [];
      for (const skill of skills) {
        choices[`skill.${skill.code}`] = { label: game.i18n.localize(skill.labelkey ?? skill.code), group: group.skill };
      }

      class CheckInput extends AnarchyCheckInput {
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
      const anarchy = game.system.anarchy;
      const [type, key] = inputs.check.split(".");
      if (!actor.getUsableAttributes) {
        throw new Error(`Anarchy actors of type "${actor.type}" cannot perform checks.`);
      }

      const payload = {
        actor,
        tokenId: actor.token?.id,
        attributes: actor.getUsableAttributes(),
        options: { canUseEdge: actor.canUseEdge?.() ?? false },
        event: options.event,
      };

      if (type === "attribute") {
        if (!payload.attributes.includes(key)) {
          throw new Error(`This Anarchy actor cannot perform "${inputs.check}" checks.`);
        }
        payload.mode = "attribute";
        payload.attribute1 = key;
      } else if (type === "skill") {
        const skill = actor.items.find((i) => i.type === "skill" && i.system.code === key);
        if (!skill) throw new Error(`This Anarchy actor cannot perform "${inputs.check}" checks.`);
        payload.mode = "skill";
        payload.skill = skill;
        payload.attribute1 = skill.system.attribute ?? "agility";
      } else {
        throw new Error(`Unsupported Anarchy check type: ${type}`);
      }

      const rolled = options.fastForward ? await rollDirect(anarchy, payload, options) : await rollWithDialog(actor, type, key, payload);
      if (!rolled?.roll) {
        return { canceled: true, result: null, target: null, success: null, levelOfSuccess: null, criticalSuccess: false, criticalFailure: false };
      }

      const roll = rolled.roll;
      const hits = roll.total ?? 0;
      const pool = rolled.param?.pool ?? 0;
      return {
        canceled: false,
        result: hits,
        target: null,
        success: hits > 0,
        levelOfSuccess: pool > 0 ? Math.clamp(Math.round((hits / pool) * 100), 0, 100) : 0,
        criticalSuccess: (roll.riskProwess ?? 0) > 0,
        criticalFailure: (roll.totalGlitch ?? 0) > 0,
      };
    },
    },
  };
};
