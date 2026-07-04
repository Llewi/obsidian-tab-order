import { Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MruTabCloseSettings,
	MruTabCloseSettingTab,
} from './settings';
import { MruTracker } from './tab-mru/mru-tracker';
import { installMruDetachPatch } from './tab-mru/detach-patch';

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

		installMruDetachPatch(this, tracker);

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
