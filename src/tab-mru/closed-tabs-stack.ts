import { ViewState, Workspace, WorkspaceLeaf } from 'obsidian';

interface ClosedTabEntry {
	viewState: ViewState;
	eState: unknown;
}

/**
 * Entries are just serialized view state, not vault content, so keeping far
 * more than anyone will realistically reach for is effectively free. Typical
 * use only ever reaches back a few tabs.
 */
const MAX_CLOSED_TABS = 50;

/**
 * LIFO stack of recently closed tabs, most recent last. Reopening a tab
 * removes it from the stack - there's no redo-style cycling back through
 * tabs you've already reopened.
 */
export class ClosedTabsStack {
	private entries: ClosedTabEntry[] = [];

	/**
	 * Snapshots `leaf`'s view state before it's detached. Skips empty tabs -
	 * there's nothing meaningful to restore.
	 */
	capture(leaf: WorkspaceLeaf): void {
		const viewState = leaf.getViewState();
		if (viewState.type === 'empty') return;

		this.entries.push({ viewState, eState: leaf.getEphemeralState() });
		if (this.entries.length > MAX_CLOSED_TABS) {
			this.entries.shift();
		}
	}

	hasEntries(): boolean {
		return this.entries.length > 0;
	}

	/**
	 * Reopens the most recently closed tab in a new leaf, if any. Returns
	 * false when the stack is empty.
	 */
	async reopenLast(workspace: Workspace): Promise<boolean> {
		const entry = this.entries.pop();
		if (!entry) return false;

		const leaf = workspace.getLeaf('tab');
		await leaf.setViewState(entry.viewState, entry.eState);
		workspace.setActiveLeaf(leaf, { focus: true });
		return true;
	}
}
