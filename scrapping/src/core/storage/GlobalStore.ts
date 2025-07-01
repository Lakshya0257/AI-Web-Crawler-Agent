import fs from "fs";
import path from "path";
import logger from "../../utils/logger.js";
import type { Socket } from "socket.io";

export interface ActionHistoryEntry {
  instruction: string;
  after_act: string; // Screenshot path or base64
  timestamp: string;
  stepNumber: number;
}

export interface InteractionGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  description: string;
  pageSummary: string;
  lastUpdated: string;
}

export interface GraphNode {
  id: string;
  label: string;
  description: string;
  type: "button" | "link" | "input" | "dropdown" | "toggle" | "tab" | "section" | "dialog" | "state" | "navigation_target";
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
}

export class GlobalStore {
  private store: Map<string, PageStore> = new Map();
  private baseDir: string;
  private socket?: Socket;
  private userName?: string;

  constructor(baseDir: string, socket?: Socket, userName?: string) {
    this.baseDir = baseDir;
    this.socket = socket;
    this.userName = userName;
    this.loadExistingStore();
  }

  /**
   * Initialize page store for a URL
   */
  initializePage(url: string, urlHash: string, initialScreenshot: string): void {
    if (!this.store.has(urlHash)) {
      const pageStore: PageStore = {
        url,
        urlHash,
        initialScreenshot,
        actionHistory: [],
        conversationHistory: [],
        lastUpdated: new Date().toISOString()
      };
      
      this.store.set(urlHash, pageStore);
      this.saveStore();
      
      logger.info(`📦 Initialized page store for: ${url}`, {
        urlHash,
        totalPages: this.store.size
      });
    }
  }

  /**
   * Add action to page history (only when URL doesn't change)
   */
  addAction(urlHash: string, instruction: string, afterActScreenshot: string, stepNumber: number): void {
    const pageStore = this.store.get(urlHash);
    if (!pageStore) {
      logger.warn(`⚠️ Page store not found for urlHash: ${urlHash}`);
      return;
    }

    const actionEntry: ActionHistoryEntry = {
      instruction,
      after_act: afterActScreenshot,
      timestamp: new Date().toISOString(),
      stepNumber
    };

    pageStore.actionHistory.push(actionEntry);
    pageStore.lastUpdated = new Date().toISOString();
    this.saveStore();

    logger.info(`📝 Added action to page store`, {
      urlHash,
      instruction: instruction.substring(0, 50),
      totalActions: pageStore.actionHistory.length
    });
  }

  /**
   * Add conversation message to page history
   */
  addConversationMessage(urlHash: string, role: "user" | "assistant", content: string): void {
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
  getConversationHistory(urlHash: string): Array<{ role: "user" | "assistant"; content: string }> {
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
      this.socket.emit('exploration_update', {
        type: 'graph_updated',
        timestamp: new Date().toISOString(),
        data: {
          userName: this.userName,
          url: pageStore.url,
          urlHash,
          graph,
          totalNodes: graph.nodes.length,
          totalEdges: graph.edges.length
        }
      });
    }

    logger.info(`📊 Updated interaction graph`, {
      urlHash,
      url: pageStore.url,
      nodes: graph.nodes.length,
      edges: graph.edges.length
    });
  }

  /**
   * Emit graph updating event
   */
  emitGraphUpdating(urlHash: string): void {
    const pageStore = this.store.get(urlHash);
    if (!pageStore || !this.socket || !this.userName) return;

    this.socket.emit('exploration_update', {
      type: 'updating_graph',
      timestamp: new Date().toISOString(),
      data: {
        userName: this.userName,
        url: pageStore.url,
        urlHash
      }
    });
  }

  /**
   * Get all page stores
   */
  getAllPages(): Map<string, PageStore> {
    return new Map(this.store);
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
              conversationHistory: value.conversationHistory.map(msg => ({
                role: msg.role,
                content: msg.content
              }))
            }
          ])
        )
      };

      const storePath = path.join(this.baseDir, 'global_store.json');
      fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2));

      logger.debug(`💾 Global store saved`, {
        path: storePath,
        totalPages: this.store.size
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
      const storePath = path.join(this.baseDir, 'global_store.json');
      
      if (fs.existsSync(storePath)) {
        const storeData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        
        if (storeData.pages) {
          Object.entries(storeData.pages).forEach(([urlHash, pageData]: [string, any]) => {
            this.store.set(urlHash, pageData as PageStore);
          });
          
          logger.info(`📂 Loaded existing global store`, {
            totalPages: this.store.size,
            loadedFrom: storePath
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