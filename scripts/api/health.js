import {
  resolveDataPaths,
  getPath,
  setPath,
  executeUpdate,
  unsupported,
} from "./core.js";

function healthConfig(dp) {
  return dp.health ?? {};
}

function isInverted(dp) {
  return healthConfig(dp).invert === true;
}

const warnedMissingPrimary = new WeakSet();

/**
 * The primary health track: "health" (`current`/`maximum`) or "wounds"
 * (`wounds`/`maximumWounds`). Inferred when only one track is mapped; when
 * both are, the adapter must set `health.primary`.
 *
 * @param {Object} dp
 * @returns {"health"|"wounds"|null}
 */
function primaryTrack(dp) {
  const cfg = healthConfig(dp);
  if (cfg.primary === "health" || cfg.primary === "wounds") return cfg.primary;
  const hasHealth = !!cfg.current;
  const hasWounds = !!cfg.wounds;
  if (hasHealth && hasWounds && !warnedMissingPrimary.has(cfg)) {
    warnedMissingPrimary.add(cfg);
    console.warn(
      `[Ripper System Abstraction] ${game.system.id} maps both health and wounds tracks but does not set health.primary; defaulting to "health".`,
    );
  }
  if (hasHealth) return "health";
  if (hasWounds) return "wounds";
  return null;
}

function isWoundMapped(dp) {
  return primaryTrack(dp) === "wounds";
}

function currentValue(actor, dp) {
  return getPath(actor, healthConfig(dp).current);
}

function maximumValue(actor, dp) {
  return getPath(actor, healthConfig(dp).maximum);
}

function temporaryValue(actor, dp) {
  return getPath(actor, healthConfig(dp).temporary);
}

function minimumValue(actor, dp) {
  return getPath(actor, healthConfig(dp).minimum);
}

function woundsValue(actor, dp) {
  return getPath(actor, healthConfig(dp).wounds);
}

function maximumWoundsValue(actor, dp) {
  return getPath(actor, healthConfig(dp).maximumWounds);
}

function numeric(value, fallback = null) {
  return typeof value === "number" ? value : fallback;
}

function effectiveCurrent(actor, dp) {
  const cfg = healthConfig(dp);
  if (!cfg.current) return null;
  const value = currentValue(actor, dp);
  if (value == null) return null;
  if (isInverted(dp)) {
    const maximum = numeric(maximumValue(actor, dp));
    return maximum != null ? Math.max(0, maximum - value) : value;
  }
  return value;
}

function effectiveTemporary(actor, dp) {
  return numeric(temporaryValue(actor, dp), 0);
}

/**
 * Normalized health operations. Uses `dataPaths.health` and never references
 * system-specific paths directly.
 */
export const health = {
  /**
   * The Actor's current primary health. Temporary health is not included.
   * Returns null when the system has no primary health track.
   *
   * @param {Actor} actor
   * @returns {number|null}
   */
  getCurrent(actor) {
    return effectiveCurrent(actor, resolveDataPaths(actor));
  },

  /**
   * The Actor's maximum primary health. Returns null when unsupported.
   *
   * @param {Actor} actor
   * @returns {number|null}
   */
  getMaximum(actor) {
    return numeric(maximumValue(actor, resolveDataPaths(actor)));
  },

  /**
   * The Actor's temporary health. Returns 0 when the system does not
   * support temporary health.
   *
   * @param {Actor} actor
   * @returns {number}
   */
  getTemporary(actor) {
    return effectiveTemporary(actor, resolveDataPaths(actor));
  },

  /**
   * The Actor's effective available health: current + temporary.
   *
   * @param {Actor} actor
   * @returns {number|null}
   */
  getTotal(actor) {
    const dp = resolveDataPaths(actor);
    const current = effectiveCurrent(actor, dp);
    if (current == null) return null;
    return current + effectiveTemporary(actor, dp);
  },

  /**
   * The Actor's effective health on its primary track as a normalized value
   * between 0 and 1.
   *
   * @param {Actor} actor
   * @param {Object} [options]
   * @param {boolean} [options.temporary=true]  Include temporary health.
   * @returns {number|null}
   */
  getPercent(actor, { temporary = true } = {}) {
    const dp = resolveDataPaths(actor);
    if (isWoundMapped(dp)) {
      const maximum = numeric(maximumWoundsValue(actor, dp));
      const wounds = numeric(woundsValue(actor, dp));
      if (!(maximum > 0) || wounds == null) return null;
      return Math.clamp((maximum - wounds) / maximum, 0, 1);
    }
    const maximum = numeric(maximumValue(actor, dp));
    const total = effectiveCurrent(actor, dp);
    if (!(maximum > 0) || total == null) return null;
    const bonus = temporary ? effectiveTemporary(actor, dp) : 0;
    return Math.clamp((total + bonus) / maximum, 0, 1);
  },

  /**
   * Set the primary current health value.
   *
   * @param {Actor} actor
   * @param {number} value
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Actor|Object<string,*>>}
   */
  set(actor, value, options = {}) {
    const dp = resolveDataPaths(actor);
    const cfg = healthConfig(dp);
    if (!cfg.current) throw unsupported(actor, "health.set", "no current health path");
    let stored = value;
    if (isInverted(dp)) {
      const maximum = numeric(maximumValue(actor, dp));
      stored = maximum != null ? maximum - value : value;
    }
    return executeUpdate(actor, setPath(actor, cfg.current, stored), options);
  },

  /**
   * Increase the primary current health value by an amount. This is a
   * low-level arithmetic operation and does not respect maximum health.
   *
   * @param {Actor} actor
   * @param {number} amount
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Actor|Object<string,*>>}
   */
  add(actor, amount, options = {}) {
    const dp = resolveDataPaths(actor);
    const cfg = healthConfig(dp);
    if (!cfg.current) throw unsupported(actor, "health.add", "no current health path");
    const current = numeric(currentValue(actor, dp), 0);
    const delta = isInverted(dp) ? -amount : amount;
    return executeUpdate(actor, setPath(actor, cfg.current, current + delta), options);
  },

  /**
   * Decrease the primary current health value by an amount. This is a
   * low-level arithmetic operation.
   *
   * @param {Actor} actor
   * @param {number} amount
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Actor|Object<string,*>>}
   */
  remove(actor, amount, options = {}) {
    const dp = resolveDataPaths(actor);
    const cfg = healthConfig(dp);
    if (!cfg.current) throw unsupported(actor, "health.remove", "no current health path");
    const current = numeric(currentValue(actor, dp), 0);
    const delta = isInverted(dp) ? amount : -amount;
    return executeUpdate(actor, setPath(actor, cfg.current, current + delta), options);
  },

  /**
   * Set health based on a normalized percentage (0-1, clamped).
   *
   * @param {Actor} actor
   * @param {number} percent
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Actor|Object<string,*>>}
   */
  setPercent(actor, percent, options = {}) {
    const dp = resolveDataPaths(actor);
    const cfg = healthConfig(dp);
    if (!cfg.current || !cfg.maximum) {
      throw unsupported(actor, "health.setPercent", "requires current and maximum health paths");
    }
    const maximum = numeric(maximumValue(actor, dp));
    if (maximum == null) throw unsupported(actor, "health.setPercent", "no maximum health value");
    const target = Math.round(maximum * Math.clamp(percent, 0, 1));
    const stored = isInverted(dp) ? maximum - target : target;
    return executeUpdate(actor, setPath(actor, cfg.current, stored), options);
  },

  /**
   * Semantic healing: increase health respecting the maximum (or reduce the
   * stored damage value for inverted systems).
   *
   * @param {Actor} actor
   * @param {number} amount
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Actor|Object<string,*>>}
   */
  heal(actor, amount, options = {}) {
    const dp = resolveDataPaths(actor);
    const cfg = healthConfig(dp);

    if (isWoundMapped(dp)) {
      const current = numeric(woundsValue(actor, dp), 0);
      return executeUpdate(actor, setPath(actor, cfg.wounds, Math.max(0, current - amount)), options);
    }

    if (!cfg.current) throw unsupported(actor, "health.heal", "no current health path");
    const current = numeric(currentValue(actor, dp), 0);

    if (isInverted(dp)) {
      const floor = numeric(minimumValue(actor, dp), 0);
      return executeUpdate(actor, setPath(actor, cfg.current, Math.max(floor, current - amount)), options);
    }

    if (!cfg.maximum) throw unsupported(actor, "health.heal", "no maximum health path");
    const maximum = numeric(maximumValue(actor, dp));
    const healed = Math.min(maximum ?? Infinity, current + amount);
    return executeUpdate(actor, setPath(actor, cfg.current, healed), options);
  },

  /**
   * Semantic damage: consumes temporary health before primary health, and
   * never reduces below the minimum (or increases the stored damage value
   * for inverted systems).
   *
   * @param {Actor} actor
   * @param {number} amount
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Actor|Object<string,*>>}
   */
  damage(actor, amount, options = {}) {
    const dp = resolveDataPaths(actor);
    const cfg = healthConfig(dp);

    if (isWoundMapped(dp)) {
      const current = numeric(woundsValue(actor, dp), 0);
      return executeUpdate(actor, setPath(actor, cfg.wounds, current + amount), options);
    }

    if (!cfg.current) throw unsupported(actor, "health.damage", "no current health path");

    let remaining = amount;
    const changes = {};

    if (cfg.temporary) {
      const temporary = numeric(temporaryValue(actor, dp), 0);
      if (temporary > 0) {
        const consumed = Math.min(temporary, remaining);
        Object.assign(changes, setPath(actor, cfg.temporary, temporary - consumed));
        remaining -= consumed;
      }
    }

    if (remaining > 0) {
      const current = numeric(currentValue(actor, dp), 0);
      let next = isInverted(dp) ? current + remaining : current - remaining;
      if (!isInverted(dp)) {
        const floor = numeric(minimumValue(actor, dp), 0);
        next = Math.max(floor, next);
      }
      Object.assign(changes, setPath(actor, cfg.current, next));
    }

    return executeUpdate(actor, changes, options);
  },
};
