import { getTestsInterface } from "./systems/_index.js";

/**
 * Build the DataModel classes describing the inputs required to run a check
 * for the loaded game system. Choices are pulled from system configuration
 * only, never from a specific actor.
 *
 * @returns {Object<string, typeof foundry.abstract.DataModel>}
 */
export function buildInputs() {
  return getTestsInterface().buildInputs();
}

/**
 * What the numeric `result` of a check represents for the loaded game system:
 * "total", "rollUnder", "successes" or "outcome".
 *
 * @returns {string}
 */
export function getResultType() {
  return getTestsInterface().resultType ?? "total";
}

/**
 * Whether the loaded game system honors the `advantage` and `disadvantage`
 * check options.
 *
 * @returns {boolean}
 */
export function supportsAdvantage() {
  return !!getTestsInterface().supportsAdvantage;
}

/**
 * Whether the loaded game system needs an actor's token on the scene to roll
 * its initiative (see `rollInitiative`).
 *
 * @returns {boolean}
 */
export function initiativeNeedsToken() {
  return !!getTestsInterface().initiativeNeedsToken;
}

/**
 * The checks the loaded game system offers through its `check` input, as a
 * flat list. Empty when the system has no `check` input.
 *
 * @returns {{key: string, label: string, group: string}[]}
 */
export function getCheckChoices() {
  const fields = buildInputs()?.check?.schema?.fields ?? {};
  const field = fields.value ?? Object.values(fields)[0];
  let choices = field?.choices;
  if (typeof choices === "function") choices = choices();
  return Object.entries(choices ?? {}).map(([key, choice]) => {
    const label = typeof choice === "object" ? choice?.label : choice;
    const group = typeof choice === "object" ? choice?.group : null;
    return {
      key,
      label: game.i18n.localize(String(label ?? key)),
      group: group ? game.i18n.localize(String(group)) : "",
    };
  });
}

/**
 * Coerce a raw value into the type represented by a DataField.
 *
 * @param {foundry.data.fields.DataField} field
 * @param {*} value
 * @returns {*}
 */
export function coerceValue(field, value) {
  const cleaned = field.clean(value);
  if (field instanceof foundry.data.fields.NumberField) {
    return (typeof cleaned === "number" && Number.isFinite(cleaned)) ? cleaned : null;
  }
  return cleaned;
}

/**
 * Serialize a flat inputs object into a single "key=value|key=value" string.
 * Nested objects (multi-field input models) are serialized as "key.field=value".
 *
 * @param {Object} inputs
 * @returns {string}
 */
export function serialize(inputs) {
  const parts = [];
  for (const [key, value] of Object.entries(inputs ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [name, nested] of Object.entries(value)) {
        parts.push(`${key}.${name}=${nested ?? ""}`);
      }
    } else {
      parts.push(`${key}=${value ?? ""}`);
    }
  }
  return parts.join("|");
}

/**
 * Parse a "key=value|key=value" string back into a typed inputs object,
 * coercing values according to the input DataModels returned by buildInputs.
 *
 * @param {string} value            The serialized inputs string.
 * @returns {Object<string, any>}   The parsed and typed inputs object.
 */
export function parse(value) {
  const raw = {};
  if (value) {
    for (const pair of String(value).split("|")) {
      if (!pair) continue;
      const separator = pair.indexOf("=");
      if (separator < 0) continue;
      raw[pair.slice(0, separator).trim()] = pair.slice(separator + 1);
    }
  }

  const inputClasses = buildInputs();
  const inputs = {};

  for (const [key, model] of Object.entries(inputClasses ?? {})) {
    const fields = model.schema?.fields ?? {};
    const names = Object.keys(fields);

    if (names.length === 1) {
      inputs[key] = coerceValue(fields[names[0]], raw[key]);
    } else if (names.length > 1) {
      const nested = {};
      for (const name of names) {
        nested[name] = coerceValue(fields[name], raw[`${key}.${name}`]);
      }
      inputs[key] = nested;
    }
  }

  return inputs;
}

const LATE_ROLL_MESSAGE_MS = 1000;
let activeSilentChecks = 0;

/**
 * Perform a check for the given actor using a serialized inputs string.
 *
 * The string is parsed back into a typed inputs object (via `parse`) which is
 * then passed to the system's `processCheck`.
 *
 * @param {Actor} actor             The actor performing the check.
 * @param {string} value            The serialized inputs string.
 * @param {Object} [options]        Options for the check.
 * @param {boolean} [options.fastForward]  Whether to skip the roll dialog if possible.
 * @param {boolean} [options.silent]       Whether to suppress chat output for the check, including
 *   roll messages the system posts shortly after the check resolves.
 * @param {Event} [options.event]    An optional originating event.
 * @param {string} [options.rollMode]      A message visibility mode (a key of CONFIG.ChatMessage.modes)
 *   applied to the chat messages the check creates.
 * @param {boolean} [options.advantage]    Roll with advantage, when the system supports it.
 * @param {boolean} [options.disadvantage] Roll with disadvantage, when the system supports it.
 * @returns {Promise<{canceled: boolean, result: number|null, target: number|null,
 *   success: boolean|null, levelOfSuccess: number|null, criticalSuccess: boolean,
 *   criticalFailure: boolean, message: ChatMessage|null, rolls: Roll[]}>}    The standardized
 *   check result, with the roll chat message the check produced (unsaved when silent) and its rolls.
 */
export async function processCheck(actor, value, options = {}) {
  const inputs = parse(value);
  const iface = getTestsInterface();
  return withChatCapture(actor, options, (checkOptions) => iface.processCheck(actor, inputs, checkOptions));
}

/**
 * Run a roll for an actor with the generic chat handling of checks: `silent`
 * suppresses the chat messages the current user creates meanwhile, `rollMode`
 * applies a message visibility mode to them, and the roll chat message they
 * produced is added to the result with its rolls.
 *
 * @param {Actor} actor
 * @param {Object} options          The check options (`silent`, `rollMode`, ...).
 * @param {Function} run            `(options) => Promise<Object>` performing the roll with the effective options.
 * @returns {Promise<Object>}       The result of `run`, with `message` and `rolls`.
 */
export async function withChatCapture(actor, options, run) {
  const { silent, rollMode } = options;
  const messages = [];
  if (silent) options = { ...options, suppressedMessages: messages };

  let settled = false;
  const isOwn = (message) => (message.author?.id ?? message.author) === game.user.id;
  const preCreate = (message) => {
    if (!isOwn(message)) return;
    if (settled && ((silent && activeSilentChecks > 0) || !message.rolls?.length)) return;
    if (rollMode) message.applyMode(rollMode);
    if (!silent) return;
    messages.push(message);
    return false;
  };
  const create = (message) => {
    if (!settled && isOwn(message)) messages.push(message);
  };

  const preCreateId = (silent || rollMode) ? Hooks.on("preCreateChatMessage", preCreate) : null;
  const createId = silent ? null : Hooks.on("createChatMessage", create);
  if (silent) activeSilentChecks++;
  try {
    const result = await run(options);
    if (!silent && result && !result.canceled && !result.message) await waitForMessage(actor, messages);
    return withMessage(result, actor, messages);
  } finally {
    if (silent) activeSilentChecks--;
    settled = true;
    if (createId !== null) Hooks.off("createChatMessage", createId);
    if (preCreateId !== null) setTimeout(() => Hooks.off("preCreateChatMessage", preCreateId), LATE_ROLL_MESSAGE_MS);
  }
}

async function waitForMessage(actor, messages) {
  const found = () => messages.some((m) => m.rolls?.length || m.speaker?.actor === actor.id);
  for (let waited = 0; waited < LATE_ROLL_MESSAGE_MS && !found(); waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function withMessage(result, actor, messages) {
  if (!result || typeof result !== "object") return result;
  const rolled = messages.filter((message) => message.rolls?.length);
  const own = (list) => list.findLast((m) => m.speaker?.actor === actor.id);
  const message = result.message ?? own(rolled) ?? rolled.at(-1) ?? own(messages) ?? null;
  return { ...result, message, rolls: result.rolls ?? message?.rolls ?? [] };
}

/**
 * A custom element which collects the inputs required to perform a check,
 * without executing the check itself.
 *
 * The element renders one control per input field described by the system's
 * tests interface `buildInputs` and exposes the collected data through:
 *
 *   - `element.value`  A serialized "key=value|key=value" string.
 *   - `element.inputs` A typed object keyed by input name, ready to be
 *                      passed to the system's `processCheck`.
 *
 * Like a native control, it dispatches `input` events while a value is being
 * edited and one `change` event when it is committed (bubbles, composed, detail
 * `{value, inputs}`). The inner controls' own events stay inside the element,
 * so a form listening for `change` submits once per edit.
 */
export class TestsInterfaceElement extends HTMLElement {
  static formAssociated = true;

  #fields = [];

  constructor() {
    super();
    this.classList.add("form-fields");
  }

  /** The form field name, read from the `name` attribute. */
  get name() {
    return this.getAttribute("name");
  }

  /** The collected inputs as a single "key=value|key=value" string. */
  get value() {
    return serialize(this.inputs);
  }

  set value(value) {
    this.#apply(value);
    this.#emit();
  }

  #apply(value) {
    const raw = {};
    if (value) {
      for (const pair of String(value).split("|")) {
        if (!pair) continue;
        const separator = pair.indexOf("=");
        if (separator < 0) continue;
        raw[pair.slice(0, separator).trim()] = pair.slice(separator + 1);
      }
    }

    for (const entry of this.#fields) {
      const rawValue = raw[entry.single ? entry.key : `${entry.key}.${entry.name}`];
      if (rawValue !== undefined) entry.control.value = rawValue;
    }
  }

  /** The collected inputs as a typed object ready for processCheck. */
  get inputs() {
    const inputs = {};

    for (const entry of this.#fields) {
      const coerced = coerceValue(entry.field, entry.control.value);
      if (entry.single) inputs[entry.key] = coerced;
      else {
        inputs[entry.key] ??= {};
        inputs[entry.key][entry.name] = coerced;
      }
    }

    return inputs;
  }

  /** @override */
  connectedCallback() {
    this.#render();
    if (this.hasAttribute("value")) this.#apply(this.getAttribute("value"));
  }

  /* -------------------------------------------- */

  #render() {
    this.replaceChildren();
    this.#fields = [];

    let inputClasses;
    try {
      inputClasses = buildInputs();
    } catch (err) {
      console.warn("ripper-system-abstraction | Failed to build check inputs:", err);
    }
    if (!inputClasses) {
      this.#emit();
      return;
    }

    for (const [key, model] of Object.entries(inputClasses)) {
      const modelFields = model.schema?.fields ?? {};
      const names = Object.keys(modelFields);
      const single = names.length === 1;

      for (const name of names) {
        const field = modelFields[name];
        const group = field.toFormGroup({ localize: true, stacked: true }, { blank: "" });
        const control = group.querySelector("input, select, textarea");
        control?.removeAttribute("name");
        control?.addEventListener("input", (event) => {
          event.stopPropagation();
          this.#emit("input");
        });
        control?.addEventListener("change", (event) => {
          event.stopPropagation();
          this.#emit();
        });
        this.append(...group.children);
        this.#fields.push({ key, name, single, field, control });
      }
    }
    this.#emit();
  }

  #emit(type = "change") {
    this.dispatchEvent(new CustomEvent(type, {
      bubbles: true,
      composed: true,
      detail: {
        value: this.value,
        inputs: this.inputs,
      },
    }));
  }
}

customElements.define("tests-interface", TestsInterfaceElement);
