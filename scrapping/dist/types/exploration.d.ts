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
    rawData: any;
    formattedMarkdown: string;
    stepNumber: number;
}
export interface PageScreenshot {
    stepNumber: number;
    timestamp: string;
    type: "initial" | "after_page_act";
    filePath: string;
    buffer?: Buffer;
}
export interface PageData {
    url: string;
    urlHash: string;
    discovered: string;
    lastStepNumber?: number;
    status: "queued" | "in_progress" | "completed";
    priority: number;
    executedSteps: ExecutedStep[];
    objectiveAchieved?: boolean;
    extractionResults: ExtractionResult[];
    screenshots: PageScreenshot[];
    currentExtractionVersion: number;
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
    inputKeys?: string[];
    inputValues?: {
        [key: string]: string;
    };
    waitTime?: number;
    beforeScreenshotPath?: string;
    afterScreenshotPath?: string;
}
export interface InputRequest {
    inputKey: string;
    inputType: "text" | "email" | "password" | "url" | "otp" | "phone" | "boolean";
    inputPrompt: string;
}
export interface LLMDecisionResponse {
    reasoning: string;
    tool_to_use: "page_act" | "page_extract" | "user_input" | "standby";
    tool_parameters: {
        instruction: string;
        inputKey?: string;
        inputType?: "text" | "email" | "password" | "url" | "otp" | "phone" | "boolean";
        inputPrompt?: string;
        sensitive?: boolean;
        inputs?: InputRequest[];
        waitTimeSeconds?: number;
    };
    next_plan: string;
    isCurrentPageExecutionCompleted: boolean;
    isInSensitiveFlow?: boolean;
}
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
    inputsReceived: {
        [key: string]: string;
    };
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
    priority: number;
}
export interface UserInputRequest {
    userName: string;
    urlHash: string;
    stepNumber: number;
    inputs: InputRequest[];
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
    flowType?: "login" | "signup" | "verification" | "checkout" | "form_submission";
    startUrl?: string;
    flowStartStep?: number;
}
export interface ActionHistoryEntry {
    instruction: string;
    sourceUrl: string;
    targetUrl?: string;
    urlChanged: boolean;
    stepNumber: number;
    timestamp: string;
    success: boolean;
}
export interface ExplorationSession {
    metadata: SessionMetadata;
    pages: Map<string, PageData>;
    pageQueue: string[];
    currentPage?: string;
    globalStepCounter: number;
    userInputs: Map<string, UserInputData>;
    flowContext: FlowContext;
    actionHistory: ActionHistoryEntry[];
}
