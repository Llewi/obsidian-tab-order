import { WorkspaceLeaf, WorkspaceTabs } from 'obsidian';

/**
 * Tracks, per tab group (WorkspaceTabs), which leaves were active most
 * recently, most-recent first. Built entirely from 'active-leaf-change', so
 * it only knows about leaves that were actually focused during this session.
 */
export class MruTracker {
	private stacks = new WeakMap<WorkspaceTabs, WorkspaceLeaf[]>();
	private currentActive: WorkspaceLeaf | null = null;

	onActiveLeafChange(leaf: WorkspaceLeaf | null): void {
		this.currentActive = leaf;

		if (!leaf) return;
		const group = leaf.parent;
		if (!(group instanceof WorkspaceTabs)) return;

		const stack = this.stacks.get(group) ?? [];
		const next = stack.filter((l) => l !== leaf);
		next.unshift(leaf);
		this.stacks.set(group, next);
	}

	/**
	 * The leaf most recently reported by 'active-leaf-change'. Tracked
	 * ourselves (rather than reading the deprecated `workspace.activeLeaf`)
	 * purely from that event.
	 */
	isActive(leaf: WorkspaceLeaf): boolean {
		return this.currentActive === leaf;
	}

	/**
	 * The most recently active leaf in `group`, other than `excludeLeaf`, that
	 * is still a live child of `group`. Null if none is known.
	 */
	getMruReplacement(
		group: WorkspaceTabs,
		excludeLeaf: WorkspaceLeaf,
	): WorkspaceLeaf | null {
		const stack = this.stacks.get(group);
		if (!stack) return null;

		const children = getLiveChildren(group);
		if (!children) return null;

		const live = stack.filter((leaf) => children.includes(leaf));
		this.stacks.set(group, live);

		return live.find((leaf) => leaf !== excludeLeaf) ?? null;
	}
}

/**
 * `children` is an undocumented internal field of WorkspaceTabs (not part of
 * the public API surface). Read defensively so a future Obsidian release that
 * changes this shape just disables the MRU correction instead of throwing.
 */
function getLiveChildren(group: WorkspaceTabs): WorkspaceLeaf[] | null {
	const children = (group as unknown as { children?: unknown }).children;
	return Array.isArray(children) ? (children as WorkspaceLeaf[]) : null;
}
