import { FileManager } from "./FileManager.js";
import { LLMDecisionResponse, PageExtractResponse, PageActResponse, UserInputResponse, PageData, ActionHistoryEntry } from "../types/exploration.js";
export declare class LLMClient {
    private fileManager;
    private anthropic;
    private additionalContext?;
    private canLogin;
    constructor(fileManager: FileManager, additionalContext?: string, canLogin?: boolean);
    private getRecentActions;
    /**
     * Ask LLM to decide which tool to use next based on the objective
     */
    decideNextAction(screenshotBuffer: Buffer, url: string, objective: string, urlHash: string, stepNumber: number, conversationHistory: Array<{
        role: "user" | "assistant";
        content: string;
    }>, pageQueue: string[], currentSystemStatus: Map<string, PageData>, isExplorationObjective: boolean, maxPagesReached?: boolean, userInputs?: Map<string, any>, flowContext?: {
        isInSensitiveFlow: boolean;
        flowType?: string;
    }, actionHistory?: ActionHistoryEntry[]): Promise<LLMDecisionResponse | null>;
    /**
     * Execute page_extract tool
     */
    /**
     * Simplified objective completion checker for page_extract
     * The main extraction formatting is handled by formatExtractionResults()
     */
    executePageExtract(screenshotBuffer: Buffer, url: string, instruction: string, objective: string, urlHash: string, stepNumber: number, toolExecutionResult: any): Promise<PageExtractResponse | null>;
    /**
     * Execute page_act tool
     */
    executePageAct(screenshotBuffer: Buffer, url: string, instruction: string, objective: string, urlHash: string, stepNumber: number, toolExecutionResult: any): Promise<PageActResponse | null>;
    /**
     * Execute user_input tool - no LLM call needed, just return structured response
     */
    executeUserInput(inputsRequested: any[], inputsReceived: {
        [key: string]: string;
    }, objective: string, urlHash: string, stepNumber: number): Promise<UserInputResponse | null>;
    /**
     * Format extraction results with comprehensive context
     */
    formatExtractionResults(screenshots: Buffer[], // All screenshots from current page
    url: string, objective: string, urlHash: string, stepNumber: number, previousExtractions: any[], // All previous raw extraction data from current page
    previousMarkdowns: string[], // All previous formatted markdown results
    currentExtractionData: any): Promise<string | null>;
    /**
     * Resize image for Claude API limits
     */
    private resizeImageForClaude;
}
