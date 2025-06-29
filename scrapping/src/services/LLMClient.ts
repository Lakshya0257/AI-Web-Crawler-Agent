import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import logger from "../utils/logger.js";
import { FileManager } from "./FileManager.js";
import {
  LLMDecisionResponse,
  PageObserveResponse,
  PageExtractResponse,
  PageActResponse,
  UserInputResponse,
  PageData,
  ActionHistoryEntry,
} from "../types/exploration.js";

export class LLMClient {
  private anthropic: Anthropic;
  private additionalContext?: string;
  private canLogin: boolean;

  constructor(
    private fileManager: FileManager,
    additionalContext?: string,
    canLogin: boolean = false
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable not found");
    }
    this.anthropic = new Anthropic({ apiKey });
    this.additionalContext = additionalContext;
    this.canLogin = canLogin;
  }

  private getRecentActions(
    conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
  ): string {
    const recentMessages = conversationHistory
      .slice(-6)
      .filter((m) => m.role === "user" && m.content.includes("Tool result"));
    return recentMessages.map((m) => m.content).join("; ") || "None";
  }

  /**
   * Ask LLM to decide which tool to use next based on the objective
   */
  async decideNextAction(
    screenshotBuffer: Buffer,
    url: string,
    objective: string,
    urlHash: string,
    stepNumber: number,
    conversationHistory: Array<{
      role: "user" | "assistant";
      content: string;
    }>,
    pageQueue: string[],
    currentSystemStatus: Map<string, PageData>,
    isExplorationObjective: boolean,
    maxPagesReached?: boolean,
    userInputs?: Map<string, any>,
    flowContext?: { isInSensitiveFlow: boolean; flowType?: string },
    actionHistory?: ActionHistoryEntry[]
  ): Promise<LLMDecisionResponse | null> {
    try {
      // ✅ PARSE PREVIOUS ACTION RESULT - Clear boolean and context
      let previousActionContext = "";
      if (
        conversationHistory.length > 0 &&
        conversationHistory[conversationHistory.length - 1].content.includes(
          "Tool result: "
        )
      ) {
        try {
          const lastAction = JSON.parse(
            conversationHistory[conversationHistory.length - 1].content.split(
              "Tool result: "
            )[1]
          );

          if (
            lastAction.result &&
            lastAction.result.includes("PREVIOUS_ACTION_RESULT:")
          ) {
            const result = lastAction.result;

            if (result.includes("URL_CHANGED=true")) {
              if (result.includes("QUEUED=true")) {
                previousActionContext = `
🔄 PREVIOUS ACTION RESULT: URL CHANGED & QUEUED
- Your last page_act action successfully changed the URL
- The new URL was added to the exploration queue for later processing
- You were navigated BACK to the original page to continue
- The screenshot shows the ORIGINAL page (not the new URL you clicked to)
- Continue working on the current page or move to the next task
`;
              } else if (result.includes("QUEUED=false")) {
                previousActionContext = `
🔒 PREVIOUS ACTION RESULT: URL CHANGED & STAYED
- Your last page_act action successfully changed the URL
- Due to sensitive flow (login), you STAYED on the new URL
- The screenshot shows the NEW page (the one you navigated to)
- Continue working on this new page
`;
              }
            } else if (result.includes("URL_CHANGED=false")) {
              previousActionContext = `
⚡ PREVIOUS ACTION RESULT: SAME PAGE INTERACTION
- Your last page_act action did NOT change the URL
- The action was performed on the same page (dropdown, modal, form, etc.)
- The screenshot shows the SAME page with the action's effects
- Continue working on the current page
`;
            }
          } else {
            // Fallback to original logic if new format not found
            if (lastAction.urlChanged) {
              previousActionContext = `
🔄 PREVIOUS ACTION: URL changed (navigated back to original page for continued processing)
`;
            }
          }
        } catch (error) {
          // If parsing fails completely, no context is provided
          previousActionContext = "";
        }
      }
      const resizedImage = await this.resizeImageForClaude(screenshotBuffer);
      const base64Image = resizedImage.toString("base64");

      // isExplorationObjective is now passed as a parameter

      const systemPrompt = `You are a web exploration agent. Your objective: ${objective}

${
  this.additionalContext
    ? `
ADDITIONAL CONTEXT PROVIDED BY USER:
${this.additionalContext}

Use this context to guide your exploration strategy and decision-making.
`
    : ""
}

${
  this.canLogin
    ? `
🔐 LOGIN CAPABILITY ENABLED:
- You are authorized to request login credentials when needed
- Use the user_input tool to request emails, passwords, OTP codes, verification links
- You can handle authentication flows, signup processes, and account access
- Request user confirmation for actions that require human verification

⚠️ IMPORTANT LOGIN RESTRICTIONS:
- ONLY use direct/normal login forms (username/email + password)
- DO NOT attempt to login via Google, Facebook, Apple, Microsoft, or any third-party OAuth providers
- DO NOT click "Login with Google", "Sign in with Facebook", "Continue with Apple", etc.
- Focus on traditional email/password or username/password login forms
- If only third-party login options are available, inform the user and skip login
- Look for "Sign in with email" or "Use password instead" options when available
- Do not attempt to click on forget password button
`
    : `
🚫 LOGIN DISABLED:
- Stay on publicly accessible content only
- Do not attempt to access login forms or restricted areas
- Focus on publicly available information and features
`
}

SYSTEM OVERVIEW:
Our exploration system works as follows:
1. You analyze the current page and decide which tool to use
2. When you use page_act and it causes a URL change, we automatically add the new URL to our exploration queue
3. We then navigate back to the original page to continue processing it
4. Later, we will process the new URL separately
5. This allows us to systematically explore all discovered pages
6. Scroll to the bottom or scroll to top when necessary

${
  isExplorationObjective
    ? `
EXPLORATION MODE ACTIVATED:
Since this is an exploration objective, your strategy should be:
1. FIRST: Extract all important content, links, and navigation from the CURRENT page
2. THEN: Click on links ONE BY ONE in separate decisions to register new pages for future processing (Priority before exploring the current page, there can be sidebar/leftpanel buttons etc which may lead to new pages)
3. Do NOT try to extract content from pages you're clicking to - they will be processed separately
4. Focus on discovering and registering as many relevant pages as possible
5. Keep page_act instructions simple: just "Click the [element name]" - nothing more

For exploration:
- Use page_extract FIRST to capture all important content about the product etc from the current page
- Then use page_act to click individual links to discover new pages
- Each page_act should be simple: "Click the 'About' link" (not "Click About and extract all content")
- Let the system process discovered pages separately later
- Scroll the page as needed to reveal more content/links
`
    : `
TASK-FOCUSED MODE:
Since this is a specific task objective, your strategy should be:
1. Navigate efficiently towards the goal
2. Extract specific information when you find it
3. Use page_act to reach target pages
4. Use page_extract when you find relevant information

- Scroll the page as needed to reveal more content/links
`
}

CRITICAL: You must analyze the current state of the page (latest/current state of the website is captured and shared in the image) that is attached and decide which tool to use next to achieve the objective.
Dont do like if the previous action failed than there might be a login needed, that might should not be the case, analyze the screenshot and decide what to do next.

${
  maxPagesReached
    ? `
⚠️ IMPORTANT: MAXIMUM PAGE EXPLORATION LIMIT REACHED
The system has reached its maximum page discovery limit. This means:
- NEW PAGE NAVIGATION will NOT be tracked or queued for future exploration
- You can still use page_act for current page interactions (dialogs, forms, dropdowns, etc.)
- Focus on extracting information and interacting with elements on the CURRENT page
- Do NOT expect clicking links to add new pages to the exploration queue
- Continue with page_extract and page_act as needed for current page objectives
- After you think all information is extracted, you can end the task by isCurrentPageExecutionCompleted = true
`
    : ""
}

${previousActionContext}

🔍 CRITICAL: OBSERVE THE SCREENSHOT CAREFULLY BEFORE MAKING ANY DECISION!
Analyze the visual elements, text, buttons, forms, and overall page state in the screenshot.
The screenshot shows the CURRENT EXACT STATE of the webpage - base all decisions on what you see, after any page act, first see that if your next action can be done on same page or not, or what that previous page_act added a new url to the queue and you are trying to extract it

Available tools:
- page_act: Perform actions on the page (click, type, scroll to a section, scroll to bottom etc.) - provide instruction parameter, ❌ "Dont delete or modify any data, you can create new data if needed like creating a new query, creating new member etc, but not deleting anything or modifying any pre existing data"
- page_extract: Extract structured information/data from the page - provide instruction parameter (dont use this tool to extract what to click on, analyze the screenshot instead what to click on, also what you are going to extract validate with the screenshot that you are on same page or not, or that page is added to the queue)  
- user_input: Request input from user (for login forms, OTP, email verification links, confirmations, etc.) - supports single or multiple inputs at once (only ask what you need or what is visible on the page)

⚡ CRITICAL: MULTIPLE INPUTS → SINGLE page_act:
When you have collected MULTIPLE inputs (like email + password), use a SINGLE page_act to fill all fields:
Example: "Type user@example.com into the email field and password123 into the password field"

Do NOT use separate page_act commands for each field. Combine them into one instruction.

${
  userInputs && userInputs.size > 0
    ? `
STORED USER INPUTS:
You have access to the following user-provided inputs:
${Array.from(userInputs.entries())
  .map(([key, data]) => `- ${key}: ${data.value} (${data.type})`)
  .join("\n")}

You can use these stored inputs directly in page_act commands:
- "Type '${Array.from(userInputs.entries()).find(([k, d]) => d.type === "email")?.[1]?.value || "[email]"}' into the email field"
- "Type '${Array.from(userInputs.entries()).find(([k, d]) => d.type === "password")?.[1]?.value || "[password]"}' into the password field"
- Simply reference the actual values in your instructions
`
    : ""
}

${
  flowContext?.isInSensitiveFlow
    ? `
🔒 SENSITIVE FLOW DETECTED (${flowContext.flowType || "unknown"}):
- URL changes will NOT trigger new page queuing (prevents login flow interruption)
- Focus on completing the current flow (login, signup, verification, etc.)
- Use user_input tool when you need additional credentials or verification codes (only ask what you need or what is visible on the page)
- Only after completing the sensitive flow should you return to normal exploration
`
    : ""
}

${
  actionHistory && actionHistory.length > 0
    ? `
📜 ACTION HISTORY:
These are the actions that have been executed so far, so if it is same action again, dont do it again :

${actionHistory
  .map(
    (action, index) => `
${index + 1}. [Step ${action.stepNumber}] "${action.instruction}" on ${action.sourceUrl}
   → ${action.urlChanged ? `URL CHANGED to: ${action.targetUrl}` : "URL STAYED SAME"}
   → ${action.success ? "SUCCESS" : "FAILED"}
`
  )
  .join("")}

CRITICAL ANALYSIS GUIDELINES:
1. 🔍 OBSERVE CAREFULLY: Check the screenshot to see what page you're actually on
2. 🚫 AVOID REPETITION: Don't repeat the same actions that have already been tried
3. 📍 URL AWARENESS: Know which actions change URLs vs. stay on same page
4. 🎯 SMART DECISIONS: Use this history to make informed choices about what to try next

Example insights from history:
- If "Click login button" changed URL to dashboard → you know login succeeded
- If "Click menu item" stayed on same URL → it might open a dropdown/modal
- If you already tried "Click About" → try different navigation instead
`
    : ""
}

Respond with ONLY valid JSON in this exact format:
{
  "reasoning": "Your analysis of the current page and why you chose this tool",
  "tool_to_use": "page_extract|page_act|user_input|standby",
  "tool_parameters": {
    "instruction": "Specific instruction for the chosen tool",
    
    // For user_input tool - OPTION 1: Single input (backward compatibility)
    "inputKey": "unique_key_for_input",
    "inputType": "text|email|password|url|otp|phone|boolean",
    "inputPrompt": "Human-readable prompt for user",
    
    // For user_input tool - OPTION 2: Multiple inputs (recommended)
    "inputs": [
      {
        "inputKey": "login_email",
        "inputType": "email", 
        "inputPrompt": "Enter your email address"
      },
      {
        "inputKey": "login_password",
        "inputType": "password",
        "inputPrompt": "Enter your password"
      }
    ],
    
    // For standby tool - Wait for loading states
    "waitTimeSeconds": 5
  },
  "next_plan": "What you plan to do after this step",
  "isCurrentPageExecutionCompleted": false,
  "isInSensitiveFlow": false
}

IMPORTANT ABOUT isCurrentPageExecutionCompleted:
Set this to TRUE when you are confident that:
- The next action (especially page_act) will navigate to the desired page for your objective
- You have found the key navigation element (like "Pricing" link for pricing objective)
- No further actions are needed on the current page
- The current page processing should stop after this action

⚠️ CRITICAL: During LOGIN/AUTHENTICATION flows, do NOT set isCurrentPageExecutionCompleted to true:
- When requesting user credentials (user_input tool)
- When filling login forms (page_act with email/password)
- When clicking login/submit buttons during authentication
- When handling post-login redirects or dashboard pages
- The system will automatically handle URL changes during sensitive flows without queuing

🔒 IMPORTANT: isInSensitiveFlow should ONLY be set to true during LOGIN flows:
- Set to true ONLY when requesting login credentials, filling login forms, or clicking login buttons
- Do NOT set to true for general forms, registration, verification, checkout, or other non-login flows
- Only use for actual username/email + password authentication processes

LOGIN FLOW EXAMPLE:
❌ Wrong: After "Click the 'LOGIN' button" → isCurrentPageExecutionCompleted: true
✅ Correct: After "Click the 'LOGIN' button" → isCurrentPageExecutionCompleted: false (continue on dashboard)

Examples when to set TRUE:
- If objective is "Find pricing" and you see a "Pricing" link → set to true when clicking it
- If objective is "Find contact info" and you see a "Contact" button → set to true when clicking it
- If you're just exploring or gathering info → set to false
- During any authentication/login process → set to false (system handles redirects)

IMPORTANT: When using page_act, break down complex actions into simple steps:
- Base all actions on what you see in the screenshot
- ONE action per step (e.g., "Type 'username' into the email field") 
- EXCEPTION: When you have multiple inputs collected, use ONE page_act to fill all fields together
- For navigation: Step 1: Click menu, Step 2: Click specific item
- Be specific about which element to interact with based on the screenshot

Examples of good actions:
✅ "Type 'user@example.com' into the email input field"
✅ "Type 'password123' into the password input field" 
✅ "Type 'user@example.com' into the email field and 'password123' into the password field" (multiple inputs)
✅ "Click the 'Login' button to submit the form"
✅ "Click the 'Accept' button on the cookie dialog"
✅ "Click the 'Close' button to dismiss the modal"
✅ "Scroll to the bottom of the page"
✅ "Click on the 'User Portal' option in the dropdown/dialog which appears after clicking the 'Menu' button (if there any dropdown/dialog then also give complete reference of the element)"

Examples of bad actions:
❌ "Fill in the login form with username and password and submit"
❌ "Login using the provided credentials"
❌ "Click the About link and extract information" (extraction will happen separately)

USER INPUT TOOL USAGE:
Use user_input when you encounter:
✅ Login forms requiring credentials not yet collected
✅ Email verification messages ("Check your email for verification link")
✅ OTP/2FA verification requests  
✅ Phone number verification
✅ Manual confirmations ("Call this number and say 'yes'", "Press the button on your device")
✅ Any form requiring user-specific information
✅ Navigate to https://example.com/login (Strictly follow this exact format for navigation as I will extract the url and navigate to it or else it will fail)

STANDBY TOOL USAGE:
Use standby ONLY when you detect LOADING STATES in the screenshot:
✅ Spinners, loading indicators, or progress bars
✅ "Loading..." or "Please wait..." text
✅ Partial page content with visible loading elements
✅ Blank sections that appear to be loading
✅ Network request in progress indicators

STANDBY TOOL PARAMETERS:
- "instruction": "Description of what loading state you detected"
- "waitTimeSeconds": 3-10 (recommended: 5 seconds)

STANDBY EXAMPLES:
✅ {"instruction": "Waiting for page content to load - spinner visible", "waitTimeSeconds": 5}
✅ {"instruction": "Loading indicator showing data fetch in progress", "waitTimeSeconds": 3}
✅ {"instruction": "Page showing 'Please wait...' while processing", "waitTimeSeconds": 8}

⚠️ IMPORTANT: 
- ONLY use standby when you see ACTIVE loading states
- Do NOT use standby for normal page interactions
- Do NOT use standby for delays or waiting without visual loading indicators
- Standby does NOT count towards step limits
- Before and after screenshots are automatically captured

MULTIPLE INPUTS (Recommended):
- For login forms: Request email + password together
- For registration: Request name + email + password at once
- For verification: Request multiple verification steps together

Examples of user_input usage:

SINGLE INPUT:
- Email only: {"inputKey": "login_email", "inputType": "email", "inputPrompt": "Enter email"}
- Password only: {"inputKey": "login_password", "inputType": "password", "inputPrompt": "Enter password"}
- OTP: {"inputKey": "otp_code", "inputType": "otp", "inputPrompt": "Enter 6-digit code"}
- Confirmation: {"inputKey": "phone_confirmed", "inputType": "boolean", "inputPrompt": "Have you called and said 'yes'? (true/false)"}

MULTIPLE INPUTS (Better UX):
{
  "inputs": [
    {"inputKey": "login_email", "inputType": "email", "inputPrompt": "Enter your email"},
    {"inputKey": "login_password", "inputType": "password", "inputPrompt": "Enter your password"}
  ]
}

⚠️ IMPORTANT: When you have collected MULTIPLE inputs (like email + password), use a SINGLE page_act to fill all fields:
- Example: "Type 'user@example.com' into the email field and 'password123' into the password field"
- Do NOT use separate page_act commands for each field
- Fill all collected inputs in one comprehensive action

BOOLEAN CONFIRMATIONS:
Use inputType="boolean" for manual actions:
- "Have you completed the phone verification? (true/false)"
- "Did you press the physical button on your security key? (true/false)"  
- "Have you confirmed the email in your inbox? (true/false)"
- ❌ "Have you clicked on the link in the email? (true/false)" (this should not happen, as it may contain the jwt token so ask for url user_input instead)

SENSITIVE FLOW DETECTION:
Set "isInSensitiveFlow": true ONLY during LOGIN flows that are truly visible on the screenshot(If in image there is no login/sigup flow, dont dare to turn this to true):
✅ When requesting login credentials (user_input for email/password)  
✅ When filling login forms (page_act with email/password)
✅ When clicking login/submit buttons (page_act to submit login)
✅ During immediate post-login redirects

❌ Do NOT set for:
- General form submissions
- Registration/signup flows  
- Verification processes
- Checkout/payment flows
- Other multi-step forms

This prevents URL changes from triggering queue behavior that would interrupt the LOGIN flow specifically.

⚠️ IMPORTANT: When isInSensitiveFlow is true:
- URLs will NOT be added to the queue during the login flow
- The system will stay on new pages (like dashboard after login) automatically
- You should continue processing on the new page without setting isCurrentPageExecutionCompleted to true
- The browser will remain on the post-login page for continued exploration

${
  isExplorationObjective
    ? `
EXPLORATION-SPECIFIC GUIDELINES:
For page_act in exploration mode:
✅ "Click the 'About' link"
✅ "Click the 'Services' button"
✅ "Click the 'Contact' link"
✅ "Click the 'Accept' button on the cookie dialog"
✅ "Click the dropdown to expand menu options"

❌ "Click the About link and extract all information from that page"
❌ "Navigate to About page and capture all content"
❌ "Click About and get all policy information"

Remember: Each discovered page will be processed separately with its own extraction steps.

WHEN MAX PAGES REACHED IN EXPLORATION MODE:
- Continue exploring the CURRENT page thoroughly
- Use page_act for dialogs, forms, dropdowns, modals, etc.
- Extract all possible information from current page
- Do NOT worry about navigation links not being queued
- Focus on maximizing value from available pages
`
    : ""
}

You should:
1. CAREFULLY ANALYZE THE SCREENSHOT - this is the most important step
2. Observe all visual elements, text, buttons, forms, and page state
3. Decide what action to take next based on the objective and what you see
4. Use the appropriate tool with clear, specific instructions
5. Break down complex actions into simple steps (except when filling multiple collected inputs)

IMPORTANT:
- ALWAYS base decisions on the screenshot - it shows the current exact state
- Focus on the objective: ${objective}
- Choose the most appropriate tool for the current situation
- Be specific in your instruction parameter`;

      const contextPrompt = `Continue the exploration based on our conversation history. 

Current context:
- URL: ${url}
- Objective: ${objective}

CURRENT SYSTEM STATUS:
- Total pages discovered: ${currentSystemStatus.size}
${
  currentSystemStatus.size > 0
    ? `- Page status: ${Array.from(currentSystemStatus.entries())
        .map(([url, data]) => `${url} (${data.status || "unknown"})`)
        .join(", ")}`
    : "- No pages discovered yet"
}

DECISION GUIDANCE:
- Focus on discovering NEW navigation links not yet in queue
- Avoid clicking links to pages already queued or processed
- If you see links to queued pages, look for other unexplored navigation options
${
  maxPagesReached
    ? "\n- ⚠️ MAX PAGES REACHED: New page navigation will not be tracked, focus on current page interactions"
    : ""
}

Decide what tool to use next and provide the exact parameters. Think step by step about what you need to do to achieve the objective.

Remember: Break down complex actions into simple steps. One action per step.`;

      conversationHistory.push({ role: "user", content: contextPrompt });

      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: base64Image,
                },
              },
            ],
          },
          ...conversationHistory,
        ],
      });

      // console.log("SYSTEM PROMPT", systemPrompt); // Debug log - uncomment if needed

      const textContent = response.content.find((c) => c.type === "text")?.text;
      if (!textContent) {
        throw new Error("No text content in response");
      }

      // this.fileManager.saveRawLLMResponse(
      //   urlHash,
      //   stepNumber,
      //   "decision",
      //   textContent
      // );

      // Clean the text content before parsing
      let cleanedContent = textContent.trim();

      // Remove any potential control characters that might break JSON parsing
      cleanedContent = cleanedContent.replace(/[\x00-\x1F\x7F]/g, "");

      // Try to extract JSON if it's wrapped in markdown code blocks
      const jsonMatch = cleanedContent.match(
        /```(?:json)?\s*(\{[\s\S]*\})\s*```/
      );
      if (jsonMatch) {
        cleanedContent = jsonMatch[1];
      }

      logger.info("🔍 Attempting to parse LLM response", {
        originalLength: textContent.length,
        cleanedLength: cleanedContent.length,
        url,
      });

      const parsedResponse = JSON.parse(cleanedContent) as LLMDecisionResponse;
      this.fileManager.saveLLMResponse(
        urlHash,
        stepNumber,
        "decision",
        parsedResponse
      );

      return parsedResponse;
    } catch (error) {
      // this.fileManager.saveRawLLMResponse(
      //   urlHash,
      //   stepNumber,
      //   "decision",
      //   "",
      //   error instanceof Error ? error.message : String(error)
      // );

      logger.error("❌ LLM decision failed", {
        error: error instanceof Error ? error.message : String(error),
        url,
        step: stepNumber,
      });
      return null;
    }
  }

  /**
   * Execute page_extract tool
   */
  /**
   * Simplified objective completion checker for page_extract
   * The main extraction formatting is handled by formatExtractionResults()
   */
  async executePageExtract(
    screenshotBuffer: Buffer,
    url: string,
    instruction: string,
    objective: string,
    urlHash: string,
    stepNumber: number,
    toolExecutionResult: any
  ): Promise<PageExtractResponse | null> {
    try {
      const resizedImage = await this.resizeImageForClaude(screenshotBuffer);
      const base64Image = resizedImage.toString("base64");

      const systemPrompt = `You are analyzing page extraction results to determine objective completion. Your objective: ${objective}

INSTRUCTION EXECUTED: ${instruction}

TOOL EXECUTION RESULT:
${JSON.stringify(toolExecutionResult, null, 2)}

🎯 YOUR SOLE PURPOSE: Determine if the objective has been achieved based on the extraction results.

🚨 CRITICAL RESPONSE FORMAT REQUIREMENTS 🚨
- You MUST respond with ONLY valid JSON
- NO markdown formatting (no \`\`\`json\`\`\`)
- NO additional text, explanations, or comments
- Focus ONLY on objective completion analysis
- objectiveAchieved is the CRITICAL field - analyze carefully

EXACT JSON FORMAT REQUIRED:
{
  "reasoning": "Brief analysis of why this extraction contributes to the objective",
  "extractedData": {},
  "relevantFindings": ["Key findings that relate to the objective"],
  "objectiveProgress": "Assessment of progress toward the objective after this extraction",
  "objectiveAchieved": false
}

IMPORTANT ANALYSIS:
- Compare the extraction results against the stated objective
- Determine if enough information has been gathered to complete the objective
- Only set objectiveAchieved to true if the objective is TRULY fulfilled
- Consider cumulative progress from previous extractions
- Be conservative - require substantial evidence before marking complete

Focus on objective completion analysis for: ${objective}`;

      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: base64Image,
                },
              },
              {
                type: "text",
                text: `Objective Completion Analysis

URL: ${url}
Instruction: ${instruction}
Tool Result: ${JSON.stringify(toolExecutionResult, null, 2)}

TASK: Analyze if this extraction helps achieve the objective and determine if the objective is now complete.

Respond with ONLY valid JSON - no other text or formatting.`,
              },
            ],
          },
        ],
      });

      const textContent = response.content.find((c) => c.type === "text")?.text;
      if (!textContent) {
        throw new Error("No text content in response");
      }

      // Clean the response to ensure it's pure JSON
      let cleanedContent = textContent.trim();
      // Remove any markdown formatting that might have been added
      cleanedContent = cleanedContent
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "");
      // Remove any leading/trailing whitespace or newlines
      cleanedContent = cleanedContent.trim();

      const parsedResponse = JSON.parse(cleanedContent) as PageExtractResponse;
      this.fileManager.saveLLMResponse(
        urlHash,
        stepNumber,
        "page_extract_objective_check",
        parsedResponse
      );

      return parsedResponse;
    } catch (error) {
      logger.error("❌ page_extract objective check failed", {
        error: error instanceof Error ? error.message : String(error),
        url,
        instruction,
      });
      return null;
    }
  }

  /**
   * Execute page_act tool
   */
  async executePageAct(
    screenshotBuffer: Buffer,
    url: string,
    instruction: string,
    objective: string,
    urlHash: string,
    stepNumber: number,
    toolExecutionResult: any
  ): Promise<PageActResponse | null> {
    try {
      const resizedImage = await this.resizeImageForClaude(screenshotBuffer);
      const base64Image = resizedImage.toString("base64");

      const systemPrompt = `You are analyzing the result of the page_act tool execution. Your objective: ${objective}

INSTRUCTION EXECUTED: ${instruction}

TOOL EXECUTION RESULT:
${JSON.stringify(toolExecutionResult, null, 2)}

🚨 CRITICAL RESPONSE FORMAT REQUIREMENTS 🚨
- You MUST respond with ONLY valid JSON
- NO markdown formatting (no \`\`\`json\`\`\`)
- NO additional text, explanations, or comments
- NO line breaks within string values
- ONLY the raw JSON object
- objectiveAchieved must be false every time

Your job is to:
1. Analyze the tool execution result and the action outcome
2. Determine if the action was successful based on the tool result
3. Evaluate the impact of the action on the page
4. Check progress toward the objective
5. Report what happened and its significance

EXACT JSON FORMAT REQUIRED:
{
  "reasoning": "Your analysis of the action result and tool execution outcome",
  "actionExecuted": "${instruction}",
  "actionSuccess": true,
  "resultDescription": "What happened after the action based on tool result",
  "objectiveProgress": "description of progress toward objective",
  "objectiveAchieved": false 
}

IMPORTANT:
- actionSuccess must be boolean (true/false)
- All string values must be single line (no line breaks)
- Response must be parseable by JSON.parse()
- Base your analysis on the tool execution result and screenshot comparison`;

      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: base64Image,
                },
              },
              {
                type: "text",
                text: `Analyze page_act tool result: ${instruction}\n\nURL: ${url}\n\nTool Result:\n${JSON.stringify(toolExecutionResult, null, 2)}\n\nREMEMBER: Respond with ONLY valid JSON, no other text or formatting.`,
              },
            ],
          },
        ],
      });

      const textContent = response.content.find((c) => c.type === "text")?.text;
      if (!textContent) {
        throw new Error("No text content in response");
      }

      // Clean the response to ensure it's pure JSON
      let cleanedContent = textContent.trim();
      // Remove any markdown formatting that might have been added
      cleanedContent = cleanedContent
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "");
      // Remove any leading/trailing whitespace or newlines
      cleanedContent = cleanedContent.trim();

      const parsedResponse = JSON.parse(cleanedContent) as PageActResponse;
      this.fileManager.saveLLMResponse(
        urlHash,
        stepNumber,
        "page_act",
        parsedResponse
      );

      return parsedResponse;
    } catch (error) {
      logger.error("❌ page_act execution failed", {
        error: error instanceof Error ? error.message : String(error),
        url,
        instruction,
      });
      return null;
    }
  }

  /**
   * Execute user_input tool - no LLM call needed, just return structured response
   */
  async executeUserInput(
    inputsRequested: any[],
    inputsReceived: { [key: string]: string },
    objective: string,
    urlHash: string,
    stepNumber: number
  ): Promise<UserInputResponse | null> {
    try {
      const response: UserInputResponse = {
        reasoning: `User inputs collected successfully for ${Object.keys(inputsReceived).join(", ")}`,
        inputsRequested: inputsRequested,
        inputsReceived: inputsReceived,
        allInputsCollected: true,
        objectiveProgress: `Collected user inputs: ${Object.keys(inputsReceived).join(", ")}. Can now proceed with authentication flow.`,
        objectiveAchieved: false,
      };

      // Save the response
      this.fileManager.saveLLMResponse(
        urlHash,
        stepNumber,
        "user_input",
        response
      );

      return response;
    } catch (error) {
      logger.error("❌ user_input execution failed", {
        error: error instanceof Error ? error.message : String(error),
        inputsRequested,
      });
      return null;
    }
  }

  /**
   * Format extraction results with comprehensive context
   */
  async formatExtractionResults(
    screenshots: Buffer[], // All screenshots from current page
    url: string,
    objective: string,
    urlHash: string,
    stepNumber: number,
    previousExtractions: any[], // All previous raw extraction data from current page
    previousMarkdowns: string[], // All previous formatted markdown results
    currentExtractionData: any // Latest extraction data to incorporate
  ): Promise<string | null> {
    try {
      // Create image content for all screenshots
      const imageContent = await Promise.all(
        screenshots.map(async (screenshot) => {
          const resizedImage = await this.resizeImageForClaude(screenshot);
          const base64Image = resizedImage.toString("base64");
          return {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: "image/png" as const,
              data: base64Image,
            },
          };
        })
      );

      const systemPrompt = `🔥 You are a TOP-TIER PRODUCT STRATEGY CONSULTANT creating a FINAL COMPREHENSIVE REPORT. Your objective: ${objective}

CURRENT PAGE: ${url}

🚨 CRITICAL MANDATE: PRESERVE ALL PREVIOUS CONTEXT 🚨
You are creating the FINAL COMPREHENSIVE REPORT that must include ALL previous findings, context, and insights. DO NOT LOSE ANY INFORMATION from previous extractions.

This is NOT a new analysis - this is the FINAL CUMULATIVE REPORT that builds upon and enhances ALL previous work while incorporating new findings.

PREVIOUS EXTRACTION DATA FROM THIS PAGE (MUST PRESERVE ALL):
${
  previousExtractions.length > 0
    ? previousExtractions
        .map(
          (data, index) => `
=== EXTRACTION ${index + 1} ===
${JSON.stringify(data, null, 2)}
`
        )
        .join("\n")
    : "None"
}

PREVIOUS MARKDOWN RESULTS FROM THIS PAGE (MUST INCORPORATE ALL):
${
  previousMarkdowns.length > 0
    ? previousMarkdowns
        .map(
          (markdown, index) => `
=== MARKDOWN VERSION ${index + 1} ===
${markdown}
`
        )
        .join("\n")
    : "None"
}

LATEST EXTRACTION DATA TO INCORPORATE:
${JSON.stringify(currentExtractionData, null, 2)}

🎯 FINAL REPORT REQUIREMENTS:
- PRESERVE every insight, detail, and finding from previous extractions
- ENHANCE and EXPAND upon previous analysis with new data
- CREATE a comprehensive final report that combines ALL information
- DO NOT START FRESH - build upon existing work
- INCLUDE all business insights, technical observations, and strategic analysis from previous versions

🚫 ABSOLUTELY FORBIDDEN CONTENT:
❌ Basic feature descriptions ("The page has X")
❌ Surface-level observations ("Users can click Y")
❌ Short paragraphs under 100 words per section
❌ Bullet points without strategic analysis
❌ Obvious statements about visible elements
❌ Generic descriptions that could apply to any platform

✅ MANDATORY STRATEGIC DEPTH:
✅ Deep business model analysis with revenue implications
✅ Competitive positioning with specific market context
✅ User psychology insights and conversion optimization analysis
✅ Technical architecture conclusions about platform maturity
✅ Growth strategy deductions from UX patterns
✅ Executive-level insights that drive strategic decisions

🎯 REQUIRED ANALYSIS FRAMEWORK:

**MINIMUM CONTENT REQUIREMENTS:**
- 🏢 Platform Strategy: 400+ words analyzing business model sophistication
- 💰 Revenue Architecture: 300+ words on monetization complexity
- 🧠 UX Psychology: 300+ words on conversion and retention design
- ⚙️ Technical Maturity: 250+ words on architecture and scalability insights
- 🏆 Market Position: 250+ words on competitive advantages and gaps
- 📈 Growth Engine: 200+ words on user acquisition and expansion strategies
- 💡 Strategic Intelligence: 200+ words of actionable executive insights

**ANALYTICAL SOPHISTICATION EXAMPLES:**

Instead of: "The platform uses credits"
Write: "The credit-based consumption model represents a sophisticated pricing psychology approach designed to maximize lifetime value through variable pricing elasticity. This mechanism enables precise user segmentation based on usage patterns while creating engagement loops that traditional subscription models cannot achieve. The 100-credit beta allocation suggests the platform is in active price discovery, using behavioral data to optimize conversion funnels before full market launch."

Instead of: "There are team features"
Write: "The multi-tiered collaboration architecture reveals a deliberate enterprise expansion strategy, with permission hierarchies and team management capabilities that indicate targeting of large organization accounts. This collaborative infrastructure represents significant development investment in enterprise-grade features, positioning the platform for high-value account acquisition and reduced churn through organizational lock-in effects."

🎨 EXECUTIVE PRESENTATION FORMATTING:

**VISUAL HIERARCHY:**
- Strategic section headers with meaningful emojis
- Data tables showing competitive comparisons  
- Code blocks for technical architecture insights
- Blockquotes highlighting key strategic insights
- Varied formatting to maintain engagement

**ANALYTICAL DEPTH:**
- Each section minimum 250 words of strategic analysis
- Specific data points and evidence-based conclusions
- Industry benchmarking and competitive context
- Business implications and strategic recommendations
- Technical sophistication assessment

**PROFESSIONAL STRUCTURE:**
1. 🎯 **Executive Summary** (200+ words)
2. 🏢 **Platform Strategy & Positioning** (400+ words)
3. 💰 **Business Model Architecture** (300+ words)
4. 🧠 **User Experience Intelligence** (300+ words)
5. ⚙️ **Technical & Scalability Assessment** (250+ words)
6. 🏆 **Competitive Intelligence** (250+ words)
7. 📈 **Growth & Acquisition Strategy** (200+ words)
8. 💡 **Strategic Recommendations** (200+ words)

🎭 EXECUTIVE MINDSET:
Think like you're preparing this for:
- Board of directors strategic review
- Investor due diligence analysis  
- Competitive intelligence briefing
- Product strategy planning session
- Market expansion assessment

Every sentence must provide strategic value that executives can act upon.

Respond with ONLY the comprehensive strategic analysis in markdown format.`;

      const messages = [
        {
          role: "user" as const,
          content: [
            ...imageContent,
            {
              type: "text" as const,
              text: `📋 FINAL COMPREHENSIVE PAGE ANALYSIS REPORT

**Target Platform**: ${url}
**Analysis Objective**: ${objective}

🚨 CRITICAL: This is your FINAL COMPREHENSIVE REPORT that must preserve ALL previous context and findings.

🎯 YOUR MISSION: Create the DEFINITIVE COMPREHENSIVE REPORT for this page that:
- PRESERVES every insight and detail from ALL previous extractions
- INCORPORATES all previous analysis and context
- ENHANCES previous findings with new data
- CREATES a complete, final report that doesn't lose ANY information

⚠️ DO NOT LOSE PREVIOUS CONTEXT: You have access to all previous extraction data and markdown results. Your job is to create the FINAL version that includes EVERYTHING discovered so far.

This is not a basic summary or new analysis - you must create the ULTIMATE, COMPREHENSIVE FINAL REPORT that includes:

📊 **COMPREHENSIVE COVERAGE REQUIREMENTS:**

**Previous Context Integration** (MANDATORY):
- Include ALL insights, findings, and analysis from previous extraction versions
- Enhance and expand upon previous business model analysis
- Preserve all technical observations and strategic insights
- Build upon previous competitive intelligence and user experience analysis

**Page Overview & Context** (200+ words):
- Detailed description of page purpose and role in user journey
- Strategic positioning within the overall platform architecture
- Key value propositions and messaging analysis
- Visual design philosophy and brand positioning
- ALL previous context and observations about the page

**Detailed Feature Analysis** (300+ words):
- Comprehensive breakdown of every functional element
- Strategic purpose and business logic behind each feature
- User experience flow and interaction design considerations
- Conversion optimization tactics and psychological triggers

**Business Model Insights** (250+ words):
- Revenue model indicators and monetization strategies
- Pricing psychology and user segmentation approaches
- Enterprise vs consumer market targeting evidence
- Competitive positioning and differentiation factors

**Technical Implementation Considerations** (200+ words):
- Architecture and scalability implications
- Security and enterprise-readiness indicators
- Integration capabilities and ecosystem approach
- Development sophistication and technology choices

**User Experience Considerations** (250+ words):
- Information architecture and navigation strategy
- User flow optimization and friction reduction
- Accessibility and usability design decisions
- Mobile responsiveness and cross-platform considerations

**Strategic Implications & Considerations** (200+ words):
- Market positioning and competitive advantages
- Growth strategy and user acquisition tactics
- Partnership and integration opportunities
- Future roadmap and expansion considerations

🔍 **REPORTING STANDARDS:**
- Write with comprehensive detail and thorough analysis
- Include specific observations and evidence-based conclusions
- Provide strategic context and business implications
- Consider multiple perspectives and use cases
- Explain the reasoning behind design and feature decisions

📝 **FINAL REPORT FORMAT:**
Create the DEFINITIVE, detailed professional report that:
- Combines ALL previous findings into one comprehensive document
- Builds upon every previous insight and analysis
- Creates the most complete version possible
- Preserves the full context and history of discoveries

**TONE**: Professional, analytical, comprehensive, and detailed - like the FINAL thorough business analyst report.

**CRITICAL REMINDER**: This is the FINAL VERSION that must include EVERYTHING discovered about this page across all previous extractions. Do not lose ANY previous context or insights.

Provide the ULTIMATE COMPREHENSIVE FINAL REPORT that preserves all previous context while incorporating new findings.`,
            },
          ],
        },
      ];

      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 8000,
        system: systemPrompt,
        messages: messages,
      });

      const textContent = response.content.find((c) => c.type === "text")?.text;
      if (!textContent) {
        throw new Error("No text content in response");
      }

      // Save the formatted response
      this.fileManager.saveLLMResponse(
        urlHash,
        stepNumber,
        "format_extraction",
        { formattedMarkdown: textContent.trim() }
      );

      return textContent.trim();
    } catch (error) {
      logger.error("❌ formatExtractionResults failed", {
        error: error instanceof Error ? error.message : String(error),
        url,
        previousExtractionsCount: previousExtractions.length,
        previousMarkdownsCount: previousMarkdowns.length,
      });
      return null;
    }
  }

  /**
   * Resize image for Claude API limits
   */
  private async resizeImageForClaude(imageBuffer: Buffer): Promise<Buffer> {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error("Could not get image dimensions");
    }

    const maxDimension = 8000;
    let newWidth = metadata.width;
    let newHeight = metadata.height;

    if (metadata.width > maxDimension || metadata.height > maxDimension) {
      const aspectRatio = metadata.width / metadata.height;

      if (metadata.width > metadata.height) {
        newWidth = maxDimension;
        newHeight = Math.round(maxDimension / aspectRatio);
      } else {
        newHeight = maxDimension;
        newWidth = Math.round(maxDimension * aspectRatio);
      }
    }

    return await image
      .resize(newWidth, newHeight, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  }
}
