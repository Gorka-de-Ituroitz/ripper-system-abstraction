import {initConfig} from "./config.js";
import {showWelcome} from "./lib/welcome.js";
import { registerSettings } from "./settings.js";
import "./testsInterfaceCustomElement.js";
import { buildInputs, getCheckChoices, getResultType, initiativeNeedsToken, parse, processCheck, serialize, supportsAdvantage } from "./testsInterfaceCustomElement.js";
import { api } from "./api/index.js";
import { rollInitiative } from "./initiative.js";
import { runAPITests } from "./testAPI.js";
import { loadSystem } from "./systems/_index.js";
import { registerManualConfigHooks } from "./manualConfig.js";

export const MODULE_ID = "ripper-system-abstraction";

let resolveReady;

export const API = {
    ...api,
    ready: new Promise((resolve) => (resolveReady = resolve)),
    tests: {
        buildInputs,
        getResultType,
        getCheckChoices,
        supportsAdvantage,
        parse,
        serialize,
        processCheck,
        rollInitiative,
        initiativeNeedsToken,
    },
    debug: {
        openDialog: openTestsDebugDialog,
        runAPITests,
    },
};

Hooks.on("init", () => {
    registerSettings();
    registerManualConfigHooks();
    const module = game.modules.get(MODULE_ID);
    module.API = API;
});

Hooks.on("ready", async () => {
    initConfig();
    await loadSystem().finally(() => resolveReady(API));
});

async function openTestsDebugDialog() {
    const content = document.createElement("div");
    const i18n = (key) => game.i18n.localize(key);
    content.innerHTML = `
        <div class="ripper-tests-debug standard-form">
            <div class="form-group">
                <label>${i18n("ripper-system-abstraction.tests.Actor")}</label>
                <select id="ripper-tests-actor"></select>
            </div>
            <div class="form-group">
                <label>${i18n("ripper-system-abstraction.tests.FastForward")}</label>
                <input type="checkbox" id="ripper-tests-fastforward">
            </div>
            <div class="form-group">
                <label>${i18n("ripper-system-abstraction.tests.Silent")}</label>
                <input type="checkbox" id="ripper-tests-silent">
            </div>
            <tests-interface id="ripper-tests-element"></tests-interface>
            <label>${i18n("ripper-system-abstraction.tests.SerializedValue")}</label>
            <div class="ripper-tests-result" id="ripper-tests-value"></div>
            <label>${i18n("ripper-system-abstraction.tests.Result")}</label>
            <div class="ripper-tests-result" id="ripper-tests-result">${i18n("ripper-system-abstraction.tests.Result")}</div>
        </div>`;

    const dialog = new foundry.applications.api.DialogV2({
        content,
        buttons: [
            {
                action: "run",
                label: "ripper-system-abstraction.tests.RunCheck",
                icon: "fa-solid fa-dice-d20",
                default: true,
                callback: (event, button, dlg) => runCheck(dlg),
            },
            {
                action: "test",
                label: "ripper-system-abstraction.tests.RunAPITests",
                icon: "fa-solid fa-vial",
                callback: (event, button, dlg) => {
                    const actor = game.actors.get(dlg.element.querySelector("#ripper-tests-actor").value);
                    runAPITests(actor);
                },
            },
        ],
    });

    await dialog.render(true);
    dialog.close = () => {};
    initTestsDialog(dialog.element);
}

function initTestsDialog(root) {
    const select = root.querySelector("#ripper-tests-actor");
    const element = root.querySelector("tests-interface");

    for (const actor of game.actors) {
        const option = document.createElement("option");
        option.value = actor.id;
        option.textContent = actor.name;
        select.append(option);
    }

    const controlled = canvas?.tokens?.controlled?.[0]?.actor;
    if (controlled) select.value = controlled.id;
    else if (select.options.length) select.selectedIndex = 0;

    element.addEventListener("change", (event) => {
        const valueElement = root.querySelector("#ripper-tests-value");
        valueElement.textContent = event.detail?.value ?? "";
    });
}

async function runCheck(dialog) {
    const root = dialog.element;
    const select = root.querySelector("#ripper-tests-actor");
    const element = root.querySelector("tests-interface");
    const fastForward = root.querySelector("#ripper-tests-fastforward");
    const silent = root.querySelector("#ripper-tests-silent");
    const resultElement = root.querySelector("#ripper-tests-result");

    const actor = game.actors.get(select.value);
    if (!actor) {
        resultElement.textContent = "No actor selected.";
        return;
    }

    const value = element.value;
    if (!value) {
        resultElement.textContent = "No inputs configured.";
        return;
    }

    resultElement.textContent = "Rolling...";
    try {
        const result = await API.tests.processCheck(actor, value, {
            fastForward: fastForward.checked,
            silent: silent.checked,
        });
        console.log("ripper-system-abstraction | Check result:", result);
        resultElement.textContent = formatCheckResult(result);
    } catch (err) {
        console.error("ripper-system-abstraction | Check failed:", err);
        resultElement.textContent = `Error: ${err.message}`;
    }
}

function formatCheckResult(result) {
    if (result?.canceled) return "Canceled";

    const parts = [];
    if (result.result != null) parts.push(`Result: ${result.result}`);
    if (result.target != null) parts.push(`Target: ${result.target}`);
    if (result.success != null) parts.push(result.success ? "Success" : "Failure");
    if (result.levelOfSuccess != null) parts.push(`${result.levelOfSuccess}%`);
    if (result.criticalSuccess) parts.push("Crit!");
    if (result.criticalFailure) parts.push("Fumble!");

    return parts.length ? parts.join(" · ") : "Done";
}