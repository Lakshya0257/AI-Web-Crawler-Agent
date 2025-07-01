import { Page } from "playwright";
import { generateObject, LanguageModel } from "ai";
import { vertex } from "@ai-sdk/google-vertex";
import { z } from "zod";
import logger from "../../utils/logger.js";
import { GlobalStore, PageStore } from "../storage/GlobalStore.js";
import { FileManager } from "../storage/FileManager.js";
import type { Socket } from "socket.io";

export interface ChatMessage {
  id: string;
  timestamp: string;
  role: "user" | "assistant";
  content: string;
  messageType: "chat" | "system";
}

export interface ChatDecision {
  reasoning: string;
  requestType: "task_specific" | "exploration" | "question";
  targetPage?: string;
  targetUrl?: string;
  needsUserInput: boolean;
  userInputPrompt?: string;
  response: string;
}

export interface ExplorationCheckpoint {
  timestamp: string;
  currentPageUrl: string;
  currentPageHash: string;
  queuePosition: number;
  remainingQueue: string[];
  explorationPhase: "active" | "completed" | "paused";
  lastStepNumber: number;
}

// Zod schema for ChatDecision
const ChatDecisionSchema = z.object({
  reasoning: z
    .string()
    .describe("Analysis of the user's request and categorization reasoning"),
  requestType: z
    .enum(["task_specific", "exploration", "question"])
    .describe("Type of user request"),
  targetPage: z
    .string()
    .optional()
    .describe("Page name/description if navigation needed"),
  targetUrl: z
    .string()
    .optional()
    .describe("Exact URL to navigate to if known"),
  needsUserInput: z
    .boolean()
    .describe("Whether clarification from user is needed"),
  userInputPrompt: z
    .string()
    .optional()
    .describe("Question to ask user if clarification needed"),
  response: z
    .string()
    .describe("Response message to the user explaining next actions"),
});

export class ChatAgent {
  private model: LanguageModel;
  private chatHistory: ChatMessage[] = [];
  private socket?: Socket;
  private userName?: string;

  constructor(
    private page: Page,
    private globalStore: GlobalStore,
    private fileManager: FileManager,
    socket?: Socket,
    userName?: string
  ) {
    this.model = vertex("gemini-1.5-pro");
    this.socket = socket;
    this.userName = userName;
  }

  /**
   * Handle user chat message and decide response
   */
  async handleChatMessage(
    userMessage: string,
    explorationCheckpoint: ExplorationCheckpoint
  ): Promise<ChatDecision> {
    try {
      // Add user message to chat history
      this.addChatMessage("user", userMessage);

      // Get all page stores for context
      const allPages = this.globalStore.getAllPages();
      const pageContexts = this.buildPageContexts(allPages);

      const systemPrompt = `You are an intelligent chat agent helping users interact with web pages during exploration.

CURRENT CONTEXT:
- Exploration Status: ${explorationCheckpoint.explorationPhase}
- Current Page: ${explorationCheckpoint.currentPageUrl}
- Remaining Pages in Queue: ${explorationCheckpoint.remainingQueue.length}
- Total Explored Pages: ${allPages.size}

AVAILABLE PAGES WITH CAPABILITIES:
${pageContexts}

EXPLORATION CHECKPOINT:
- Last Step: ${explorationCheckpoint.lastStepNumber}
- Queue Position: ${explorationCheckpoint.queuePosition}/${explorationCheckpoint.remainingQueue.length + explorationCheckpoint.queuePosition}

USER CHAT HISTORY:
${this.chatHistory
  .slice(-10)
  .map((msg) => `${msg.role}: ${msg.content}`)
  .join("\n")}

TASK: Analyze the user's message and decide how to respond based on the complete visual context of all explored pages.

REQUEST TYPES:
1. "task_specific": User wants to perform a specific task (fill forms, make purchases, etc.)
2. "exploration": User wants to explore or discover more pages/content
3. "question": User is asking questions about what was found or needs clarification

CAPABILITIES:
- Navigate to any explored page using stagehand.page.goto()
- Access page-level conversation history for context
- Ask clarifying questions using user input prompts
- Continue exploration or perform specific tasks

IMPORTANT DECISION FACTORS:
- If user mentions specific functionality → likely "task_specific"
- If user wants to "explore more" or "check out" → likely "exploration"  
- If user asks "what did you find" or "can you tell me" → likely "question"
- If unclear → ask for clarification

Based on the visual context and exploration history provided, analyze the user's request and provide an appropriate response.`;

      // Build comprehensive visual context with all page screenshots and histories
      const visualContextMessages = this.buildComprehensiveVisualContext(allPages, userMessage);

      const response = await generateObject({
        model: this.model,
        schema: ChatDecisionSchema,
        system: systemPrompt,
        maxTokens: 2000,
        messages: visualContextMessages,
      });

      console.log("🗨️ Chat decision response", response.object);

      const decision = response.object as ChatDecision;

      // Add assistant response to chat history
      this.addChatMessage("assistant", decision.response);

      logger.info(`🗨️ Chat decision made`, {
        requestType: decision.requestType,
        targetPage: decision.targetPage,
        needsUserInput: decision.needsUserInput,
      });

      return decision;
    } catch (error) {
      console.log("❌ Chat decision handling failed", error);
      logger.error("❌ Chat message handling failed", { error });

      const fallbackDecision: ChatDecision = {
        reasoning: "Error processing request",
        requestType: "question",
        needsUserInput: false,
        response:
          "I encountered an error processing your request. Could you please rephrase or try again?",
      };

      this.addChatMessage("assistant", fallbackDecision.response);
      return fallbackDecision;
    }
  }

  /**
   * Navigate to target page for chat request
   */
  async navigateToPage(targetUrl: string): Promise<boolean> {
    try {
      logger.info(`🧭 Navigating to page for chat: ${targetUrl}`);

      await this.page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // Take screenshot after navigation
      const screenshot = await this.page.screenshot({ fullPage: false });
      const screenshotPath = this.fileManager.saveScreenshot(
        FileManager.generateUrlHash(targetUrl),
        Date.now(),
        "chat_navigation",
        screenshot
      );

      logger.info(`📸 Chat navigation screenshot saved: ${screenshotPath}`);

      // Emit navigation event
      if (this.socket && this.userName) {
        this.socket.emit("exploration_update", {
          type: "chat_navigation",
          timestamp: new Date().toISOString(),
          data: {
            userName: this.userName,
            targetUrl,
            screenshotPath,
          },
        });
      }

      return true;
    } catch (error) {
      console.log("❌ Chat navigation failed", error, targetUrl);
      logger.error("❌ Chat navigation failed", { error, targetUrl });
      return false;
    }
  }

  /**
   * Get conversation history for a specific page
   */
  getPageConversationHistory(
    urlHash: string
  ): Array<{ role: "user" | "assistant"; content: string }> {
    return this.globalStore.getConversationHistory(urlHash);
  }

  /**
   * Get chat messages (isolated from exploration)
   */
  getChatHistory(): ChatMessage[] {
    return [...this.chatHistory];
  }

  /**
   * Clear chat history
   */
  clearChatHistory(): void {
    this.chatHistory = [];
  }

  /**
   * Add message to chat history
   */
  private addChatMessage(role: "user" | "assistant", content: string): void {
    const message: ChatMessage = {
      id: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      role,
      content,
      messageType: "chat",
    };

    this.chatHistory.push(message);

    // Emit chat message event
    if (this.socket && this.userName) {
      this.socket.emit("exploration_update", {
        type: "chat_message",
        timestamp: new Date().toISOString(),
        data: {
          userName: this.userName,
          message,
        },
      });
    }

    // Keep chat history reasonable size (last 50 messages)
    if (this.chatHistory.length > 50) {
      this.chatHistory = this.chatHistory.slice(-50);
    }
  }

  /**
   * Build comprehensive visual context with all page screenshots and histories
   */
  private buildComprehensiveVisualContext(
    allPages: Map<string, PageStore>,
    userMessage: string
  ): Array<{ role: "user" | "assistant"; content: any[] }> {
    const messages: Array<{ role: "user" | "assistant"; content: any[] }> = [];

    // Add context for each explored page
    Array.from(allPages.entries()).forEach(([urlHash, pageStore], pageIndex) => {
      // Add initial page screenshot with context
      messages.push({
        role: "user",
        content: [
          {
            type: "image",
            image: pageStore.initialScreenshot,
          },
          {
            type: "text",
            text: `PAGE ${pageIndex + 1}: ${pageStore.url}
Initial state when exploration started.
Total actions performed on this page: ${pageStore.actionHistory.length}`,
          },
        ],
      });

      // Add action history with screenshots for this page
      pageStore.actionHistory.forEach((action, actionIndex) => {
        // Add action description
        messages.push({
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Page ${pageIndex + 1} - Action ${actionIndex + 1}: ${action.instruction}`,
            },
          ],
        });

        // Add after-action screenshot
        messages.push({
          role: "user",
          content: [
            {
              type: "image",
              image: action.after_act,
            },
            {
              type: "text",
              text: `Page ${pageIndex + 1} - Result after action ${actionIndex + 1}: "${action.instruction}"
Timestamp: ${action.timestamp}`,
            },
          ],
        });
      });

      // Add page summary if available
      if (pageStore.graph?.pageSummary) {
        messages.push({
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Page ${pageIndex + 1} Summary: ${pageStore.graph.pageSummary}`,
            },
          ],
        });
      }
    });

    // Add user's current message
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: `Current user request: "${userMessage}"

Based on all the visual context and exploration history above, analyze this request and determine the appropriate response type and actions.`,
        },
      ],
    });

    return messages;
  }

  /**
   * Build page contexts for LLM decision making
   */
  private buildPageContexts(allPages: Map<string, PageStore>): string {
    const contexts: string[] = [];

    for (const [urlHash, pageStore] of allPages.entries()) {
      const summary = pageStore.graph?.pageSummary || "No summary available";
      const actionCount = pageStore.actionHistory.length;

      contexts.push(`
📄 ${pageStore.url}
   Summary: ${summary.substring(0, 200)}${summary.length > 200 ? "..." : ""}
   Actions Performed: ${actionCount}
   Graph Available: ${pageStore.graph ? "Yes" : "No"}
   Hash: ${urlHash}
`);
    }

    return contexts.join("\n");
  }
}
