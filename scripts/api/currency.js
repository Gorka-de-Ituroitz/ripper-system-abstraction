import {
  resolveDataPaths,
  getPath,
  setPath,
  executeUpdate,
  unsupported,
} from "./core.js";

function currencyConfig(dp) {
  return dp.currency ?? {};
}

function actorHandler(config) {
  return config.actor?.handler ?? null;
}

function actorPaths(config) {
  return config.actor?.denominations ?? {};
}

function amountOf(value) {
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function denominationRatio(config, name) {
  const entry = config.denominations?.[name];
  return typeof entry?.value === "number" ? entry.value : 1;
}

function localizeLabel(key) {
  return game.i18n.localize(key).replace(/\s*:\s*$/, "");
}

function denominationAbbreviation(id, entry) {
  if (entry?.abbreviation) return localizeLabel(entry.abbreviation);
  if (!entry?.label) return id.toUpperCase();
  return localizeLabel(entry.label).split(/\s+/).filter(Boolean).map((word) => word[0]).join("");
}

function toBase(config, amounts) {
  let total = 0;
  for (const [name, amount] of Object.entries(amounts)) {
    if (typeof amount === "number") total += amount * denominationRatio(config, name);
  }
  return Math.round(total * 1e6) / 1e6;
}

function storedDenominationPath(item, spec) {
  return spec && getPath(item, spec) != null ? spec : null;
}

function readWallet(actor, config) {
  const handler = actorHandler(config);
  if (handler) return handler.get(actor) ?? {};
  const wallet = {};
  for (const [name, path] of Object.entries(actorPaths(config))) {
    const amount = path ? getPath(actor, path) : undefined;
    if (amount !== undefined) wallet[name] = amountOf(amount) ?? 0;
  }
  return wallet;
}

function assertDenominations(actor, wallet, currency, operation) {
  for (const name of Object.keys(currency)) {
    if (!(name in wallet)) throw unsupported(actor, operation, `actor does not support denomination "${name}"`);
  }
}

/**
 * Persist a new wallet state. Path-based wallets write only the changed
 * denominations (honouring `update: false`); handler-based wallets receive
 * the changed absolute amounts through `handler.set`.
 */
function commit(actor, config, before, after, operation, options) {
  const changed = Object.fromEntries(Object.entries(after).filter(([name, amount]) => amount !== before[name]));
  const handler = actorHandler(config);
  if (handler) {
    if (options.update === false) throw unsupported(actor, operation, "update: false is not available for handler-based currency");
    return Promise.resolve(handler.set(actor, changed)).then(() => actor);
  }
  const paths = actorPaths(config);
  const changes = {};
  for (const [name, amount] of Object.entries(changed)) Object.assign(changes, setPath(actor, paths[name], amount));
  return executeUpdate(actor, changes, options);
}

/**
 * Pay `request` out of `wallet`, spending the requested denominations first,
 * then the largest coins that fit, and finally breaking the smallest coin that
 * covers the remainder and returning change in lower denominations (except
 * those declared with `change: false`). Amounts
 * are handled in whole units of the smallest denomination, so no fractional
 * coins are produced. Returns null when funds are insufficient.
 */
function withdraw(config, wallet, request) {
  const names = Object.keys(wallet).sort((a, b) => denominationRatio(config, b) - denominationRatio(config, a));
  const unit = Math.min(...names.map((name) => denominationRatio(config, name)));
  const scale = (name) => Math.round(denominationRatio(config, name) / unit);
  const next = { ...wallet };

  let owed = 0;
  for (const [name, amount] of Object.entries(request)) {
    if (!(amount > 0)) continue;
    const direct = Math.min(next[name], amount);
    next[name] -= direct;
    owed += (amount - direct) * scale(name);
  }

  for (const name of names) {
    const take = Math.min(next[name], Math.floor(owed / scale(name)));
    next[name] -= take;
    owed -= take * scale(name);
  }

  if (owed > 0) {
    const breaker = names.findLast((name) => next[name] >= 1 && scale(name) > owed);
    if (!breaker) return null;
    next[breaker] -= 1;
    let change = scale(breaker) - owed;
    for (const name of names) {
      if (scale(name) >= scale(breaker) || config.denominations?.[name]?.change === false) continue;
      const give = Math.floor(change / scale(name));
      next[name] += give;
      change -= give * scale(name);
    }
  }

  return next;
}

/**
 * Currency operations. Uses `dataPaths.currency` (base denomination, relative
 * denomination values, and per-denomination storage paths) and never
 * references system-specific paths directly.
 */
export const currency = {
  /**
   * Every denomination the system declares, ordered from lowest to highest
   * value. `value` is the worth of one unit expressed in the base
   * denomination.
   *
   * `abbreviation` falls back to the initials of an explicit `label`, then
   * to the uppercased id.
   *
   * @returns {{id: string, label: string, abbreviation: string, icon: string|null, value: number, isBase: boolean}[]}
   */
  getDenominations() {
    const config = currencyConfig(resolveDataPaths());
    return Object.entries(config.denominations ?? {})
      .map(([id, entry]) => ({
        id,
        label: entry?.label ? localizeLabel(entry.label) : id.toUpperCase(),
        abbreviation: denominationAbbreviation(id, entry),
        icon: entry?.icon ?? null,
        value: denominationRatio(config, id),
        isBase: id === config.base,
      }))
      .sort((a, b) => a.value - b.value);
  },

  /**
   * The Actor's currency as a normalized denomination object.
   *
   * @param {Actor} actor
   * @returns {Object<string, number>}
   */
  get(actor) {
    return readWallet(actor, currencyConfig(resolveDataPaths(actor)));
  },

  /**
   * The Actor's total currency converted into the configured base
   * denomination.
   *
   * @param {Actor} actor
   * @returns {number}
   */
  getTotal(actor) {
    const config = currencyConfig(resolveDataPaths(actor));
    return toBase(config, readWallet(actor, config));
  },

  /**
   * Set Actor currency. Only the supplied denominations are written;
   * unsupplied denominations are left untouched.
   *
   * @param {Actor} actor
   * @param {Object<string, number>} currency
   * @param {Object} [options]
   * @param {boolean} [options.update=true]  When false, returns the update payload (path-based currency only).
   * @returns {Promise<Actor|Object<string,*>>}
   */
  set(actor, currency = {}, options = {}) {
    const config = currencyConfig(resolveDataPaths(actor));
    const wallet = readWallet(actor, config);
    assertDenominations(actor, wallet, currency, "currency.set");
    return commit(actor, config, wallet, { ...wallet, ...currency }, "currency.set", options);
  },

  /**
   * Add currency to the Actor.
   *
   * @param {Actor} actor
   * @param {Object<string, number>} currency
   * @param {Object} [options]
   * @param {boolean} [options.update=true]  When false, returns the update payload (path-based currency only).
   * @returns {Promise<Actor|Object<string,*>>}
   */
  add(actor, currency = {}, options = {}) {
    const config = currencyConfig(resolveDataPaths(actor));
    const wallet = readWallet(actor, config);
    assertDenominations(actor, wallet, currency, "currency.add");
    const next = { ...wallet };
    for (const [name, amount] of Object.entries(currency)) next[name] += amount;
    return commit(actor, config, wallet, next, "currency.add", options);
  },

  /**
   * Remove currency from the Actor. Requested denominations are spent first;
   * any shortfall is covered by other denominations, making change in whole
   * coins. Never produces negative denominations; throws when funds are
   * insufficient.
   *
   * @param {Actor} actor
   * @param {Object<string, number>} currency
   * @param {Object} [options]
   * @param {boolean} [options.update=true]  When false, returns the update payload (path-based currency only).
   * @returns {Promise<Actor|Object<string,*>>}
   */
  remove(actor, currency = {}, options = {}) {
    const config = currencyConfig(resolveDataPaths(actor));
    const wallet = readWallet(actor, config);
    assertDenominations(actor, wallet, currency, "currency.remove");
    const next = withdraw(config, wallet, currency);
    if (!next) throw unsupported(actor, "currency.remove", "insufficient funds");
    return commit(actor, config, wallet, next, "currency.remove", options);
  },

  /**
   * An Item's monetary value as a normalized denomination object.
   *
   * @param {Item} item
   * @returns {Object<string, number>}
   */
  getItemValue(item) {
    const config = currencyConfig(resolveDataPaths(item));
    const itemConfig = config.item ?? {};
    if (itemConfig.single?.value) {
      const value = amountOf(getPath(item, itemConfig.single.value));
      if (typeof value !== "number") return {};
      const spec = itemConfig.single.denomination;
      const denomination = (storedDenominationPath(item, spec) && getPath(item, spec))
        || (config.denominations?.[spec] ? spec : config.base ?? "");
      return { [denomination]: value };
    }

    const result = {};
    for (const [name, path] of Object.entries(itemConfig.denominations ?? {})) {
      const amount = path ? amountOf(getPath(item, path)) : undefined;
      if (amount !== undefined) result[name] = amount ?? 0;
    }
    return result;
  },

  /**
   * Set an Item's monetary value, replacing the previous one (denominations
   * not supplied are cleared). Supports both single-denomination and
   * multi-denomination representations. For single-denomination systems that
   * store the denomination on the item, a single supplied denomination is
   * stored as-is; otherwise the value is converted into the base denomination.
   *
   * @param {Item} item
   * @param {Object<string, number>} currency
   * @param {Object} [options]
   * @param {boolean} [options.update=true]
   * @returns {Promise<Item|Object<string,*>>}
   */
  setItemValue(item, currency = {}, options = {}) {
    const config = currencyConfig(resolveDataPaths(item));
    const itemConfig = config.item ?? {};

    if (itemConfig.single?.value) {
      const entries = Object.entries(currency);
      const denominationPath = storedDenominationPath(item, itemConfig.single.denomination);
      if (denominationPath && entries.length === 1 && config.denominations?.[entries[0][0]]) {
        const [[name, amount]] = entries;
        return executeUpdate(item, {
          ...setPath(item, itemConfig.single.value, amount),
          ...setPath(item, denominationPath, name),
        }, options);
      }

      const base = config.base;
      if (!base) throw unsupported(item, "currency.setItemValue", "no base denomination configured");
      const changes = setPath(item, itemConfig.single.value, toBase(config, currency));
      if (denominationPath) Object.assign(changes, setPath(item, denominationPath, base));
      return executeUpdate(item, changes, options);
    }

    const changes = {};
    for (const [name, amount] of Object.entries(currency)) {
      const path = itemConfig.denominations?.[name];
      if (!path) {
        throw unsupported(item, "currency.setItemValue", `item does not support denomination "${name}"`);
      }
      Object.assign(changes, setPath(item, path, amount));
    }
    for (const [name, path] of Object.entries(itemConfig.denominations ?? {})) {
      if (path && !(name in currency) && getPath(item, path)) Object.assign(changes, setPath(item, path, 0));
    }
    return executeUpdate(item, changes, options);
  },
};
