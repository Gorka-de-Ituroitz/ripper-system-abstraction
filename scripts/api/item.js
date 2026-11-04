import {
  resolveDataPaths,
  getPath,
  setPath,
  executeUpdate,
  unsupported,
} from "./core.js";

function itemConfig(dp) {
  return dp.item ?? {};
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function writeQuantity(item, compute, operation, options) {
  const cfg = itemConfig(resolveDataPaths(item));
  if (!cfg.quantity) throw unsupported(item, operation, "no quantity path");
  const target = compute(numeric(getPath(item, cfg.quantity)) ?? 0);
  if (target > 1 && typeof cfg.stackable === "function" && !cfg.stackable(item)) {
    throw unsupported(item, operation, "item is not stackable");
  }
  return executeUpdate(item, setPath(item, cfg.quantity, target), options);
}

const STATES = {
  equipped: { feature: "supportsEquipment", allowed: "equippable", on: "equippedValue", off: "unequippedValue" },
  attuned: { feature: "supportsAttunement", allowed: "attunable", on: "attunedValue", off: "unattunedValue" },
};

function stateSpec(item, dp, key) {
  const state = STATES[key];
  const cfg = itemConfig(dp);
  if (dp.features?.[state.feature] !== true || !cfg[key]) return null;
  if (typeof cfg[state.allowed] === "function" && !cfg[state.allowed](item)) return null;
  return getPath(item, cfg[key]) == null ? null : cfg[key];
}

/**
 * Interpret a toggle state (equipped/attuned) of an item. Boolean paths need
 * no metadata; numeric and string enum paths use the optional
 * `equippedValue`/`attunedValue` hints declared on the adapter. A numeric
 * hint is an inclusive threshold; a string or boolean is matched exactly
 * (a boolean hint allows inverted flags such as `inactive: false`).
 */
function readState(item, key) {
  const dp = resolveDataPaths(item);
  const spec = stateSpec(item, dp, key);
  if (!spec) return null;
  const current = getPath(item, spec);
  const hint = itemConfig(dp)[STATES[key].on];
  if (typeof current === "boolean") return typeof hint === "boolean" ? current === hint : current;
  if (typeof current === "number") return current >= (typeof hint === "number" ? hint : 1);
  return current === (typeof hint === "string" ? hint : key);
}

function writeState(item, key, enabled, operation, options) {
  const dp = resolveDataPaths(item);
  const spec = stateSpec(item, dp, key);
  if (!spec) throw unsupported(item, operation, `item has no ${key} state`);
  const state = STATES[key];
  const value = enabled ? (itemConfig(dp)[state.on] ?? true) : (itemConfig(dp)[state.off] ?? false);
  return executeUpdate(item, setPath(item, spec, value), options);
}

/**
 * Item quantity, equipment, attunement, weight, and uses/charges operations. Uses
 * `dataPaths.item` and `features` and never references system-specific paths
 * directly.
 */
export const item = {
  // ---------------------------------------------------------------
  // Quantity
  // ---------------------------------------------------------------

  /**
   * The Item's current quantity.
   *
   * @param {Item} item
   * @returns {number|null}
   */
  getQuantity(item) {
    const spec = itemConfig(resolveDataPaths(item)).quantity;
    return spec ? (getPath(item, spec) ?? null) : null;
  },

  /**
   * @param {Item} item
   * @param {number} quantity
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Item|Object<string,*>>}
   */
  setQuantity(item, quantity, options = {}) {
    return writeQuantity(item, () => quantity, "item.setQuantity", options);
  },

  /**
   * @param {Item} item
   * @param {number} amount
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Item|Object<string,*>>}
   */
  addQuantity(item, amount, options = {}) {
    return writeQuantity(item, (current) => current + amount, "item.addQuantity", options);
  },

  /**
   * @param {Item} item
   * @param {number} amount
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Item|Object<string,*>>}
   */
  removeQuantity(item, amount, options = {}) {
    return writeQuantity(item, (current) => Math.max(0, current - amount), "item.removeQuantity", options);
  },

  /**
   * Whether the Item can hold a quantity greater than one. Returns null when
   * the Item has no quantity.
   *
   * @param {Item} item
   * @returns {boolean|null}
   */
  isStackable(item) {
    const cfg = itemConfig(resolveDataPaths(item));
    if (!cfg.quantity || getPath(item, cfg.quantity) == null) return null;
    return typeof cfg.stackable === "function" ? !!cfg.stackable(item) : true;
  },

  // ---------------------------------------------------------------
  // Equipment
  // ---------------------------------------------------------------

  /**
   * Whether the Item is equipped. Returns null when the system or this Item
   * has no equipped state.
   *
   * @param {Item} item
   * @returns {boolean|null}
   */
  isEquipped(item) {
    return readState(item, "equipped");
  },

  /**
   * @param {Item} item
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Item|Object<string,*>>}
   */
  equip(item, options = {}) {
    return writeState(item, "equipped", true, "item.equip", options);
  },

  /**
   * @param {Item} item
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Item|Object<string,*>>}
   */
  unequip(item, options = {}) {
    return writeState(item, "equipped", false, "item.unequip", options);
  },

  /**
   * @param {Item} item
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Item|Object<string,*>>}
   */
  toggleEquipped(item, options = {}) {
    return writeState(item, "equipped", !readState(item, "equipped"), "item.toggleEquipped", options);
  },

  // ---------------------------------------------------------------
  // Attunement
  // ---------------------------------------------------------------

  /**
   * Whether the Item is attuned (bonded, linked) to its Actor. Returns null
   * when the system or this Item has no attunement state.
   *
   * @param {Item} item
   * @returns {boolean|null}
   */
  isAttuned(item) {
    return readState(item, "attuned");
  },

  /**
   * @param {Item} item
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Item|Object<string,*>>}
   */
  attune(item, options = {}) {
    return writeState(item, "attuned", true, "item.attune", options);
  },

  /**
   * @param {Item} item
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Item|Object<string,*>>}
   */
  unattune(item, options = {}) {
    return writeState(item, "attuned", false, "item.unattune", options);
  },

  // ---------------------------------------------------------------
  // Weight
  // ---------------------------------------------------------------

  /**
   * The weight of a single unit of the Item, in the system's own unit.
   * Returns null when unsupported.
   *
   * @param {Item} item
   * @returns {number|null}
   */
  getWeight(item) {
    const dp = resolveDataPaths(item);
    if (dp.features?.supportsWeight !== true) return null;
    return numeric(getPath(item, itemConfig(dp).weight));
  },

  /**
   * The weight of the whole stack (unit weight x quantity). Returns null when
   * unsupported.
   *
   * @param {Item} item
   * @returns {number|null}
   */
  getTotalWeight(item) {
    const dp = resolveDataPaths(item);
    if (dp.features?.supportsWeight !== true) return null;
    const weight = numeric(getPath(item, itemConfig(dp).weight));
    if (weight == null) return null;
    return weight * (numeric(getPath(item, itemConfig(dp).quantity)) ?? 1);
  },

  // ---------------------------------------------------------------
  // Uses / Charges
  // ---------------------------------------------------------------

  /**
   * The Item's current remaining uses/charges.
   *
   * @param {Item} item
   * @returns {number|null}
   */
  getUses(item) {
    const dp = resolveDataPaths(item);
    const cfg = itemConfig(dp);
    if (cfg.usesSpent) {
      const maximum = numeric(cfg.maximumUses ? getPath(item, cfg.maximumUses) : null);
      const spent = numeric(getPath(item, cfg.usesSpent)) ?? 0;
      return maximum != null ? maximum - spent : null;
    }
    const spec = cfg.uses;
    if (!spec) return null;
    if (cfg.maximumUses && !(numeric(getPath(item, cfg.maximumUses)) > 0)) return null;
    return numeric(getPath(item, spec));
  },

  /**
   * The Item's maximum uses/charges.
   *
   * @param {Item} item
   * @returns {number|null}
   */
  getMaximumUses(item) {
    const spec = itemConfig(resolveDataPaths(item)).maximumUses;
    return spec ? numeric(getPath(item, spec)) : null;
  },

  /**
   * @param {Item} item
   * @param {number} value
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Item|Object<string,*>>}
   */
  setUses(item, value, options = {}) {
    const dp = resolveDataPaths(item);
    const cfg = itemConfig(dp);
    if (cfg.usesSpent) {
      const maximum = numeric(cfg.maximumUses ? getPath(item, cfg.maximumUses) : null);
      const spent = maximum != null ? Math.max(0, Math.min(maximum, maximum - value)) : value;
      return executeUpdate(item, setPath(item, cfg.usesSpent, spent), options);
    }
    const spec = cfg.uses;
    if (!spec) throw unsupported(item, "item.setUses", "no uses path");
    return executeUpdate(item, setPath(item, spec, value), options);
  },

  /**
   * Consume uses, never dropping below zero.
   *
   * @param {Item} item
   * @param {number} amount
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Item|Object<string,*>>}
   */
  consumeUses(item, amount, options = {}) {
    const dp = resolveDataPaths(item);
    const cfg = itemConfig(dp);
    if (cfg.usesSpent) {
      const maximum = numeric(cfg.maximumUses ? getPath(item, cfg.maximumUses) : null);
      const spent = numeric(getPath(item, cfg.usesSpent)) ?? 0;
      const next = maximum != null ? Math.min(maximum, spent + amount) : spent + amount;
      return executeUpdate(item, setPath(item, cfg.usesSpent, next), options);
    }
    const spec = cfg.uses;
    if (!spec) throw unsupported(item, "item.consumeUses", "no uses path");
    const current = numeric(getPath(item, spec)) ?? 0;
    return executeUpdate(item, setPath(item, spec, Math.max(0, current - amount)), options);
  },

  /**
   * Restore uses to maximum.
   *
   * @param {Item} item
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Item|Object<string,*>>}
   */
  restoreUses(item, options = {}) {
    const dp = resolveDataPaths(item);
    const cfg = itemConfig(dp);
    if (cfg.usesSpent) {
      return executeUpdate(item, setPath(item, cfg.usesSpent, 0), options);
    }
    const usesSpec = cfg.uses;
    const maximumSpec = cfg.maximumUses;
    if (!usesSpec || !maximumSpec) {
      throw unsupported(item, "item.restoreUses", "requires uses and maximumUses paths");
    }
    const maximum = getPath(item, maximumSpec);
    return executeUpdate(item, setPath(item, usesSpec, maximum), options);
  },

  // ---------------------------------------------------------------
  // Items from spells
  // ---------------------------------------------------------------

  /**
   * Whether the system can turn this Item (a spell) into another item, such
   * as a scroll, wand or potion.
   *
   * @param {Item} item
   * @returns {boolean}
   */
  canCreateFromSpell(item) {
    const cfg = itemConfig(resolveDataPaths(item)).fromSpell;
    return !!cfg && !!cfg.isSpell(item);
  },

  /**
   * Create item data from a spell the way the system does when a spell is
   * dropped into an inventory (e.g. a spell scroll), showing the system's
   * own choices unless `options.dialog` is false. Nothing is created.
   *
   * @param {Item} spell
   * @param {Object} [options]
   * @param {boolean} [options.dialog=true]
   * @returns {Promise<Object|Item|null>} The new item's source data, the
   *   spell itself when the user chose to keep it as a spell, or null when
   *   the user canceled.
   */
  async createFromSpell(spell, options = {}) {
    const cfg = itemConfig(resolveDataPaths(spell)).fromSpell;
    if (!cfg?.isSpell(spell)) throw unsupported(spell, "item.createFromSpell", "item is not a supported spell");
    return (await cfg.create(spell, { dialog: true, ...options })) ?? null;
  },
};
