/** The longest observed dependency path through a complete, acyclic node set. */
export interface DependencyPath { readonly durationMs: number; readonly nodeIds: readonly string[] }
export type DependencyNode = { readonly id: string; readonly dependencies: readonly string[] | null; readonly durationMs: number };

export function completeDependencyNodes(nodes: readonly DependencyNode[]): boolean {
  if (!nodes.length || nodes.some(node => node.dependencies === null || !Number.isFinite(node.durationMs))) { return false; }
  const byId = new Map(nodes.map(node => [node.id, node]));
  return byId.size === nodes.length && !nodes.some(node => node.dependencies!.some(id => !byId.has(id)));
}

export function longestDependencyPath(nodes: readonly DependencyNode[]): DependencyPath | null {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const memo = new Map<string, { durationMs: number; nodeIds: readonly string[] }>();
  const visiting = new Set<string>();
  const visit = (id: string): { durationMs: number; nodeIds: readonly string[] } | null => {
    const cached = memo.get(id); if (cached) { return cached; }
    if (visiting.has(id)) { return null; }
    const node = byId.get(id); if (!node) { return null; }
    visiting.add(id);
    const predecessors = node.dependencies!.map(visit);
    visiting.delete(id);
    if (predecessors.some(value => value === null)) { return null; }
    const prior = (predecessors as { durationMs: number; nodeIds: readonly string[] }[])
      .sort((a, b) => b.durationMs - a.durationMs || a.nodeIds.join('\0').localeCompare(b.nodeIds.join('\0')))[0];
    const result = { durationMs: (prior?.durationMs ?? 0) + node.durationMs,
      nodeIds: [...(prior?.nodeIds ?? []), id] };
    memo.set(id, result); return result;
  };
  const paths = nodes.map(node => visit(node.id));
  if (paths.some(value => value === null)) { return null; }
  return (paths as DependencyPath[])
    .sort((a, b) => b.durationMs - a.durationMs || a.nodeIds.join('\0').localeCompare(b.nodeIds.join('\0')))[0] ?? null;
}
