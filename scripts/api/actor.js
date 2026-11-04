import { resolveDataPaths, getPath } from "./core.js";
import { getManualConfig } from "../manualConfig.js";

function actorConfig(dp) {
  return dp.actor ?? {};
}

function evaluate(value) {
  return typeof value === "function" ? value() : value;
}

function toList(value) {
  if (value instanceof Set) value = [...value];
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string" && entry);
  return typeof value === "string" && value ? [value] : [];
}

function toText(value) {
  return typeof value === "string" && value ? value : null;
}

function localizeLabel(value) {
  const label = typeof value === "object" && value ? value.label : value;
  return typeof label === "string" ? game.i18n.localize(label) : "";
}

/**
 * Actor classification and sizing. Uses `dataPaths.actor` and never
 * references system-specific paths directly.
 */
export const actor = {
  /**
   * The Actor's creature/entity types. Always an array, since some systems
   * allow several types at once (e.g. undead + humanoid). Types set through
   * the manual configuration (`creatureType` flag) are appended.
   *
   * @param {Actor} actor
   * @returns {string[]}
   */
  getTypes(actor) {
    const types = toList(getPath(actor, actorConfig(resolveDataPaths(actor)).type));
    const manual = toList(getManualConfig(actor, "creatureType"));
    return [...new Set([...types, ...manual])];
  },

  /**
   * Every creature/entity type declared by the game system, independent of
   * any Actor, plus any type manually configured on a world Actor.
   *
   * @returns {{id: string, label: string}[]}
   */
  getAllTypes() {
    const choices = evaluate(actorConfig(resolveDataPaths()).typeChoices) ?? {};
    const types = Object.entries(choices).map(([id, label]) => ({ id, label: localizeLabel(label) || id }));
    const known = new Set(types.map((type) => type.id));
    for (const actor of game.actors ?? []) {
      for (const id of toList(getManualConfig(actor, "creatureType"))) {
        if (known.has(id)) continue;
        known.add(id);
        types.push({ id, label: id });
      }
    }
    return types;
  },

  /**
   * The Actor's secondary classification, or null when unsupported.
   *
   * @param {Actor} actor
   * @returns {string|null}
   */
  getSubtype(actor) {
    return toText(getPath(actor, actorConfig(resolveDataPaths(actor)).subtype));
  },

  /**
   * The Actor's system-specific role, or null when unsupported.
   *
   * @param {Actor} actor
   * @returns {string|null}
   */
  getRole(actor) {
    return toText(getPath(actor, actorConfig(resolveDataPaths(actor)).role));
  },

  /**
   * The Actor's level, or null when unsupported.
   *
   * @param {Actor} actor
   * @returns {number|null}
   */
  getLevel(actor) {
    const value = getPath(actor, actorConfig(resolveDataPaths(actor)).level);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  },

  /**
   * The Actor's size in grid squares (e.g. 1 for a Medium creature, 2 for a
   * Large one). Falls back to the prototype token width when the system has
   * no size for this Actor.
   *
   * @param {Actor} actor
   * @returns {number|null}
   */
  getSize(actor) {
    const cfg = actorConfig(resolveDataPaths(actor));
    const value = getPath(actor, cfg.size);
    const squares = value != null ? evaluate(cfg.sizes)?.[value] : undefined;
    if (typeof squares === "number") return squares;
    return actor.prototypeToken?.width ?? null;
  },
};
