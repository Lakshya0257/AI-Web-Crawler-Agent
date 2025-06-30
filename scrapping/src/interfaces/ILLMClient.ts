import { LLMDecisionResponse, PageExtractResponse, PageActResponse, UserInputResponse, PageData, ActionHistoryEntry } from "../types/exploration.js";

/**
 * Interface for LLM client functionality
 */
export interface ILLMClient {
  /**
   * Decide the next action to take based on current page state
   */
  decideNextAction(
    screenshotBuffer: Buffer,
    url: string,
    objective: string,
    urlHash: string,
    stepNumber: number,
    conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
    pageQueue: string[],
    currentSystemStatus: Map<string, PageData>,
    isExplorationObjective: boolean,
    maxPagesReached?: boolean,
    userInputs?: Map<string, any>,
    flowContext?: { isInSensitiveFlow: boolean; flowType?: string },
    actionHistory?: ActionHistoryEntry[]
  ): Promise<LLMDecisionResponse | null>;

  /**
   * Execute page extraction analysis
   */
  executePageExtract(
    screenshotBuffer: Buffer,
    url: string,
    instruction: string,
    objective: string,
    urlHash: string,
    stepNumber: number,
    toolExecutionResult: any
  ): Promise<PageExtractResponse | null>;

  /**
   * Execute page action analysis
   */
  executePageAct(
    screenshotBuffer: Buffer,
    url: string,
    instruction: string,
    objective: string,
    urlHash: string,
    stepNumber: number,
    toolExecutionResult: any
  ): Promise<PageActResponse | null>;

  /**
   * Execute user input handling
   */
  executeUserInput(
    inputsRequested: any[],
    inputsReceived: { [key: string]: string },
    objective: string,
    urlHash: string,
    stepNumber: number
  ): Promise<UserInputResponse | null>;

  /**
   * Format extraction results into markdown
   */
  formatExtractionResults(
    screenshots: Buffer[],
    url: string,
    objective: string,
    urlHash: string,
    stepNumber: number,
    previousExtractions: any[],
    previousMarkdowns: string[],
    currentExtractionData: any
  ): Promise<string | null>;
} 