export interface SessionMetadata {
  sessionId: string;
  startTime: string;
  endTime?: string;
  objective: string;
  startUrl: string;
  totalPagesDiscovered: number;
  totalActionsExecuted: number;
  objectiveAchieved: boolean;
  currentPhase: "active" | "completed";
}

export interface ExtractionResult {
  version: number;
  timestamp: string;
  rawData: any; // Raw extraction from tool
  formattedMarkdown: string; // Formatted result from LLM
  stepNumber: number;
}

export interface PageScreenshot {
  stepNumber: number;
  timestamp: string;
  type: "initial" | "after_page_act";
  filePath: string;
  buffer?: Buffer; // For LLM processing
}

export interface PageData {
  url: string;
  urlHash: string;
  discovered: string; // timestamp
  lastStepNumber?: number;
  status: "queued" | "in_progress" | "completed";
  priority: number;

  // Execution results
  executedSteps: ExecutedStep[];
  objectiveAchieved?: boolean;

  // Enhanced extraction system
  extractionResults: ExtractionResult[]; // Versioned extraction results
  screenshots: PageScreenshot[]; // All screenshots for this page
  currentExtractionVersion: number; // Latest version number
}

export interface ExecutedStep {
  step: number;
  timestamp: string;
  tool_used: "page_act" | "page_extract" | "user_input" | "standby";
  instruction: string;
  success: boolean;
  result?: string;
  screenshotPath?: string;
  urlChanged?: boolean;
  newUrl?: string;
  newUrlsDiscovered?: string[];
  objectiveAchieved?: boolean;
  inputKeys?: string[]; // For user_input tool - multiple keys
  inputValues?: { [key: string]: string }; // For user_input tool - key-value pairs
  waitTime?: number; // For standby tool - wait duration in seconds
  beforeScreenshotPath?: string; // For standby tool - before wait screenshot
  afterScreenshotPath?: string; // For standby tool - after wait screenshot
}

// Single input request within a multi-input request
export interface InputRequest {
  inputKey: string;
  inputType:
    | "text"
    | "email"
    | "password"
    | "url"
    | "otp"
    | "phone"
    | "boolean";
  inputPrompt: string;
}

// LLM Decision Response
export interface LLMDecisionResponse {
  reasoning: string;
  tool_to_use: "page_act" | "user_input" | "standby";
  tool_parameters: {
    instruction: string;
    // For single input (backward compatibility)
    inputKey?: string;
    inputType?:
      | "text"
      | "email"
      | "password"
      | "url"
      | "otp"
      | "phone"
      | "boolean";
    inputPrompt?: string;
    sensitive?: boolean;
    // For multiple inputs (new)
    inputs?: InputRequest[];
    // For standby tool
    waitTimeSeconds?: number;
  };
  isCurrentPageExecutionCompleted: boolean;
  isInSensitiveFlow?: boolean;
}

// Tool execution responses
export interface PageObserveResponse {
  reasoning: string;
  clickableElements: ClickableElement[];
  suggestedActions: string[];
  objectiveProgress: string;
  objectiveAchieved: boolean;
}

export interface PageExtractResponse {
  reasoning: string;
  extractedData: any;
  relevantFindings: string[];
  objectiveProgress: string;
  objectiveAchieved: boolean;
}

export interface PageActResponse {
  reasoning: string;
  actionExecuted: string;
  actionSuccess: boolean;
  resultDescription: string;
  objectiveProgress: string;
  objectiveAchieved: boolean;
}

export interface UserInputResponse {
  reasoning: string;
  inputsRequested: InputRequest[];
  inputsReceived: { [key: string]: string };
  allInputsCollected: boolean;
  objectiveProgress: string;
  objectiveAchieved: boolean;
}

export interface StandbyResponse {
  reasoning: string;
  waitTime: number;
  loadingStateDetected: string;
  resultDescription: string;
  objectiveProgress: string;
  objectiveAchieved: boolean;
}

export interface ClickableElement {
  description: string;
  suggestedAction: string;
  priority: number; // 1=highest, 5=lowest
}

// User input request/response for Socket.IO
export interface UserInputRequest {
  userName: string;
  urlHash: string;
  stepNumber: number;
  inputs: InputRequest[]; // Support multiple inputs
  timestamp: string;
}

export interface UserInputData {
  key: string;
  value: string;
  type: string;
  timestamp: string;
}

export interface FlowContext {
  isInSensitiveFlow: boolean;
  flowType?:
    | "login"
    | "signup"
    | "verification"
    | "checkout"
    | "form_submission";
  startUrl?: string;
  flowStartStep?: number;
}

export interface ActionHistoryEntry {
  instruction: string;
  sourceUrl: string;
  targetUrl?: string; // URL after action (if changed)
  urlChanged: boolean;
  stepNumber: number;
  timestamp: string;
  success: boolean;
}

export interface ExplorationSession {
  metadata: SessionMetadata;
  pages: Map<string, PageData>; // urlHash -> PageData
  pageQueue: string[]; // urlHashes in priority order
  currentPage?: string; // current urlHash
  globalStepCounter: number;
  userInputs: Map<string, UserInputData>; // Store user inputs by key
  flowContext: FlowContext; // Track sensitive flows to prevent URL queuing interference
  actionHistory: ActionHistoryEntry[]; // Persistent history of all page_act instructions and their URL outcomes
}
