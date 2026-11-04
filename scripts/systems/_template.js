/*
 * System Data Path Configuration
 * ===============================
 *
 * This file defines how the agnostic API locates common data inside a
 * specific game system's Actor and Item data models.
 *
 * The goal is to allow modules to work across multiple game systems without
 * knowing the internal structure of each system.
 *
 * Each supported system provides its own implementation of this object.
 * The API uses these definitions to translate system-specific data into a
 * common, normalized representation.
 *
 * IMPORTANT
 * ---------
 *
 * - Paths are relative to the relevant Foundry document's `system` data.
 * - Use dot notation for nested properties.
 * - Use an empty string ("") when a value is not supported or unavailable.
 * - Use an empty object ({}) when a mapping contains multiple entries.
 * - Use arrays when a value may exist in multiple possible locations; the
 *   first candidate holding a value on the document is used.
 * - Use a function `(document) => value` for derived values that cannot be
 *   expressed as a single path. Function specs are read-only.
 * - Use an accessor `{ get(document), set(document, value) }` for writable
 *   values spread over several fields; `set` returns the update payload
 *   (e.g. `{ "system.a": 1, "system.b": 2 }`).
 * - Boolean properties are feature flags describing whether a system
 *   supports a particular concept.
 *
 * ---------------------------------------------------------------------------
 * ACTOR
 * ---------------------------------------------------------------------------
 *
 * Basic information about an Actor or creature.
 *
 * type:
 *   The creature/entity type(s). The value may be a single string or an
 *   array of strings (systems allowing several types, e.g. undead +
 *   humanoid); the API always returns an array.
 *
 * typeChoices (function):
 *   `() => ({ [typeId]: label | { label } })` returning every type the system
 *   declares, independent of any actor. Labels are localized by the API.
 *
 * subtype:
 *   Optional secondary creature/entity classification.
 *
 * size:
 *   Creature/entity size.
 *
 * sizes (object or function returning an object):
 *   Maps each stored size value to the creature's footprint in grid squares
 *   (e.g. { tiny: 0.5, med: 1, lg: 2 }). When the stored size has no mapping
 *   the API falls back to the prototype token width.
 *
 * level:
 *   Character or creature level.
 *
 * role:
 *   Optional system-specific role or classification.
 *
 * ---------------------------------------------------------------------------
 * HEALTH
 * ---------------------------------------------------------------------------
 *
 * Normalized health information.
 *
 * current:
 *   Current health / hit points.
 *
 * maximum:
 *   Maximum health / hit points.
 *
 * temporary:
 *   Temporary or additional health.
 *
 * minimum:
 *   Minimum possible health value, if applicable.
 *
 * wounds:
 *   Current wounds/injuries.
 *
 * maximumWounds:
 *   Maximum wounds/injuries.
 *
 * primary ("health" | "wounds"):
 *   Which track is the actor's primary health, used by getPercent, heal and
 *   damage. "health" uses `current`/`maximum`; "wounds" uses
 *   `wounds`/`maximumWounds` (counting up toward the maximum). May be left
 *   out when only one track is mapped, in which case it is inferred. Required
 *   when both `current` and `wounds` are mapped.
 *
 * invert (optional, default false):
 *   When true, the stored `current`/`maximum` values count damage taken
 *   rather than remaining health (e.g. damage trackers). The API interprets
 *   add/remove/heal/damage and getCurrent accordingly.
 *
 * ---------------------------------------------------------------------------
 * ITEM
 * ---------------------------------------------------------------------------
 *
 * Generic information about Items.
 *
 * quantity:
 *   Item quantity / stack size.
 *
 * weight:
 *   Item weight (of a single unit, in the system's own unit).
 *
 * equipped:
 *   Whether the item is equipped.
 *
 * attuned:
 *   Whether the item is attuned, bonded, or otherwise linked to the Actor.
 *
 * attunedValue / unattunedValue (optional):
 *   Same as equippedValue / unequippedValue, for non-boolean attunement.
 *
 * stackable (optional function):
 *   `(item) => boolean` for systems where only some items may hold a
 *   quantity above one. Quantity writes above one throw for other items.
 *
 * equippable / attunable (optional functions):
 *   `(item) => boolean` for systems where only some items carrying the field
 *   can actually be equipped/attuned (e.g. dnd5e attunement requirement).
 *   When false, the API treats the item as having no such state.
 *
 * equippedValue / unequippedValue (optional):
 *   For systems whose equipped field is not a boolean, these declare the
 *   values representing the equipped and not-equipped states. A numeric
 *   `equippedValue` is an inclusive threshold (value >= equippedValue);
 *   a string is matched exactly.
 *
 * uses:
 *   Current remaining uses/charges.
 *
 * usesSpent (optional):
 *   A path to a stored "spent" counter when the system stores uses as
 *   consumed rather than remaining (e.g. `uses.spent` with a derived
 *   remaining value). The API then computes remaining as `maximumUses -
 *   usesSpent` and mutates the spent counter.
 *
 * maximumUses:
 *   Maximum uses/charges.
 *
 * fromSpell (optional object):
 *   For systems that turn a spell dropped into an inventory into another
 *   item (spell scrolls, wands, potions). Leave out when the system has no
 *   such concept.
 *   - `isSpell(item) => boolean`
 *   - `create(spell, { dialog }) => Promise<Object|Item|null>` returns the
 *     new item's source data, the spell itself when the user chose to keep
 *     it as a spell, or null when canceled. With `dialog: false` it uses the
 *     system's defaults without prompting. It must not create documents.
 *
 * ---------------------------------------------------------------------------
 * CURRENCY
 * ---------------------------------------------------------------------------
 *
 * Currency has two separate concepts:
 *
 * 1. Actor currency
 *    The actual money/denominations owned by an Actor.
 *
 * 2. Item currency
 *    The monetary value of an Item.
 *
 * Currency denominations are normalized using a relative `value`.
 *
 * `base` identifies the denomination used as the canonical unit.
 *
 * Example:
 *
 *   base: "gp"
 *
 *   cp = 0.01
 *   sp = 0.1
 *   gp = 1
 *   pp = 10
 *
 * This allows the API to normalize currencies across completely different
 * game systems.
 *
 * Actor currency is normally represented as multiple denomination paths:
 *
 *   actor: {
 *     denominations: {
 *       cp: "currency.cp",
 *       sp: "currency.sp",
 *       gp: "currency.gp",
 *       pp: "currency.pp",
 *     },
 *   }
 *
 * Systems that store actor currency in a non-path-based form (e.g. as items,
 * like PF2E's treasure items) may provide an optional `handler` instead. The
 * handler replaces path-based actor currency entirely: `get(actor)` returns the
 * amount of every supported denomination (0 when the actor has none), and
 * `set(actor, amounts)` writes the given absolute amounts (only changed
 * denominations are passed). Adding, removing and change-making are computed
 * generically from get/set.
 *
 *   actor: {
 *     denominations: { cp: "", sp: "", gp: "", pp: "" },
 *     handler: {
 *       get: (actor) => ({ cp: 0, sp: 0, gp: 0, pp: 0 }),
 *       set: async (actor, amounts) => {},
 *     },
 *   }
 *
 * Item currency supports two representations:
 *
 * 1. Single denomination
 *
 *    Example:
 *      value = "price.value"
 *      denomination = "price.denomination" (a path the item holds), or a
 *      fixed denomination id such as "gp" when every item uses the same one
 *
 * 2. Multiple denominations
 *
 *    Example:
 *      5 gp + 2 cp
 *
 * This allows the API to handle systems that store item prices differently
 * without requiring system-specific currency logic.
 *
 * ---------------------------------------------------------------------------
 * EXPERIENCE
 * ---------------------------------------------------------------------------
 *
 * Character/creature progression data.
 *
 * current:
 *   Current experience/progression value.
 *
 * maximum:
 *   Experience required for the next level, if applicable.
 *
 * (The character level lives in `actor.level`.)
 *
 * ---------------------------------------------------------------------------
 * OVERRIDES
 * ---------------------------------------------------------------------------
 *
 * Optional per document-type adjustments, merged over the base configuration
 * for documents of that type:
 *
 *   overrides: {
 *     Actor: { npc: { actor: { level: "details.cr" }, experience: { current: "" } } },
 *     Item: { spell: { item: { quantity: "" } } },
 *   }
 *
 * ---------------------------------------------------------------------------
 * AFTER UPDATE
 * ---------------------------------------------------------------------------
 *
 * afterUpdate (optional async function):
 *   `(document, changes) => Promise` awaited after every write the API makes,
 *   for systems that mirror document data elsewhere and need it synced.
 *
 * updateOptions (optional object):
 *   Options passed to every document update the API makes, e.g. flags a
 *   system reads to skip its own prompts.
 *
 * ---------------------------------------------------------------------------
 * FEATURES
 * ---------------------------------------------------------------------------
 *
 * Feature flags indicate whether the system supports a given concept.
 *
 * supportsHealth:
 *   The system exposes health information.
 *
 * supportsTemporaryHealth:
 *   The system supports temporary/additional health.
 *
 * supportsWounds:
 *   The system uses wounds/injuries.
 *
 * supportsCurrency:
 *   The system exposes currency.
 *
 * supportsWeight:
 *   Items have weight.
 *
 * supportsEquipment:
 *   Items can be equipped.
 *
 * supportsAttunement:
 *   Items can be attuned/bonded to an Actor.
 */

export default async function systemAdapter() {
  /*
   * Optional asynchronous preloads (e.g. awaiting compendium `getIndex()` to
   * resolve names for tool/skill choices) may run here, before the adapter's
   * dataPaths and testsInterface are returned.
   */

  return {
    dataPaths: {
  // -------------------------------------------------------------------------
  // Actor
  // -------------------------------------------------------------------------

  actor: {
    type: "",
    typeChoices: () => ({}),
    subtype: "",
    size: "",
    sizes: {},
    level: "",
    role: "",
  },

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  health: {
    current: "",
    maximum: "",
    temporary: "",
    minimum: "",

    wounds: "",
    maximumWounds: "",
    primary: "health",
  },

  // -------------------------------------------------------------------------
  // Item
  // -------------------------------------------------------------------------

  item: {
    quantity: "",
    weight: "",

    equipped: "",
    attuned: "",

    uses: "",
    maximumUses: "",
  },

  // -------------------------------------------------------------------------
  // Currency
  // -------------------------------------------------------------------------

  currency: {
    // Canonical denomination used as the base unit for normalization.
    base: "",

    // Currency owned by an Actor.
    actor: {
      denominations: {},
    },

    // Monetary value represented by an Item.
    item: {
      // Single value + denomination.
      //
      // Example:
      //   value: 5
      //   denomination: "gp"
      single: {
        value: "",
        denomination: "",
      },

      // Multiple denomination values.
      //
      // Example:
      //   5 gp + 2 cp
      //
      // Each key is a denomination and the value is the path containing
      // the amount for that denomination.
      denominations: {},
    },

    // Relative value of each denomination compared to `base`.
    //
    // Example:
    //   cp: { value: 0.01 }
    //   sp: { value: 0.1 }
    //   gp: { value: 1 }
    //   pp: { value: 10 }
    //
    // Add `change: false` to a denomination that may be spent but should
    // never be handed out as change (e.g. dnd5e electrum). Optional `label`
    // and `abbreviation` (i18n keys or text) and `icon` (image path) are
    // exposed through `currency.getDenominations()`.
    denominations: {},
  },

  // -------------------------------------------------------------------------
  // Experience / Progression
  // -------------------------------------------------------------------------

  experience: {
    current: "",
    maximum: "",
  },

  // -------------------------------------------------------------------------
  // Feature Support
  // -------------------------------------------------------------------------

  features: {
    supportsHealth: false,
    supportsTemporaryHealth: false,
    supportsWounds: false,
    supportsCurrency: false,
    supportsWeight: false,
    supportsEquipment: false,
    supportsAttunement: false,
  },
    },

// ---------------------------------------------------------------------------
// Tests / Checks
// ---------------------------------------------------------------------------
//
// Defines the interface used by the agnostic API to perform system-specific
// checks.
//
// `buildInputs` returns an object where each key represents a logical input
// and each value is a Foundry DataModel class describing that input.
//
// The choices for each input are pulled from the game system's configuration
// only - never from a specific actor. Checks that an actor cannot perform are
// still listed.
//
// The generic API can use these DataModels to construct, render, and validate
// the required UI without knowing anything about the underlying game system.
//
// Example:
//
//   buildInputs() => ({
//     check: CheckInput,
//     dc: DCInput,
//   })
//
// Once the user has provided the values, the generic API passes a simple
// key/value object to `processCheck`:
//
//   {
//     check: "skill.acrobatics",
//     dc: 15,
//   }
//
// The meaning of each input is entirely system-specific.
//
// `processCheck` is responsible for translating the provided values into the
// system's native check/roll API, executing the check, and normalizing the
// result.
//
// Options:
//
//   {
//     fastForward: false,  Whether to skip the system's roll dialog if possible
//     silent: false,       Whether to suppress chat output for the check
//     event: null,         An optional originating event passed to the native check
//     rollMode: null,      A message visibility mode (CONFIG.ChatMessage.modes key)
//     advantage: false,    Roll with advantage (only when `supportsAdvantage`)
//     disadvantage: false, Roll with disadvantage (only when `supportsAdvantage`)
//   }
//
// The options object is forwarded to the system's check method when that
// method accepts an options argument.
//
// `rollMode` is applied by the generic layer to the chat messages created by
// the current user while the check runs; adapters don't need to handle it.
// The generic layer also adds the produced roll chat message and its rolls to
// the result (`message`, `rolls`) unless the adapter already set them.
//
// When `silent` is set, the generic layer blocks chat messages created by the
// current user while the check runs, and
// collects the blocked ChatMessage documents in `options.suppressedMessages`.
// Systems whose check methods return the created chat message (which is then
// undefined) should read the rolls from `options.suppressedMessages.at(-1)`.
//
// The returned value is a standardized result object:
//
//   {
//     canceled: false,          Whether the check was canceled (dialog dismissed)
//     result: 17,               The primary numeric outcome (roll total) if any
//     target: 15,               The target/DC/threshold the result was compared against
//     success: true,            Whether the check succeeded, or null if the system
//                               cannot determine success
//     levelOfSuccess: 67,       A 0-100 percentage. Each system normalizes its own
//                               success levels (e.g. binary -> 0/100, 4 levels ->
//                               0/33/66/100). Null if the system has no such concept.
//     criticalSuccess: false,   Whether the outcome was a critical success
//     criticalFailure: false,   Whether the outcome was a critical failure
//   }
//

    testsInterface: {
  /**
   * What the numeric `result` of a check represents, so consumers can compare
   * it against thresholds:
   *   "total"     - a roll total, higher is better (default)
   *   "rollUnder" - a roll total, lower is better (rolled against `target`)
   *   "successes" - a count of successes, hits or similar
   *   "outcome"   - the total is not meaningful; use `levelOfSuccess`
   */
  resultType: "total",

  /**
   * Whether `processCheck` (and initiative) honor the `advantage` and
   * `disadvantage` options.
   */
  supportsAdvantage: false,

  /**
   * Optional. Extra options for the system's `Combat#rollInitiative` when the
   * API rolls initiative, from the initiative options (`fastForward`,
   * `advantage`, ...), e.g. to skip the system's roll dialog.
   *
   * @param {Object} options
   * @returns {Object}
   */
  // initiativeOptions: (options) => ({}),

  /**
   * Optional. Replaces the initiative roll the API performs through
   * `Combat#rollInitiative`; it must set the combatant's initiative.
   *
   * @param {Actor} actor
   * @param {Combatant} combatant
   * @param {Object} options
   * @returns {Promise<void>}
   */
  // rollInitiative: async (actor, combatant, options) => {},

  /**
   * Optional. True when the system's combat code fails on combatants without a
   * token: rolling initiative for an actor with no token on the scene then
   * throws instead of creating a tokenless combatant.
   */
  // initiativeNeedsToken: false,

  /**
   * Returns the DataModel classes required to build a system check.
   *
   * Choices are derived from system configuration, never from a specific
   * actor.
   *
   * @returns {Object<string, typeof foundry.abstract.DataModel>}
   */
  buildInputs: () => ({}),

  /**
   * Executes a system-specific check using the submitted input values.
   *
   * `inputs` contains the values defined by `buildInputs`, keyed by the same
   * names returned by that function.
   *
   * @param {Actor} actor
   * @param {Object<string, any>} inputs
   * @param {Object} [options]        Options for the check.
   * @param {boolean} [options.fastForward]  Whether to skip the roll dialog if possible.
   * @param {boolean} [options.silent]       Whether to suppress chat output for the check.
   * @param {Event} [options.event]    An optional originating event.
   * @returns {Promise<{
   *   canceled: boolean,
   *   result: number|null,
   *   target: number|null,
   *   success: boolean|null,
   *   levelOfSuccess: number|null,
   *   criticalSuccess: boolean,
   *   criticalFailure: boolean,
   * }>}
   */
  processCheck: async (actor, inputs, options = {}) => {
    throw new Error("processCheck is not implemented");
  },
},
  };
};