import { Plugin, WorkspaceLeaf, WorkspaceTabs } from 'obsidian';
import { around, dedupe } from 'monkey-around';
import { MruTabCloseSettings } from '../settings';
import { MruTracker } from './mru-tracker';

const DETACH_PATCH_KEY = 'obsidian-mru-tab-close:leaf-detach';

/**
 * Wraps WorkspaceLeaf.prototype.detach so that closing the active tab in a
 * group activates the most-recently-used sibling (per `tracker`) instead of
 * Obsidian's default positional neighbor.
 *
 * detach() commits the new activeLeaf synchronously before returning, while
 * the 'active-leaf-change' event notifying listeners fires afterward
 * (deferred) - so overriding it here, right after the original call, lands
 * before any listener observes the positional pick. Confirmed by manual
 * spike, see docs/mru-tab-close-plan.md §5.1.
 */
export function installMruDetachPatch(
	plugin: Plugin & { settings: MruTabCloseSettings },
	tracker: MruTracker,
): void {
	const uninstall = around(WorkspaceLeaf.prototype, {
		detach(next) {
			return dedupe(DETACH_PATCH_KEY, next, function (this: WorkspaceLeaf) {
				if (!plugin.settings.activateMruTabOnClose) {
					return next.call(this);
				}

				const group = this.parent;
				const wasActive = tracker.isActive(this);

				const result = next.call(this);

				if (wasActive && group instanceof WorkspaceTabs) {
					const replacement = tracker.getMruReplacement(group, this);
					if (replacement) {
						plugin.app.workspace.setActiveLeaf(replacement, { focus: true });
					}
				}

				return result;
			});
		},
	});

	plugin.register(uninstall);
}
