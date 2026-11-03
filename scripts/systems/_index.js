import a5e from "./a5e.js";
import alienrpg from "./alienrpg.js";
import anarchy from "./anarchy.js";
import ars from "./ars.js";
import bitd from "./bitd.js";
import cairn2e from "./cairn2e.js";
import castlesAndCrusades from "./castles-and-crusades.js";
import CoC7 from "./CoC7.js";
import crucible from "./crucible.js";
import customSystemBuilder from "./custom-system-builder.js";
import cyberpunk2020 from "./cyberpunk2020.js";
import daggerheart from "./daggerheart.js";
import deltagreen from "./deltagreen.js";
import demonlord from "./demonlord.js";
import dnd4e from "./dnd4e.js";
import dnd5e from "./dnd5e.js";
import dsa5 from "./dsa5.js";
import earthdawn4e from "./earthdawn4e.js";
import exaltedthird from "./exaltedthird.js";
import fallout from "./fallout.js";
import gurps from "./gurps.js";
import impmal from "./impmal.js";
import pbta from "./pbta.js";
import pf2e from "./pf2e.js";
import sfrpg from "./sfrpg.js";
import shadowdark from "./shadowdark.js";
import shadowrun5e from "./shadowrun5e.js";
import starwarsffg from "./starwarsffg.js";
import swade from "./swade.js";
import vaesen from "./vaesen.js";
import wfrp4e from "./wfrp4e.js";
import wildtalents from "./wildtalents.js";
import worldbuilding from "./worldbuilding.js";

const factories = {
  a5e,
  alienrpg,
  anarchy,
  ars,
  bitd,
  cairn2e,
  "castles-and-crusades": castlesAndCrusades,
  CoC7,
  crucible,
  "custom-system-builder": customSystemBuilder,
  cyberpunk2020,
  daggerheart,
  deltagreen,
  demonlord,
  dnd4e,
  dnd5e,
  dsa5,
  earthdawn4e,
  exaltedthird,
  fallout,
  gurps,
  impmal,
  pbta,
  pf2e,
  sfrpg,
  shadowdark,
  shadowrun5e,
  starwarsffg,
  swade,
  vaesen,
  wfrp4e,
  wildtalents,
  worldbuilding,
};

const { DataModel } = foundry.abstract;
const fields = foundry.data.fields;

class DefaultFormulaInput extends DataModel {
  static defineSchema() {
    return {
      value: new fields.StringField({
        label: "ripper-system-abstraction.tests.Formula",
        required: true,
        blank: false,
      }),
    };
  }
}

class DefaultDCInput extends DataModel {
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

export const defaultTestsInterface = {
  resultType: "total",

  buildInputs: () => ({
    formula: DefaultFormulaInput,
    dc: DefaultDCInput,
  }),

  processCheck: async (actor, inputs, options = {}) => {
    const roll = await new foundry.dice.Roll(inputs.formula, actor.getRollData?.()).evaluate();
    if (!options.silent) await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });

    const target = Number.isNumeric(inputs.dc) ? inputs.dc : null;
    const success = target != null ? roll.total >= target : null;

    return {
      canceled: false,
      result: roll.total,
      target,
      success,
      levelOfSuccess: success == null ? null : success ? 100 : 0,
      criticalSuccess: false,
      criticalFailure: false,
    };
  },
};

let current = null;

/**
 * Load the adapter for a system by calling its factory (awaited). Only the
 * system's own factory function is invoked. Results are cached.
 *
 * @param {string} [systemId]  The Foundry system ID. Defaults to game.system.id.
 * @param {Function} [factory] Optional factory override (used by tests).
 * @returns {Promise<{dataPaths: Object, testsInterface: Object}|null>}
 */
export async function loadSystem(systemId = game.system.id, factory = factories[systemId]) {
  if (typeof factory !== "function") return null;
  current = await factory();
  return current;
}

/**
 * The currently loaded system adapter.
 *
 * @returns {{dataPaths: Object, testsInterface: Object}|null}
 */
export function getCurrentSystem() {
  return current;
}

/**
 * The loaded system's dataPaths, or null when not loaded.
 *
 * @returns {Object|null}
 */
export function getDataPaths() {
  return current?.dataPaths ?? null;
}

/**
 * The loaded system's tests interface, falling back to the shared default
 * (a generic roll-formula + dc check) when the system provides none.
 *
 * @returns {Object}
 */
export function getTestsInterface() {
  return current?.testsInterface ?? defaultTestsInterface;
}

/**
 * The registry of system factory functions, keyed by system ID.
 *
 * @returns {Object<string, Function>}
 */
export function getFactories() {
  return factories;
}
