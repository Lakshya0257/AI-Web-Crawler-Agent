import fs from "fs";
import path from "path";
import logger from "../../utils/logger.js";
import type { Socket } from "socket.io";

export interface ActionHistoryEntry {
  instruction: string;
  after_act: string; // Screenshot path or base64
  imageName: string; // Unique name for the image node (step_X_hash_Y)
  timestamp: string;
  stepNumber: number;
}

export interface InteractionGraph {
  nodes: ImageNode[];
  edges: ImageEdge[];
  flows: FlowDefinition[];
  description: string;
  pageSummary: string;
  lastUpdated: string;
}

export interface ImageNode {
  id: string; // imageName (step_X_hash_Y)
  imageName: string; // Same as id for consistency
  imageData: string; // Base64 screenshot data
  instruction: string; // The action that led to this state
  stepNumber: number; // Step number when this state was captured
  metadata: {
    visibleElements: string[]; // Description of what's visible
    clickableElements: string[]; // Description of interactive elements
    flowsConnected: string[]; // Array of flow IDs this image participates in
    dialogsOpen: string[]; // Any dialogs/modals open
    pageTitle?: string; // Page title if available
    timestamp: string; // When this state was captured
  };
  position?: { x: number; y: number }; // For frontend positioning
}

export interface ImageEdge {
  from: string; // Source imageName
  to: string; // Target imageName
  action: string; // Specific action taken (e.g., "click_upload_button")
  instruction: string; // Full instruction that caused the transition
  description: string; // Human-readable description of the transition
  flowId?: string; // Optional flow this edge belongs to
}

export interface FlowDefinition {
  id: string; // Unique flow identifier
  name: string; // Human-readable flow name (e.g., "Upload Asset Flow")
  description: string; // What this flow accomplishes
  startImageName: string; // Initial state of the flow
  endImageNames: string[]; // Possible end states
  imageNodes: string[]; // All image nodes in this flow
  flowType: "linear" | "branching" | "circular"; // Flow pattern type
}

export interface GraphNode {
  id: string;
  label: string;
  description: string;
  type:
    | "button"
    | "link"
    | "input"
    | "dropdown"
    | "toggle"
    | "tab"
    | "section"
    | "dialog"
    | "state"
    | "navigation_target";
  position?: { x: number; y: number };
  actionable?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  action: string;
  description: string;
}

export interface PageStore {
  url: string;
  urlHash: string;
  initialScreenshot: string;
  actionHistory: ActionHistoryEntry[];
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  graph?: InteractionGraph;
  lastUpdated: string;
  isGraphGenerationInProgress: boolean;
}

export interface TreeNode {
  id: string;
  completed: boolean;
  action: string;
  actionType: "hover" | "click" | "scroll" | "nothing";
  children: TreeNode[];
}

export class GlobalStore {
  private store: Map<string, PageStore> = new Map();
  private baseDir: string;
  private socket?: Socket;
  private userName?: string;
  private trees: Map<string, TreeNode> = new Map();
  private currentNodeId: Map<string, string> = new Map();

  constructor(baseDir: string, socket?: Socket, userName?: string) {
    this.baseDir = baseDir;
    this.socket = socket;
    this.userName = userName;
    this.loadExistingStore();
  }

  /**
   * Initialize page store for a URL
   */
  initializePage(
    url: string,
    urlHash: string,
    initialScreenshot: string
  ): void {
    if (!this.store.has(urlHash)) {
      const pageStore: PageStore = {
        url,
        urlHash,
        initialScreenshot,
        actionHistory: [],
        conversationHistory: [],
        lastUpdated: new Date().toISOString(),
        isGraphGenerationInProgress: false,
      };

      this.store.set(urlHash, pageStore);
      this.saveStore();

      logger.info(`📦 Initialized page store for: ${url}`, {
        urlHash,
        totalPages: this.store.size,
      });

      this.trees.set(urlHash, {
        id: urlHash,
        completed: false,
        action: "",
        actionType: "nothing",
        children: [],
      });

      this.currentNodeId.set(urlHash, urlHash);
      
      // Export initial tree structure
      this.exportTreeStructure(urlHash);
    }
  }

  getCurrentTreeNodeId(urlHash: string) {
    return this.currentNodeId.get(urlHash) || "";
  }

  setCurrentTreeNode(urlHash: string, nodeId: string) {
    this.currentNodeId.set(urlHash, nodeId);
    
    // Export tree structure when current node changes
    this.exportTreeStructure(urlHash);
  }

  getCurrentTreeNode(urlHash: string): TreeNode | null {
    const currentNodeId = this.currentNodeId.get(urlHash);
    if (!currentNodeId) {
      return null;
    }
    
    const rootTree = this.trees.get(urlHash);
    if (!rootTree) {
      return null;
    }
    
    // If current node ID is the root, return root
    if (currentNodeId === urlHash) {
      return rootTree;
    }
    
    // Otherwise, find the node recursively
    return this.findNodeById(rootTree, currentNodeId);
  }

  private findNodeById(node: TreeNode, targetId: string): TreeNode | null {
    if (node.id === targetId) {
      return node;
    }
    
    for (const child of node.children) {
      const found = this.findNodeById(child, targetId);
      if (found) {
        return found;
      }
    }
    
    return null;
  }

  saveTreeState(urlHash: string): void {
    // Trees are already stored in memory, no additional persistence needed for now
    logger.info(`💾 Tree state saved for urlHash: ${urlHash}`);
    
    // Export complete tree structure to file for debugging/visualization
    this.exportTreeStructure(urlHash);
  }

  /**
   * Export complete tree structure to a JSON file in the URL hash folder
   */
  private exportTreeStructure(urlHash: string): void {
    const rootTree = this.trees.get(urlHash);
    if (!rootTree) {
      logger.warn(`⚠️ No tree found for urlHash: ${urlHash}`);
      return;
    }

    try {
      // Get page store for additional context
      const pageStore = this.store.get(urlHash);
      
      // Create the tree export data
      const treeExport = {
        timestamp: new Date().toISOString(),
        urlHash,
        url: pageStore?.url || 'unknown',
        currentNodeId: this.currentNodeId.get(urlHash),
        currentNodePath: this.getPathToNode(urlHash, this.currentNodeId.get(urlHash) || ''),
        treeStructure: this.serializeTreeForExport(rootTree),
        stats: this.calculateTreeStats(rootTree),
        incompleteActions: this.getActionsFromTree(urlHash),
        visualTree: this.generateVisualTree(rootTree, 0, this.currentNodeId.get(urlHash) || '')
      };

      // Get the path to the URL hash folder
      const urlHashFolder = path.join(
        this.baseDir,
        this.userName || 'default',
        urlHash
      );

      // Ensure the folder exists
      if (!fs.existsSync(urlHashFolder)) {
        fs.mkdirSync(urlHashFolder, { recursive: true });
      }

      // Write the tree structure to a file
      const exportPath = path.join(urlHashFolder, 'tree_structure.json');
      fs.writeFileSync(exportPath, JSON.stringify(treeExport, null, 2));

      // Emit tree update event to frontend
      if (this.socket && this.userName) {
        this.socket.emit("exploration_update", {
          type: "tree_updated",
          timestamp: new Date().toISOString(),
          data: {
            userName: this.userName,
            url: pageStore?.url || 'unknown',
            urlHash,
            treeStructure: treeExport,
            totalNodes: treeExport.stats.totalNodes,
            completedNodes: treeExport.stats.completedNodes,
            incompleteNodes: treeExport.stats.incompleteNodes,
            currentNodeId: treeExport.currentNodeId
          },
        });
      }

      logger.info(`📊 Tree structure exported to: ${exportPath}`, {
        urlHash,
        totalNodes: treeExport.stats.totalNodes,
        completedNodes: treeExport.stats.completedNodes,
        incompleteNodes: treeExport.stats.incompleteNodes,
        currentNodeId: treeExport.currentNodeId
      });

    } catch (error) {
      logger.error(`❌ Failed to export tree structure for ${urlHash}:`, error);
    }
  }

  /**
   * Serialize tree node for export with readable format
   */
  private serializeTreeForExport(node: TreeNode): any {
    return {
      id: node.id,
      completed: node.completed,
      action: node.action,
      actionType: node.actionType,
      children: node.children.map(child => this.serializeTreeForExport(child)),
      // Add some metadata for easier debugging
      hasChildren: node.children.length > 0,
      childrenCount: node.children.length,
      depth: this.calculateNodeDepth(node)
    };
  }

  /**
   * Calculate statistics about the tree
   */
  private calculateTreeStats(rootNode: TreeNode): any {
    const stats = {
      totalNodes: 0,
      completedNodes: 0,
      incompleteNodes: 0,
      maxDepth: 0,
      actionTypes: {} as Record<string, number>
    };

    this.traverseTreeForStats(rootNode, stats, 0);

    return stats;
  }

  /**
   * Traverse tree to calculate statistics
   */
  private traverseTreeForStats(node: TreeNode, stats: any, depth: number): void {
    stats.totalNodes++;
    
    if (node.completed) {
      stats.completedNodes++;
    } else {
      stats.incompleteNodes++;
    }

    stats.maxDepth = Math.max(stats.maxDepth, depth);

    // Count action types
    if (stats.actionTypes[node.actionType]) {
      stats.actionTypes[node.actionType]++;
    } else {
      stats.actionTypes[node.actionType] = 1;
    }

    // Traverse children
    for (const child of node.children) {
      this.traverseTreeForStats(child, stats, depth + 1);
    }
  }

  /**
   * Calculate the depth of a node from root
   */
  private calculateNodeDepth(node: TreeNode): number {
    // This is a simplified version - in a real scenario you'd traverse from root
    // For now, return 0 as we don't track parent references
    return 0;
  }

  /**
   * Generate a visual representation of the tree for easy debugging
   */
  private generateVisualTree(node: TreeNode, depth: number, currentNodeId: string): string {
    const indent = '  '.repeat(depth);
    const isCurrent = node.id === currentNodeId ? ' ← CURRENT' : '';
    const completedMark = node.completed ? '✅' : '⏳';
    const actionTypeIcon = this.getActionTypeIcon(node.actionType);
    
    let visual = `${indent}${completedMark} ${actionTypeIcon} [${node.id}] ${node.action}${isCurrent}\n`;
    
    for (const child of node.children) {
      visual += this.generateVisualTree(child, depth + 1, currentNodeId);
    }
    
    return visual;
  }

  /**
   * Get icon for action type
   */
  private getActionTypeIcon(actionType: string): string {
    switch (actionType) {
      case 'click': return '🖱️';
      case 'hover': return '👆';
      case 'scroll': return '📜';
      case 'nothing': return '🏠';
      default: return '❓';
    }
  }

  markNodeCompleted(urlHash: string, nodeId: string): void {
    const node = this.findNodeById(this.trees.get(urlHash)!, nodeId);
    if (node) {
      node.completed = true;
      logger.info(`✅ Marked node as completed: ${nodeId}`);
      
      // Check if parent should also be marked as completed
      this.checkAndMarkParentCompleted(urlHash, nodeId);
      
      // Export updated tree structure
      this.exportTreeStructure(urlHash);
    }
  }

  private checkAndMarkParentCompleted(urlHash: string, nodeId: string): void {
    const rootTree = this.trees.get(urlHash);
    if (!rootTree) return;

    // Find the parent of the completed node
    const parentNode = this.findParentNode(rootTree, nodeId);
    if (!parentNode) return;

    // Check if all children of the parent are completed
    const allChildrenCompleted = parentNode.children.length > 0 && 
      parentNode.children.every(child => child.completed);

    if (allChildrenCompleted && !parentNode.completed) {
      parentNode.completed = true;
      logger.info(`✅ All children completed, marking parent as completed: ${parentNode.id}`);
      
      // Recursively check if the parent's parent should also be completed
      this.checkAndMarkParentCompleted(urlHash, parentNode.id);
    }
  }

  private findParentNode(node: TreeNode, targetChildId: string): TreeNode | null {
    // Check if any direct child matches the target
    for (const child of node.children) {
      if (child.id === targetChildId) {
        return node;
      }
    }
    
    // Recursively search in children
    for (const child of node.children) {
      const found = this.findParentNode(child, targetChildId);
      if (found) {
        return found;
      }
    }
    
    return null;
  }

  getNextIncompleteNode(urlHash: string): TreeNode | null {
    const rootTree = this.trees.get(urlHash);
    if (!rootTree) {
      return null;
    }
    
    // DFS to find next incomplete node
    return this.findNextIncompleteNodeDFS(rootTree);
  }

  private findNextIncompleteNodeDFS(node: TreeNode): TreeNode | null {
    // If current node is incomplete and has an action, return it
    if (!node.completed && node.action && node.action.trim() !== "") {
      return node;
    }
    
    // Otherwise, check children in DFS order
    for (const child of node.children) {
      const found = this.findNextIncompleteNodeDFS(child);
      if (found) {
        return found;
      }
    }
    
    return null;
  }

  getPathToNode(urlHash: string, targetNodeId: string): TreeNode[] {
    const rootTree = this.trees.get(urlHash);
    if (!rootTree) {
      return [];
    }
    
    const path: TreeNode[] = [];
    if (this.findPathToNodeDFS(rootTree, targetNodeId, path)) {
      return path;
    }
    
    return [];
  }

  private findPathToNodeDFS(node: TreeNode, targetId: string, path: TreeNode[]): boolean {
    path.push(node);
    
    if (node.id === targetId) {
      return true;
    }
    
    for (const child of node.children) {
      if (this.findPathToNodeDFS(child, targetId, path)) {
        return true;
      }
    }
    
    path.pop();
    return false;
  }

  getActionsFromTree(urlHash: string): string[] {
    const pageStore = this.store.get(urlHash);
    if (!pageStore) {
      logger.warn(`⚠️ Page store not found for urlHash: ${urlHash}`);
      return [];
    }
    const treeNode = this.trees.get(urlHash);
    if (!treeNode) {
      logger.warn(`⚠️ Tree node not found for urlHash: ${urlHash}`);
      return [];
    }
    const actions: string[] = [];
    this.getIncompleteActions(urlHash, actions, treeNode);
    return actions;
  }

  private getIncompleteActions(
    urlHash: string,
    currActions: string[],
    node: TreeNode
  ) {
    if (node.children.length === 0 && !node.completed) {
      currActions.push(node.action);
    } else if (node.children.length > 0 && !node.completed) {
      for (const child of node.children) {
        this.getIncompleteActions(urlHash, currActions, child);
      }
    }
  }

  /**
   * Add action to page history (only when URL doesn't change)
   */
  addAction(
    urlHash: string,
    instruction: string,
    afterActScreenshot: string,
    stepNumber: number
  ): void {
    const pageStore = this.store.get(urlHash);
    if (!pageStore) {
      logger.warn(`⚠️ Page store not found for urlHash: ${urlHash}`);
      return;
    }

    // Generate unique image name: step_X_hash_Y
    const imageHash = this.generateImageHash(afterActScreenshot);
    const imageName = `step_${stepNumber}_${imageHash}`;

    const actionEntry: ActionHistoryEntry = {
      instruction,
      after_act: afterActScreenshot,
      imageName,
      timestamp: new Date().toISOString(),
      stepNumber,
    };

    pageStore.actionHistory.push(actionEntry);
    pageStore.lastUpdated = new Date().toISOString();
    this.saveStore();

    logger.info(`📝 Added action to page store`, {
      urlHash,
      instruction: instruction.substring(0, 50),
      imageName,
      totalActions: pageStore.actionHistory.length,
    });
  }

  /**
   * Generate a short hash from image data for unique naming
   */
  private generateImageHash(imageData: string): string {
    // Simple hash generation from image data
    let hash = 0;
    const str = imageData.substring(0, 1000); // Use first 1000 chars for hash
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 8); // 8 character hex hash
  }

  /**
   * Add conversation message to page history
   */
  addConversationMessage(
    urlHash: string,
    role: "user" | "assistant",
    content: string
  ): void {
    const pageStore = this.store.get(urlHash);
    if (!pageStore) {
      logger.warn(`⚠️ Page store not found for urlHash: ${urlHash}`);
      return;
    }

    pageStore.conversationHistory.push({ role, content });
    pageStore.lastUpdated = new Date().toISOString();
    this.saveStore();
  }

  /**
   * Get conversation history for a page
   */
  getConversationHistory(
    urlHash: string
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const pageStore = this.store.get(urlHash);
    return pageStore?.conversationHistory || [];
  }

  /**
   * Get complete page store data
   */
  getPageStore(urlHash: string): PageStore | undefined {
    return this.store.get(urlHash);
  }

  /**
   * Update graph for a page
   */
  updateGraph(urlHash: string, graph: InteractionGraph): void {
    const pageStore = this.store.get(urlHash);
    if (!pageStore) {
      logger.warn(`⚠️ Page store not found for urlHash: ${urlHash}`);
      return;
    }

    pageStore.graph = graph;
    pageStore.lastUpdated = new Date().toISOString();
    this.saveStore();

    // Emit graph update event to frontend
    if (this.socket && this.userName) {
      this.socket.emit("exploration_update", {
        type: "graph_updated",
        timestamp: new Date().toISOString(),
        data: {
          userName: this.userName,
          url: pageStore.url,
          urlHash,
          graph,
          totalNodes: graph.nodes.length,
          totalEdges: graph.edges.length,
        },
      });
    }

    logger.info(`📊 Updated interaction graph`, {
      urlHash,
      url: pageStore.url,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    });
  }

  /**
   * Emit graph updating event
   */
  emitGraphUpdating(urlHash: string): void {
    const pageStore = this.store.get(urlHash);
    if (!pageStore || !this.socket || !this.userName) return;

    this.socket.emit("exploration_update", {
      type: "updating_graph",
      timestamp: new Date().toISOString(),
      data: {
        userName: this.userName,
        url: pageStore.url,
        urlHash,
      },
    });
  }

  /**
   * Get all page stores
   */
  getAllPages(): Map<string, PageStore> {
    return new Map(this.store);
  }

  /**
   * Check if graph generation is in progress for a page
   */
  isGraphGenerationInProgress(urlHash: string): boolean {
    const pageStore = this.store.get(urlHash);
    return pageStore?.isGraphGenerationInProgress || false;
  }

  /**
   * Set graph generation status for a page
   */
  setGraphGenerationInProgress(urlHash: string, inProgress: boolean): void {
    const pageStore = this.store.get(urlHash);
    if (!pageStore) {
      logger.warn(`⚠️ Page store not found for urlHash: ${urlHash}`);
      return;
    }

    pageStore.isGraphGenerationInProgress = inProgress;
    pageStore.lastUpdated = new Date().toISOString();
    this.saveStore();

    logger.info(`🔄 Graph generation status updated`, {
      urlHash,
      inProgress,
      url: pageStore.url,
    });
  }

  /**
   * Save store to file system
   */
  private saveStore(): void {
    try {
      const storeData = {
        timestamp: new Date().toISOString(),
        totalPages: this.store.size,
        pages: Object.fromEntries(
          Array.from(this.store.entries()).map(([key, value]) => [
            key,
            {
              ...value,
              // Convert conversation history to serializable format
              conversationHistory: value.conversationHistory.map((msg) => ({
                role: msg.role,
                content: msg.content,
              })),
            },
          ])
        ),
      };

      const storePath = path.join(this.baseDir, "global_store.json");
      fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2));

      logger.debug(`💾 Global store saved`, {
        path: storePath,
        totalPages: this.store.size,
      });
    } catch (error) {
      logger.error(`❌ Failed to save global store`, { error });
    }
  }

  /**
   * Load existing store from file system
   */
  private loadExistingStore(): void {
    try {
      const storePath = path.join(this.baseDir, "global_store.json");

      if (fs.existsSync(storePath)) {
        const storeData = JSON.parse(fs.readFileSync(storePath, "utf8"));

        if (storeData.pages) {
          Object.entries(storeData.pages).forEach(
            ([urlHash, pageData]: [string, any]) => {
              // Add backward compatibility for new boolean field
              if (pageData.isGraphGenerationInProgress === undefined) {
                pageData.isGraphGenerationInProgress = false;
              }
              this.store.set(urlHash, pageData as PageStore);
            }
          );

          logger.info(`📂 Loaded existing global store`, {
            totalPages: this.store.size,
            loadedFrom: storePath,
          });
        }
      }
    } catch (error) {
      logger.warn(`⚠️ Could not load existing global store`, { error });
    }
  }

  /**
   * Clear store (for cleanup)
   */
  clear(): void {
    this.store.clear();
    this.saveStore();
    logger.info(`🗑️ Global store cleared`);
  }
}
 