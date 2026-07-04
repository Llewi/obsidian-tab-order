import {
	Editor,
	MarkdownView,
	MarkdownFileInfo,
	Modal,
	Notice,
	Plugin,
	WorkspaceLeaf,
} from 'obsidian';
import { around } from 'monkey-around';
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	SampleSettingTab,
} from './settings';

// Remember to rename these classes and interfaces!

// --- SPIKE INSTRUMENTATION -------------------------------------------------
// Temporary logging to answer: which UI close actions call
// WorkspaceLeaf.prototype.detach(), what is readable on leaf.parent at that
// point, and how detach ordering relates to active-leaf-change/layout-change.
// Remove this whole block (and the two calls to it in onload/onunload) once
// the spike questions in docs/mru-tab-close-plan.md §5 are answered.

let spikeSeq = 0;
function spikeLog(label: string, data: Record<string, unknown> = {}) {
	spikeSeq += 1;
	// eslint-disable-next-line no-console
	console.log(`[mru-spike #${spikeSeq}] ${label}`, data);
}

function describeLeaf(leaf: WorkspaceLeaf | null): Record<string, unknown> {
	if (!leaf) return { leaf: null };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const parent = (leaf as any).parent;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const parentAny = parent as any;
	let parentInfo: Record<string, unknown> = { parentType: parent?.constructor?.name };
	try {
		if (Array.isArray(parentAny?.children)) {
			parentInfo = {
				...parentInfo,
				childCount: parentAny.children.length,
				childViewTypes: parentAny.children.map(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(c: any) => c?.view?.getViewType?.() ?? c?.view?.getDisplayText?.(),
				),
				currentTab: parentAny.currentTab,
			};
		}
	} catch (e) {
		parentInfo.parentReadError = String(e);
	}
	return {
		viewType: leaf.view?.getViewType?.(),
		display: leaf.getDisplayText?.(),
		...parentInfo,
	};
}

function installSpikeInstrumentation(plugin: MyPlugin) {
	plugin.registerEvent(
		plugin.app.workspace.on('active-leaf-change', (leaf) => {
			spikeLog('active-leaf-change', describeLeaf(leaf));
		}),
	);
	plugin.registerEvent(
		plugin.app.workspace.on('layout-change', () => {
			spikeLog('layout-change', {});
		}),
	);

	const uninstall = around(WorkspaceLeaf.prototype, {
		detach(next) {
			return function (this: WorkspaceLeaf) {
				spikeLog('detach:before', describeLeaf(this));
				const result = next.call(this);
				spikeLog('detach:after', {
					newActive: describeLeaf(plugin.app.workspace.activeLeaf),
				});
				return result;
			};
		},
	});
	plugin.register(uninstall);

	plugin.addCommand({
		id: 'mru-spike-dump-tree',
		name: '[Spike] Dump active leaf + parent info',
		callback: () => {
			spikeLog('manual-dump', describeLeaf(plugin.app.workspace.activeLeaf));
			new Notice('Dumped active leaf info to console (Ctrl+Shift+I)');
		},
	});
}
// --- END SPIKE INSTRUMENTATION ----------------------------------------------

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		await this.loadSettings();
		installSpikeInstrumentation(this);

		// This creates an icon in the left ribbon.
		this.addRibbonIcon('dice', 'Sample', (_evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('This is a notice!');
		});

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status bar text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-modal-simple',
			name: 'Open modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			},
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'replace-selected',
			name: 'Replace selected content',
			editorCallback: (
				editor: Editor,
				_ctx: MarkdownView | MarkdownFileInfo,
			) => {
				editor.replaceSelection('Sample editor command');
			},
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-modal-complex',
			name: 'Open modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
				return false;
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(activeDocument, 'click', (_evt: MouseEvent) => {
			new Notice('Click');
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000),
		);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
