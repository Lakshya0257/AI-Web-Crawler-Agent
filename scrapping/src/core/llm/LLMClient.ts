import { generateText, generateObject, LanguageModel } from "ai";
import { vertex } from "@ai-sdk/google-vertex";
import { anthropic } from "@ai-sdk/anthropic";
import sharp from "sharp";
import { z } from "zod";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import logger from "../../utils/logger.js";
import { FileManager } from "../storage/FileManager.js";
import {
  GlobalStore,
  PageStore,
  InteractionGraph,
  ImageNode,
  ImageEdge,
  FlowDefinition,
} from "../storage/GlobalStore.js";
import {
  LLMDecisionResponse,
  PageObserveResponse,
  PageExtractResponse,
  PageActResponse,
  UserInputResponse,
  PageData,
  ActionHistoryEntry,
} from "../../types/exploration.js";

// 🔧 ZOD SCHEMAS FOR ROBUST GRAPH GENERATION
const ImageNodeMetadataSchema = z
  .object({
    visibleElements: z
      .array(z.string())
      .describe("Description of what's visible on screen"),
    clickableElements: z
      .array(z.string())
      .describe("Description of interactive elements"),
    flowsConnected: z
      .array(z.string())
      .describe("Array of flow IDs this image participates in"),
    dialogsOpen: z.array(z.string()).describe("Any dialogs/modals open"),
    timestamp: z.string().describe("When this state was captured"),
    pageTitle: z.string().optional().describe("Page title if available"),
    url: z.string().optional().describe("URL of the page if available"),
  })
  .describe(
    "Complete metadata - NEVER omit any fields, use empty arrays if needed"
  );

// 🔧 ZOD SCHEMAS FOR LLM DECISION RESPONSE
const InputRequestSchema = z.object({
  inputKey: z.string().describe("Unique identifier for the input"),
  inputType: z
    .enum(["text", "email", "password", "url", "otp", "phone", "boolean"])
    .describe("Type of input required"),
  inputPrompt: z.string().describe("User-friendly prompt for the input"),
});

const ToolParametersSchema = z.object({
  instruction: z.string().describe("Specific instruction for the tool"),
  inputKey: z
    .string()
    .optional()
    .describe("For single input (backward compatibility)"),
  inputType: z
    .enum(["text", "email", "password", "url", "otp", "phone", "boolean"])
    .optional()
    .describe("Type of single input"),
  inputPrompt: z.string().optional().describe("Prompt for single input"),
  sensitive: z.boolean().optional().describe("Whether this input is sensitive"),
  inputs: z
    .array(InputRequestSchema)
    .optional()
    .describe("For multiple inputs"),
  waitTimeSeconds: z.number().optional().describe("Wait time for standby tool"),
  actionables: z
    .array(
      z.object({
        text: z.string().describe("Text content of the actionable element"),
        instruction: z
          .string()
          .describe(
            "Specific action instruction like 'Click on the chat widget', 'Hover on the dropdown menu', 'Scroll to the bottom section'"
          ),
        elementType: z
          .string()
          .optional()
          .describe("Type of element (button, link, etc.)"),
        actionType: z
          .enum(["click", "hover", "scroll"])
          .describe("Type of action to perform on this element"),
      })
    )
    .optional()
    .describe(
      "Comprehensive one-time list of ALL actionable elements you want to interact with on this page"
    ),
});

const LLMDecisionResponseSchema = z.object({
  reasoning: z.string().describe("Detailed reasoning for the decision"),
  tool_to_use: z
    .enum(["page_act", "user_input", "standby", "backtrack", "actionables"])
    .describe("Which tool to use next"),
  tool_parameters: ToolParametersSchema.describe(
    "Parameters for the selected tool"
  ),
  actions: z.array(
    z.object({
      id: z.string().describe("Unique identifier for the action"),
      action: z.string(),
      actionType: z.enum(["hover", "click"]),
    })
  ),
  isCurrentPageExecutionCompleted: z
    .boolean()
    .describe(
      "Whether current page exploration is complete, first ask to user if the current page is completed or not, as a user_input tool of boolean WHEN YOU ARE SETTING THIS TO TRUE, CALL STANDBY TOOL WITH 1 SEC WAIT TIME. (COMPULSORY)"
    ),
  isInSensitiveFlow: z
    .boolean()
    .optional()
    .describe("Whether currently in a sensitive flow"),
});

const ImageNodeSchema = z.object({
  id: z
    .string()
    .describe("Unique identifier matching imageName (e.g., 'step_5_abc12345')"),
  imageName: z.string().describe("Same as id for consistency"),
  imageData: z
    .string()
    .describe(
      "Use 'PLACEHOLDER_WILL_BE_REPLACED' - real data mapped after generation"
    ),
  instruction: z.string().describe("The action that led to this state"),
  stepNumber: z.number().describe("Step number when this state was captured"),
  metadata: ImageNodeMetadataSchema,
  position: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional()
    .describe("Optional positioning for frontend layout"),
});

const ImageEdgeSchema = z.object({
  from: z.string().describe("Source imageName"),
  to: z.string().describe("Target imageName"),
  action: z
    .string()
    .describe("Specific action taken (e.g., 'expand_navigation_menu')"),
  instruction: z
    .string()
    .describe("Full instruction that caused the transition"),
  description: z
    .string()
    .describe("Clear description of what this transition accomplishes"),
  flowId: z.string().optional().describe("Optional flow this edge belongs to"),
});

const FlowDefinitionSchema = z.object({
  id: z
    .string()
    .describe("Unique flow identifier (snake_case version of name)"),
  name: z
    .string()
    .describe(
      "Human-readable descriptive name (e.g., 'User Authentication Process')"
    ),
  description: z.string().describe("What this flow accomplishes"),
  startImageName: z.string().describe("Initial state of the flow"),
  endImageNames: z.array(z.string()).describe("Possible end states"),
  imageNodes: z.array(z.string()).describe("All image nodes in this flow"),
  flowType: z
    .enum(["linear", "branching", "circular"])
    .describe("Flow pattern type"),
});

const InteractionGraphSchema = z.object({
  nodes: z
    .array(ImageNodeSchema)
    .describe("All image nodes - MUST preserve existing + add new"),
  edges: z
    .array(ImageEdgeSchema)
    .describe("All edges - MUST preserve existing + add new"),
  flows: z
    .array(FlowDefinitionSchema)
    .describe("All flows - MUST preserve existing + add new"),
  description: z
    .string()
    .describe("Comprehensive visual flow analysis summary"),
  pageSummary: z
    .string()
    .describe("Detailed application summary with all workflows discovered"),
  lastUpdated: z.string().describe("ISO timestamp of when graph was generated"),
});

export class LLMClient {
  private model: LanguageModel;
  private claudeModel: LanguageModel;
  private additionalContext?: string;
  private canLogin: boolean;

  constructor(
    private fileManager: FileManager,
    additionalContext?: string,
    canLogin: boolean = false
  ) {
    // Check for required environment variables (These are automatically used by the SDK)
    // Vertex AI authentication should be set up via Application Default Credentials

    // Initialize Vertex AI model (Gemini)
    this.model = vertex("gemini-2.5-pro");

    // Initialize Claude model for graph generation
    this.claudeModel = anthropic("claude-4-sonnet-20250514");

    this.additionalContext = additionalContext;
    this.canLogin = canLogin;
  }

  /**
   * Get next version number for raw LLM responses
   */
  private getNextResponseVersion(urlHash: string): string {
    //create ramdom hash
    const randomHash = crypto.randomUUID();

    return randomHash;
  }

  /**
   * Extract JSON from LLM response with robust safety measures
   */
  private extractJsonFromResponse(rawResponse: string): string {
    try {
      // Remove any leading/trailing whitespace
      let cleaned = rawResponse.trim();

      // Strategy 1: Check if it's already clean JSON (starts with { and ends with })
      if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
        logger.debug("JSON extraction: Using Strategy 1 (already clean)");
        return cleaned;
      }

      // Strategy 2: Extract JSON from markdown code blocks (multiple patterns)
      const markdownPatterns = [
        /```(?:json)?\s*(\{[\s\S]*?\})\s*```/, // Standard markdown json blocks
        /```\s*(\{[\s\S]*?\})\s*```/, // Markdown blocks without language
        /~~~(?:json)?\s*(\{[\s\S]*?\})\s*~~~/, // Alternative markdown syntax
      ];

      for (const pattern of markdownPatterns) {
        const match = cleaned.match(pattern);
        if (match && match[1]) {
          logger.debug("JSON extraction: Using Strategy 2 (markdown blocks)");
          return match[1].trim();
        }
      }

      // Strategy 3: Look for JSON between any backticks
      const backtickMatch = cleaned.match(/`+\s*(\{[\s\S]*?\})\s*`+/);
      if (backtickMatch && backtickMatch[1]) {
        logger.debug("JSON extraction: Using Strategy 3 (backticks)");
        return backtickMatch[1].trim();
      }

      // Strategy 4: Find the first { and last } to extract JSON block
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");

      if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
        const extracted = cleaned.substring(firstBrace, lastBrace + 1);
        return extracted;
      }

      // Strategy 5: Try to find JSON after common prefixes
      const prefixes = [
        "Here is the JSON:",
        "Here's the JSON:",
        "JSON:",
        "Response:",
        "Result:",
        "Output:",
        "\n",
        "\r\n",
      ];

      for (const prefix of prefixes) {
        const prefixIndex = cleaned.toLowerCase().indexOf(prefix.toLowerCase());
        if (prefixIndex !== -1) {
          const afterPrefix = cleaned
            .substring(prefixIndex + prefix.length)
            .trim();
          if (afterPrefix.startsWith("{")) {
            const firstBrace = afterPrefix.indexOf("{");
            const lastBrace = afterPrefix.lastIndexOf("}");
            if (
              firstBrace !== -1 &&
              lastBrace !== -1 &&
              firstBrace < lastBrace
            ) {
              return afterPrefix.substring(firstBrace, lastBrace + 1);
            }
          }
        }
      }

      // Strategy 6: Remove common non-JSON prefixes and suffixes
      const patterns = [
        /^[^{]*(\{[\s\S]*\})[^}]*$/, // Extract everything between first { and last }
        /^.*?(\{[\s\S]*?\}).*$/, // Extract first complete JSON object
      ];

      for (const pattern of patterns) {
        const match = cleaned.match(pattern);
        if (match && match[1]) {
          return match[1].trim();
        }
      }

      // Strategy 7: Handle broken JSON with mismatched braces
      if (cleaned.includes("{")) {
        try {
          // Find all potential JSON objects and try to parse each
          let braceCount = 0;
          let startIndex = -1;
          let potentialJsons = [];

          for (let i = 0; i < cleaned.length; i++) {
            if (cleaned[i] === "{") {
              if (braceCount === 0) {
                startIndex = i;
              }
              braceCount++;
            } else if (cleaned[i] === "}") {
              braceCount--;
              if (braceCount === 0 && startIndex !== -1) {
                const potentialJson = cleaned.substring(startIndex, i + 1);
                potentialJsons.push(potentialJson);
                startIndex = -1;
              }
            }
          }

          // Try to parse each potential JSON, return the first successful one
          for (const jsonCandidate of potentialJsons) {
            try {
              JSON.parse(jsonCandidate);
              return jsonCandidate;
            } catch {
              // Continue to next candidate
            }
          }
        } catch {
          // Fall through to next strategy
        }
      }

      // If all strategies fail, return the cleaned response and let JSON.parse handle the error
      logger.warn("Could not extract clean JSON from response, trying as-is", {
        rawResponsePreview: cleaned.substring(0, 200),
      });

      return cleaned;
    } catch (error) {
      logger.error("Error in extractJsonFromResponse", {
        error: error instanceof Error ? error.message : String(error),
        rawResponsePreview: rawResponse.substring(0, 200),
      });
      return rawResponse; // Return original if extraction fails
    }
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
    langfuseTraceId: string,
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
    actionHistory?: ActionHistoryEntry[],
    incompleteNodes?: string[]
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

🚨 **CRITICAL PRIORITY #1: LOOP DETECTION AND PREVENTION** 🚨

**BEFORE MAKING ANY DECISION, CHECK FOR LOOPS:**
1. **ANALYZE YOUR REASONING** - Is it similar to previous steps?
2. **CHECK FOR REPETITIVE ACTIONS** - Are you trying the same thing again?
3. **LOOK FOR LOOP KEYWORDS** - "stuck in loop", "repeatedly", "re-issuing", "corrective measure"
4. **EXAMINE FAILED ATTEMPTS** - Have you tried this actionable before?

**IF LOOP DETECTED → IMMEDIATE BACKTRACK REQUIRED:**
✅ **USE BACKTRACK TOOL** - Do NOT use actionables tool
❌ **NEVER re-add same actionables** that were already tried
❌ **NEVER assume "maybe this time it will work"**
❌ **NEVER use "corrective measure" reasoning**

**LOOP DETECTION EXAMPLES:**
- "system is stuck in a loop, repeatedly opening the dropdown"
- "failing to click the option, re-issuing the instruction"
- "corrective measure to proceed with exploration"
- Same reasoning as previous steps

**WHEN IN DOUBT → USE BACKTRACK, NOT ACTIONABLES**

🚨 **CRITICAL PRIORITY #1: LOOP DETECTION AND PREVENTION** 🚨

**BEFORE MAKING ANY DECISION, CHECK FOR LOOPS:**
1. **ANALYZE YOUR REASONING** - Is it similar to previous steps?
2. **CHECK FOR REPETITIVE ACTIONS** - Are you trying the same thing again?
3. **LOOK FOR LOOP KEYWORDS** - "stuck in loop", "repeatedly", "re-issuing", "corrective measure"
4. **EXAMINE FAILED ATTEMPTS** - Have you tried this actionable before?

**IF LOOP DETECTED → IMMEDIATE BACKTRACK REQUIRED:**
✅ **USE BACKTRACK TOOL** - Do NOT use actionables tool
❌ **NEVER re-add same actionables** that were already tried
❌ **NEVER assume "maybe this time it will work"**
❌ **NEVER use "corrective measure" reasoning**

**LOOP DETECTION EXAMPLES:**
- "system is stuck in a loop, repeatedly opening the dropdown"
- "failing to click the option, re-issuing the instruction"
- "corrective measure to proceed with exploration"
- Same reasoning as previous steps

**WHEN IN DOUBT → USE BACKTRACK, NOT ACTIONABLES**

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
- Do not explore in the login process, just simply login. You dont have to register or sign up only login should happen.

⚠️ IMPORTANT LOGIN RESTRICTIONS:
- ONLY use direct/normal login forms (username/email + password)
- DO NOT attempt to login via Google, Facebook, Apple, Microsoft, or any third-party OAuth providers
- DO NOT click "Login with Google", "Sign in with Facebook", "Continue with Apple", etc.
- Focus on traditional email/password or username/password login forms
- If only third-party login options are available, inform the user and skip login
- Look for "Sign in with email" or "Use password instead" options when available
- Do not attempt to click on forget password button
- Do not explore in the login process, just simply login. You dont have to register or sign up only login should happen.
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
🚀 EXPLORATION MODE ACTIVATED - MAXIMUM THOROUGHNESS REQUIRED:
Since this is an exploration objective, your strategy MUST be:

1. 🎯 COMPREHENSIVE EXPLORATION MANDATE: You MUST click/hover/interact with EVERY SINGLE visible interactive element
2. 🔍 LEAVE NO STONE UNTURNED: Every button, link, dropdown, toggle, tab, filter, checkbox, radio button, slider, etc.
3. 📊 100% INTERACTION COVERAGE: The exploration is NOT complete until EVERY possibility has been tested
4. 🚫 NEVER ASSUME: Don't assume what elements do - ALWAYS interact to discover their actual behavior
5. 📝 SYSTEMATIC APPROACH: Go through elements systematically - top to bottom, left to right

🎯 MANDATORY EXPLORATION CHECKLIST:
✅ ALL navigation links (primary navigation, footer links, breadcrumbs)
✅ ALL buttons (submit, action, CTA, utility buttons)
✅ ALL dropdown menus (click to see all options, then select different values)
✅ ALL tabs (switch between every tab to see different content)
✅ ALL toggles and switches (turn on/off to see state changes)
✅ ALL filters and sorting options (apply different filters to see results)
✅ ALL checkboxes and radio buttons (select/deselect to see effects)
✅ ALL form fields (click into them to see input behaviors)
✅ ALL search boxes (try typing to see autocomplete/suggestions)
✅ ALL expandable sections (expand/collapse to see hidden content)
✅ ALL modal triggers (open modals/dialogs to explore their content)
✅ ALL hover effects (hover over elements to reveal hidden options)
✅ ALL scroll areas (scroll to reveal more content or options)
✅ ALL tooltips and help icons (hover to see additional information)

⚡ SMART INTERACTION STRATEGY:
- Start with SAFE interactions first (view-only elements)
- Then progress to POTENTIALLY MODIFYING interactions (but get confirmation first)
- Test ONE example from each TYPE of similar elements (smart content selection)
- Document what each interaction reveals about functionality

🔄 COMPLETION CRITERIA:
The page exploration is ONLY complete when:
- Every visible interactive element has been tested at least once
- All dropdown options have been explored
- All tabs/sections have been viewed
- All form fields have been interacted with (safely)
- All navigation paths have been discovered
- No more untested interactive elements remain visible
- You should never conclude page while executing page_act tool, after you think each task is done, ask from user to conclude this page or not, if yes then conclude this page with standby tool of 1 sec.

🚨 NEVER SET isCurrentPageExecutionCompleted = true UNTIL:
- You have methodically gone through EVERY interactive element
- You have tested ALL functionality visible on the page
- You have discovered ALL possible navigation paths
- There are NO MORE untested elements remaining
- User have said true from user_input tool (necessary)
`
    : `
🎯 TASK-FOCUSED MODE - THOROUGH EXPLORATION WITH PURPOSE:
Since this is a specific task objective, your strategy MUST be:

1. 🔍 COMPREHENSIVE PAGE EXPLORATION: Click/hover/interact with EVERY visible interactive element
2. 🎯 GOAL-ORIENTED PRIORITIZATION: While being thorough, prioritize elements relevant to the objective
3. 🚫 NEVER ASSUME FUNCTIONALITY: Always interact to discover what elements actually do
4. 📝 SYSTEMATIC COVERAGE: Ensure no interactive element is left untested
5. 🎪 SMART CONTENT SELECTION: Test one example from each type of similar elements

🔧 MANDATORY INTERACTION REQUIREMENTS:
✅ ALL buttons, links, and clickable elements
✅ ALL dropdown menus (open them to see options)
✅ ALL tabs and navigation elements
✅ ALL form fields and input elements
✅ ALL filters, toggles, and controls
✅ ALL expandable sections and accordions
✅ ALL modal/dialog triggers
✅ ALL search and filter interfaces

⚡ TASK-FOCUSED INTERACTION STRATEGY:
- PRIORITIZE elements that seem relevant to your objective
- BUT STILL TEST all other interactive elements systematically
- Use smart content selection (test one project, not all projects)
- Get confirmation before any data-modifying actions
- Scroll to reveal more content when needed

🔄 TASK COMPLETION CRITERIA:
Consider the task/page complete ONLY when:
- The specific objective has been achieved OR
- Every possible path to achieve the objective has been explored AND
- All interactive elements have been tested to understand the full interface

🚨 CRITICAL: Even in task mode, DO NOT skip elements like "Create new canvas" - these might be essential for achieving your objective! Test everything, but get confirmation for actions that create/modify data.
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
- After you think all information is extracted, all tasks are done, then call user_input to ask whether we can conclude this page or not, if user said yes then you can end the task by isCurrentPageExecutionCompleted = true
`
    : ""
}

${previousActionContext}

🔍 CRITICAL: OBSERVE THE SCREENSHOT CAREFULLY BEFORE MAKING ANY DECISION!
Analyze the visual elements, text, buttons, forms, and overall page state in the screenshot.
The screenshot shows the CURRENT EXACT STATE of the webpage - base all decisions on what you see.

🚫 NEVER ASSUME - ONLY OBSERVE:
- Do NOT assume error messages that aren't visible in the screenshot
- Do NOT assume login failed without seeing actual error text
- Do NOT assume success/failure based on URL changes alone
- Do NOT make inferences about page state - only describe what you see
- Do NOT conclude anything not directly visible in the screenshot

✅ SCREENSHOT-BASED DECISION MAKING:
- Look for specific text, buttons, forms, and UI elements
- Identify error messages by reading actual text shown
- Determine page state by visual layout and content
- Base reasoning on visible elements, not technical assumptions
- If unclear, describe exactly what you see and ask for clarification

EXAMPLE GOOD REASONING:
✅ "I can see a dashboard with navigation menu and user profile, indicating successful login"
✅ "The screenshot shows the text 'Invalid password' below the password field"
✅ "I see a contact form with Name, Email, and Message fields ready to be filled"

EXAMPLE BAD REASONING:
❌ "Login probably failed because URL didn't change"
❌ "There might be an error message" (when none is visible)
❌ "The form submission likely failed" (without seeing error indicators)

🚨 MANDATORY CONFIRMATION REQUIRED - NO EXCEPTIONS:
Before performing ANY action that could manipulate, change, or affect data, you MUST use the user_input tool to get explicit confirmation first!

EXPANDED ACTIONS REQUIRING CONFIRMATION:
🛑 CREATE/ADD/NEW:
- Creating accounts/profiles/users
- Creating new projects/files/documents/canvases
- Adding new items/content/entries
- Registering for services/newsletters
- Creating posts/comments/reviews/tasks
- Adding items to cart/wishlist/favorites
- Inviting users/sending invitations
- Setting up new configurations
- Starting new processes/workflows

🛑 DELETE/REMOVE/CLEAR:
- Deleting accounts/profiles/users
- Removing projects/files/documents
- Deleting posts/comments/entries
- Clearing data/history/caches
- Unsubscribing from services
- Removing any existing content
- Canceling subscriptions/services

🛑 MODIFY/UPDATE/EDIT:
- Changing account settings/preferences
- Updating profile information/details
- Editing existing content/documents
- Changing passwords/security settings
- Modifying permissions/access rights
- Updating any existing data/configurations
- Changing system settings

🛑 SUBMIT/SEND/SHARE:
- Submitting contact/feedback forms
- Sending messages/emails/notifications
- Sharing content/files/links
- Publishing/posting content
- Submitting applications/requests
- Any form submission with data

🛑 FINANCIAL/PAYMENT/SUBSCRIPTION:
- Making purchases/payments
- Adding payment methods/cards
- Changing billing information
- Upgrading/downgrading plans
- Processing transactions
- Any money-related actions

🛑 AUTHENTICATION/SECURITY:
- Changing passwords/credentials
- Enabling/disabling security features
- Password reset requests
- Two-factor authentication changes
- Security settings modifications

🚫 ABSOLUTELY NO EXCEPTIONS:
- Even if it seems harmless, ASK FIRST
- Even if it's "just testing", ASK FIRST  
- Even if you think the user wants it, ASK FIRST
- Even if it's for exploration purposes, ASK FIRST
- Better to ask unnecessarily than act without permission

✅ DETAILED CONFIRMATION EXAMPLES:
- "I found a 'Create New Canvas' button. Should I click it to create a new project? (yes/no)"
- "There's a 'Create New Project' button. Should I create a new project for exploration? (yes/no)"
- "I see an 'Invite Members' button. Should I click it to explore the invitation process? (yes/no)"
- "There's a contact form. Should I fill it out with test data and submit it? (yes/no)"
- "I found a 'Delete Project' option. Should I explore what happens when clicked? (yes/no)"
- "There's an 'Add to Team' button. Should I add a test user to explore this feature? (yes/no)"

🔍 SAFE ACTIONS (NO CONFIRMATION NEEDED):
- Clicking navigation links (About, Contact, Home, etc.)
- Opening dropdowns/menus to view options (without selecting)
- Switching between tabs/filters to see content
- Scrolling to view more content
- Hovering to see tooltips/previews
- Clicking to view details (without modifying)
- Browsing/viewing existing content
- Opening modals/dialogs to see their content (without submitting)
- Clicking sorting options to see different arrangements
- Expanding/collapsing sections to view content

🚫 CRITICAL: ACTIONS TO ABSOLUTELY AVOID:
⛔ **NEVER CLICK LOGOUT/SIGN OUT BUTTONS**:
- "Logout", "Sign Out", "Log Out", "Exit", "Disconnect"
- User menu items that end sessions
- Account termination options
- Session ending controls

⚔️ **SMART CONTENT SELECTION STRATEGY**:
When you see MULTIPLE SIMILAR ITEMS, only interact with ONE example to understand the pattern:

📋 **Content Lists - Test ONE Example**:
- **Project Lists**: Click only one project to explore project details page
- **Video Lists**: Click only one video to test video player functionality  
- **Task Lists**: Select only one task to understand task management interface
- **Article Lists**: Click only one article to see reading experience
- **Product Lists**: Explore only one product to understand product pages
- **User Profiles**: Check only one profile to see profile page structure
- **File Lists**: Open only one file to understand file management
- **Company Lists**: Select only one company to see company details
- **Message Lists**: Open only one message to see message interface
- **Category Lists**: Explore only one category to understand navigation

🎯 **BUT STILL EXPLORE EVERYTHING ELSE**:
While being smart about content lists, you MUST still:
✅ Click ALL different types of buttons (Create, Edit, Delete, etc.)
✅ Test ALL different types of filters and dropdowns
✅ Explore ALL different functional areas of the interface
✅ Interact with ALL unique interface elements
✅ Test ALL navigation options and menu items
✅ Open ALL different types of modals/dialogs
✅ Try ALL search and filtering capabilities

💡 **SMART SELECTION CRITERIA**:
- Choose the FIRST or most prominent item from lists
- Pick items that seem most representative of the type
- Avoid testing every single similar item in a list
- Focus on understanding the PATTERN and functionality
- BUT don't skip unique interface elements or functions

🚀 **AGGRESSIVE EXPLORATION EXAMPLES**:
✅ "Click the 'Create New Canvas' button to explore project creation"
✅ "Click the 'Invite Members' button to see invitation flow"
✅ "Click the search filter dropdown to see all filter options"
✅ "Click the user menu to see account options"
✅ "Click the settings gear icon to explore configuration options"
✅ "Click the notification bell to see notification interface"
✅ "Open the help/support section to see available resources"

❌ **DON'T SKIP IMPORTANT FUNCTIONALITY**:
- Don't skip "Create" buttons thinking they're too complex
- Don't skip "Settings" thinking they're not important
- Don't skip "Admin" sections thinking they're restricted
- Don't skip "Help" sections thinking they're just documentation
- Don't skip any functional buttons or controls

🎯 **EXPLORATION PRIORITY ORDER**:
1. **Navigation elements** (menus, tabs, breadcrumbs)
2. **Primary action buttons** (Create, Add, New, etc.)
3. **Content filtering/sorting** (dropdowns, toggles, filters)
4. **Settings and configuration** (gear icons, preferences)
5. **User account features** (profile, account settings)
6. **One example from content lists** (first project, first task, etc.)
7. **Secondary features** (help, notifications, search)
8. **Advanced/admin features** (if accessible)

Available tools:
- page_act: Perform actions on the page (click, type, scroll to a section, scroll to bottom etc.) - provide instruction parameter
- user_input: Request input from user (for login forms, OTP, email verification links, confirmations, etc.) - supports single or multiple inputs at once
- standby: Wait for loading states or page changes - provide waitTimeSeconds parameter
- actionables: Extract and list all interactive elements from the current screenshot for systematic exploration
- backtrack: Move to the next incomplete actionable when current path is exhausted

🔧 NEW TOOLS USAGE GUIDELINES:

🚨 **CRITICAL: ACTIONABLES ARE HANDLED AUTOMATICALLY BY SYSTEM** 🚨

**MANDATORY UNDERSTANDING - ACTIONABLES TOOL WORKFLOW:**
1. **YOU PROVIDE ACTIONABLES** → System receives the list
2. **SYSTEM HANDLES EXECUTION** → Automatically executes each actionable via tree traversal
3. **YOU DO NOT EXECUTE** → NEVER use page_act for actionables you already provided
4. **SYSTEM MANAGES FLOW** → Moves through actionables systematically

**FORBIDDEN BEHAVIOR AFTER PROVIDING ACTIONABLES:**
❌ **NEVER use page_act to execute actionables you already listed**
❌ **NEVER manually click elements from your actionables list**
❌ **NEVER assume you need to "continue the exploration" with page_act**
❌ **NEVER use reasoning like "next logical step is to click X"**

**CORRECT BEHAVIOR AFTER PROVIDING ACTIONABLES:**
✅ **WAIT for system to execute** - System handles all actionables automatically
✅ **ONLY provide NEW actionables** - When page changes and new elements appear
✅ **USE BACKTRACK** - When no new actionables exist or when stuck
✅ **OBSERVE CHANGES** - Look for new dialogs, modals, or page states

**EXAMPLE SCENARIOS:**

❌ **WRONG APPROACH:**
Step 1: Provide actionables list with "Home", "Settings", "Profile" links
Step 2: Use page_act "Click on the 'Home' link" → FORBIDDEN!

✅ **CORRECT APPROACH:**
Step 1: Provide actionables list with "Home", "Settings", "Profile" links  
Step 2: Wait for system to execute → System automatically clicks each element
Step 3: Only act if NEW elements appear or use backtrack when done

**WHEN TO USE EACH TOOL:**

🎯 **USE ACTIONABLES TOOL WHEN:**
- New dialog/modal appears → Map all elements in the dialog
- Page loads with new content → Extract all visible interactive elements
- Dropdown opens → Map all options in the dropdown
- Form appears → Map all inputs and buttons

🎯 **USE PAGE_ACT TOOL WHEN:**
- Cookie consent popups → "Click 'Accept' on cookie dialog"
- Non-exploration utility actions → "Dismiss notification banner"  
- Sensitive flows (login) → "Type email into login field"
- Actions NOT for exploration → Utility/maintenance actions only

🎯 **USE BACKTRACK TOOL WHEN:**
- No new actionables beyond those already provided
- Stuck in loops or repetitive actions
- All visible elements already in pending list
- Ready to move to next incomplete node

🎯 **NEVER USE PAGE_ACT FOR:**
- Elements you already listed in actionables
- Navigation links you already extracted
- Buttons you already mapped
- Any exploration-related actions

**CRITICAL UNDERSTANDING:**
The actionables tool is for MAPPING elements, not executing them.
The system handles EXECUTION automatically.
Your job is to MAP what's available, not execute what you mapped.

🚨 **CRITICAL LOOP DETECTION AND BACKTRACK PRIORITY** 🚨

**MANDATORY LOOP DETECTION RULES:**
1. **IF YOU SEE REPETITIVE ACTIONS** → MUST USE BACKTRACK TOOL
2. **IF SAME REASONING APPEARS MULTIPLE TIMES** → MUST USE BACKTRACK TOOL  
3. **IF STUCK ON SAME ELEMENT/DROPDOWN** → MUST USE BACKTRACK TOOL
4. **IF REPEATEDLY TRYING SAME ACTIONABLE** → MUST USE BACKTRACK TOOL

**LOOP DETECTION KEYWORDS:**
- "system is stuck in a loop"
- "repeatedly opening/clicking"
- "failing to click"
- "re-issuing the instruction"
- "corrective measure"
- Same reasoning as previous steps

**WHEN LOOP DETECTED:**
✅ **IMMEDIATELY USE BACKTRACK TOOL** - No exceptions!
❌ **NEVER use actionables tool when in loop**
❌ **NEVER re-add same actionables that failed before**

**BACKTRACK PRIORITY RULE:**
- Loop detected → backtrack tool (moves to next incomplete node)
- No loop detected → actionables tool (for new dialogs/modals)

🚨 **CRITICAL DIALOG RULE - ZERO TOLERANCE** 🚨
**IF YOU SEE A NEW DIALOG/MODAL/POPUP → MUST USE ACTIONABLES TOOL FIRST**
**NEVER use page_act immediately when dialogs appear!**

Examples:
- ✅ "Create New Canvas" modal appears → Use actionables to map input field, Create button, Cancel button
- ❌ "Create New Canvas" modal appears → Immediately use page_act to type in input field (FORBIDDEN!)
- ✅ Settings dialog opens → Use actionables to map all options and buttons  
- ❌ Settings dialog opens → Immediately use page_act to change settings (FORBIDDEN!)

**MANDATORY SEQUENCE: Dialog appears → actionables tool → system executes**

**EXCEPTION: IF LOOP DETECTED WITH DIALOG → USE BACKTRACK INSTEAD OF ACTIONABLES**

�� ACTIONABLES TOOL:

🚨 **CRITICAL RULE: SCREENSHOT VERIFICATION MANDATORY** 🚨

**BEFORE EXTRACTING ANY ACTIONABLE, YOU MUST:**
1. **VISUALLY LOCATE** the element in the current screenshot
2. **READ THE EXACT TEXT** visible on the element  
3. **VERIFY** it appears interactive (button/link styling)
4. **CONFIRM** it's not already in the pending actions list below

❌ **ABSOLUTELY FORBIDDEN:**
- Including elements you "think should be there"
- Adding actions based on typical website patterns
- Assuming elements exist outside the visible area
- Using actions from memory of previous screenshots
- Including any action that's already in the pending list

🚨 **MANDATORY ACTIONABLES FOR NEW DIALOGS/MODALS** 🚨

**CRITICAL RULE: When a NEW dialog/modal/popup appears, you MUST use actionables tool FIRST**

✅ **REQUIRED BEHAVIOR FOR NEW DIALOGS:**
1. **DETECT**: New dialog/modal/popup has appeared in screenshot
2. **USE ACTIONABLES TOOL**: Extract ALL interactive elements from the dialog
3. **MAP COMPLETELY**: List all buttons, inputs, dropdowns, options in the dialog
4. **THEN EXECUTE**: Let the system handle execution through tree traversal

❌ **FORBIDDEN BEHAVIOR FOR NEW DIALOGS:**
1. **NEVER immediately use page_act** when a new dialog appears
2. **NEVER start typing or clicking** without mapping actionables first
3. **NEVER assume what to do** - always map the dialog completely

**EXAMPLES OF DIALOGS REQUIRING ACTIONABLES FIRST:**

✅ **CORRECT APPROACH - "Create New Canvas" Modal:**
- reasoning: "A 'Create New Canvas' modal has appeared with a project name input field, Create button, and Cancel button. I need to map all actionables in this dialog first before proceeding."
- tool_to_use: "actionables"
- actionables: Include project name input, Create button, Cancel button with proper instructions

❌ **WRONG APPROACH - Direct page_act:**
- reasoning: "I'll type a name in the input field"
- tool_to_use: "page_act"
- instruction: "Type 'New Test Canvas' into the input field"
- → FORBIDDEN! Must use actionables first!

**DIALOG TYPES REQUIRING ACTIONABLES FIRST:**
- 🔲 **Form Dialogs**: Login forms, create forms, edit forms
- 🔲 **Confirmation Dialogs**: Delete confirmations, save confirmations
- 🔲 **Settings Dialogs**: Preferences, configuration panels
- 🔲 **Upload Dialogs**: File upload, image upload interfaces
- 🔲 **Selection Dialogs**: Choose options, pick items
- 🔲 **Input Dialogs**: Name input, text input, data entry

**DETECTION CRITERIA FOR NEW DIALOGS:**
- Modal overlay appears over main content
- Popup window with distinct boundaries
- Dialog box with title and interactive elements
- Form appears that wasn't there in previous screenshot
- New panel slides in or appears

🚨 **MANDATORY SEQUENCE FOR ALL DIALOGS:**
1. **DIALOG APPEARS** → Detect new dialog in screenshot
2. **USE ACTIONABLES** → Map ALL interactive elements in the dialog
3. **SYSTEM EXECUTES** → Tree traversal handles the actions automatically
4. **NEVER SKIP** → Always map dialog actionables before any page_act

🚨 **ZERO TOLERANCE FOR SKIPPING ACTIONABLES ON DIALOGS:**
- If you see a NEW dialog/modal/popup → MUST use actionables tool first
- If you see a form that wasn't there before → MUST use actionables tool first  
- If you see a dropdown menu opened → MUST use actionables tool first
- If you see any new interface element → MUST use actionables tool first

**NEVER use page_act immediately when new dialogs appear - ALWAYS map actionables first!**

🚨 CRITICAL: SCREENSHOT-BASED ACTIONABLES EXTRACTION ONLY 🚨

📸 **MANDATORY SCREENSHOT VERIFICATION**:
- **ONLY extract actionables that are CLEARLY VISIBLE in the current screenshot**
- **NEVER assume elements exist without seeing them in the image**
- **NEVER include actions based on memory or previous screenshots**
- **NEVER include elements that might be "just off-screen" or "probably there"**
- **NEVER include actions from incomplete nodes list if they're not visible in current screenshot**

🔍 **VISUAL CONFIRMATION REQUIRED**:
Before including ANY actionable, you MUST:
1. **LOCATE the element in the screenshot** - point to its exact position
2. **READ the visible text** - use the exact text you can see
3. **VERIFY it's interactive** - confirm it looks clickable/hoverable
4. **CONFIRM it's not already selected/active** - check current state

❌ **FORBIDDEN ASSUMPTIONS**:
- "There's probably a menu button" → Only if you SEE it
- "The About link should be there" → Only if it's VISIBLE
- "Usually sites have a search" → Only if you can SEE the search
- "From the pending list, I'll add..." → Only if VISIBLE in current screenshot

✅ **CORRECT APPROACH**:
- "I can see a blue 'About Us' link in the top navigation"
- "There's a hamburger menu icon (three lines) in the top-right corner"
- "I observe a search input field with placeholder text 'Search...'"
- "A dropdown arrow is visible next to 'Products' in the navigation"

🚫 **CRITICAL: DO NOT DUPLICATE PENDING ACTIONS**:
${
  incompleteNodes && incompleteNodes.length > 0
    ? `
⚠️ THESE ACTIONS ARE ALREADY PENDING - DO NOT INCLUDE THEM:
${incompleteNodes.map((action, index) => `${index + 1}. ${action}`).join("\n")}

🚨 CRITICAL ACTIONABLES EXTRACTION RULES - SCREENSHOT VERIFICATION MANDATORY 🚨

⚠️ **BEFORE EXTRACTING ANY ACTIONABLE:**
1. **VISUALLY LOCATE** the element in the current screenshot - point to its exact position
2. **READ THE EXACT TEXT** visible on the element (don't paraphrase or assume)
3. **VERIFY** it appears interactive (has button/link styling, clickable appearance)
4. **ENSURE** it's in the current visible state (not from memory or assumptions)

❌ **ABSOLUTELY FORBIDDEN - ZERO TOLERANCE:**
- Including elements you "think should be there" but can't see
- Adding actions based on typical website patterns or assumptions
- Using elements that "might be just off-screen" or "probably exist"
- Including any action that matches the pending list above
- Extracting elements from memory of previous screenshots
- Assuming text content without clearly reading it in the screenshot

✅ **ONLY EXTRACT WHAT YOU CAN PROVE EXISTS:**
- Point to the exact location in the screenshot where you see the element
- Quote the exact text visible on buttons/links (use what you can actually read)
- Only include elements that are clearly interactive and visible
- Skip any element that might correspond to pending actions above

🔍 **VERIFICATION CHECKLIST FOR EACH ACTIONABLE:**
Before including any element, ask yourself:
- [ ] Can I point to this element's exact location in the screenshot?
- [ ] Can I read the exact text/label on this element?
- [ ] Does this element clearly appear clickable/interactive?
- [ ] Is this element definitely NOT in the pending actions list above?
- [ ] Am I certain this element exists in the current screenshot (not assuming)?

**IF YOU CANNOT ANSWER "YES" TO ALL 5 QUESTIONS → DON'T INCLUDE THE ELEMENT**

- When using actionables tool: Do NOT include any of the above pending actions in your list
- These actions are already in the system and will be processed automatically
- Only extract NEW actionables that are both VISIBLE and NOT in pending list
- If no new actionables exist beyond those listed, use backtrack tool instead
- For backtrack tool: Simply call it without providing any actionables list
`
    : `
🚨 CRITICAL ACTIONABLES EXTRACTION RULES - SCREENSHOT VERIFICATION MANDATORY 🚨

⚠️ **BEFORE EXTRACTING ANY ACTIONABLE:**
1. **VISUALLY LOCATE** the element in the current screenshot - point to its exact position
2. **READ THE EXACT TEXT** visible on the element (don't paraphrase or assume)
3. **VERIFY** it appears interactive (has button/link styling, clickable appearance)
4. **ENSURE** it's in the current visible state (not from memory or assumptions)

❌ **ABSOLUTELY FORBIDDEN - ZERO TOLERANCE:**
- Including elements you "think should be there" but can't see
- Adding actions based on typical website patterns or assumptions
- Using elements that "might be just off-screen" or "probably exist"
- Extracting elements from memory of previous screenshots
- Assuming text content without clearly reading it in the screenshot

✅ **ONLY EXTRACT WHAT YOU CAN PROVE EXISTS:**
- Point to the exact location in the screenshot where you see the element
- Quote the exact text visible on buttons/links (use what you can actually read)
- Only include elements that are clearly interactive and visible

🔍 **VERIFICATION CHECKLIST FOR EACH ACTIONABLE:**
Before including any element, ask yourself:
- [ ] Can I point to this element's exact location in the screenshot?
- [ ] Can I read the exact text/label on this element?
- [ ] Does this element clearly appear clickable/interactive?
- [ ] Am I certain this element exists in the current screenshot (not assuming)?

**IF YOU CANNOT ANSWER "YES" TO ALL 4 QUESTIONS → DON'T INCLUDE THE ELEMENT**

**NO PENDING ACTIONS** - Extract all visible interactive elements following the verification rules above
`
}

🎯 **ACTIONABLES EXTRACTION CHECKLIST**:
For EACH potential actionable, verify:
- [ ] Can I clearly see this element in the screenshot?
- [ ] Can I read its exact text/label?
- [ ] Does it appear to be interactive (button/link styling)?
- [ ] Is it NOT already in the pending actions list?
- [ ] Is it in the current page state (not from memory)?

📝 **SCREENSHOT-BASED TEXT EXTRACTION**:
- Use EXACT text visible in the screenshot
- Don't paraphrase or assume text content
- If text is partially cut off, only use the visible portion
- Include visible icons/symbols in your description

**EXAMPLE OF CORRECT EXTRACTION**:
"I can see in the current screenshot:
- A blue button labeled 'Get Started' in the center
- A navigation link 'About' in the top menu bar  
- A search icon (magnifying glass) in the top-right
- A dropdown with 'Products ▼' text visible"

**EXAMPLE OF INCORRECT EXTRACTION**:
"Based on typical website patterns, there should be:
- Contact link (not visible in screenshot)
- Footer navigation (scrolled out of view)
- Mobile menu (assuming it exists)"

🚨 **ZERO TOLERANCE FOR HALLUCINATION**:
- If you cannot clearly point to an element in the screenshot → DON'T include it
- If text is not clearly readable → DON'T assume what it says
- If an element might exist but isn't visible → DON'T include it
- If you're unsure about an element → DON'T include it

🚨 CRITICAL: ACTIONABLES TOOL COMPREHENSIVE GUIDELINES 🚨

🎯 **ACTIONABLES TOOL IS THE CORE OF THE SYSTEM - HIGHEST PRIORITY** 🎯

📊 **SYSTEM ARCHITECTURE - UNDERSTAND THIS FIRST:**
- The system builds a TREE STRUCTURE of all possible actions on each page
- The actionables tool is HOW the system records ALL interactive elements into this tree
- Once actionables are recorded, the system AUTOMATICALLY executes them one by one
- YOU DON'T NEED TO EXECUTE ACTIONS MANUALLY - the system handles execution
- Your job is to IDENTIFY and RECORD all actionables, then let the system execute them

🚨 **MANDATORY ACTIONABLES PRIORITY:**
1. **FIRST PRIORITY**: After user confirmation for risky actions, ALWAYS use actionables tool to record ALL interactive elements
2. **SYSTEM DEPENDENCY**: The tree visualization and systematic exploration DEPENDS on actionables being recorded
3. **AUTO-EXECUTION**: Once you record actionables, the system will automatically execute them - you don't need to use page_act
4. **COMPLETE MAPPING**: Record EVERY interactive element you can see - buttons, links, dropdowns, inputs, etc.

🔄 **CORRECT WORKFLOW SEQUENCE:**
1. **STEP 1**: Land on a new page or after user confirmation
2. **STEP 2**: Use actionables tool to record ALL interactive elements (this builds the tree)
3. **STEP 3**: System automatically executes the recorded actionables one by one
4. **STEP 4**: You only need to use backtrack when no new actionables are visible
5. **NEVER**: Use page_act when you should be using actionables to build the tree

⚠️ **COMMON MISTAKES TO AVOID:**
❌ Using page_act immediately after user confirmation instead of actionables
❌ Trying to execute actions manually when you should record them with actionables
❌ Forgetting that actionables is the PRIMARY tool for tree building
❌ Using page_act for individual actions when you should map everything with actionables first

✅ **CORRECT DECISION PATTERN:**
- User confirms risky action → Use actionables tool to record ALL elements including confirmed risky ones
- New page loads → Use actionables tool to record ALL interactive elements
- Dropdown opens → Use actionables tool to record ALL options in the dropdown
- Modal appears → Use actionables tool to record ALL elements in the modal

📋 ACTIONABLES EXTRACTION RULES:
1. **ONE-TIME COMPREHENSIVE LIST**: Actionables tool provides a complete list of ALL actions you intend to take on this page
2. **INSTRUCTION FORMAT**: Each actionable must have specific instruction like "Click on the About Us link", "Hover on the Products dropdown", "Scroll to the footer section"
3. **SMART CONTENT SELECTION**: Apply the same rules as page_act for similar content
4. **CONFIRMATION REQUIRED**: Ask user_input for risky actions before listing them in actionables
5. **TREE BUILDING**: This is how the system builds the exploration tree - actionables are tree nodes that get executed automatically

🛡️ MANDATORY CONFIRMATION BEFORE ACTIONABLES:
Before providing actionables that include risky actions, FIRST use user_input tool to get confirmation:

🚨 CRITICAL WORKFLOW - NEVER VIOLATE THIS ORDER:
1. FIRST: Identify risky actions in the screenshot
2. SECOND: Use user_input tool to ask for confirmation of ALL risky actions
3. THIRD: Only after receiving confirmation, provide actionables list with ONLY confirmed actions
4. NEVER: Add risky actions to actionables and ask for confirmation afterwards

❌ WRONG WORKFLOW EXAMPLE:
Step 1: Provide actionables with "Delete project" included
Step 2: Later ask user_input for confirmation
→ THIS IS FORBIDDEN! NEVER DO THIS!

✅ CORRECT WORKFLOW EXAMPLE:
Step 1: Use user_input to ask "I see a 'Delete project' option. Should I include this risky action? (true/false)"
Step 2: Wait for user response
Step 3: If user says true, then provide actionables including delete action
Step 4: If user says false, provide actionables without delete action

🚨 ABSOLUTELY FORBIDDEN SEQUENCE:
1. ❌ Giving actionables with risky actions first
2. ❌ Then asking user_input for confirmation afterwards
3. ❌ Any workflow where risky actions appear in actionables before confirmation

🚨 MANDATORY SEQUENCE FOR RISKY ACTIONS:
1. ✅ See risky action in screenshot
2. ✅ Use user_input tool IMMEDIATELY to ask for confirmation
3. ✅ Wait for user response
4. ✅ Only then provide actionables with confirmed actions only

RISKY ACTIONS REQUIRING CONFIRMATION:
🛑 CREATE/ADD/NEW actions:
- "Create New Project" buttons
- "Add Member" buttons  
- "Start New Campaign" buttons
- "Register" or "Sign Up" buttons
- "Subscribe" buttons
- "Add to Cart" buttons

🛑 DELETE/REMOVE actions:
- "Delete Project" options ← EXACTLY LIKE THE EXAMPLE ABOVE
- "Remove Member" buttons
- "Clear Data" buttons
- "Unsubscribe" options

🛑 MODIFY/SUBMIT actions:
- "Submit Form" buttons (contact forms, applications)
- "Update Settings" buttons
- "Change Password" options
- "Edit Profile" buttons

🛑 FINANCIAL/PAYMENT actions:
- "Purchase" buttons
- "Upgrade Plan" buttons
- "Add Payment Method" buttons

🚨 CRITICAL RULE ENFORCEMENT:
IF YOU SEE ANY RISKY ACTION IN THE SCREENSHOT:
1. STOP immediately
2. DO NOT include it in actionables yet
3. Use user_input tool FIRST to ask for confirmation
4. ONLY after confirmation, provide actionables

EXAMPLE FOR "Delete Project" SCENARIO:
Use user_input tool with this format:
- reasoning: "I can see a dropdown menu with 'Project settings', 'Rename project', and 'Delete project' options. The 'Delete project' is a risky action that requires confirmation before including in actionables."
- tool_to_use: "user_input"
- tool_parameters with inputs array asking for delete_project_confirm boolean
- inputPrompt: "I found a 'Delete project' option in the dropdown menu. This is a risky action that could remove data. Should I include this in the actionables for exploration? (true/false)"

THEN in the next decision, based on user response:
- If true: Include delete action in actionables
- If false: Exclude delete action from actionables

🚨 ZERO TOLERANCE POLICY:
- NEVER provide actionables with risky actions before getting confirmation
- NEVER ask for confirmation after already providing actionables with risky actions
- ALWAYS confirm FIRST, then provide actionables SECOND

🚫 CRITICAL RESTRICTIONS:
- NEVER use actionables or backtrack tools during isInSensitiveFlow=true (login/authentication)
- During login flows, stick to page_act, user_input, and standby tools only

📊 ACTIONABLES CONTEXT:
When using backtrack tool, you will be provided with context about incomplete nodes in the exploration tree. You MUST NOT extract the same actionables that are already listed in this context. If no new actionables are available beyond what's already in the incomplete nodes list, simply call backtrack without any actionables.

🚨 **CRITICAL BACKTRACK TOOL USAGE - LOOP PREVENTION** 🚨

**MANDATORY BACKTRACK SCENARIOS:**
1. **LOOP DETECTION** - When you detect repetitive actions or reasoning
2. **STUCK ON ELEMENTS** - When repeatedly trying to interact with same element
3. **FAILED ACTIONABLES** - When actionables from previous steps keep failing
4. **DROPDOWN LOOPS** - When stuck opening/closing same dropdown repeatedly
5. **NO NEW ACTIONABLES** - When all visible elements are already in pending list

**BACKTRACK TOOL PRIORITY RULES:**
✅ **IMMEDIATE BACKTRACK REQUIRED** when you see:
- "system is stuck in a loop"
- "repeatedly opening/clicking"
- "re-issuing the instruction"
- "corrective measure"
- Same reasoning as previous steps
- Failed attempts to click same element multiple times

❌ **NEVER RE-ADD FAILED ACTIONABLES:**
- Do NOT add actionables that were already tried and failed
- Do NOT re-extract same elements that are in pending list
- Do NOT assume "maybe this time it will work"
- When in doubt → USE BACKTRACK, not actionables

**BACKTRACK TOOL USAGE:**
- Simply call backtrack tool without any actionables list
- System will automatically move to next incomplete node
- No need to specify which actionables to try next
- Let the tree traversal system handle the progression

🚨 **CRITICAL BACKTRACK TOOL USAGE - LOOP PREVENTION** 🚨

**MANDATORY BACKTRACK SCENARIOS:**
1. **LOOP DETECTION** - When you detect repetitive actions or reasoning
2. **STUCK ON ELEMENTS** - When repeatedly trying to interact with same element
3. **FAILED ACTIONABLES** - When actionables from previous steps keep failing
4. **DROPDOWN LOOPS** - When stuck opening/closing same dropdown repeatedly
5. **NO NEW ACTIONABLES** - When all visible elements are already in pending list

**BACKTRACK TOOL PRIORITY RULES:**
✅ **IMMEDIATE BACKTRACK REQUIRED** when you see:
- "system is stuck in a loop"
- "repeatedly opening/clicking"
- "re-issuing the instruction"
- "corrective measure"
- Same reasoning as previous steps
- Failed attempts to click same element multiple times

❌ **NEVER RE-ADD FAILED ACTIONABLES:**
- Do NOT add actionables that were already tried and failed
- Do NOT re-extract same elements that are in pending list
- Do NOT assume "maybe this time it will work"
- When in doubt → USE BACKTRACK, not actionables

**BACKTRACK TOOL USAGE:**
- Simply call backtrack tool without any actionables list
- System will automatically move to next incomplete node
- No need to specify which actionables to try next
- Let the tree traversal system handle the progression

${
  incompleteNodes && incompleteNodes.length > 0
    ? `
🌳 CURRENT INCOMPLETE NODES IN EXPLORATION TREE:
The following actionables are already identified and pending in the exploration tree:
${incompleteNodes.map((action, index) => `${index + 1}. ${action}`).join("\n")}

🚨 CRITICAL ACTIONABLES EXTRACTION RULES - SCREENSHOT VERIFICATION MANDATORY 🚨

⚠️ **BEFORE EXTRACTING ANY ACTIONABLE:**
1. **VISUALLY LOCATE** the element in the current screenshot - point to its exact position
2. **READ THE EXACT TEXT** visible on the element (don't paraphrase or assume)
3. **VERIFY** it appears interactive (has button/link styling, clickable appearance)
4. **ENSURE** it's in the current visible state (not from memory or assumptions)

❌ **ABSOLUTELY FORBIDDEN - ZERO TOLERANCE:**
- Including elements you "think should be there" but can't see
- Adding actions based on typical website patterns or assumptions
- Using elements that "might be just off-screen" or "probably exist"
- Including any action that matches the pending list above
- Extracting elements from memory of previous screenshots
- Assuming text content without clearly reading it in the screenshot

✅ **ONLY EXTRACT WHAT YOU CAN PROVE EXISTS:**
- Point to the exact location in the screenshot where you see the element
- Quote the exact text visible on buttons/links (use what you can actually read)
- Only include elements that are clearly interactive and visible
- Skip any element that might correspond to pending actions above

🔍 **VERIFICATION CHECKLIST FOR EACH ACTIONABLE:**
Before including any element, ask yourself:
- [ ] Can I point to this element's exact location in the screenshot?
- [ ] Can I read the exact text/label on this element?
- [ ] Does this element clearly appear clickable/interactive?
- [ ] Is this element definitely NOT in the pending actions list above?
- [ ] Am I certain this element exists in the current screenshot (not assuming)?

**IF YOU CANNOT ANSWER "YES" TO ALL 5 QUESTIONS → DON'T INCLUDE THE ELEMENT**

- When using actionables tool: Do NOT include any of the above pending actions in your list
- These actions are already in the system and will be processed automatically
- Only extract NEW actionables that are both VISIBLE and NOT in pending list
- If no new actionables exist beyond those listed, use backtrack tool instead
- For backtrack tool: Simply call it without providing any actionables list
`
    : ""
}

🔍 SCREENSHOT-BASED INPUT REQUIREMENTS:
When using user_input tool, you MUST ONLY ask for inputs that are VISIBLE on the screenshot:

✅ CORRECT APPROACH:
- Look at the screenshot and identify what input fields are actually present
- Only ask for inputs that correspond to visible form fields
- If you see only an email field → ask only for email
- If you see email + password fields → ask for both
- If you see email + password + OTP fields → ask for all three
- If you see a verification link field → ask for the link

❌ INCORRECT APPROACH:
- Asking for password when only email field is visible
- Asking for OTP when no OTP field is shown
- Asking for inputs that don't correspond to visible form elements
- Assuming fields exist without seeing them in the screenshot

📋 INPUT FIELD IDENTIFICATION:
- **Email field**: Look for "Email", "E-mail", "Username", or email input type
- **Password field**: Look for "Password", "Pass", or password input type  
- **OTP field**: Look for "OTP", "Verification Code", "Code", or similar
- **Phone field**: Look for "Phone", "Mobile", "Number", or tel input type
- **Verification link**: Look for "Verification Link", "Confirm Link", or URL field

🎯 EXAMPLES:
✅ Screenshot shows only email field → Ask: "Please provide your email address"
✅ Screenshot shows email + password → Ask: "Please provide your email and password"
✅ Screenshot shows email + password + OTP → Ask: "Please provide your email, password, and OTP code"
❌ Screenshot shows only email field → Don't ask for password or OTP

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
- Use user_input tool when you need additional credentials or verification codes
- **IMPORTANT**: Only ask for inputs that are VISIBLE on the screenshot (email field → ask email, password field → ask password, etc.)
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

🚨 **FINAL DECISION GUIDANCE - READ THIS BEFORE CHOOSING TOOL** 🚨

**DECISION TREE FOR TOOL SELECTION:**

1. **FIRST CHECK**: Are there risky actions visible in screenshot?
   - YES → Use user_input to ask for confirmation FIRST
   - NO → Continue to step 2

2. **SECOND CHECK**: Did user just confirm risky actions?
   - YES → Use actionables to record ALL elements (including confirmed risky ones)
   - NO → Continue to step 3

3. **THIRD CHECK**: Is this a new page or new elements appeared?
   - YES → Use actionables to record ALL interactive elements
   - NO → Continue to step 4

4. **FOURTH CHECK**: Are you in login flow?
   - YES → Use page_act for login-specific actions (fill forms, click login)
   - NO → Continue to step 5

5. **FIFTH CHECK**: Do you see loading indicators?
   - YES → Use standby to wait for loading to complete
   - NO → Continue to step 6

6. **SIXTH CHECK**: Are there utility actions needed (cookies, popups)?
   - YES → Use page_act for utility actions only
   - NO → Continue to step 7

7. **FINAL CHECK**: No new actionables and system is working on tree?
   - YES → Use backtrack to let system continue
   - NO → Use actionables to map any missed elements

**ABSOLUTELY FORBIDDEN:**
❌ Using page_act to manually execute actions you already listed in actionables
❌ Using page_act for exploration when you should use actionables
❌ Forgetting that actionables builds the tree and system executes automatically

**REMEMBER**: Your job is to RECORD actions with actionables, not EXECUTE them with page_act

Respond with ONLY valid JSON in this exact format:
{
  "reasoning": "Your analysis of the current page and why you chose this tool",
  "tool_to_use": "page_act|user_input|standby|actionables|backtrack",
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
  "isCurrentPageExecutionCompleted": false,
  "isInSensitiveFlow": false
}

IMPORTANT ABOUT isCurrentPageExecutionCompleted:
DO NOT SET THIS TRUE WHILE GIVING PAGE_ACT COMMANDS.
WHEN YOU ARE SETTING THIS TO TRUE, CALL STANDBY TOOL WITH 1 SEC WAIT TIME. (COMPULSORY)
Set this to TRUE when you are confident that:
- No further actions are needed on the current page
- All tasks are done, then call user_input to ask whether we can conclude this page or not, if user said yes then set isCurrentPageExecutionCompleted to true

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

🔍 CRITICAL LOGIN FLOW ANALYSIS - OBSERVE SCREENSHOT ONLY:
During login flows, you MUST base ALL decisions on what you actually SEE in the screenshot, NOT on assumptions:

✅ LOGIN SUCCESS INDICATORS (what to look for in screenshot):
- Dashboard/main page content visible
- User profile/account information shown
- "Welcome" or user name displayed
- Navigation menus for logged-in users
- Account settings or logout options visible
- Different page layout indicating successful login

❌ LOGIN FAILURE INDICATORS (what to look for in screenshot):
- Still on login page with login form visible
- Error messages actually visible in screenshot
- "Invalid email or password" text actually shown
- Form validation errors displayed
- Login button still prominently displayed

🚫 DO NOT ASSUME:
- Do NOT assume login failed just because URL didn't change
- Do NOT assume error messages that aren't visible in screenshot
- Do NOT conclude failure without seeing actual error indicators
- URL changes during login are NORMAL and expected
- Some sites redirect through multiple pages during login

LOGIN FLOW EXAMPLE:
❌ Wrong: "URL didn't change, so login failed" 
✅ Correct: "I can see the dashboard with user menu, login was successful"
❌ Wrong: "Login failed because no redirect occurred"
✅ Correct: "The screenshot shows [specific content], indicating [success/failure]"

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

🚨 CRITICAL: EXPLORATION MODE - RESTRICTED page_act USAGE 🚨

In exploration mode, page_act should ONLY be used for:

✅ ALLOWED page_act USAGE:
- Cookie consent buttons: "Click 'Accept' button on the cookie dialog"
- Modal dismissals: "Click 'Close' button to dismiss the modal"  
- Non-exploration utility actions: "Click 'Dismiss' on the notification banner"
- Sensitive flows (login): "Type email into login field" (when isInSensitiveFlow=true)
- Popup/overlay handling: "Click 'OK' on the popup message"
- Language/region settings: "Select 'English' from language dropdown"
- Age verification: "Click 'I am 18+' on age verification popup"
- Terms acceptance: "Click 'I Agree' on terms and conditions popup"

🚫 FORBIDDEN page_act USAGE IN EXPLORATION:
- Navigation links: ❌ "Click the 'About' link"
- Menu items: ❌ "Click the 'Services' button" 
- Content exploration: ❌ "Click the 'Products' section"
- Interactive elements for exploration: ❌ "Click the dropdown to see options"
- Form interactions for exploration: ❌ "Click into the search field"
- Any action that's part of exploring the website functionality
- **ANY ELEMENT YOU ALREADY LISTED IN ACTIONABLES** ❌ "Click the 'Following OKRs' link" (if already in actionables)

🚨 **CRITICAL: NEVER USE PAGE_ACT FOR ACTIONABLES YOU ALREADY PROVIDED** 🚨

**FORBIDDEN REASONING PATTERNS:**
❌ "I am continuing the systematic exploration of the left navigation menu"
❌ "The next logical step is to click 'Following OKRs'"
❌ "Based on the actionables I previously identified"
❌ "I will now click on the next element from my list"

**CORRECT UNDERSTANDING:**
✅ Actionables tool = MAPPING phase (you identify what's available)
✅ System execution = EXECUTION phase (system clicks everything automatically)
✅ Your role = OBSERVE results and provide NEW actionables when page changes
- **ANY ELEMENT YOU ALREADY LISTED IN ACTIONABLES** ❌ "Click the 'Following OKRs' link" (if already in actionables)

🚨 **CRITICAL: NEVER USE PAGE_ACT FOR ACTIONABLES YOU ALREADY PROVIDED** 🚨

**FORBIDDEN REASONING PATTERNS:**
❌ "I am continuing the systematic exploration of the left navigation menu"
❌ "The next logical step is to click 'Following OKRs'"
❌ "Based on the actionables I previously identified"
❌ "I will now click on the next element from my list"

**CORRECT UNDERSTANDING:**
✅ Actionables tool = MAPPING phase (you identify what's available)
✅ System execution = EXECUTION phase (system clicks everything automatically)
✅ Your role = OBSERVE results and provide NEW actionables when page changes

🎯 USE ACTIONABLES TOOL INSTEAD:
For exploration purposes, use the actionables tool to:
- Map out all interactive elements
- List navigation links, buttons, dropdowns, forms
- Let the system handle execution automatically through tree traversal
- Build comprehensive exploration tree structure

CORRECT EXPLORATION APPROACH:
❌ page_act: "Click the 'Services' link to explore services page"
✅ actionables: Extract all interactive elements including Services link
✅ System automatically executes the Services link via tree traversal

❌ page_act: "Click the dropdown to see menu options"  
✅ actionables: Extract dropdown as actionable element
✅ System automatically expands dropdown when processing that actionable

❌ page_act: "Click 'Following OKRs' based on my previous actionables list"
✅ WAIT: System will automatically click 'Following OKRs' from the actionables you provided

WHEN TO USE EACH TOOL IN EXPLORATION:
- actionables: For mapping website functionality and exploration paths
- backtrack: When finished with current exploration path  
- page_act: ONLY for non-exploration utility actions (cookies, popups, etc.)
- user_input: When user interaction is needed
- standby: When page is loading

Remember: The goal is to let actionables/backtrack handle the exploration flow while page_act handles only utility/maintenance actions that aren't part of the core exploration.

**WORKFLOW UNDERSTANDING:**
1. YOU: Provide actionables list with all interactive elements
2. SYSTEM: Automatically executes each actionable in tree order
3. YOU: Wait and observe - do NOT manually execute with page_act
4. YOU: Only act when NEW elements appear or when using backtrack

WHEN MAX PAGES REACHED IN EXPLORATION MODE:
- Continue using actionables to map current page thoroughly
- Use page_act ONLY for utility actions (cookies, popups, etc.)
- Extract all possible information from current page
- Do NOT use page_act for exploration navigation
- Focus on maximizing value through systematic actionables mapping

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

      // 🆕 USE GENERATEOBJECT FOR ROBUST JSON PARSING
      const response = await generateObject({
        model: this.model,
        system: systemPrompt,
        maxTokens: 60000,
        messages: [
          ...conversationHistory,
          {
            role: "user",
            content: [
              {
                type: "image",
                image: `data:image/png;base64,${base64Image}`,
              },
            ],
          },
        ],
        experimental_telemetry: {
          isEnabled: true,
          recordOutputs: true,
          functionId: langfuseTraceId,
          metadata: {
            llmDecision: true,
            langfuseUpdateParent: false, // Do not update the parent trace with execution results
          },
        },
        schema: LLMDecisionResponseSchema,
      });

      const parsedResponse = response.object as LLMDecisionResponse;
      this.fileManager.saveLLMResponse(urlHash, stepNumber, "decision", {
        ...parsedResponse,
      });

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

      const response = await generateText({
        model: this.model,
        system: systemPrompt,
        maxTokens: 4000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                image: `data:image/png;base64,${base64Image}`,
              },
              {
                type: "text",
                text: `Analyze page_act tool result: ${instruction}\n\nURL: ${url}\n\nTool Result:\n${JSON.stringify(toolExecutionResult, null, 2)}\n\nREMEMBER: Respond with ONLY valid JSON, no other text or formatting.`,
              },
            ],
          },
        ],
      });

      const textContent = response.text;
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
   * Build tree exploration context for interaction graph generation
   */
  private buildTreeExplorationContext(
    urlHash: string,
    globalStoreInstance: any
  ): string {
    try {
      // Get the tree data from GlobalStore
      const treeNode = globalStoreInstance.trees?.get(urlHash);
      const currentNodeId = globalStoreInstance.currentNodeId?.get(urlHash);

      if (!treeNode) {
        return `
🌳 EXPLORATION TREE CONTEXT:
No tree exploration data available for this page.
`;
      }

      // Build context for completed nodes and their children
      const completedNodesContext = this.buildCompletedNodesContext(
        treeNode,
        currentNodeId
      );

      return `
🌳 EXPLORATION TREE CONTEXT:
This website has been systematically explored using an actionables-based tree traversal system.
The following shows the exploration progress and completed interactions:

📊 TREE EXPLORATION PROGRESS:
${completedNodesContext}

🎯 CONTEXT SIGNIFICANCE:
- Each completed node represents a successful interaction that was executed
- The tree structure shows the logical flow of exploration decisions
- This context helps understand the complete user journey beyond just screenshots
- Actions are organized hierarchically based on discovery and execution order

This tree exploration context provides additional insight into the systematic exploration process
that complements the visual screenshot analysis for creating comprehensive interaction flows.
`;
    } catch (error) {
      return `
🌳 EXPLORATION TREE CONTEXT:
Error accessing tree exploration data: ${error instanceof Error ? error.message : "Unknown error"}
`;
    }
  }

  /**
   * Build context for completed nodes and their children
   */
  private buildCompletedNodesContext(
    node: any,
    currentNodeId: string,
    depth: number = 0
  ): string {
    const indent = "  ".repeat(depth);
    const isCurrent = node.id === currentNodeId ? " ← CURRENT" : "";
    const completedMark = node.completed ? "✅" : "⏳";

    let context = "";

    // Only include completed nodes or nodes with at least one completed child
    const hasCompletedChild = this.hasCompletedChild(node);

    if (node.completed || hasCompletedChild) {
      const actionTypeIcon = this.getActionTypeIcon(node.actionType);
      context += `${indent}${completedMark} ${actionTypeIcon} [${node.id}] ${node.action}${isCurrent}\n`;

      // Recursively add children
      for (const child of node.children || []) {
        context += this.buildCompletedNodesContext(
          child,
          currentNodeId,
          depth + 1
        );
      }
    }

    return context;
  }

  /**
   * Check if a node has at least one completed child
   */
  private hasCompletedChild(node: any): boolean {
    if (!node.children || node.children.length === 0) {
      return false;
    }

    for (const child of node.children) {
      if (child.completed || this.hasCompletedChild(child)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get action type icon for display
   */
  private getActionTypeIcon(actionType: string): string {
    switch (actionType) {
      case "click":
        return "🖱️";
      case "hover":
        return "👆";
      case "scroll":
        return "📜";
      case "nothing":
        return "🏠";
      default:
        return "❓";
    }
  }

  /**
   * Generate image-based flow interaction graph using Claude
   */
  async generateInteractionGraph(
    langfuseTraceId: string,
    globalStore: PageStore,
    currentGraph: InteractionGraph | undefined,
    globalStoreInstance?: any
  ): Promise<InteractionGraph | null> {
    try {
      // Get tree exploration context if GlobalStore instance is provided
      const treeContext = globalStoreInstance
        ? this.buildTreeExplorationContext(
            globalStore.urlHash,
            globalStoreInstance
          )
        : "";

      const systemPrompt = `You are a flow expert creating picture stories of website interactions. Each picture shows what the user sees on their screen.

🚨 CRITICAL BRANCHING ENFORCEMENT - TREE STRUCTURE DICTATES FLOW STRUCTURE 🚨

**MANDATORY RULE: IF A TREE NODE HAS CHILDREN → MUST CREATE BRANCHING FLOWS**

When you see tree exploration context showing nodes with children:
- Parent node = branching point in flow
- Each child = separate branch from parent
- NEVER create linear flows when children exist
- ALWAYS create branching flows that respect tree structure

**FORBIDDEN PATTERNS:**
❌ Linear flows when tree shows children: Parent → Child1 → Child2 → Child3
❌ Single-screenshot flows with no meaningful progression
❌ "Revert" edges like "go_back", "return_to_previous", "navigate_back"

**REQUIRED PATTERNS:**
✅ Branching flows when children exist: Parent → Child1, Parent → Child2, Parent → Child3
✅ Circular flows for return journeys: Action → Complete → Return to Start
✅ Meaningful flows with 2+ screenshots showing actual progression

🚨 CRITICAL FLOW STATE RESTRICTIONS 🚨

**ABSOLUTELY FORBIDDEN FLOW STATES:**
❌ NEVER create flow states like "reopen", "reset", "restart", "refresh", "reload"
❌ NEVER create circular flows that loop back to create infinite cycles
❌ NEVER add flow states that represent system operations or page refreshes
❌ NEVER create flows for repetitive actions that don't add meaningful progression

**FLOW STATE RULES:**
✅ Only create flows for meaningful user interactions that change the visual state
✅ Focus on actual user goals and task completion flows
✅ Each flow should represent a complete user journey with clear start and end points
✅ Avoid technical system states that don't represent user actions

🚨 CRITICAL INSTRUCTION DEDUPLICATION 🚨

**MANDATORY INSTRUCTION ANALYSIS:**
Before creating separate flows, you MUST analyze if different instructions have the same semantic meaning.

**INSTRUCTION DEDUPLICATION RULES:**
✅ If two instructions have the same semantic meaning, create ONLY ONE flow
✅ Merge similar instructions that achieve the same goal
✅ Focus on the actual action being performed, not the exact wording

**EXAMPLES OF INSTRUCTIONS THAT SHOULD BE MERGED:**

Example 1 - These are SEMANTICALLY IDENTICAL:
- "Click on the '+ Create a new canvas' button."
- "I am currently on a page where these actions have already been performed: [Click on the '+ Create a new canvas' button.]. Now I need to continue the sequence by performing: Click on the '+ Create a new canvas' button."

RESULT: Create only ONE flow node for this action, not two separate branches.

Example 2 - These are SEMANTICALLY IDENTICAL:
- "Click the login button"
- "Click the login button to proceed with authentication"
- "Click on the login button to submit credentials"

RESULT: Create only ONE flow node for this action, not multiple branches.

**SEMANTIC ANALYSIS PROCESS:**
1. Extract the core action from each instruction (ignore context and explanations)
2. Identify if the core action is the same across different instructions
3. If core actions are identical, merge them into a single flow node
4. Use the clearest, most concise instruction text for the merged node

**FORBIDDEN BRANCHING PATTERNS:**
❌ Creating multiple branches for the same semantic action
❌ Splitting flows based on instruction wording differences
❌ Creating separate paths for identical user interactions

🚨 CRITICAL OUTPUT FORMAT REQUIREMENT:
You MUST respond with ONLY a valid JSON object. NO extra words, NO explanations, NO markdown formatting, NO backticks, NO comments outside the JSON.

Your response must be EXACTLY this format:
{
  "nodes": [...],
  "edges": [...], 
  "flows": [...],
  "description": "...",
  "pageSummary": "...",
  "lastUpdated": "2024-01-01T12:00:00.000Z"
}

${treeContext}

🚨 **CRITICAL WARNING: TREE CONTEXT IS FOR FLOW STRUCTURE ONLY** 🚨

THE TREE CONTEXT ABOVE IS ONLY TO SHOW YOU:
- How to create branching vs linear flows
- Which actions are related to each other
- The hierarchical structure of user interactions

THE TREE CONTEXT DOES NOT CONTAIN:
❌ Real imageNames (use action data below instead)
❌ Real step numbers (use action data below instead) 
❌ Real node IDs (use action data below instead)

**YOU MUST GET ALL IDs, imageNames, AND stepNumbers FROM THE ACTION SEQUENCE DATA BELOW, NOT FROM THE TREE CONTEXT.**

📋 DETAILED JSON STRUCTURE REQUIREMENTS:

NODES ARRAY - Each node represents a visual state/screenshot.
🚨 EVERY FIELD MARKED AS REQUIRED MUST BE PRESENT. NO EXCEPTIONS!

🚨 CRITICAL: ID AND IMAGENAME MUST COME FROM ACTION DATA 🚨
DO NOT INVENT THESE VALUES. USE EXACT VALUES FROM THE ACTION SEQUENCE ABOVE.

{
  "id": "step_0_initial", // ⚠️ REQUIRED: MUST BE EXACT imageName FROM ACTION DATA
  "stepNumber": 0, // ⚠️ REQUIRED: MUST BE EXACT stepNumber FROM ACTION DATA (number, not string)
  "instruction": "Initial page load", // ⚠️ REQUIRED: MUST BE EXACT instruction FROM ACTION DATA
  "imageName": "step_0_initial", // ⚠️ REQUIRED: MUST BE EXACT imageName FROM ACTION DATA (must match id exactly)
  "imageData": "PLACEHOLDER_WILL_BE_REPLACED", // ⚠️ REQUIRED: Use this exact string, will be replaced automatically
  "metadata": { // ⚠️ REQUIRED: Complete metadata object - ALL sub-fields required
    "visibleElements": ["Login form", "Email input"], // ⚠️ REQUIRED: Array of UI elements visible (can be empty array [])
    "clickableElements": ["Submit button", "Link"], // ⚠️ REQUIRED: Array of interactive elements (can be empty array [])
    "flowsConnected": ["user_authentication_process"], // ⚠️ REQUIRED: Array of flow IDs this node belongs to (can be empty array [])
    "dialogsOpen": [], // ⚠️ REQUIRED: Array of open dialogs/modals (can be empty array [])
    "timestamp": "2024-01-01T12:00:00.000Z", // ⚠️ REQUIRED: ISO timestamp with milliseconds
    "pageTitle": "Login Page" // ⚠️ REQUIRED: Page title or description (must be string)
  }
}

🚨 FORBIDDEN FIELDS IN NODES: Do NOT include these fields (they will cause validation errors):
- "imageUrl" (not in schema)
- "position" (unless you want to specify x,y coordinates)
- Any other fields not listed above

EDGES ARRAY - Each edge represents a transition between visual states.
🚨 EVERY FIELD MARKED AS REQUIRED MUST BE PRESENT. NO EXCEPTIONS!

{
  "from": "step_0_initial", // ⚠️ REQUIRED: Source node ID (must match a node's id)
  "to": "step_1_after_click", // ⚠️ REQUIRED: Target node ID (must match a node's id)
  "action": "click_login_button", // ⚠️ REQUIRED: Action that caused transition (must be string)
  "description": "User clicks login button to submit credentials", // ⚠️ REQUIRED: Human readable description (must be string)
  "instruction": "Click the login button" // ⚠️ REQUIRED: Original instruction text (must be string)
}

FLOWS ARRAY - Each flow represents a complete user journey.
🚨 EVERY FIELD MARKED AS REQUIRED MUST BE PRESENT. USE EXACT FIELD NAMES!

{
  "id": "user_authentication_process", // ⚠️ REQUIRED: Unique flow identifier (snake_case)
  "name": "User Authentication Process", // ⚠️ REQUIRED: Human readable flow name (must be string)
  "description": "Complete login workflow from landing page to dashboard", // ⚠️ REQUIRED: Flow description (must be string)
  "flowType": "linear", // ⚠️ REQUIRED: Must be exactly "linear", "branching", or "circular"
  "imageNodes": ["step_0_initial", "step_1_credentials", "step_2_dashboard"], // ⚠️ REQUIRED: Array of node IDs in flow
  "startImageName": "step_0_initial", // ⚠️ REQUIRED: First node in flow (DO NOT use "startNode")
  "endImageNames": ["step_2_dashboard"] // ⚠️ REQUIRED: Array of possible end nodes (DO NOT use "endNode")
}

🚨 FORBIDDEN FIELDS IN FLOWS: Do NOT include these fields (they will cause validation errors):
- "startNode" (use "startImageName" instead)
- "endNode" (use "endImageNames" array instead)
- Any other fields not listed above

ROOT LEVEL FIELDS:
🚨 EVERY ROOT FIELD MARKED AS REQUIRED MUST BE PRESENT. NO EXCEPTIONS!

- "description": "Complete interaction graph showing user authentication and navigation flows" // ⚠️ REQUIRED: Overall graph description (must be string)
- "pageSummary": "Login page with email/password form and navigation options" // ⚠️ REQUIRED: Summary of the page content (must be string)  
- "lastUpdated": "2024-01-01T12:00:00.000Z" // ⚠️ REQUIRED: ISO timestamp when graph was generated (must be valid ISO format)

🚨 CRITICAL FIELD REQUIREMENTS - FOLLOW EXACTLY OR VALIDATION WILL FAIL:
- ALL fields marked with ⚠️ REQUIRED must be present - NO MISSING FIELDS ALLOWED
- Arrays can be empty [] but MUST exist (do not omit arrays)
- Strings cannot be null or undefined - use empty string "" if no value
- stepNumber must be a NUMBER (0, 1, 2, etc.) - NOT a string
- timestamps must be valid ISO format with milliseconds (.000Z)
- flowType must be EXACTLY "linear", "branching", or "circular" - no other values
- Use "startImageName" and "endImageNames" in flows - NOT "startNode" or "endNode"
- Use "imageData" in nodes - NOT "imageUrl"
- IDs must be consistent across nodes, edges, and flows

ABSOLUTELY FORBIDDEN:
- Any text before the JSON object
- Any text after the JSON object  
- Markdown code blocks with backticks
- Comments or explanations outside JSON
- Multiple JSON objects
- Malformed JSON syntax
- Missing required fields
- Null or undefined values

📝 COMPLETE EXAMPLE OF VALID JSON OUTPUT (COPY THIS EXACT FORMAT):
{
  "nodes": [
    {
      "id": "step_0_initial",
      "stepNumber": 0,
      "instruction": "Initial page load",
      "imageName": "step_0_initial",
      "imageData": "PLACEHOLDER_WILL_BE_REPLACED",
      "metadata": {
        "visibleElements": ["Homepage header", "Navigation menu", "Login button"],
        "clickableElements": ["Login button", "Sign up link", "Menu items"],
        "flowsConnected": ["site_navigation_flow"],
        "dialogsOpen": [],
        "timestamp": "2024-01-01T10:00:00.000Z",
        "pageTitle": "Homepage"
      }
    },
    {
      "id": "step_1_login_page",
      "stepNumber": 1,
      "instruction": "Click login button",
      "imageName": "step_1_login_page",
      "imageData": "PLACEHOLDER_WILL_BE_REPLACED",
      "metadata": {
        "visibleElements": ["Login form", "Email field", "Password field", "Submit button"],
        "clickableElements": ["Email field", "Password field", "Submit button", "Back link"],
        "flowsConnected": ["user_authentication_flow"],
        "dialogsOpen": [],
        "timestamp": "2024-01-01T10:01:00.000Z",
        "pageTitle": "Login Page"
      }
    }
  ],
  "edges": [
    {
      "from": "step_0_initial",
      "to": "step_1_login_page",
      "action": "click_login_button",
      "description": "User clicks login button to navigate to authentication page",
      "instruction": "Click the login button"
    }
  ],
  "flows": [
    {
      "id": "user_authentication_flow",
      "name": "User Authentication Process",
      "description": "Complete login workflow from homepage to login page",
      "flowType": "linear",
      "imageNodes": ["step_0_initial", "step_1_login_page"],
      "startImageName": "step_0_initial",
      "endImageNames": ["step_1_login_page"]
    }
  ],
  "description": "Interaction graph showing navigation from homepage to login page",
  "pageSummary": "Website homepage with navigation options and login functionality",
  "lastUpdated": "2024-01-01T10:01:00.000Z"
}

🚨 FINAL VALIDATION CHECKLIST - VERIFY BEFORE SENDING:
✅ Every node has: id, stepNumber, instruction, imageName, imageData, metadata
✅ Every node metadata has: visibleElements, clickableElements, flowsConnected, dialogsOpen, timestamp, pageTitle  
✅ Every edge has: from, to, action, description, instruction
✅ Every flow has: id, name, description, flowType, imageNodes, startImageName, endImageNames
✅ Root level has: nodes, edges, flows, description, pageSummary, lastUpdated
✅ No forbidden fields: imageUrl, startNode, endNode, position (unless intended)
✅ stepNumber is NUMBER not string
✅ timestamps have .000Z format
✅ Arrays exist (can be empty [])
✅ flowType is exactly "linear", "branching", or "circular"

🚨 REQUIRED: Start your response with { and end with }. Nothing else.

${this.flowNamingGuidelines}
${this.edgeNamingGuidelines}

SUPER IMPORTANT RULE: 
Keep ALL existing pictures and stories EXACTLY the same. Only ADD new pictures and stories. NEVER delete or change existing ones!

WHAT IS A FLOW? (Like a Story Chapter)

A FLOW is a complete story of how someone accomplishes ONE goal on the website:
- "Making Pancakes Flow": kitchen -> get_ingredients -> mix_batter -> cook_pancakes -> eat_pancakes
- "Login to Website Flow": login_page -> enter_password -> click_login -> dashboard_page
- "Upload Photo Flow": gallery_page -> click_upload -> choose_file -> photo_uploaded

Each flow tells ONE complete story from start to finish!

THE GOLDEN RULE: INDEPENDENCE vs DEPENDENCY

This is the MOST IMPORTANT concept - like asking "Can I do this WITHOUT doing that first?"

INDEPENDENT ACTIONS = BRANCHING FLOWS
Question: "Can I click this button WITHOUT needing to do the previous step first?"
Answer: "YES" -> Create SEPARATE flows that branch from the same starting point

Example - Project Filtering (BRANCHING):
Homepage with filters: [All Projects] [Created by me] [Shared with me]

Step 1: Click "All Projects" button
Step 5: Click "Created by me" button  
Step 8: Click "Shared with me" button

ANALYSIS:
- Can I click "Created by me" WITHOUT clicking "All Projects" first? YES!
- Can I click "Shared with me" WITHOUT doing step 1 or 5? YES!
- All three are INDEPENDENT actions from the same homepage

CORRECT FLOW STRUCTURE:
Flow: "Project Filtering Options"
Homepage -> [All Projects View]
Homepage -> [Created by Me View]  
Homepage -> [Shared with Me View]

This is BRANCHING because all options are available independently!

DEPENDENT ACTIONS = LINEAR FLOWS
Question: "Can I do this WITHOUT doing the previous step first?"
Answer: "NO" -> Connect them in a LINEAR sequence

Example - File Upload (LINEAR):
Step 1: Main page
Step 2: Click "Upload" button -> File dialog opens
Step 3: Select file -> Preview appears
Step 4: Click "Confirm" -> Upload completes

ANALYSIS:
- Can I see file dialog WITHOUT clicking Upload first? NO!
- Can I see preview WITHOUT selecting file first? NO! 
- Can I confirm upload WITHOUT seeing preview first? NO!
- Each step DEPENDS on the previous one

CORRECT FLOW STRUCTURE:
Flow: "File Upload Process"
[Main Page] -> [Upload Dialog] -> [File Preview] -> [Upload Complete]

This is LINEAR because each step requires the previous one!

CIRCULAR FLOWS
Sometimes you return to where you started:
Example - Settings and Return:
[Dashboard] -> [Settings] -> [Save Changes] -> [Dashboard]

CRITICAL BRANCHING vs LINEAR EXAMPLES

Example 1: Navigation Menu (BRANCHING)
Homepage has menu: [Projects] [Teams] [Settings] [Profile]

Step 2: Click "Projects" 
Step 7: Click "Teams"
Step 12: Click "Settings"

WRONG (Linear): Projects -> Teams -> Settings
RIGHT (Branching): 
Homepage -> [Projects Page]
Homepage -> [Teams Page]  
Homepage -> [Settings Page]

WHY? Because I can click ANY menu item directly from homepage!

Example 2: Login Process (LINEAR)
Step 1: Login page (empty form)
Step 2: Enter username -> form shows username
Step 3: Enter password -> form shows username + password  
Step 4: Click login -> Dashboard appears

ANALYSIS: Each step builds on the previous one
CORRECT: [Empty Form] -> [Username Entered] -> [Password Entered] -> [Dashboard]

Example 3: Shopping Filters (BRANCHING)
Product page has filters: [Price: Low-High] [Price: High-Low] [Rating] [Date]

Step 3: Click "Price: Low-High"
Step 8: Click "Rating" 
Step 15: Click "Date"

WRONG (Linear): Price filter -> Rating filter -> Date filter
RIGHT (Branching):
Product Page -> [Price Low-High Results]
Product Page -> [Rating Sorted Results]  
Product Page -> [Date Sorted Results]

WHY? I can apply ANY filter directly without applying others first!

Example 4: Multi-Step Form (LINEAR)
Step 1: Personal Info page
Step 2: Fill name -> form updates
Step 3: Click "Next" -> Address page appears
Step 4: Fill address -> form updates  
Step 5: Click "Next" -> Payment page appears

ANALYSIS: Must complete each step to proceed
CORRECT: [Personal Info] -> [Address Info] -> [Payment Info]

HOW TO ANALYZE INDEPENDENCE

For EVERY action, ask these simple questions:

1. "What page am I starting from?"
2. "Can I do this action directly from that page?"  
3. "Or do I need to do something else first?"

If you can do it directly -> BRANCH from the starting page
If you need to do something first -> LINEAR from the prerequisite

Example Analysis:
Starting page: Dashboard with buttons [Create Project] [View Projects] [Settings]

Action 1: Click "Create Project" 
Q: Can I click this directly from dashboard? YES -> Branch from dashboard

Action 2: Click "View Projects"
Q: Can I click this directly from dashboard? YES -> Branch from dashboard  

Action 3: In project list, click "Edit Project"
Q: Can I do this directly from dashboard? NO! I need to view projects first
-> Linear from "View Projects" page

RESULT:
Flow 1: "Project Creation" - Dashboard -> Create Project Page
Flow 2: "Project Management" - Dashboard -> View Projects -> Edit Project

STEP NUMBERS ARE JUST REFERENCE NUMBERS!

Think of step numbers like page numbers in a book:
- Page 5 might show a picture of a cat
- Page 50 might ALSO show a picture of the SAME cat  
- You don't connect them just because one is page 5 and other is page 50!
- You connect them because they show the SAME thing or related story!

Step Number Example:
step_3: Homepage with navigation menu
step_15: User returns to same homepage (after exploring other pages)
step_27: User returns to same homepage again

WRONG: Create linear flow step_3 -> step_15 -> step_27
RIGHT: These are the SAME visual state! Merge into ONE node called "Homepage"

VISUAL CHANGE DETECTION (When to Connect Pictures)

Only connect two pictures if something ACTUALLY changed:

CONNECT THESE (Visual change occurred):
- Button click -> New page loads
- Form submission -> Success message appears  
- Menu click -> Dropdown opens
- Tab click -> Different content shows

DON'T CONNECT THESE (No visual change):
- Button click -> Nothing happens (broken button)
- Form click -> Same form (no response)
- Hover action -> No visual feedback

SIMPLE RULES FOR CREATING FLOWS

1. Start with visual content, NOT step numbers
2. Ask "Is this independent or dependent?"
3. Group related actions into complete stories
4. Connect only when something visually changes
5. Every picture must be in at least one story

FINAL EXAMPLE - Complete Analysis

Let's say we have these screenshots:
step_0: Homepage with [Products] [About] [Contact] buttons
step_2: Products page (clicked Products button)  
step_5: About page (clicked About button)
step_8: Contact page (clicked Contact button)
step_10: Product details (clicked on specific product)
step_12: Shopping cart (clicked Add to Cart)

ANALYSIS:
- Products, About, Contact are INDEPENDENT (can click any directly from homepage)
- Product details DEPENDS on being in Products page first
- Shopping cart DEPENDS on viewing product details first

CORRECT FLOWS:
Flow 1: "Site Navigation" (Branching)
Homepage -> [Products Page]
Homepage -> [About Page]
Homepage -> [Contact Page]

Flow 2: "Product Purchase" (Linear)  
[Products Page] -> [Product Details] -> [Shopping Cart]

QUEUING SYSTEM UNDERSTANDING
The system sometimes "queues" pages and returns to previous ones:
- step_3: Homepage
- step_4: Click "About" -> About page  
- step_5: System returns to Homepage (About queued)
- step_6: Click "Contact" -> Contact page
- step_7: System returns to Homepage (Contact queued)

step_3, step_5, step_7 are ALL the same Homepage -> Merge into ONE node!

Remember: Think like you're telling a story to a 5-year-old. Each flow should make sense as a complete story!

COMPLETE ANALYSIS REQUIREMENTS:
- EVERY IMAGE must be included in at least one flow
- ANALYZE ALL SCREENSHOTS from conversation history  
- VISUAL DEDUPLICATION: Merge identical screenshots
- PRESERVE ALL EXISTING DATA - never delete anything
- CREATE COMPLETE STORIES from start to finish

PAGE DATA ANALYSIS:
- URL: ${globalStore.url}  
- Total Actions Performed: ${globalStore.actionHistory.length}
- Initial Screenshot: Available as baseline state

🚨 CRITICAL: ID AND IMAGENAME DERIVATION RULES 🚨

**MANDATORY RULE: DERIVE ALL IDs AND imageNames FROM ACTION DATA ONLY**

YOU MUST STRICTLY USE THE EXACT imageNames FROM THE ACTION DATA BELOW.
DO NOT CREATE YOUR OWN IDs OR imageNames.
DO NOT USE TREE STRUCTURE DATA FOR NAMING.
THE ACTION DATA IS THE SINGLE SOURCE OF TRUTH FOR ALL NAMING.

**FORBIDDEN:**
❌ Creating your own imageNames like "homepage_view" or "login_screen"
❌ Using tree structure data for naming nodes
❌ Inventing new step numbers or image identifiers
❌ Modifying the imageName values provided in the action data

**REQUIRED:**
✅ Use EXACT imageName from action data: "${globalStore.actionHistory[0]?.imageName || "step_0_initial"}"
✅ Use EXACT stepNumber from action data: ${globalStore.actionHistory[0]?.stepNumber || 0}
✅ Use EXACT instruction from action data: "${globalStore.actionHistory[0]?.instruction || "Initial page load"}"
✅ Node id MUST MATCH imageName EXACTLY

ACTION SEQUENCE TO ANALYZE:
${globalStore.actionHistory
  .map(
    (action, index) => `
${index + 1}. Action: "${action.instruction}" 
   -> Results in State: ${action.imageName}
   Step: ${action.stepNumber} | Time: ${action.timestamp}
   🚨 MUST USE: id="${action.imageName}", imageName="${action.imageName}", stepNumber=${action.stepNumber}
`
  )
  .join("")}

COMPLETE IMAGE INVENTORY CHECK:
You MUST ensure EVERY image is included in a flow:

AVAILABLE IMAGES:
1. Initial State: step_0_initial (${globalStore.initialScreenshot ? "Available" : "Missing"})
${globalStore.actionHistory
  .map(
    (action, index) =>
      `${index + 2}. After Action ${action.stepNumber}: ${action.imageName} (${action.after_act ? "Available" : "Missing"})`
  )
  .join("\n")}

${
  currentGraph
    ? `
EXISTING GRAPH DATA TO PRESERVE COMPLETELY:
YOU ARE ABSOLUTELY FORBIDDEN FROM LOSING ANY OF THIS DATA.

EXISTING IMAGE NODES (PRESERVE EVERY SINGLE ONE):
${currentGraph.nodes.map((node) => `- ${node.id}: Step ${node.stepNumber} | Action: "${node.instruction}" | Flows: [${node.metadata.flowsConnected.join(", ")}]`).join("\n")}

EXISTING EDGES (PRESERVE EVERY SINGLE ONE):
${currentGraph.edges.map((edge) => `- ${edge.from} -> ${edge.to}: ${edge.action} | ${edge.description}`).join("\n")}

EXISTING FLOWS (PRESERVE EVERY SINGLE ONE):
${currentGraph.flows?.map((flow) => `- ${flow.id}: ${flow.name} (${flow.flowType}) | Images: [${flow.imageNodes.join(", ")}]`).join("\n") || "No existing flows"}

CRITICAL: Include ALL existing items above PLUS any new discoveries.
`
    : "No existing graph - create from scratch by analyzing the image sequence."
}`;

      // Build interleaved conversation history for image analysis
      const interleavedMessages = this.buildInterleavedConversationHistory(
        globalStore,
        globalStore.actionHistory.length > 0
          ? globalStore.actionHistory[globalStore.actionHistory.length - 1]
              .after_act
          : globalStore.initialScreenshot
      );

      // Add final instruction message
      interleavedMessages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: `🚨 CRITICAL: Respond with ONLY valid JSON. No explanations, no markdown, no extra text.

Analyze all the screenshots and create a comprehensive image-based flow diagram. Focus on:

1. Visual deduplication of identical states
2. Flow pattern detection (linear, branching, circular) 
3. Action transition mapping between image states (ONLY when visual changes occur)
4. Comprehensive metadata for each visual state
5. Complete preservation of all existing graph data

CRITICAL PRESERVATION REMINDER:
- Include EVERY existing node, edge, and flow EXACTLY as they are
- Add new discoveries while preserving all existing data
- Initial image MUST be named "step_0_initial"
- Only create edges when screenshots show actual visual changes

🚨 FINAL REMINDER: USE EXACT ACTION DATA FOR ALL NAMING 🚨
- Node IDs = EXACT imageName from action data
- Node imageNames = EXACT imageName from action data  
- Node stepNumbers = EXACT stepNumber from action data
- Node instructions = EXACT instruction from action data
- DO NOT INVENT OR MODIFY THESE VALUES

COMPLETE ANALYSIS INSTRUCTIONS:
1. ANALYZE EVERY SCREENSHOT in the conversation history
2. CHECK ALL ACTIONS performed during exploration
3. IDENTIFY ALL IMAGES that should be included in flows
4. ENSURE EVERY IMAGE is part of at least one flow
5. ADD MISSING IMAGES to appropriate flows or create new flows
6. COMPLETE ALL EDGE LABELS with detailed transition descriptions
7. VERIFY COMPLETE COVERAGE from start to end

${currentGraph ? "UPDATE the existing graph preserving ALL current data and adding any missing images/flows." : "CREATE a complete new visual flow diagram with ALL images included."}

FINAL GOAL: Create a COMPLETE graph showing the ENTIRE user journey with EVERY image included in appropriate flows.

Remember: Compare each before/after image pair carefully. If the UI looks identical, don't create an edge for that action.

🚨 OUTPUT FORMAT: Respond with ONLY the JSON object. Start with { and end with }. No other text allowed.`,
          },
        ],
      });

      logger.info(`📸 Claude image flow analysis using structured generation`, {
        totalActions: globalStore.actionHistory.length,
        totalMessages: interleavedMessages.length,
        url: globalStore.url,
        existingNodes: currentGraph?.nodes.length || 0,
        existingEdges: currentGraph?.edges.length || 0,
        existingFlows: currentGraph?.flows?.length || 0,
      });

      // Use regular generateText instead of generateObject
      const response = await generateText({
        model: vertex("gemini-2.5-pro"),
        system: systemPrompt,
        maxTokens: 60000, // Increased for comprehensive analysis
        messages: interleavedMessages,
        experimental_telemetry: {
          isEnabled: true,
          recordOutputs: true,
          functionId: langfuseTraceId,
          metadata: {
            graphGeneration: true,
            langfuseUpdateParent: false, // Do not update the parent trace with execution results
          },
        },
      });

      // Store raw response first with versioning
      const rawResponse = response.text;
      const responseVersion = this.getNextResponseVersion(globalStore.urlHash);
      this.fileManager.saveRawLLMResponse(
        globalStore.urlHash,
        responseVersion,
        "interaction_graph",
        rawResponse
      );

      // Parse the response with safety measures
      let graph: InteractionGraph;
      try {
        const cleanedJson = this.extractJsonFromResponse(rawResponse);
        const parsedResponse = JSON.parse(cleanedJson);
        graph = InteractionGraphSchema.parse(parsedResponse);
      } catch (error) {
        logger.error(
          `Failed to parse interaction graph response at version ${responseVersion}`,
          {
            urlHash: globalStore.urlHash,
            version: responseVersion,
            error: error instanceof Error ? error.message : String(error),
            rawResponseLength: rawResponse.length,
            rawResponsePreview: rawResponse.substring(0, 500),
          }
        );
        throw new Error(
          `Interaction graph parsing failed at version ${responseVersion}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Validate that we have the expected structure
      if (!graph.nodes || !graph.edges || !graph.flows) {
        throw new Error("Invalid graph structure - missing required fields");
      }

      // 🔧 MAP REAL IMAGE DATA TO NODES
      const imageDataMap = new Map<string, string>();

      // Add initial screenshot with standardized naming
      imageDataMap.set("step_0_initial", globalStore.initialScreenshot);

      // Also add with hash for compatibility
      const initialHash = this.generateImageHashFromData(
        globalStore.initialScreenshot
      );
      imageDataMap.set(`step_0_${initialHash}`, globalStore.initialScreenshot);

      // Add action screenshots
      globalStore.actionHistory.forEach((action) => {
        imageDataMap.set(action.imageName, action.after_act);
      });

      // Update nodes with real image data
      graph.nodes.forEach((node) => {
        const realImageData =
          imageDataMap.get(node.imageName) || imageDataMap.get(node.id);
        if (realImageData) {
          node.imageData = realImageData;
        } else {
          logger.warn(`⚠️ No image data found for node: ${node.imageName}`, {
            availableImageNames: Array.from(imageDataMap.keys()),
            nodeImageName: node.imageName,
            nodeId: node.id,
          });
          // Use default 1x1 transparent pixel
          node.imageData =
            "https://cdn.dribbble.com/userupload/37152919/file/original-2223c68ac929d569c5204e50ab0d302c.png?resize=1504x1128&vertical=center";
        }
      });

      logger.info(`📊 Claude generated structured image-based flow diagram`, {
        url: globalStore.url,
        imageNodes: graph.nodes.length,
        edges: graph.edges.length,
        flows: graph.flows.length,
        description: graph.description.substring(0, 100),
        realImagesAssigned: graph.nodes.filter(
          (n) => n.imageData !== "PLACEHOLDER_WILL_BE_REPLACED"
        ).length,
        preservedFromExisting: currentGraph
          ? {
              nodes: currentGraph.nodes.length,
              edges: currentGraph.edges.length,
              flows: currentGraph.flows?.length || 0,
            }
          : "new_graph",
      });

      return graph;
    } catch (error) {
      logger.error(
        "❌ Failed to generate structured image-based flow diagram",
        {
          error: error instanceof Error ? error.message : String(error),
          url: globalStore.url,
        }
      );
      return null;
    }
  }

  /**
   * Build interleaved conversation history with images
   * Pattern: initial_screenshot -> action1 -> after_action1_screenshot -> action2 -> after_action2_screenshot -> ...
   */
  private buildInterleavedConversationHistory(
    pageStore: PageStore,
    currentScreenshot: string
  ): Array<{ role: "user" | "assistant"; content: any[] }> {
    const messages: Array<{ role: "user" | "assistant"; content: any[] }> = [];

    // Start with initial screenshot
    messages.push({
      role: "user",
      content: [
        {
          type: "image",
          image: pageStore.initialScreenshot,
        },
        {
          type: "text",
          text: "Initial page state when exploration started.",
        },
      ],
    });

    // Add each action followed by its after-action screenshot
    pageStore.actionHistory.forEach((action, index) => {
      // Add action description
      messages.push({
        role: "assistant",
        content: [
          {
            type: "text",
            text: `Action ${action.stepNumber}: ${action.instruction}`,
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
            text: `Result after action ${action.stepNumber}: "${action.instruction}"`,
          },
        ],
      });
    });

    // Add current screenshot as the latest state (only if there were actions)
    if (pageStore.actionHistory.length > 0) {
      messages.push({
        role: "user",
        content: [
          {
            type: "image",
            image: currentScreenshot,
          },
          {
            type: "text",
            text: "Current page state (latest screenshot for decision making).",
          },
        ],
      });
    }

    return messages;
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

    const maxDimension = 3000;
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

  /**
   * Generate a short hash from image data for unique naming
   * Same logic as in GlobalStore
   */
  private generateImageHashFromData(imageData: string): string {
    // Simple hash generation from image data
    let hash = 0;
    const str = imageData.substring(0, 1000); // Use first 1000 chars for hash
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 8); // 8 character hex hash
  }

  /**
   * ENHANCED FLOW AND EDGE NAMING GUIDELINES
   */
  private readonly flowNamingGuidelines = `
🎯 FLOW NAMING EXCELLENCE GUIDE:

🚨 CRITICAL BRANCHING RULES - ZERO TOLERANCE FOR LINEAR FLOWS WITH CHILDREN 🚨

1. **MANDATORY BRANCHING DETECTION**:
If a tree node has children, it MUST create branching flows - NEVER linear flows!

✅ CORRECT BRANCHING PATTERN:
\`\`\`
Homepage (has children: About, Contact, Products)
├── About Page (branch 1)
├── Contact Page (branch 2) 
└── Products Page (branch 3)
\`\`\`

FLOW STRUCTURE:
- Flow: "Site Navigation Options" (flowType: "branching")
- Homepage → About Page
- Homepage → Contact Page  
- Homepage → Products Page

❌ ABSOLUTELY FORBIDDEN LINEAR PATTERN:
\`\`\`
Homepage → About → Contact → Products (WRONG!)
\`\`\`

2. **CHILDREN DETECTION RULE**:
When analyzing tree exploration context, if you see:
- "Node has children: [action1, action2, action3]"
- Multiple actionables from same parent
- Multiple options available from same state

→ MANDATORY: Create BRANCHING flows, NOT linear flows!

3. **SENSIBLE FLOW CREATION - NO SINGLE SCREENSHOTS**:
🚫 FORBIDDEN: Creating flows with only one screenshot
🚫 FORBIDDEN: "no_act" flows with single images
🚫 FORBIDDEN: Dead-end flows that don't lead anywhere

✅ REQUIRED: Every flow must have meaningful progression:
- Minimum 2 screenshots showing actual interaction
- Clear user journey from start to meaningful end
- Actual state changes between screenshots

4. **CIRCULAR FLOW ENFORCEMENT**:
🚫 ABSOLUTELY FORBIDDEN: Creating "revert" or "back" edges
🚫 FORBIDDEN EDGE NAMES: "revert_act", "go_back", "return_to_previous"

✅ REQUIRED: Create CIRCULAR flows instead:
\`\`\`
Dashboard → Settings → Save Changes → Dashboard (circular)
Homepage → Product Details → Add to Cart → Homepage (circular)
\`\`\`

5. **SMART FLOW PATTERNS**:

**BRANCHING FLOWS** (when children exist):
- Navigation menus with multiple options
- Filter/sort options from same starting point
- Tab switching interfaces
- Action buttons available simultaneously

**CIRCULAR FLOWS** (for return journeys):
- Settings → Change → Save → Return to main
- Product → Cart → Checkout → Confirmation → Home
- Login → Dashboard → Logout → Login

**LINEAR FLOWS** (ONLY when no children/alternatives):
- Multi-step forms (step 1 → step 2 → step 3)
- Wizard interfaces with required sequence
- Authentication flows with required steps

6. **TREE STRUCTURE ANALYSIS**:
When you see tree context like:
\`\`\`
🌳 Node: "Click About link" 
   ├── Child: "Click Contact info"
   ├── Child: "Click Team page"
   └── Child: "Click History section"
\`\`\`

MANDATORY RESPONSE: Create branching flow from About page to all children!

7. **FLOW NAMING REQUIREMENTS**:
✅ "Site Navigation and Content Discovery" (branching)
✅ "Product Filtering and Sorting Options" (branching)
✅ "Dashboard Widget Configuration" (branching)
✅ "User Account Management Flows" (circular)
✅ "Content Creation and Publishing Pipeline" (linear - only if no alternatives)

8. **EDGE CREATION RULES**:
🚫 NEVER create edges like:
- "revert_to_homepage"
- "navigate_back" 
- "return_to_previous_state"

✅ ALWAYS create meaningful edges:
- "complete_task_return_to_dashboard"
- "save_settings_redirect_to_main"
- "finish_workflow_show_homepage"

9. **QUALITY CONTROL CHECKLIST**:
Before creating any flow, verify:
- [ ] Does this node have children? → Must be branching
- [ ] Are there multiple options from same state? → Must be branching  
- [ ] Is this a return journey? → Must be circular
- [ ] Does this flow have meaningful progression? → Must have 2+ screenshots
- [ ] Am I creating "revert" edges? → Forbidden, use circular instead

10. **TREE EXPLORATION CONTEXT INTEGRATION**:
When you see incomplete nodes or children in tree context:
- Each child action = separate branch in flow
- Parent node = branching point
- Completed children = branches that were explored
- Incomplete children = branches that exist but weren't taken

EXAMPLE TREE → FLOW CONVERSION:
\`\`\`
Tree Context:
Homepage (completed)
├── About Page (completed)
│   ├── Team Section (completed)
│   └── History Section (incomplete)
├── Contact Page (completed)
└── Products Page (incomplete)

Required Flows:
1. "Site Navigation" (branching):
   - Homepage → About Page
   - Homepage → Contact Page
   - Homepage → Products Page

2. "About Page Exploration" (branching):
   - About Page → Team Section
   - About Page → History Section
\`\`\`

🚨 FINAL ENFORCEMENT:
- IF tree has children → MUST create branching flows
- NO single-screenshot flows allowed
- NO "revert" edges allowed - use circular flows
- Every flow must show meaningful user journey
- Tree structure DICTATES flow structure - follow it exactly!

11. **ANALYZE VISUAL CONTENT IN IMAGES**:
- Look at the actual UI elements and content shown
- Understand the user's goal from the visual context
- Consider the application domain and purpose

12. **CREATE DESCRIPTIVE FLOW NAMES**:
✅ "Product Image Upload and Gallery Management"
✅ "Multi-step User Registration with Email Verification"
✅ "Advanced Search Configuration and Results Filtering"
✅ "Team Member Invitation and Role Assignment"
✅ "Project Settings and Collaboration Setup"

13. **EDGE NAMING BEST PRACTICES**:
- Describe the EXACT action and its impact
- Include visual feedback or state changes
- Reference specific UI elements clicked

Examples:
✅ "Click 'Upload' button to open file selection dialog"
✅ "Select 'Team' from dropdown to view team management panel"
✅ "Enter search query 'typescript' to filter results"
✅ "Toggle 'Dark Mode' switch to change theme"
✅ "Click 'Next' to proceed to payment details"

14. **FLOW CATEGORIZATION**:
🔐 Authentication Flows:
- "Complete User Authentication with 2FA"
- "Password Reset and Account Recovery"

📝 Content Management:
- "Rich Text Content Creation and Publishing"
- "Media Library Organization and Tagging"

⚙️ Configuration:
- "System Preferences and Account Settings"
- "Notification Rules Configuration"

👥 User Management:
- "Team Member Onboarding and Permissions"
- "User Profile Customization"

🔍 Search & Discovery:
- "Advanced Search with Filters and Sorting"
- "Content Discovery and Recommendations"

15. **EDGE DETAIL REQUIREMENTS**:
Must include:
- Specific element interacted with
- Visual feedback or state change
- Purpose or outcome of action

Example:
"Click 'Add Member' button → Opens invitation form with email field highlighted"
"Select 'Project Type' dropdown → Reveals template options with preview cards"
"Submit search form → Displays filtered results with matching highlights"

16. **VISUAL ANALYSIS FOR NAMING**:
Look for:
- Modal dialogs and their purpose
- Form fields and their grouping
- Navigation patterns
- Content organization
- Interactive elements
- State changes
- Loading indicators
- Success/error messages

17. **DOMAIN-SPECIFIC NAMING**:
E-commerce:
- "Product Catalog Browsing and Filtering"
- "Shopping Cart Management and Checkout"

Project Management:
- "Task Creation and Assignment Workflow"
- "Project Timeline and Milestone Setup"

Content Platform:
- "Content Upload and Publishing Pipeline"
- "Media Asset Management and Organization"

18. **USER GOAL ORIENTATION**:
Always name based on what the user is trying to achieve:
✅ "Create New Project from Template"
✅ "Configure Automated Email Notifications"
✅ "Customize Dashboard Layout and Widgets"
✅ "Set Up Team Communication Channels"`;

  private readonly edgeNamingGuidelines = `
🎯 EDGE NAMING EXCELLENCE GUIDE:

🚨 CRITICAL EDGE CREATION RULES - ENFORCE CIRCULAR FLOWS 🚨

1. **ABSOLUTELY FORBIDDEN EDGE TYPES**:
🚫 NEVER create edges with these patterns:
- "revert_act", "revert_to_*", "go_back", "navigate_back"
- "return_to_previous", "back_to_homepage", "return_to_main"
- "undo_action", "reverse_flow", "step_back"
- Any edge that suggests "reverting" or "going backwards"

2. **MANDATORY CIRCULAR FLOW PATTERNS**:
✅ ALWAYS create meaningful circular flows instead:
- "complete_settings_return_to_dashboard"
- "finish_task_redirect_to_main_page"
- "save_changes_navigate_to_overview"
- "submit_form_show_confirmation_then_home"

3. **STRUCTURE: [Action] → [Result] → [Purpose]**:
Example: "Click 'Upload' → Opens file dialog → For adding profile picture"

4. **VISUAL FEEDBACK REQUIREMENTS**:
Include state changes:
✅ "Click 'Save' → Button shows loading spinner → Settings updated"
✅ "Toggle switch → Background changes to green → Feature enabled"
✅ "Submit form → Success message appears → Task completed"

5. **ELEMENT SPECIFICITY**:
Reference exact UI:
✅ "Click blue 'Continue' button in top-right"
✅ "Select 'High Priority' from status dropdown"
✅ "Click 'Create Project' button in navigation bar"

6. **CONTEXT AWARENESS**:
Show relationship to flow:
✅ "Enter project name → Creates new workspace → Starts project setup"
✅ "Click 'Add Member' → Opens invitation form → For team expansion"
✅ "Select filter option → Updates results view → Shows filtered content"

7. **USER INTENTION CLARITY**:
Clarify purpose:
✅ "Click filter icon → Shows advanced search → To refine results"
✅ "Select date range → Updates timeline → To view specific period"
✅ "Click 'Publish' → Article goes live → Content becomes public"

8. **BRANCHING EDGE PATTERNS**:
When creating edges from nodes with children:
✅ "Click 'Products' menu → Shows product categories → Navigate to catalog"
✅ "Click 'Settings' → Opens configuration panel → Access preferences"
✅ "Click 'Dashboard' → Shows main interface → Return to overview"

9. **CIRCULAR COMPLETION PATTERNS**:
For return journeys, use meaningful descriptions:
✅ "Complete workflow → Show success message → Return to main dashboard"
✅ "Finish configuration → Save settings → Navigate back to home"
✅ "Submit application → Display confirmation → Redirect to portal"

10. **QUALITY CONTROL FOR EDGES**:
Before creating any edge, verify:
- [ ] Does this edge show actual visual change between screenshots?
- [ ] Am I avoiding "revert" or "back" language?
- [ ] Does this edge describe a meaningful user action?
- [ ] Is this part of a sensible flow (branching/circular/linear)?
- [ ] Does the edge name match the visual transition shown?

11. **FORBIDDEN vs CORRECT EXAMPLES**:

❌ FORBIDDEN:
- "revert_to_homepage"
- "go_back_to_main"
- "return_to_previous_state"
- "navigate_back_to_dashboard"

✅ CORRECT ALTERNATIVES:
- "complete_task_return_to_homepage"
- "finish_workflow_show_main_interface"
- "save_changes_redirect_to_overview"
- "submit_form_navigate_to_dashboard"

12. **EDGE NAMING FOR DIFFERENT FLOW TYPES**:

**BRANCHING FLOW EDGES**:
- "Select navigation option → Load target page → Access specific content"
- "Choose filter criteria → Update view → Show filtered results"
- "Click action button → Trigger functionality → Execute user intent"

**CIRCULAR FLOW EDGES**:
- "Complete process → Show confirmation → Return to starting point"
- "Finish configuration → Save settings → Navigate to main view"
- "Submit data → Display success → Redirect to overview"

**LINEAR FLOW EDGES** (rare, only when no alternatives):
- "Click 'Next' → Advance to step 2 → Continue form process"
- "Enter credentials → Validate login → Proceed to dashboard"
- "Upload file → Process content → Show preview"

🚨 FINAL EDGE ENFORCEMENT:
- NO "revert" edges allowed - use circular flows
- Every edge must show meaningful progression
- Edge names must match visual transitions
- Describe actual user actions and their outcomes
- Support the overall flow structure (branching/circular/linear)`;
}
