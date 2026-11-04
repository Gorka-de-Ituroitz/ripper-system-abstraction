import { MODULE_ID } from "./main.js";
import { getSetting } from "./settings.js";

const fields = foundry.data.fields;
const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

/**
 * Manually configured values for data a game system does not track itself.
 * Values are stored as flags in this module's scope, keyed by field name, and
 * are combined with the system adapter's data when the API reads them.
 *
 * To extend: add a field factory under the relevant document name. The
 * header button and form are registered automatically for every document
 * name listed here.
 */
export const MANUAL_CONFIG_FIELDS = {
  Actor: {
    creatureType: () =>
      new fields.SetField(new fields.StringField({ blank: false, trim: true }), {
        label: `${MODULE_ID}.manualConfig.fields.creatureType.label`,
        hint: `${MODULE_ID}.manualConfig.fields.creatureType.hint`,
      }),
  },
};

/**
 * Read a manually configured value from a document.
 *
 * @param {Document} document
 * @param {string} key
 * @returns {*}
 */
export function getManualConfig(document, key) {
  return document?.flags?.[MODULE_ID]?.[key];
}

export class ManualConfigSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {
  // Getters: MODULE_ID comes from main.js, which imports this file, so it is
  // not yet initialized when the class body is evaluated.
  static get DEFAULT_OPTIONS() {
    return {
      classes: [`${MODULE_ID}-manual-config`],
      sheetConfig: false,
      window: {
        icon: "fa-solid fa-sliders",
        contentClasses: ["standard-form"],
      },
      position: { width: 480, height: "auto" },
      form: { closeOnSubmit: true },
    };
  }

  static get PARTS() {
    return {
      form: { template: `modules/${MODULE_ID}/templates/manual-config.hbs` },
      footer: { template: "templates/generic/form-footer.hbs" },
    };
  }

  /**
   * Open the sheet for a document, bringing an already open one to front.
   *
   * @param {Document} document
   */
  static open(document) {
    const existing = Object.values(document.apps ?? {}).find((app) => app instanceof this);
    if (existing) return existing.render({ force: true });
    return new this({ document }).render({ force: true });
  }

  get title() {
    return `${game.i18n.localize(`${MODULE_ID}.manualConfig.title`)}: ${this.document.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const definitions = MANUAL_CONFIG_FIELDS[this.document.documentName] ?? {};
    context.fields = Object.entries(definitions).map(([key, factory]) => {
      const field = factory();
      const value = getManualConfig(this.document, key);
      return {
        field,
        name: `flags.${MODULE_ID}.${key}`,
        value: value ?? field.getInitialValue(),
      };
    });
    context.buttons = [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "SETTINGS.Save" }];
    return context;
  }
}

function canConfigure(document) {
  return !!document?.isOwner && getSetting("manualConfig") === true;
}

/**
 * Add the manual configuration header button to the sheets of every document
 * name in MANUAL_CONFIG_FIELDS, for both ApplicationV1 and ApplicationV2.
 */
export function registerManualConfigHooks() {
  const label = `${MODULE_ID}.manualConfig.button`;
  const icon = "fa-solid fa-sliders";

  for (const documentName of Object.keys(MANUAL_CONFIG_FIELDS)) {
    // ApplicationV2: fires for every subclass of the base sheet.
    Hooks.on(`getHeaderControls${documentName}SheetV2`, (app, controls) => {
      if (!canConfigure(app.document)) return;
      controls.push({
        action: `${MODULE_ID}-manual-config`,
        icon,
        label,
        onClick: () => ManualConfigSheet.open(app.document),
      });
    });

    // ApplicationV1
    Hooks.on(`get${documentName}SheetHeaderButtons`, (app, buttons) => {
      const document = app.document ?? app.object;
      if (!canConfigure(document)) return;
      buttons.unshift({
        label: game.i18n.localize(label),
        class: `${MODULE_ID}-manual-config`,
        icon,
        onclick: () => ManualConfigSheet.open(document),
      });
    });
  }
}
