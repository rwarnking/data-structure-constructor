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
export type FlatNode = { node: TreeNode; parentId: string | null; path: string; order: number }

export function flattenPaths(nodes: TreeNode[], parentId: string | null = null, parentPath = ''): Map<string, { value: string; parentId: string | null; path: string }> {
  const result = new Map<string, { value: string; parentId: string | null; path: string }>()
  function visit(items: TreeNode[], currentParentId: string | null, currentParentPath: string) {
    for (const node of items) {
      const path = currentParentPath ? `${currentParentPath}/${node.value}` : node.value
      result.set(node.id, { value: node.value, parentId: currentParentId, path })
      visit(node.children, node.id, path)
    }
  }
  visit(nodes, parentId, parentPath)
  return result
}

export function flattenNodes(nodes: TreeNode[], parentId: string | null = null, parentPath = ''): Map<string, FlatNode> {
  const result = new Map<string, FlatNode>()
  function visit(items: TreeNode[], currentParentId: string | null, currentParentPath: string) {
    for (const [order, node] of items.entries()) {
      const path = currentParentPath ? `${currentParentPath}/${node.value}` : node.value
      result.set(node.id, { node, parentId: currentParentId, path, order })
      visit(node.children, node.id, path)
    }
  }
  visit(nodes, parentId, parentPath)
  return result
}
