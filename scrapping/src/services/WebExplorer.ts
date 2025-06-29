import { Browser, Page } from "playwright";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import fs from "fs";
import path from "path";
import logger from "../utils/logger.js";
import { FileManager } from "./FileManager.js";
import { LLMClient } from "./LLMClient.js";
import {
  ExplorationSession,
  SessionMetadata,
  PageData,
  ExecutedStep,
  UserInputData,
  FlowContext,
  ExtractionResult,
  PageScreenshot,
} from "../types/exploration.js";
import type { Socket } from "socket.io";

export class WebExplorer {
  protected session: ExplorationSession;
  private fileManager: FileManager;
  private llmClient: LLMClient;
  private stagehand: Stagehand;
  private sessionDecisionHistory: any[] = []; // Track all decisions made during the session
  private isExplorationObjective: boolean; // Add exploration mode detection
  private activeProcessingPromises: Map<string, Promise<void>> = new Map(); // Track background processing
  protected pageLinkages: Map<string, string[]> = new Map(); // Track which page leads to which pages
  private maxPagesToExplore: number; // Maximum pages to explore
  protected socket?: Socket;
  protected userName?: string;
  private activeExplorations?: Map<string, WebExplorer>; // Reference to activeExplorations from SocketServer
  private additionalContext?: string;
  private canLogin: boolean;

  constructor(
    private browser: Browser,
    private page: Page,
    private objective: string,
    startUrl: string,
    stagehand: Stagehand,
    maxPagesToExplore: number = 6,
    socket?: Socket,
    userName?: string,
    activeExplorations?: Map<string, WebExplorer>,
    isExploration: boolean = false,
    additionalContext?: string,
    canLogin: boolean = false
  ) {
    this.stagehand = stagehand;
    this.maxPagesToExplore = maxPagesToExplore;
    this.socket = socket;
    this.userName = userName;
    this.activeExplorations = activeExplorations;
    this.additionalContext = additionalContext;
    this.canLogin = canLogin;

    // Use the provided isExploration boolean instead of detecting from objective
    this.isExplorationObjective = isExploration;

    const sessionId = FileManager.generateSessionId(startUrl);
    this.fileManager = new FileManager(sessionId, socket, userName);
    this.llmClient = new LLMClient(
      this.fileManager,
      this.additionalContext,
      this.canLogin
    );

    // Initialize session
    this.session = {
      metadata: {
        sessionId,
        startTime: new Date().toISOString(),
        objective,
        startUrl,
        totalPagesDiscovered: 0,
        totalActionsExecuted: 0,
        objectiveAchieved: false,
        currentPhase: "active",
      },
      pages: new Map(),
      pageQueue: [],
      globalStepCounter: 0,
      userInputs: new Map(),
      flowContext: {
        isInSensitiveFlow: false,
      },
      actionHistory: [],
    };

    // Initialize file structure
    this.fileManager.initializeSession();
    this.saveSession();

    logger.info("🚀 WebExplorer initialized", {
      sessionId,
      objective,
      startUrl,
      isExplorationMode: this.isExplorationObjective,
      userName: this.userName,
      folderStructure: this.userName
        ? `User-specific folder: ${this.userName}`
        : "Default exploration_sessions folder",
    });
  }

  /**
   * Main exploration method implementing the tool-driven flow
   */
  async explore(maxPagesToExplore?: number): Promise<boolean> {
    // Update maxPagesToExplore if provided
    if (maxPagesToExplore !== undefined) {
      this.maxPagesToExplore = maxPagesToExplore;
    }
    try {
      // Add starting URL to queue
      await this.addUrlToQueue(this.session.metadata.startUrl, 1);

      return await this.exploreSequentially();
    } catch (error) {
      logger.error("❌ Exploration failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return await this.finalizeSession(false);
    }
  }

  /**
   * Sequential exploration for task-focused objectives
   */
  private async exploreSequentially(): Promise<boolean> {
    // Main exploration loop - sequential processing
    while (this.session.pageQueue.length > 0) {
      // Check if user is still active
      if (!this.isUserStillActive()) {
        logger.info(
          "🛑 Stopping sequential exploration - user no longer active"
        );
        return await this.finalizeSession(false);
      }

      if (this.session.metadata.objectiveAchieved) {
        logger.info("✅ Objective achieved!");
        return await this.finalizeSession(true);
      }

      // Get next page from queue
      const urlHash = this.session.pageQueue.shift()!;
      const pageData = this.session.pages.get(urlHash)!;

      await this.processPage(pageData);
    }

    return await this.finalizeSession(false);
  }

  /**
   * Background processing exploration for exploration objectives
   */
  private async exploreWithBackgroundProcessing(): Promise<boolean> {
    logger.info("🔍 Starting exploration mode with background processing");

    // Process pages with background processing
    while (true) {
      // Check if user is still active
      if (!this.isUserStillActive()) {
        logger.info(
          "🛑 Stopping background exploration - user no longer active"
        );
        return await this.finalizeSession(false);
      }

      // Check if objective is achieved
      if (this.session.metadata.objectiveAchieved) {
        logger.info("✅ Objective achieved!");
        // Wait for all background processing to complete
        await this.waitForAllProcessingToComplete();
        return await this.finalizeSession(true);
      }

      // Check if we have queued pages to process
      if (this.session.pageQueue.length > 0) {
        // Get next page from queue
        const urlHash = this.session.pageQueue.shift()!;
        const pageData = this.session.pages.get(urlHash)!;

        // Start processing in background (don't await)
        const processingPromise = this.processPage(pageData).finally(() => {
          // Clean up completed promise
          this.activeProcessingPromises.delete(urlHash);
        });

        // Track the processing promise
        this.activeProcessingPromises.set(urlHash, processingPromise);

        logger.info(`🔄 Started background processing for: ${pageData.url}`, {
          activeProcessing: this.activeProcessingPromises.size,
          queueRemaining: this.session.pageQueue.length,
        });

        // Small delay to prevent overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        // No more queued pages, check if all processing is complete
        if (this.activeProcessingPromises.size === 0) {
          // All pages have been processed
          const allPagesCompleted = this.areAllPagesCompleted();
          if (allPagesCompleted) {
            logger.info("✅ All pages completed in exploration mode");
            return await this.finalizeSession(false);
          } else {
            // Wait a bit and check again (some pages might still be processing)
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } else {
          // Wait for some processing to complete
          logger.info(`⏳ Waiting for background processing to complete...`, {
            activeProcessing: this.activeProcessingPromises.size,
          });
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }
  }

  /**
   * Wait for all active processing to complete
   */
  private async waitForAllProcessingToComplete(): Promise<void> {
    if (this.activeProcessingPromises.size > 0) {
      logger.info(
        `⏳ Waiting for ${this.activeProcessingPromises.size} background processes to complete...`
      );
      await Promise.allSettled(
        Array.from(this.activeProcessingPromises.values())
      );
      this.activeProcessingPromises.clear();
    }
  }

  /**
   * Check if all discovered pages have completed status
   */
  private areAllPagesCompleted(): boolean {
    for (const [urlHash, pageData] of this.session.pages) {
      if (pageData.status !== "completed") {
        return false;
      }
    }
    return true;
  }

  /**
   * Process a single page with tool-driven approach
   */
  protected async processPage(pageData: PageData): Promise<void> {
    // Check if user is still active before processing page
    if (!this.isUserStillActive()) {
      logger.info(`🛑 Stopping page processing - user no longer active`);
      return;
    }

    logger.info(`🔍 Processing page: ${pageData.url}`);

    // Emit page started event
    if (this.socket && this.userName) {
      this.socket.emit("exploration_update", {
        type: "page_started",
        timestamp: new Date().toISOString(),
        data: {
          userName: this.userName,
          url: pageData.url,
          urlHash: pageData.urlHash,
          status: pageData.status,
        },
      });
    }

    try {
      // Navigate to page
      await this.page.goto(pageData.url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // await this.page.waitForTimeout(3000);

      pageData.status = "in_progress";
      this.session.currentPage = pageData.urlHash;
      this.saveSession();

      // Main tool execution loop for this page
      let maxStepsPerPage = 10; // Prevent infinite loops
      let stepsOnThisPage = 0;

      // Take initial screenshot of the page
      const screenshotBuffer = await this.page.screenshot({ fullPage: true });

      // Save initial page screenshot
      const initialScreenshotPath = this.fileManager.saveScreenshot(
        pageData.urlHash,
        0, // Step 0 for initial page load
        "initial_page_load",
        screenshotBuffer
      );

      // Store screenshot in page data
      pageData.screenshots.push({
        stepNumber: 0,
        timestamp: new Date().toISOString(),
        type: "initial",
        filePath: initialScreenshotPath,
        buffer: screenshotBuffer, // For LLM processing
      });

      logger.info(`📸 Initial page screenshot saved: ${initialScreenshotPath}`);

      const conversationHistory: Array<{
        role: "user" | "assistant";
        content: string;
      }> = [];

      while (
        stepsOnThisPage < maxStepsPerPage &&
        !this.session.metadata.objectiveAchieved
      ) {
        // Check if user is still active before each step
        if (!this.isUserStillActive()) {
          logger.info(
            `🛑 Stopping page processing loop - user no longer active`
          );
          return;
        }

        // Ask LLM to decide which tool to use next
        this.session.globalStepCounter++;

        // Take screenshot before LLM decision
        const currentScreenshotBuffer = await this.page.screenshot();

        // Check if max pages limit has been reached
        const maxPagesReached =
          this.session.metadata.totalPagesDiscovered >= this.maxPagesToExplore;

        // Check if user is still active before LLM call
        if (!this.isUserStillActive()) {
          logger.info(
            `🛑 Stopping before LLM decision - user no longer active`
          );
          return;
        }

        const decision = await this.llmClient.decideNextAction(
          currentScreenshotBuffer,
          pageData.url,
          this.session.metadata.objective,
          pageData.urlHash,
          this.session.globalStepCounter,
          conversationHistory,
          this.session.pageQueue,
          this.session.pages,
          this.isExplorationObjective,
          maxPagesReached,
          this.session.userInputs,
          this.session.flowContext,
          this.session.actionHistory
        );

        // Check if user is still active after LLM call
        if (!this.isUserStillActive()) {
          logger.info(`🛑 Stopping after LLM decision - user no longer active`);
          return;
        }

        if (!decision) {
          logger.warn("❌ Failed to get LLM decision, moving to next page");
          break;
        }

        // Emit LLM decision event
        if (this.socket && this.userName) {
          this.socket.emit("exploration_update", {
            type: "llm_decision",
            timestamp: new Date().toISOString(),
            data: {
              userName: this.userName,
              url: pageData.url,
              urlHash: pageData.urlHash,
              stepNumber: this.session.globalStepCounter,
              decision: {
                tool: decision.tool_to_use,
                instruction: decision.tool_parameters.instruction,
                reasoning: decision.reasoning,
                nextPlan: decision.next_plan,
                isPageCompleted: decision.isCurrentPageExecutionCompleted,
              },
              maxPagesReached,
            },
          });
        }

        conversationHistory.push({
          role: "assistant",
          content: JSON.stringify(decision),
        });

        // Add to session-level decision history
        const decisionEntry = {
          stepNumber: this.session.globalStepCounter,
          timestamp: new Date().toISOString(),
          url: pageData.url,
          urlHash: pageData.urlHash,
          objective: this.session.metadata.objective,
          decision: decision,
          conversationContext: [...conversationHistory], // Copy of conversation at this point
        };
        this.sessionDecisionHistory.push(decisionEntry);

        logger.info(`🤖 LLM Decision: ${decision.tool_to_use}`, {
          reasoning: decision.reasoning,
          instruction: decision.tool_parameters.instruction,
          nextPlan: decision.next_plan,
          isCurrentPageExecutionCompleted:
            decision.isCurrentPageExecutionCompleted,
        });

        // Emit tool execution start event
        if (this.socket && this.userName) {
          this.socket.emit("exploration_update", {
            type: "tool_execution_started",
            timestamp: new Date().toISOString(),
            data: {
              userName: this.userName,
              url: pageData.url,
              urlHash: pageData.urlHash,
              stepNumber: this.session.globalStepCounter,
              tool: decision.tool_to_use,
              instruction: decision.tool_parameters.instruction,
            },
          });
        }

        // Update flow context based on LLM decision
        if (decision.isInSensitiveFlow !== undefined) {
          this.session.flowContext.isInSensitiveFlow =
            decision.isInSensitiveFlow;
          if (decision.isInSensitiveFlow) {
            this.session.flowContext.flowType = "login";
            this.session.flowContext.startUrl = pageData.url;
            this.session.flowContext.flowStartStep =
              this.session.globalStepCounter;
          }
        }

        // Execute the chosen tool
        let stepResult: ExecutedStep | null = null;

        if (decision.tool_to_use === "user_input") {
          // Special handling for user_input tool to support both single and multiple inputs
          stepResult = await this.executeUserInputTool(
            decision.tool_parameters,
            pageData,
            currentScreenshotBuffer
          );
        } else {
          stepResult = await this.executeTool(
            decision.tool_to_use,
            decision.tool_parameters.instruction,
            pageData,
            currentScreenshotBuffer,
            decision.tool_parameters.inputKey,
            decision.tool_parameters.inputType,
            decision.tool_parameters.inputPrompt,
            decision.tool_parameters.sensitive,
            decision.tool_parameters.waitTimeSeconds
          );
        }

        // Don't count standby or sensitive flow steps towards page limits
        if (
          !decision.isInSensitiveFlow &&
          decision.tool_to_use !== "standby" &&
          !stepResult?.newUrl
        ) {
          stepsOnThisPage++;
        }

        // Check if tool execution was stopped due to user being inactive
        if (stepResult === null) {
          logger.info(`🛑 Tool execution stopped - user no longer active`);
          return;
        }

        // Emit tool execution completed event
        if (this.socket && this.userName) {
          this.socket.emit("exploration_update", {
            type: "tool_execution_completed",
            timestamp: new Date().toISOString(),
            data: {
              userName: this.userName,
              url: pageData.url,
              urlHash: pageData.urlHash,
              stepNumber: this.session.globalStepCounter,
              tool: decision.tool_to_use,
              instruction: decision.tool_parameters.instruction,
              success: stepResult?.success || false,
              result: stepResult?.result,
              urlChanged: stepResult?.urlChanged,
              newUrl: stepResult?.newUrl,
              objectiveAchieved: stepResult?.objectiveAchieved,
            },
          });
        }

        conversationHistory.push({
          role: "user",
          content: `Tool result: ${JSON.stringify(stepResult)}`,
        });

        if (!stepResult) {
          logger.warn("❌ Tool execution failed, continuing...");
          continue;
        }

        if (stepResult.tool_used === "page_act" && !stepResult.newUrl) {
          this.fileManager.saveScreenshot(
            pageData.urlHash,
            this.session.globalStepCounter,
            "before_decision",
            currentScreenshotBuffer
          );
          const afterToolScreenshotBuffer = await this.page.screenshot({
            fullPage: false,
          });

          // Save screenshot after tool execution
          const afterToolScreenshotPath = this.fileManager.saveScreenshot(
            pageData.urlHash,
            this.session.globalStepCounter,
            `after_${decision.tool_to_use}`,
            afterToolScreenshotBuffer
          );

          // Store screenshot in page data
          pageData.screenshots.push({
            stepNumber: this.session.globalStepCounter,
            timestamp: new Date().toISOString(),
            type: "after_page_act",
            filePath: afterToolScreenshotPath,
            buffer: afterToolScreenshotBuffer, // For LLM processing
          });

          logger.info(
            `📸 Post-tool screenshot saved: ${afterToolScreenshotPath}`
          );
        }

        // Record the executed step
        pageData.executedSteps.push(stepResult);
        pageData.lastStepNumber = this.session.globalStepCounter;
        this.session.metadata.totalActionsExecuted++;

        // Check if objective is achieved
        if (stepResult.objectiveAchieved && !this.isExplorationObjective) {
          this.session.metadata.objectiveAchieved = true;
          pageData.objectiveAchieved = true;
          logger.info("🎉 Objective achieved!");

          this.saveSession();
          break;
        }

        // Check if LLM indicated this page execution should be completed
        if (decision.isCurrentPageExecutionCompleted) {
          logger.info("✅ LLM indicated current page execution is completed", {
            reason: "LLM set isCurrentPageExecutionCompleted to true",
            lastAction: decision.tool_parameters.instruction,
            nextPlan: decision.next_plan,
          });
          this.saveSession();
          break;
        }

        this.saveSession();
      }

      // Save session conversation history after page processing
      this.fileManager.saveSessionConversationHistory(
        this.sessionDecisionHistory
      );

      // Take final screenshot of completed page
      // const finalScreenshotBuffer = await this.page.screenshot({
      //   fullPage: false,
      // });

      // // Save final page screenshot
      // const finalScreenshotPath = this.fileManager.saveScreenshot(
      //   pageData.urlHash,
      //   this.session.globalStepCounter,
      //   "page_completed",
      //   finalScreenshotBuffer
      // );

      // logger.info(`📸 Final page screenshot saved: ${finalScreenshotPath}`);

      // Mark page as completed
      pageData.status = "completed";
      this.fileManager.savePageData(pageData.urlHash, pageData);

      // Emit page completed event
      if (this.socket && this.userName) {
        this.socket.emit("exploration_update", {
          type: "page_completed",
          timestamp: new Date().toISOString(),
          data: {
            userName: this.userName,
            url: pageData.url,
            urlHash: pageData.urlHash,
            status: pageData.status,
            stepsExecuted: pageData.executedSteps.length,
          },
        });
      }

      logger.info(`✅ Page processing completed: ${pageData.url}`, {
        stepsExecuted: stepsOnThisPage,
        totalSteps: pageData.executedSteps.length,
      });
    } catch (error) {
      logger.error(`❌ Page processing failed: ${pageData.url}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      pageData.status = "completed"; // Mark as completed even if failed
    }

    this.saveSession();
  }

  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);

      // Comment out query parameters and hash removal for now
      // urlObj.search = "";
      // urlObj.hash = "";

      // Remove trailing slash from pathname (except for root path)
      if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith("/")) {
        urlObj.pathname = urlObj.pathname.slice(0, -1);
      }

      return urlObj.toString();
    } catch (error) {
      // If URL is invalid, return original string
      console.warn(`Invalid URL: ${url}`);
      return url;
    }
  }

  /**
   * Helper function to execute action and check if URL changes
   * Returns { newUrl: string | null, actionResult: any }
   */
  private async executeActionAndCheckUrlChange(
    instruction: string
  ): Promise<{ newUrl: string | null; actionResult: any }> {
    // Store the current URL before executing action
    const originalUrl = this.normalizeUrl(this.page.url());

    logger.info(`🔍 Executing action with URL check: ${instruction}`, {
      originalUrl,
    });

    // Execute the action using Stagehand
    let actResult;

    if (instruction.includes("Navigate") || instruction.includes("navigate")) {
      //extract the url from the instruction Navigate to https://example.com/login using split
      const url = instruction.split(" ")[2];
      await this.stagehand.page.goto(url);
      actResult = { success: true, error: null };
    } else {
      actResult = await this.toolPageAct(instruction);
    }

    if (!actResult.success) {
      logger.error(`❌ Action failed: ${actResult.error}`);
      return { newUrl: null, actionResult: actResult };
    }

    // Check if URL changed after action
    const newUrl = this.normalizeUrl(this.page.url());
    const urlChanged = newUrl !== originalUrl;

    if (urlChanged) {
      logger.info(`🔄 URL changed: ${originalUrl} → ${newUrl}`);

      // Check if we're in a sensitive flow (login, signup, etc.)
      if (this.session.flowContext.isInSensitiveFlow) {
        // In sensitive flow - stay on new page, don't navigate back
        logger.info(
          `🔒 Sensitive flow detected - staying on new URL: ${newUrl}`
        );

        return { newUrl: null, actionResult: actResult };
      } else {
        // Normal flow - navigate back to original URL for continued processing
        logger.info(`🔙 Navigating back to original URL: ${originalUrl}`);
        await this.page.goto(originalUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        // await this.page.waitForTimeout(2000);

        // Return the new URL that was discovered and the action result
        return { newUrl: newUrl, actionResult: actResult };
      }
    } else {
      // URL didn't change, don't reload, just return the result
      logger.debug(`✅ URL remained the same: ${originalUrl}`);
      return { newUrl: null, actionResult: actResult };
    }
  }

  /**
   * Stagehand tool implementations
   */
  private async toolPageAct(instruction: string): Promise<any> {
    console.log(`🎬 Acting: ${instruction}`);
    try {
      console.log(
        `🔧 Calling stagehand.page.act with instruction: "${instruction}"`
      );

      // const result = await this.stagehand.page.act({
      //   action: instruction,
      // });

      const agent = this.stagehand.agent({
        // You can use either OpenAI or Anthropic
        provider: "anthropic",
        // The model to use (claude-3-7-sonnet-latest for Anthropic)
        model: "claude-3-7-sonnet-latest",

        // Customize the system prompt
        instructions: `You are a helpful assistant that can use a web browser.
    Do not ask follow up questions, the user will trust your judgement.`,

        // Customize the API key
        options: {
          apiKey: process.env.ANTHROPIC_API_KEY,
        },
      });

      // Execute the agent
      const result = await agent.execute(instruction);

      // const result = await this.stagehand.page.act({
      //   action: instruction,
      // });

      if (!result.success) {
        throw new Error(
          `Action failed for instruction ${instruction}: ${JSON.stringify(result, null, 2)}`
        );
      }
      console.log(`✅ Act succeeded:`, result);
      return { success: true, action: instruction, result };
    } catch (error) {
      console.error(`❌ Act failed with error:`, error);
      console.error(`❌ Error type:`, typeof error);
      console.error(
        `❌ Error message:`,
        error instanceof Error ? error.message : String(error)
      );
      console.error(
        `❌ Error stack:`,
        error instanceof Error ? error.stack : "No stack trace"
      );
      return {
        error: `Action failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private async toolPageExtract(instruction: string): Promise<any> {
    console.log(`🔍 Extracting: ${instruction}`);
    try {
      // Enhanced schema for more comprehensive analysis
      const extractSchema = z.object({
        extracted_data: z
          .string()
          .describe(
            "Comprehensive analysis of the page content, features, and functionality. Focus on business value, user experience patterns, technical capabilities, and strategic insights rather than just listing visible elements. Analyze what you see in context of the overall platform strategy."
          ),
        elements_found: z
          .array(z.string())
          .describe(
            "Key functional elements and features that indicate platform capabilities and user experience design"
          ),
        page_structure: z
          .string()
          .describe(
            "Analysis of page architecture, information hierarchy, and UX design patterns used"
          ),
        interactive_elements: z
          .array(z.string())
          .describe(
            "Interactive features and their strategic purpose in the user journey and conversion funnel"
          ),
        business_insights: z
          .string()
          .describe(
            "Business model indicators, monetization clues, competitive positioning signals, and strategic market approach evident on this page"
          ),
        technical_observations: z
          .string()
          .describe(
            "Technical architecture insights, scalability indicators, integration capabilities, and platform sophistication level"
          ),
      });

      // Enhanced instruction to get better analytical data
      const enhancedInstruction = `${instruction}

ANALYSIS APPROACH: Act as a senior product manager analyzing this platform. Focus on:
1. Business strategy and value proposition signals
2. User experience design patterns and conversion optimization
3. Technical architecture and capability indicators  
4. Competitive positioning and market approach
5. Revenue model and monetization strategy clues
6. Growth and user acquisition tactics

Provide comprehensive insights rather than just listing visible elements. Analyze WHY features exist and HOW they contribute to the platform's business objectives.`;

      console.log(
        `🔧 Calling stagehand.page.extract with enhanced instruction`
      );

      const result = await this.stagehand.page.extract({
        instruction: enhancedInstruction,
        schema: extractSchema,
      });

      console.log(`✅ Extract succeeded:`, result);
      return { success: true, data: result };
    } catch (error) {
      console.error(`❌ Extract failed with error:`, error);
      console.error(`❌ Error type:`, typeof error);
      console.error(
        `❌ Error message:`,
        error instanceof Error ? error.message : String(error)
      );
      console.error(
        `❌ Error stack:`,
        error instanceof Error ? error.stack : "No stack trace"
      );

      // Fallback to simple string extraction
      try {
        const fallbackResult = await this.stagehand.page.extract({
          instruction,
          schema: z.object({ data: z.string() }),
        });
        return { success: true, data: fallbackResult };
      } catch (fallbackError) {
        return {
          error: `Extraction failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }
  }

  /**
   * Request user input via Socket.IO and wait for response - supports multiple inputs
   */
  private async toolUserInput(
    inputs: any[], // Array of InputRequest objects
    singleInputKey?: string,
    singleInputType?:
      | "text"
      | "email"
      | "password"
      | "url"
      | "otp"
      | "phone"
      | "boolean",
    singleInputPrompt?: string
  ): Promise<{
    success: boolean;
    inputs?: { [key: string]: string };
    error?: string;
  }> {
    if (!this.socket || !this.userName) {
      return {
        success: false,
        error:
          "Socket connection or userName not available for input collection",
      };
    }

    // Prepare inputs array - support both single and multiple input modes
    let inputsToRequest: any[] = [];

    if (inputs && inputs.length > 0) {
      // Multiple inputs mode
      inputsToRequest = inputs;
    } else if (singleInputKey && singleInputType && singleInputPrompt) {
      // Single input mode (backward compatibility)
      inputsToRequest = [
        {
          inputKey: singleInputKey,
          inputType: singleInputType,
          inputPrompt: singleInputPrompt,
        },
      ];
    } else {
      return {
        success: false,
        error: "No valid inputs provided",
      };
    }

    try {
      logger.info(`📥 Requesting user inputs`, {
        inputCount: inputsToRequest.length,
        inputKeys: inputsToRequest.map((i) => i.inputKey).join(", "),
      });

      // Create a promise that resolves when user provides all inputs
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => {
            reject(new Error("User input timeout (5 minutes)"));
          },
          5 * 60 * 1000
        ); // 5 minute timeout

        const collectedInputs: { [key: string]: string } = {};
        const expectedKeys = new Set(inputsToRequest.map((i) => i.inputKey));

        // Set up listener for multiple input responses
        const inputResponseHandler = (data: {
          inputs: { [key: string]: string };
        }) => {
          logger.info(`📥 Received user_input_response from frontend`, {
            userName: this.userName,
            inputKeys: Object.keys(data.inputs).join(", "),
            inputCount: Object.keys(data.inputs).length,
          });

          clearTimeout(timeout);
          this.socket!.off("user_input_response", inputResponseHandler);

          resolve({
            success: true,
            inputs: data.inputs,
          });
        };

        // Listen for user input response
        this.socket!.on("user_input_response", inputResponseHandler);

        // Request inputs from frontend
        const userInputRequestData = {
          userName: this.userName!,
          url: this.page.url(),
          urlHash: "current_page",
          stepNumber: this.session.globalStepCounter,
          inputs: inputsToRequest,
          timestamp: new Date().toISOString(),
        };

        logger.info(`📤 Emitting user_input_request to frontend`, {
          userName: this.userName,
          inputCount: inputsToRequest.length,
          inputKeys: inputsToRequest.map((i) => i.inputKey).join(", "),
          socketConnected: !!this.socket,
        });

        this.socket!.emit("exploration_update", {
          type: "user_input_request",
          timestamp: new Date().toISOString(),
          data: userInputRequestData,
        });
      });
    } catch (error) {
      logger.error("❌ User input collection failed", {
        inputsToRequest: inputsToRequest?.map((i) => i.inputKey).join(", "),
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute user input tool with proper handling of both single and multiple inputs
   */
  private async executeUserInputTool(
    toolParameters: any,
    pageData: PageData,
    screenshotBuffer: Buffer
  ): Promise<ExecutedStep | null> {
    // Check if user is still active before tool execution
    if (!this.isUserStillActive()) {
      logger.info(
        `🛑 Stopping user input tool execution - user no longer active`
      );
      return null;
    }

    const step: ExecutedStep = {
      step: this.session.globalStepCounter,
      timestamp: new Date().toISOString(),
      tool_used: "user_input",
      instruction: toolParameters.instruction || "Request user input",
      success: false,
    };

    try {
      let inputResult: {
        success: boolean;
        inputs?: { [key: string]: string };
        error?: string;
      };

      // Check if using multiple inputs mode or single input mode
      if (toolParameters.inputs && Array.isArray(toolParameters.inputs)) {
        // Multiple inputs mode
        inputResult = await this.toolUserInput(
          toolParameters.inputs,
          undefined, // singleInputKey
          undefined, // singleInputType
          undefined // singleInputPrompt
        );
      } else if (
        toolParameters.inputKey &&
        toolParameters.inputType &&
        toolParameters.inputPrompt
      ) {
        // Single input mode (backward compatibility)
        inputResult = await this.toolUserInput(
          [], // Empty array for single input mode
          toolParameters.inputKey,
          toolParameters.inputType,
          toolParameters.inputPrompt
        );
      } else {
        return {
          ...step,
          success: false,
          result:
            "Invalid user input parameters: missing inputs array or single input fields",
        };
      }

      // Check if user is still active after tool execution
      if (!this.isUserStillActive()) {
        logger.info(`🛑 Stopping after user_input - user no longer active`);
        return null;
      }

      logger.info("inputResult check", inputResult);

      if (inputResult.success && inputResult.inputs) {
        step.success = true;

        const inputKeys = Object.keys(inputResult.inputs);
        step.inputKeys = inputKeys;
        step.inputValues = {};
        step.result = `User input received for keys: ${inputKeys.join(", ")}`;

        // Process each input
        for (const [key, value] of Object.entries(inputResult.inputs)) {
          // Store in step results (no masking - keep actual values for Claude to use)
          step.inputValues[key] = value;

          // Store the input in session
          this.session.userInputs.set(key, {
            key,
            value,
            type: toolParameters.inputs
              ? toolParameters.inputs.find((inp: any) => inp.inputKey === key)
                  ?.inputType || "text"
              : toolParameters.inputType || "text",
            timestamp: new Date().toISOString(),
          });
        }

        // Emit user input received event
        if (this.socket && this.userName) {
          this.socket.emit("exploration_update", {
            type: "user_input_received",
            timestamp: new Date().toISOString(),
            data: {
              userName: this.userName,
              url: pageData.url,
              urlHash: pageData.urlHash,
              stepNumber: this.session.globalStepCounter,
              inputKeys,
              inputValues: step.inputValues,
              inputReceived: true,
            },
          });
        }

        logger.info(`📥 user_input completed`, {
          inputKeys: inputKeys.join(", "),
          inputCount: inputKeys.length,
        });
      } else {
        step.success = false;
        step.result = inputResult.error || "User input collection failed";
      }

      return step;
    } catch (error) {
      step.success = false;
      step.result = `User input tool execution failed: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`❌ User input tool execution failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return step;
    }
  }

  /**
   * Standby tool - wait for loading states without counting towards step limits
   */
  private async toolStandby(
    waitTimeSeconds: number,
    instruction: string
  ): Promise<{
    success: boolean;
    waitTime: number;
    loadingStateDetected: string;
    resultDescription: string;
    error?: string;
  }> {
    console.log(
      `⏳ Standby: ${instruction} - waiting ${waitTimeSeconds} seconds`
    );
    try {
      // Simple wait implementation
      await new Promise((resolve) =>
        setTimeout(resolve, waitTimeSeconds * 1000)
      );

      return {
        success: true,
        waitTime: waitTimeSeconds,
        loadingStateDetected: instruction,
        resultDescription: `Waited ${waitTimeSeconds} seconds for loading state to complete: ${instruction}`,
      };
    } catch (error) {
      console.error(`❌ Standby failed with error:`, error);
      return {
        success: false,
        waitTime: waitTimeSeconds,
        loadingStateDetected: instruction,
        resultDescription: `Standby failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute the chosen tool
   */
  private async executeTool(
    toolName: "page_act" | "page_extract" | "user_input" | "standby",
    instruction: string,
    pageData: PageData,
    screenshotBuffer: Buffer,
    inputKey?: string,
    inputType?:
      | "text"
      | "email"
      | "password"
      | "url"
      | "otp"
      | "phone"
      | "boolean",
    inputPrompt?: string,
    sensitive?: boolean,
    waitTimeSeconds?: number
  ): Promise<ExecutedStep | null> {
    // Check if user is still active before tool execution
    if (!this.isUserStillActive()) {
      logger.info(`🛑 Stopping tool execution - user no longer active`);
      return null;
    }

    const step: ExecutedStep = {
      step: this.session.globalStepCounter,
      timestamp: new Date().toISOString(),
      tool_used: toolName,
      instruction,
      success: false,
    };

    try {
      switch (toolName) {
        case "page_extract":
          const extractResult = await this.toolPageExtract(instruction);

          // Check if user is still active after tool execution
          if (!this.isUserStillActive()) {
            logger.info(
              `🛑 Stopping after page_extract - user no longer active`
            );
            return null;
          }

          if (extractResult.success) {
            step.success = true;
            step.result = JSON.stringify(extractResult.data);

            // 🆕 NEW COMPREHENSIVE EXTRACTION FORMATTING FLOW

            // 1. Increment version number
            pageData.currentExtractionVersion++;
            const currentVersion = pageData.currentExtractionVersion;

            // 2. Collect all screenshots from current page for LLM context
            const screenshotBuffers = pageData.screenshots
              .map((s) => s.buffer!)
              .filter(Boolean);

            // 3. Collect previous extraction data from current page only
            const previousExtractions = pageData.extractionResults.map(
              (r) => r.rawData
            );
            const previousMarkdowns = pageData.extractionResults.map(
              (r) => r.formattedMarkdown
            );

            logger.info(`🔄 Processing extraction v${currentVersion}`, {
              previousVersions: previousExtractions.length,
              screenshotsAvailable: screenshotBuffers.length,
              currentInstruction: instruction,
            });

            // Check if user is still active before comprehensive LLM call
            if (!this.isUserStillActive()) {
              logger.info(
                `🛑 Stopping before comprehensive formatting - user no longer active`
              );
              return null;
            }

            // 4. 🆕 NEW LLM CALL: Comprehensive formatting with all context
            const formattedMarkdown =
              await this.llmClient.formatExtractionResults(
                screenshotBuffers,
                pageData.url,
                this.session.metadata.objective,
                pageData.urlHash,
                this.session.globalStepCounter,
                previousExtractions,
                previousMarkdowns,
                extractResult.data // Current extraction data
              );

            // Check if user is still active after formatting call
            if (!this.isUserStillActive()) {
              logger.info(
                `🛑 Stopping after formatting - user no longer active`
              );
              return null;
            }

            // 5. Store versioned extraction result
            const extractionResult: ExtractionResult = {
              version: currentVersion,
              timestamp: new Date().toISOString(),
              rawData: extractResult.data,
              formattedMarkdown:
                formattedMarkdown ||
                `# Extraction v${currentVersion}\n\n${JSON.stringify(extractResult.data, null, 2)}`,
              stepNumber: this.session.globalStepCounter,
            };

            pageData.extractionResults.push(extractionResult);

            // 6. Check objective completion using original method
            if (!this.isExplorationObjective) {
              const analysisResult = await this.llmClient.executePageExtract(
                screenshotBuffer,
                pageData.url,
                instruction,
                this.session.metadata.objective,
                pageData.urlHash,
                this.session.globalStepCounter,
                extractResult
              );

              if (analysisResult) {
                step.objectiveAchieved = analysisResult.objectiveAchieved;
              }
            }

            // Check if user is still active after objective check
            if (!this.isUserStillActive()) {
              logger.info(
                `🛑 Stopping after objective check - user no longer active`
              );
              return null;
            }

            // 7. Emit enhanced socket event with versioned data
            if (this.socket && this.userName) {
              this.socket.emit("exploration_update", {
                type: "page_extract_result",
                timestamp: new Date().toISOString(),
                data: {
                  userName: this.userName,
                  url: pageData.url,
                  urlHash: pageData.urlHash,
                  stepNumber: this.session.globalStepCounter,
                  instruction,
                  // Latest formatted result for frontend
                  extractedData: formattedMarkdown,
                  // Version information
                  version: currentVersion,
                  totalVersions: pageData.extractionResults.length,
                  isNewVersion: true, // 🆕 Notify frontend of changes
                  // Legacy fields for compatibility
                  elementsFound: extractResult.data?.elements_found || [],
                  pageStructure: extractResult.data?.page_structure,
                  interactiveElements:
                    extractResult.data?.interactive_elements || [],
                },
              });
            }

            logger.info(
              `📊 Enhanced page_extract completed v${currentVersion}`,
              {
                dataExtracted: true,
                elementsFound: extractResult.data?.elements_found?.length || 0,
                formattedLength: formattedMarkdown?.length || 0,
                totalVersions: pageData.extractionResults.length,
                screenshotsUsed: screenshotBuffers.length,
              }
            );
          } else {
            step.success = false;
            step.result = extractResult.error;
          }
          break;

        case "page_act":
          const actionResult =
            await this.executeActionAndCheckUrlChange(instruction);

          // Check if user is still active after tool execution
          if (!this.isUserStillActive()) {
            logger.info(`🛑 Stopping after page_act - user no longer active`);
            return null;
          }

          const discoveredUrl = actionResult.newUrl;
          const toolResult = actionResult.actionResult;

          this.session.actionHistory.push({
            instruction,
            sourceUrl: pageData.url,
            targetUrl: discoveredUrl || undefined,
            urlChanged: !!discoveredUrl,
            stepNumber: this.session.globalStepCounter,
            timestamp: new Date().toISOString(),
            success: toolResult.success,
          });
          logger.info(`📝 Added to action history`, {
            instruction: instruction.substring(0, 50),
            sourceUrl: pageData.url,
            urlChanged: !!discoveredUrl,
            targetUrl: discoveredUrl,
            totalActions: this.session.actionHistory.length,
          });

          if (discoveredUrl) {
            // ✅ BOOLEAN FLAG: URL CHANGED - Set right before queuing logic
            const urlChangedFlag = true;

            // Check if we're in a sensitive flow (login, signup, etc.)
            if (this.session.flowContext.isInSensitiveFlow) {
              // In sensitive flow - do NOT queue URL, just continue on new page
              logger.info(
                `🔒 Sensitive flow detected - staying on new URL without queuing: ${discoveredUrl}`
              );
              step.urlChanged = urlChangedFlag;
              step.newUrl = discoveredUrl;
              step.success = true;
              step.result = `PREVIOUS_ACTION_RESULT: URL_CHANGED=true, NEW_URL=${discoveredUrl}, QUEUED=false (sensitive flow - stayed on new page)`;
            } else {
              // Normal flow - add to queue and navigate back
              logger.info(`🆕 New URL discovered: ${discoveredUrl}`);
              await this.addUrlToQueue(discoveredUrl, 2, pageData.url);
              step.urlChanged = urlChangedFlag;
              step.newUrl = discoveredUrl;
              step.success = true;
              step.result = `PREVIOUS_ACTION_RESULT: URL_CHANGED=true, NEW_URL=${discoveredUrl}, QUEUED=true (navigated back to original page)`;
            }
          } else {
            // ✅ BOOLEAN FLAG: URL DID NOT CHANGE
            const urlChangedFlag = false;

            step.urlChanged = urlChangedFlag;
            step.success = toolResult.success;
            step.result = `PREVIOUS_ACTION_RESULT: URL_CHANGED=false, STAYED_ON_SAME_PAGE=true, ACTION_RESULT=${toolResult.success ? "SUCCESS" : "FAILED"}`;
          }

          // Emit specific page_act event
          if (this.socket && this.userName) {
            this.socket.emit("exploration_update", {
              type: "page_act_result",
              timestamp: new Date().toISOString(),
              data: {
                userName: this.userName,
                url: pageData.url,
                urlHash: pageData.urlHash,
                stepNumber: this.session.globalStepCounter,
                instruction,
                actionSuccess: step.success,
                urlChanged: !!discoveredUrl,
                newUrl: discoveredUrl,
                result: step.result,
              },
            });
          }

          // Let Claude analyze the action result to check objective progress (only if action was successful)
          if (toolResult.success) {
            // Check if user is still active before LLM call
            if (!this.isUserStillActive()) {
              logger.info(
                `🛑 Stopping before LLM call - user no longer active`
              );
              return null;
            }

            if (!this.isExplorationObjective) {
              const analysisResult = await this.llmClient.executePageAct(
                screenshotBuffer, // Use the screenshot provided to executeTool
                pageData.url,
                instruction,
                this.session.metadata.objective,
                pageData.urlHash,
                this.session.globalStepCounter,
                toolResult
              );

              if (analysisResult) {
                step.objectiveAchieved = analysisResult.objectiveAchieved;
              }
            }

            // Check if user is still active after LLM call
            if (!this.isUserStillActive()) {
              logger.info(`🛑 Stopping after LLM call - user no longer active`);
              return null;
            }
          }

          logger.info(`🎬 page_act completed`, {
            actionSuccess: step.success,
            action: instruction,
            urlChanged: !!discoveredUrl,
            newUrl: discoveredUrl,
          });
          break;

        case "user_input":
          // Handle single input mode for backward compatibility
          const inputResult = await this.toolUserInput(
            [], // Empty array for single input mode
            inputKey!,
            inputType!,
            inputPrompt!
          );

          // Check if user is still active after tool execution
          if (!this.isUserStillActive()) {
            logger.info(`🛑 Stopping after user_input - user no longer active`);
            return null;
          }

          if (inputResult.success && inputResult.inputs) {
            step.success = true;
            step.result = `User input received for key: ${inputKey}`;
            step.inputKeys = [inputKey!];

            const inputValue = inputResult.inputs[inputKey!];
            step.inputValues = { [inputKey!]: inputValue }; // No masking

            // Store the input in session
            this.session.userInputs.set(inputKey!, {
              key: inputKey!,
              value: inputValue,
              type: inputType!,
              timestamp: new Date().toISOString(),
            });

            // Emit user input received event
            if (this.socket && this.userName) {
              this.socket.emit("exploration_update", {
                type: "user_input_received",
                timestamp: new Date().toISOString(),
                data: {
                  userName: this.userName,
                  url: pageData.url,
                  urlHash: pageData.urlHash,
                  stepNumber: this.session.globalStepCounter,
                  inputKey: inputKey!,
                  inputType: inputType!,
                  inputPrompt: inputPrompt!,
                  inputReceived: true,
                  sensitive: false,
                },
              });
            }

            logger.info(`📥 user_input completed`, {
              inputKey: inputKey!,
              inputType: inputType!,
            });
          } else {
            step.success = false;
            step.result = inputResult.error || "User input collection failed";
          }
          break;

        case "standby":
          // Take before screenshot
          const beforeScreenshotBuffer = await this.page.screenshot();
          const beforeScreenshotPath = this.fileManager.saveScreenshot(
            pageData.urlHash,
            this.session.globalStepCounter,
            "before_standby",
            beforeScreenshotBuffer
          );
          step.beforeScreenshotPath = beforeScreenshotPath;

          // Execute standby wait
          const standbyResult = await this.toolStandby(
            waitTimeSeconds || 5,
            instruction
          );

          // Check if user is still active after standby
          if (!this.isUserStillActive()) {
            logger.info(`🛑 Stopping after standby - user no longer active`);
            return null;
          }

          // Take after screenshot
          const afterScreenshotBuffer = await this.page.screenshot();
          const afterScreenshotPath = this.fileManager.saveScreenshot(
            pageData.urlHash,
            this.session.globalStepCounter,
            "after_standby",
            afterScreenshotBuffer
          );
          step.afterScreenshotPath = afterScreenshotPath;

          if (standbyResult.success) {
            step.success = true;
            step.result = standbyResult.resultDescription;
            step.waitTime = standbyResult.waitTime;

            // Emit standby completed event
            if (this.socket && this.userName) {
              this.socket.emit("exploration_update", {
                type: "standby_completed",
                timestamp: new Date().toISOString(),
                data: {
                  userName: this.userName,
                  url: pageData.url,
                  urlHash: pageData.urlHash,
                  stepNumber: this.session.globalStepCounter,
                  instruction,
                  waitTime: standbyResult.waitTime,
                  loadingStateDetected: standbyResult.loadingStateDetected,
                  beforeScreenshot: beforeScreenshotPath,
                  afterScreenshot: afterScreenshotPath,
                },
              });
            }

            logger.info(`⏳ standby completed`, {
              waitTime: standbyResult.waitTime,
              loadingState: standbyResult.loadingStateDetected,
            });
          } else {
            step.success = false;
            step.result = standbyResult.error || "Standby execution failed";
          }
          break;
      }

      return step;
    } catch (error) {
      step.success = false;
      step.result = `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`❌ Tool execution failed: ${toolName}`, {
        error: error instanceof Error ? error.message : String(error),
        instruction,
      });
      return step;
    }
  }

  /**
   * Add URL to exploration queue
   */
  protected async addUrlToQueue(
    url: string,
    priority: number,
    sourceUrl?: string
  ): Promise<void> {
    const urlHash = FileManager.generateUrlHash(url);

    // Skip if already exists or if we've reached the maximum pages to explore
    if (
      this.session.pages.has(url) ||
      this.session.metadata.totalPagesDiscovered >= this.maxPagesToExplore
    ) {
      return;
    }

    // Track page linkage for frontend diagram
    if (sourceUrl) {
      const sourceUrlHash = FileManager.generateUrlHash(sourceUrl);
      if (!this.pageLinkages.has(sourceUrlHash)) {
        this.pageLinkages.set(sourceUrlHash, []);
      }
      this.pageLinkages.get(sourceUrlHash)!.push(url);

      logger.info("🔗 Page linkage recorded", {
        from: sourceUrl,
        to: url,
      });
    }

    // Create page data
    const pageData: PageData = {
      url,
      urlHash,
      discovered: new Date().toISOString(),
      status: "queued",
      priority,
      executedSteps: [],
      // Enhanced extraction system
      extractionResults: [],
      screenshots: [],
      currentExtractionVersion: 0,
    };

    // Add to session
    this.session.pages.set(urlHash, pageData);
    this.session.pageQueue.push(urlHash);
    this.session.metadata.totalPagesDiscovered++;

    // Sort queue by priority (lower number = higher priority)
    this.session.pageQueue.sort((a, b) => {
      const pageA = this.session.pages.get(a)!;
      const pageB = this.session.pages.get(b)!;
      return pageA.priority - pageB.priority;
    });

    // Initialize file structure for this urlHash
    this.fileManager.initializeUrlDirectory(urlHash);
    this.fileManager.savePageData(urlHash, pageData);

    // Emit URL discovery event
    if (this.socket && this.userName && sourceUrl) {
      this.socket.emit("exploration_update", {
        type: "url_discovered",
        timestamp: new Date().toISOString(),
        data: {
          userName: this.userName,
          newUrl: url,
          sourceUrl: sourceUrl,
          priority: priority,
          queueSize: this.session.pageQueue.length,
        },
      });
    }

    logger.info("🔗 Added URL to queue", {
      url,
      priority,
      urlHash,
      queueSize: this.session.pageQueue.length,
    });
  }

  /**
   * Save session state
   */
  private saveSession(): void {
    this.fileManager.saveSessionMetadata(this.session.metadata);
  }

  /**
   * Save page linkages for frontend diagram
   */
  private savePageLinkages(): void {
    // Convert Map to a serializable object for frontend consumption
    const linkagesObject = Object.fromEntries(
      Array.from(this.pageLinkages.entries()).map(([source, targets]) => [
        source,
        targets,
      ])
    );

    // Create the linkages data structure
    const linkagesData = {
      sessionId: this.session.metadata.sessionId,
      timestamp: new Date().toISOString(),
      totalSources: this.pageLinkages.size,
      totalLinkages: Array.from(this.pageLinkages.values()).reduce(
        (sum, targets) => sum + targets.length,
        0
      ),
      linkages: linkagesObject,
    };

    // Save to file system using FileManager pattern
    const linkagesPath = path.join(
      this.fileManager["sessionDir"],
      "page-linkages.json"
    );
    fs.writeFileSync(linkagesPath, JSON.stringify(linkagesData, null, 2));

    logger.info("💾 Page linkages saved", {
      totalSources: this.pageLinkages.size,
      totalLinkages: Array.from(this.pageLinkages.values()).reduce(
        (sum, targets) => sum + targets.length,
        0
      ),
    });
  }

  /**
   * Finalize exploration session
   */
  protected async finalizeSession(
    objectiveAchieved: boolean
  ): Promise<boolean> {
    this.session.metadata.objectiveAchieved = objectiveAchieved;
    this.session.metadata.currentPhase = "completed";
    this.session.metadata.endTime = new Date().toISOString();

    const duration =
      new Date(this.session.metadata.endTime).getTime() -
      new Date(this.session.metadata.startTime).getTime();

    // Save final session conversation history
    this.fileManager.saveSessionConversationHistory(
      this.sessionDecisionHistory
    );

    // Save page linkages for frontend diagram
    this.savePageLinkages();

    this.saveSession();

    // Emit session completion with linkages
    if (this.socket && this.userName) {
      this.socket.emit("exploration_update", {
        type: "session_completed",
        timestamp: new Date().toISOString(),
        data: {
          userName: this.userName,
          objectiveAchieved,
          totalPages: this.session.metadata.totalPagesDiscovered,
          totalActions: this.session.metadata.totalActionsExecuted,
          pageLinkages: Object.fromEntries(this.pageLinkages.entries()),
          sessionId: this.session.metadata.sessionId,
          duration: `${duration}ms`,
        },
      });
    }

    logger.info("🏁 Exploration completed", {
      sessionId: this.session.metadata.sessionId,
      objectiveAchieved,
      pagesDiscovered: this.session.metadata.totalPagesDiscovered,
      actionsExecuted: this.session.metadata.totalActionsExecuted,
      totalDecisions: this.sessionDecisionHistory.length,
      duration: `${duration}ms`,
    });

    return objectiveAchieved;
  }

  /**
   * Check if the user is still active in the exploration
   */
  private isUserStillActive(): boolean {
    if (!this.userName || !this.activeExplorations) {
      return true; // If no userName or activeExplorations, continue (for CLI usage)
    }

    const isActive = this.activeExplorations.has(this.userName);
    if (!isActive) {
      logger.info(
        `🛑 User ${this.userName} is no longer active, stopping exploration`
      );
    }
    return isActive;
  }
}
