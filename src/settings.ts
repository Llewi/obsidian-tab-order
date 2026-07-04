import { App, PluginSettingTab, Setting } from 'obsidian';
import type MruTabClosePlugin from './main';

export interface MruTabCloseSettings {
	activateMruTabOnClose: boolean;
}

export const DEFAULT_SETTINGS: MruTabCloseSettings = {
	activateMruTabOnClose: true,
};

export class MruTabCloseSettingTab extends PluginSettingTab {
	plugin: MruTabClosePlugin;

	constructor(app: App, plugin: MruTabClosePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Activate most recently used tab on close')
			.setDesc(
				'When you close a tab, switch to the tab you had open most recently instead of the neighboring tab.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.activateMruTabOnClose)
					.onChange(async (value) => {
						this.plugin.settings.activateMruTabOnClose = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
