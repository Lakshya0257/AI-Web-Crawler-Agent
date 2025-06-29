import { Browser, Page } from "playwright";
import { Stagehand } from "@browserbasehq/stagehand";
import { ExplorationSession, PageData } from "../types/exploration.js";
import type { Socket } from "socket.io";
export declare class WebExplorer {
    private browser;
    private page;
    private objective;
    protected session: ExplorationSession;
    private fileManager;
    private llmClient;
    private stagehand;
    private sessionDecisionHistory;
    private isExplorationObjective;
    private activeProcessingPromises;
    protected pageLinkages: Map<string, string[]>;
    private maxPagesToExplore;
    protected socket?: Socket;
    protected userName?: string;
    private activeExplorations?;
    private additionalContext?;
    private canLogin;
    constructor(browser: Browser, page: Page, objective: string, startUrl: string, stagehand: Stagehand, maxPagesToExplore?: number, socket?: Socket, userName?: string, activeExplorations?: Map<string, WebExplorer>, isExploration?: boolean, additionalContext?: string, canLogin?: boolean);
    /**
     * Main exploration method implementing the tool-driven flow
     */
    explore(maxPagesToExplore?: number): Promise<boolean>;
    /**
     * Sequential exploration for task-focused objectives
     */
    private exploreSequentially;
    /**
     * Background processing exploration for exploration objectives
     */
    private exploreWithBackgroundProcessing;
    /**
     * Wait for all active processing to complete
     */
    private waitForAllProcessingToComplete;
    /**
     * Check if all discovered pages have completed status
     */
    private areAllPagesCompleted;
    /**
     * Process a single page with tool-driven approach
     */
    protected processPage(pageData: PageData): Promise<void>;
    private normalizeUrl;
    /**
     * Helper function to execute action and check if URL changes
     * Returns { newUrl: string | null, actionResult: any }
     */
    private executeActionAndCheckUrlChange;
    /**
     * Stagehand tool implementations
     */
    private toolPageAct;
    private toolPageExtract;
    /**
     * Request user input via Socket.IO and wait for response - supports multiple inputs
     */
    private toolUserInput;
    /**
     * Execute user input tool with proper handling of both single and multiple inputs
     */
    private executeUserInputTool;
    /**
     * Standby tool - wait for loading states without counting towards step limits
     */
    private toolStandby;
    /**
     * Execute the chosen tool
     */
    private executeTool;
    /**
     * Add URL to exploration queue
     */
    protected addUrlToQueue(url: string, priority: number, sourceUrl?: string): Promise<void>;
    /**
     * Save session state
     */
    private saveSession;
    /**
     * Save page linkages for frontend diagram
     */
    private savePageLinkages;
    /**
     * Finalize exploration session
     */
    protected finalizeSession(objectiveAchieved: boolean): Promise<boolean>;
    /**
     * Check if the user is still active in the exploration
     */
    private isUserStillActive;
}
