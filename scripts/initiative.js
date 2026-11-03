import { getTestsInterface } from "./systems/_index.js";
import { withChatCapture } from "./testsInterfaceCustomElement.js";

const INITIATIVE_UPDATE_MS = 2000;

/**
 * Roll initiative for an actor in the active combat, through the system's own
 * combat initiative. The actor's combatant is created when missing (for its
 * active token on the canvas, or tokenless), in a new combat when none is active.
 *
 * Adapters may customize it with `testsInterface.initiativeOptions(options)`,
 * extra options for `Combat#rollInitiative` (e.g. skipping a roll dialog), or
 * replace the roll with `testsInterface.rollInitiative(actor, combatant, options)`,
 * which must set the combatant's initiative. `testsInterface.initiativeNeedsToken`
 * makes an actor without a token on the scene throw instead of getting a tokenless
 * combatant the system can't handle.
 *
 * @param {Actor} actor
 * @param {Object} [options]
 * @param {boolean} [options.fastForward]  Whether to skip the system's roll dialog if possible.
 * @param {boolean} [options.silent]       Whether to suppress chat output.
 * @param {string} [options.rollMode]      A message visibility mode applied to the chat messages.
 * @param {boolean} [options.advantage]    Roll with advantage, when the system supports it.
 * @param {boolean} [options.disadvantage] Roll with disadvantage, when the system supports it.
 * @returns {Promise<{canceled: boolean, result: number|null, target: null, success: null,
 *   levelOfSuccess: null, criticalSuccess: boolean, criticalFailure: boolean,
 *   message: ChatMessage|null, rolls: Roll[]}>}
 */
export async function rollInitiative(actor, options = {}) {
  return withChatCapture(actor, options, async (rollOptions) => {
    const iface = getTestsInterface();
    const apps = new Set(foundry.applications.instances.keys());
    const windows = new Set(Object.keys(ui.windows ?? {}));
    const combatant = await getCombatant(actor, iface);
    const dialogOpen = () => [...foundry.applications.instances.keys()].some((id) => !apps.has(id))
      || Object.keys(ui.windows ?? {}).some((id) => !windows.has(id));
    let updated = false;
    const hookId = Hooks.on("updateCombatant", (document, changes) => {
      if (document.id === combatant.id && "initiative" in changes) updated = true;
    });
    try {
      if (iface.rollInitiative) await iface.rollInitiative(actor, combatant, rollOptions);
      else await combatant.combat.rollInitiative([combatant.id], { updateTurn: false, ...iface.initiativeOptions?.(rollOptions) });
      for (let waited = 0; !updated && (waited < INITIATIVE_UPDATE_MS || dialogOpen()); waited += 50) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      Hooks.off("updateCombatant", hookId);
    }
    const initiative = combatant.combat.combatants.get(combatant.id)?.initiative;
    const rolled = Number.isFinite(initiative);
    return {
      canceled: !rolled,
      result: rolled ? initiative : null,
      target: null,
      success: null,
      levelOfSuccess: null,
      criticalSuccess: false,
      criticalFailure: false,
    };
  });
}

async function getCombatant(actor, iface) {
  const token = actor.token ?? actor.getActiveTokens(false, true)[0];
  const existing = token ? token.combatant : game.combat?.combatants.find((c) => c.actor === actor);
  if (existing) return existing;
  if (!token && iface.initiativeNeedsToken) {
    throw new Error(`[Ripper System Abstraction] ${game.system.id} needs a token of "${actor.name}" on the scene to roll its initiative.`);
  }
  const combat = game.combat ?? (await getDocumentClass("Combat").create({ scene: canvas.scene?.id, active: true }));
  const data = token ? { tokenId: token.id, sceneId: token.parent.id, actorId: actor.id, hidden: token.hidden } : { actorId: actor.id, hidden: false };
  const [combatant] = await combat.createEmbeddedDocuments("Combatant", [data]);
  return combatant;
}
