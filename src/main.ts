import { Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MruTabCloseSettings,
	MruTabCloseSettingTab,
} from './settings';
import { ClosedTabsStack } from './tab-mru/closed-tabs-stack';
import { MruTracker } from './tab-mru/mru-tracker';
import { installMruDetachPatch } from './tab-mru/detach-patch';
import { installReopenClosedTabMenuPatch } from './tab-mru/pane-menu-patch';

export default class MruTabClosePlugin extends Plugin {
	settings!: MruTabCloseSettings;

	async onload() {
		await this.loadSettings();

		const tracker = new MruTracker();
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				tracker.onActiveLeafChange(leaf);
			}),
		);

		const closedTabsStack = new ClosedTabsStack();
		installMruDetachPatch(this, tracker, closedTabsStack);
		installReopenClosedTabMenuPatch(this, closedTabsStack);

		this.addCommand({
			id: 'reopen-last-closed-tab',
			name: 'Reopen last closed tab',
			callback: () => {
				void closedTabsStack.reopenLast(this.app.workspace);
			},
		});

		this.addSettingTab(new MruTabCloseSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MruTabCloseSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
