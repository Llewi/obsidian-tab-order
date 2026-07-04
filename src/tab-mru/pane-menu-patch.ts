import { Menu, Plugin, View } from 'obsidian';
import { around, dedupe } from 'monkey-around';
import { ClosedTabsStack } from './closed-tabs-stack';

const PANE_MENU_PATCH_KEY = 'obsidian-mru-tab-close:pane-menu';

/**
 * Wraps View.prototype.onPaneMenu to add a "Reopen last closed tab" item to
 * the tab bar's right-click context menu. Only applies to `source ===
 * 'tab-header'` - the tab bar - not the pane's "more options" (...) menu.
 */
export function installReopenClosedTabMenuPatch(
	plugin: Plugin,
	closedTabsStack: ClosedTabsStack,
): void {
	const uninstall = around(View.prototype, {
		onPaneMenu(next) {
			return dedupe(
				PANE_MENU_PATCH_KEY,
				next,
				function (this: View, menu: Menu, source: string) {
					next.call(this, menu, source);
					if (source !== 'tab-header') return;

					menu.addItem((item) =>
						item
							.setTitle('Reopen last closed tab')
							.setIcon('history')
							.setDisabled(!closedTabsStack.hasEntries())
							.onClick(() => {
								void closedTabsStack.reopenLast(this.app.workspace);
							}),
					);
				},
			);
		},
	});

	plugin.register(uninstall);
}
