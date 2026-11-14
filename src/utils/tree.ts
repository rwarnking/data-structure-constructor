import type { TreeNode } from '../types/workspace'

export function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const match = findNode(node.children, id)
    if (match) return match
  }
  return undefined
}
export function findParent(nodes: TreeNode[], id: string, parent: TreeNode | null = null): TreeNode | null | undefined {
  for (const node of nodes) {
    if (node.id === id) return parent
    const match = findParent(node.children, id, node)
    if (match !== undefined) return match
  }
  return undefined
}
export function removeNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) return nodes.splice(index, 1)[0]
  for (const node of nodes) {
    const removed = removeNode(node.children, id)
    if (removed) return removed
  }
  return undefined
}
export function descendants(node: TreeNode): string[] {
  return [node.id, ...node.children.flatMap(descendants)]
}
export function countNodes(nodes: TreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0)
}
export function nodeParentIds(nodes: TreeNode[], parentId: string | null = null, result = new Map<string, string | null>()) {
  for (const node of nodes) {
    result.set(node.id, parentId)
    nodeParentIds(node.children, node.id, result)
  }
  return result
}
