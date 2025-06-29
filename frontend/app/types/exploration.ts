export interface ExplorationConfig {
  userName: string;
  objective: string;
  startUrl: string;
  isExploration: boolean;
  maxPagesToExplore: number;
  additionalContext?: string;
  canLogin: boolean;
}

export interface InputRequest {
  inputKey: string;
  inputType: 'text' | 'email' | 'password' | 'url' | 'otp' | 'phone' | 'boolean';
  inputPrompt: string;
}

export interface UserInputRequest {
  userName: string;
  url: string;
  urlHash: string;
  stepNumber: number;
  inputs: InputRequest[];
  timestamp: string;
}

export interface LLMDecision {
  tool: 'page_extract' | 'page_observe' | 'page_act' | 'standby';
  instruction: string;
  reasoning: string;
  nextPlan: string;
  isPageCompleted: boolean;
}

export interface ToolResult {
  userName: string;
  url: string;
  urlHash: string;
  stepNumber: number;
  instruction: string;
  timestamp: string;
}

export interface PageObserveResult extends ToolResult {
  visibleElements: string[];
  interactiveElements: string[];
  navigationOptions: string[];
  formsPresent: boolean;
}

export interface PageExtractResult extends ToolResult {
  extractedData: string; // Now contains formatted markdown
  elementsFound: string[];
  pageStructure: string;
  interactiveElements: string[];
  // Enhanced versioning system
  version: number;
  totalVersions: number;
  isNewVersion: boolean; // Notify frontend of changes
}

export interface PageActResult extends ToolResult {
  actionSuccess: boolean;
  urlChanged: boolean;
  newUrl?: string;
  result: string;
}

export interface StandbyResult extends ToolResult {
  waitTime: number;
  loadingStateDetected: string;
  beforeScreenshot: string;
  afterScreenshot: string;
}

export interface ScreenshotData {
  userName: string;
  urlHash: string;
  stepNumber: number;
  action: string;
  filename: string;
  screenshotPath: string;
  screenshotBase64: string;
  timestamp: string;
}

export interface URLDiscovery {
  userName: string;
  newUrl: string;
  sourceUrl: string;
  priority: number;
  queueSize: number;
  timestamp: string;
}

export interface PageStatus {
  userName: string;
  url: string;
  urlHash: string;
  status: 'in_progress' | 'completed';
  stepsExecuted?: number;
  timestamp: string;
}

export interface SessionCompletion {
  userName: string;
  objectiveAchieved: boolean;
  totalPages: number;
  totalActions: number;
  pageLinkages: Record<string, string[]>;
  sessionId: string;
  duration: string;
  timestamp: string;
}

export interface ExplorationUpdate {
  type: 'page_started' | 'page_completed' | 'llm_decision' | 'tool_execution_started' | 
        'tool_execution_completed' | 'page_extract_result' | 
        'page_act_result' | 'url_discovered' | 'screenshot_captured' | 'session_completed' |
        'user_input_request' | 'user_input_received' | 'standby_completed';
  timestamp: string;
  data: any;
}

export interface ExplorationState {
  isConnected: boolean;
  isRunning: boolean;
  currentPage: string | null;
  screenshots: ScreenshotData[];
  decisions: Array<{
    stepNumber: number;
    decision: LLMDecision;
    url: string;
    urlHash: string;
    maxPagesReached: boolean;
    timestamp: string;
  }>;
  toolResults: {
    observe: PageObserveResult[];
    extract: PageExtractResult[];
    act: PageActResult[];
    standby: StandbyResult[];
  };
  urlDiscoveries: URLDiscovery[];
  pageStatuses: PageStatus[];
  sessionCompletion: SessionCompletion | null;
  totalSteps: number;
  activeToolExecution: {
    tool: string;
    instruction: string;
    stepNumber: number;
  } | null;
  userInputRequest: UserInputRequest | null;
} 