import { generateText, generateObject, LanguageModel } from "ai";
import { vertex } from "@ai-sdk/google-vertex";
import { anthropic } from "@ai-sdk/anthropic";
import sharp from "sharp";
import { z } from "zod";
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
    this.model = vertex("gemini-1.5-pro");

    // Initialize Claude model for graph generation
    this.claudeModel = anthropic("claude-4-sonnet-20250514");

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
EXPLORATION MODE ACTIVATED:
Since this is an exploration objective, your strategy should be:
1. EXPLORE THE CURRENT PAGE COMPLETELY: Click ALL visible buttons, filters, dropdowns, toggles, tabs, and interactive elements
2. THOROUGH INTERACTION: Don't assume what elements do - actually interact with them to see their behavior
3. FOCUS ON SCREENSHOT: Base decisions strictly on what you can see in the screenshot, don't assume functionality
4. SEQUENTIAL EXPLORATION: Explore one element at a time, observing the changes after each interaction
5. DISCOVER NEW PAGES: Click on links that lead to new pages to register them for future processing

For exploration:
- Click every button, filter, dropdown, tab, toggle, and interactive element you can see
- Observe how each interaction changes the page state
- Don't assume functionality - test it by interacting
- Scroll the page as needed to reveal more content/links
- If you see forms, try interacting with form elements (but get confirmation before submitting)
- Example: If you see a dropdown, click it to see what options are available
`
    : `
TASK-FOCUSED MODE:
Since this is a specific task objective, your strategy should be:
1. EXPLORE THE CURRENT PAGE COMPLETELY: Click ALL visible buttons, filters, dropdowns, toggles, tabs, and interactive elements
2. THOROUGH INTERACTION: Don't assume what elements do - actually interact with them to see their behavior
3. FOCUS ON SCREENSHOT: Base decisions strictly on what you can see in the screenshot, don't assume functionality
4. SEQUENTIAL EXPLORATION: Explore one element at a time, observing the changes after each interaction
5. GOAL-ORIENTED: While exploring, keep the specific objective in mind and prioritize relevant elements

- Click every button, filter, dropdown, tab, toggle, and interactive element you can see
- Observe how each interaction changes the page state
- Don't assume functionality - test it by interacting
- Scroll the page as needed to reveal more content/links
- If you see forms, try interacting with form elements (but get confirmation before submitting)
- Example: If you see a dropdown, click it to see what options are available
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
Like creating a new task, inviting someone, deleting something, clicking on forget password etc

ACTIONS REQUIRING CONFIRMATION (NON-EXHAUSTIVE LIST):
🛑 CREATE/REGISTER:
- Creating accounts/profiles
- Registering for services
- Adding items to cart/wishlist
- Creating posts/comments/reviews
- Signing up for newsletters
- Creating any new content

🛑 DELETE/REMOVE:
- Deleting accounts/profiles
- Removing items from cart
- Deleting posts/comments
- Unsubscribing from services
- Removing any existing data

🛑 MODIFY/UPDATE:
- Changing account settings/preferences
- Updating profile information
- Editing existing content
- Changing passwords/security settings
- Modifying any existing data

🛑 SUBMIT/SEND:
- Submitting contact forms
- Sending messages/emails
- Placing orders/purchases
- Submitting reviews/ratings
- Any form submission with personal data

🛑 FINANCIAL/TRANSACTIONS:
- Making purchases/payments
- Adding payment methods
- Changing billing information
- Any money-related actions

🚫 ABSOLUTELY NO EXCEPTIONS:
- Even if it seems harmless, ASK FIRST
- Even if it's "just testing", ASK FIRST  
- Even if you think the user wants it, ASK FIRST
- Better to ask unnecessarily than act without permission

✅ CONFIRMATION EXAMPLES:
- "I found a signup form. Should I create an account with email user@example.com? (yes/no)"
- "There's an 'Add to Cart' button for Product X ($29.99). Should I add it? (yes/no)"
- "I can submit this contact form with your message. Should I proceed? (yes/no)"
- "There's a 'Delete Account' option. Do you want me to click it? (yes/no)"

🔍 SAFE ACTIONS (NO CONFIRMATION NEEDED):
- Clicking navigation links (About, Contact, Home, etc.)
- Opening dropdowns/menus to explore options
- Scrolling to view content
- Clicking to view product details (without adding to cart)
- Browsing/viewing content only

🚫 CRITICAL: ACTIONS TO ABSOLUTELY AVOID:
⛔ **NEVER CLICK LOGOUT/SIGN OUT BUTTONS**:
- "Logout", "Sign Out", "Log Out", "Exit", "Disconnect"
- User menu items that end sessions
- Account termination options
- Session ending controls

⚔️ **SMART CONTENT SELECTION STRATEGY**:
When you see MULTIPLE SIMILAR ITEMS, only interact with ONE example:

📋 **Project Lists**: Click only one project to explore, not all projects
🎥 **Video Lists**: Click only one video to test functionality, not every video  
📝 **Task Lists**: Select only one task to understand the workflow, not all tasks
📰 **Article Lists**: Click only one article to see the reading experience
🛍️ **Product Lists**: Explore only one product to understand the interface
👥 **User Profiles**: Check only one profile to see the profile page structure
📁 **File Lists**: Open only one file to understand file management
🏢 **Company Lists**: Select only one company to see company details
📧 **Message Lists**: Open only one message to see message interface
🔖 **Category Lists**: Explore only one category to understand navigation

💡 **SELECTION CRITERIA**:
- Choose the FIRST or most prominent item
- Pick items that seem most representative  
- Avoid testing every single similar item
- Focus on understanding the PATTERN, not exhausting all examples

**Examples**:
✅ "Click on the first project in the project list to explore project details"
✅ "Select the top video to understand the video player interface"
✅ "Open the first task to see task management functionality"
❌ "Click on all projects to see each one"
❌ "Test every video in the list"
❌ "Open all tasks to explore them"

Available tools:
- page_act: Perform actions on the page (click, type, scroll to a section, scroll to bottom etc.) - provide instruction parameter
- user_input: Request input from user (for login forms, OTP, email verification links, confirmations, etc.) - supports single or multiple inputs at once
- standby: Wait for loading states or page changes - provide waitTimeSeconds parameter

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

Respond with ONLY valid JSON in this exact format:
{
  "reasoning": "Your analysis of the current page and why you chose this tool",
  "tool_to_use": "page_act|user_input|standby",
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

      const response = await generateText({
        model: this.model,
        system: systemPrompt,
        maxTokens: 2000,
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
      });

      // console.log("SYSTEM PROMPT", systemPrompt); // Debug log - uncomment if needed

      const textContent = response.text;
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
      this.fileManager.saveLLMResponse(urlHash, stepNumber, "decision", {
        ...parsedResponse,
        image: `data:image/png;base64,${base64Image}`,
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

      const response = await generateText({
        model: this.model,
        system: systemPrompt,
        maxTokens: 2000,
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
            image: `data:image/png;base64,${base64Image}`,
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

      const response = await generateText({
        model: this.model,
        system: systemPrompt,
        maxTokens: 8000,
        messages: messages,
      });

      const textContent = response.text;
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
   * Ask Gemini if the interaction graph needs to be updated after a page_act
   */
  async shouldUpdateGraph(
    globalStore: PageStore,
    currentGraph: InteractionGraph | undefined,
    latestAction: string,
    latestScreenshot: string
  ): Promise<boolean> {
    try {
      // Define Zod schema for graph update decision
      const GraphUpdateDecisionSchema = z.object({
        needsUpdate: z
          .boolean()
          .describe("Whether the interaction graph needs to be updated"),
        reasoning: z
          .string()
          .describe(
            "Brief explanation of why the graph does/doesn't need updating"
          ),
      });

      const systemPrompt = `You are analyzing whether an interaction graph needs to be updated after a page action.

CURRENT ACTION: ${latestAction}

GLOBAL STORE DATA:
- URL: ${globalStore.url}
- Initial Screenshot: Available
- Action History: ${globalStore.actionHistory.length} previous actions
- Previous Actions: ${globalStore.actionHistory.map((a) => a.instruction).join(", ")}

CURRENT GRAPH STATUS:
${currentGraph ? `Existing graph with ${currentGraph.nodes.length} nodes and ${currentGraph.edges.length} edges` : "No existing graph"}

ANALYSIS CRITERIA:
- Did the action reveal new interactive elements (buttons, dropdowns, modals, dialogs)?
- Did the action change the page state significantly (new sections appeared, elements changed)?
- Did the action create new interaction flows or pathways?
- Are there new relationships between UI elements that should be mapped?

Analyze the screenshot and determine if the graph needs updating.`;

      // Build interleaved conversation history for graph update decision
      const interleavedMessages = this.buildInterleavedConversationHistory(
        globalStore,
        latestScreenshot
      );

      // Add decision instruction message
      interleavedMessages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze if the graph needs updating after this action: "${latestAction}"`,
          },
        ],
      });

      logger.info(`📸 Gemini graph update decision using interleaved history`, {
        totalActions: globalStore.actionHistory.length,
        totalMessages: interleavedMessages.length,
        latestAction,
      });

      const response = await generateObject({
        model: this.model,
        schema: GraphUpdateDecisionSchema,
        system: systemPrompt,
        maxTokens: 1000,
        messages: interleavedMessages,
      });

      logger.info("🤖 Gemini graph update decision", {
        needsUpdate: response.object.needsUpdate,
        reasoning: response.object.reasoning,
        action: latestAction,
      });

      return response.object.needsUpdate;
    } catch (error) {
      logger.error("❌ Failed to get graph update decision from Gemini", {
        error,
      });
      return false; // Default to not updating if decision fails
    }
  }

  /**
   * Generate page navigation graph when URL changes (no Gemini confirmation needed)
   */
  async generatePageNavigationGraph(
    sourcePageStore: PageStore,
    currentGraph: InteractionGraph | undefined,
    navigationAction: string,
    sourceUrl: string,
    targetUrl: string
  ): Promise<InteractionGraph | null> {
    // Use the new comprehensive page change navigation method
    return this.generatePageChangeNavigationGraph(
      sourcePageStore,
      currentGraph,
      navigationAction,
      sourceUrl,
      targetUrl
    );
  }

  /**
   * Generate image-based flow interaction graph using Claude
   */
  async generateInteractionGraph(
    globalStore: PageStore,
    currentGraph: InteractionGraph | undefined
  ): Promise<InteractionGraph | null> {
    try {
      const systemPrompt = `You are an expert UI/UX analyst creating comprehensive image-based flow diagrams for web applications.

${this.flowNamingGuidelines}
${this.edgeNamingGuidelines}

🚨 CRITICAL DATA PRESERVATION WARNING:
Your response will COMPLETELY REPLACE the existing graph. You are STRICTLY FORBIDDEN from losing ANY existing data.
You MUST include EVERY SINGLE existing node, edge, and flow EXACTLY as they are, plus any new discoveries.

⚠️ ABSOLUTE PRESERVATION REQUIREMENTS:
- **NEVER MODIFY** existing flows - keep them exactly as they are
- **NEVER REMOVE** existing nodes or edges - preserve all previous states
- **NEVER CHANGE** existing flow names, descriptions, or structures
- **ONLY ADD** new discoveries to existing flows or create new flows
- **MAINTAIN COMPLETE HISTORY** from the very first step to the current state
- **PRESERVE ALL TIMESTAMPS** and metadata exactly as they were
- **KEEP ALL VISUAL STATES** in chronological order without gaps

🔍 COMPLETE ANALYSIS REQUIREMENT:
You MUST analyze the ENTIRE chat history, ALL screenshots, and EVERY action to create a COMPLETE graph:
- **EVERY IMAGE MUST BE INCLUDED** in at least one flow - this is COMPULSORY
- **NO IMAGE CAN BE LEFT OUT** - if an image exists, it must be part of a flow
- **ANALYZE ALL SCREENSHOTS** from the conversation history
- **CHECK ALL ACTIONS** performed during exploration
- **IDENTIFY MISSING IMAGES** that aren't in existing flows
- **ADD MISSING IMAGES** to appropriate flows or create new flows
- **COMPLETE EDGE LABELS** for all transitions between images
- **FULL FLOW COVERAGE** from the very beginning to the very end

🔥 WHAT ARE FLOWS? WHY ARE WE CREATING THEM?
FLOWS represent complete user journeys through the application:
- **PURPOSE**: Track how users navigate through different states to accomplish goals
- **VALUE**: Essential for UX analysis, testing, and understanding user experience
- **COMPOSITION**: Each flow is a sequence of connected image states showing a complete journey

FLOW EXAMPLES:
- "User Authentication Process": login_page → enter_credentials → validate → dashboard
- "File Upload Workflow": main_page → click_upload → file_dialog → select_file → preview → upload_complete
- "E-commerce Checkout Process": product_page → add_to_cart → cart_view → checkout_form → payment → confirmation
- "Navigation Discovery Journey": home_page → menu_expand → section_select → content_view
- "Settings Configuration Flow": dashboard → settings_menu → configuration_panel → save_changes

🚨 CRITICAL FLOW STEP INCLUSION REQUIREMENT:
⚠️ **NEVER SKIP STEPS IN A FLOW - INCLUDE ALL AVAILABLE IMAGES**:
- If a flow has multiple step images available, you MUST include EVERY SINGLE ONE
- Do NOT skip intermediate steps or combine multiple steps into one
- Each step image represents a distinct state that must be preserved
- Missing steps break the flow continuity and lose valuable UX data

**Example - File Upload Flow**:
❌ WRONG: step_0_initial → step_5_upload_complete (missing steps 1,2,3,4)
✅ CORRECT: step_0_initial → step_1_click_upload → step_2_file_dialog → step_3_file_selected → step_4_preview → step_5_upload_complete

**Flow Completeness Rules**:
1. Include EVERY image that belongs to the flow sequence
2. Maintain chronological order of step numbers
3. Connect ALL intermediate steps with appropriate edges
4. Each step must show progression toward the flow goal
5. No gaps allowed in step sequences

🎯 IMAGE STATE ANALYSIS OVERVIEW:
You are analyzing screenshots captured during web exploration. Each image represents a different APPLICATION STATE after specific user actions.

🔧 YOUR CORE RESPONSIBILITIES:
1. **VISUAL DEDUPLICATION**: Identify visually identical states and merge into single nodes
2. **FLOW MAPPING**: Group related image sequences into logical user journeys  
3. **PATTERN DETECTION**: Identify linear, branching, and circular flow patterns
4. **TRANSITION ANALYSIS**: Create edges ONLY when visual changes actually occur

⚠️ CRITICAL EDGE CREATION RULES - VISUAL CHANGE DETECTION:
🔍 ONLY CREATE EDGES WHEN THERE ARE ACTUAL VISUAL CHANGES:
- Compare the "before" image state with the "after action" image state
- IF the images are visually identical → DO NOT create an edge
- IF the images show different content/UI → CREATE an edge

❌ DO NOT CREATE EDGES FOR:
- Button clicks that don't change the page visually (no response)
- Hover actions that don't trigger visual changes
- Clicks on inactive/disabled elements
- Actions that fail silently without UI feedback
- Form submissions that don't show success/error states
- Loading states that look identical to the previous state

✅ CREATE EDGES ONLY FOR:
- Page navigation (different page content)
- Modal/dialog opening or closing
- Form field changes (text appears in inputs)
- Content updates (new text/images appear)
- UI state changes (menus expand, tabs switch)
- Error messages appearing
- Success notifications showing
- Loading → content loaded transitions

🔍 VISUAL COMPARISON EXAMPLES:
Example 1: Click "Upload" button
- Before: Page with upload button
- After: SAME page with upload button (no change)
- → NO EDGE (action had no visual effect)

Example 2: Click "Upload" button
- Before: Page with upload button  
- After: File selection dialog opened
- → CREATE EDGE (visual change occurred)

Example 3: Type in input field
- Before: Empty input field
- After: Input field with text visible
- → CREATE EDGE (visual change occurred)

PAGE DATA ANALYSIS:
- URL: ${globalStore.url}  
- Total Actions Performed: ${globalStore.actionHistory.length}
- Initial Screenshot: Available as baseline state

📝 ACTION SEQUENCE TO ANALYZE:
${globalStore.actionHistory
  .map(
    (action, index) => `
${index + 1}. Action: "${action.instruction}" 
   → Results in State: ${action.imageName}
   Step: ${action.stepNumber} | Time: ${action.timestamp}
`
  )
  .join("")}

🔍 COMPLETE IMAGE INVENTORY CHECK:
You MUST ensure EVERY image is included in a flow:

AVAILABLE IMAGES:
1. **Initial State**: step_0_initial (${globalStore.initialScreenshot ? "Available" : "Missing"})
${globalStore.actionHistory
  .map(
    (action, index) =>
      `${index + 2}. **After Action ${action.stepNumber}**: ${action.imageName} (${action.after_act ? "Available" : "Missing"})`
  )
  .join("\n")}

🚨 MANDATORY FLOW INCLUSION RULES:
- **EVERY SINGLE IMAGE ABOVE MUST BE INCLUDED** in at least one flow
- **NO IMAGE CAN BE EXCLUDED** - if it exists in the data, it must be in a flow
- **CHECK EACH IMAGE** against existing flows to ensure coverage
- **ADD MISSING IMAGES** to appropriate flows or create new flows
- **COMPLETE THE JOURNEY** from first image to last image

${
  currentGraph
    ? `
🔒 EXISTING GRAPH DATA TO PRESERVE COMPLETELY:
YOU ARE ABSOLUTELY FORBIDDEN FROM LOSING ANY OF THIS DATA.
EVERY SINGLE ITEM BELOW MUST BE INCLUDED IN YOUR RESPONSE.

🚨 STRICT PRESERVATION RULES:
- **COPY EVERYTHING EXACTLY** - do not modify, remove, or change anything
- **MAINTAIN COMPLETE TIMELINE** from step 0 to current step
- **PRESERVE ALL FLOW STRUCTURES** exactly as they are
- **KEEP ALL NODE CONNECTIONS** and relationships intact
- **NEVER REORGANIZE** existing flows or change their names
- **ONLY ADD NEW CONTENT** to existing flows or create new flows

CURRENT STATISTICS:
- Image Nodes: ${currentGraph.nodes.length} (PRESERVE ALL)
- Edges: ${currentGraph.edges.length} (PRESERVE ALL)  
- Flows: ${currentGraph.flows?.length || 0} (PRESERVE ALL)
- Description: ${currentGraph.description}
- Page Summary: ${currentGraph.pageSummary}

EXISTING IMAGE NODES (PRESERVE EVERY SINGLE ONE):
${currentGraph.nodes.map((node) => `- ${node.id}: Step ${node.stepNumber} | Action: "${node.instruction}" | Flows: [${node.metadata.flowsConnected.join(", ")}]`).join("\n")}

EXISTING EDGES (PRESERVE EVERY SINGLE ONE):
${currentGraph.edges.map((edge) => `- ${edge.from} → ${edge.to}: ${edge.action} | ${edge.description}`).join("\n")}

EXISTING FLOWS (PRESERVE EVERY SINGLE ONE):
${currentGraph.flows?.map((flow) => `- ${flow.id}: ${flow.name} (${flow.flowType}) | Images: [${flow.imageNodes.join(", ")}]`).join("\n") || "No existing flows"}

🚨 CRITICAL: Your response replaces everything. Include ALL existing items above PLUS any new discoveries.
**NEVER REMOVE OR MODIFY** any of the above data - only add new content.

🔍 COMPLETE GRAPH VERIFICATION:
Before finalizing your response, verify that:
1. **EVERY IMAGE** from the inventory is included in at least one flow
2. **ALL EDGES** have complete labels describing the transitions
3. **ALL FLOWS** cover the complete journey from start to end
4. **NO IMAGES** are left out or missing from flows
5. **COMPLETE TIMELINE** is maintained from step 0 to final step

🎯 YOUR GOAL: Create a COMPLETE graph that shows the ENTIRE user journey with EVERY image included in appropriate flows.
`
    : "No existing graph - create from scratch by analyzing the image sequence."
}

🏗️ STANDARDIZED NAMING REQUIREMENTS:

INITIAL IMAGE NAMING:
- The very first image (page load) MUST ALWAYS be named: "step_0_initial"
- This provides consistent identification across all graphs

FLOW NAMING RULES:
✅ GOOD FLOW NAMES (use these patterns):
- "User Authentication Process" (not "login_flow")
- "File Upload Workflow" (not "upload_flow")  
- "Product Search Journey" (not "search_flow")
- "Account Registration Process" (not "signup_flow")
- "Settings Configuration Flow" (not "settings_flow")
- "Payment Checkout Process" (not "payment_flow")
- "Content Creation Workflow" (not "content_flow")
- "Navigation Discovery Journey" (not "navigation_flow")
- "Form Validation Process" (not "form_flow")
- "Modal Interaction Sequence" (not "dialog_flow")

🎯 **FUTURE-FOCUSED FLOW NAMING STRATEGY**:
Create flow names that answer: "If someone wanted to accomplish this task in the future, what would they search for?"

**Naming Framework**: [Action/Goal] + [Process Type] + [Context]

**Examples of Excellent Flow Names**:
✅ "Complete User Onboarding Experience" - Shows the entire new user journey
✅ "Project Creation and Setup Workflow" - Clear about creating and configuring projects  
✅ "Document Upload and Processing Pipeline" - File handling from start to finish
✅ "User Profile Management and Customization" - Profile editing capabilities
✅ "E-commerce Product Discovery and Purchase Journey" - Shopping experience
✅ "Customer Support Ticket Submission and Tracking" - Help desk workflow
✅ "Content Publishing and Review Process" - Publishing workflow
✅ "Team Collaboration and Communication Flow" - Team interaction patterns
✅ "Financial Transaction and Payment Processing" - Money handling workflows
✅ "Data Import, Validation, and Integration Process" - Data handling pipeline

**What Makes a Great Flow Name**:
1. **Action-Oriented**: Starts with what the user wants to accomplish
2. **Complete Scope**: Indicates the full journey from start to finish  
3. **Searchable**: Uses terms someone would search for
4. **Professional**: Sounds like documentation someone would reference
5. **Specific**: Clearly distinguishes from other workflows
6. **Future-Proof**: Remains relevant as the application evolves

**Bad Flow Names to Avoid**:
❌ "dialog_flow" → ✅ "Modal Dialog Interaction and Form Submission Process"
❌ "navigation_flow" → ✅ "Site Navigation and Content Discovery Journey"  
❌ "form_flow" → ✅ "Data Entry, Validation, and Submission Workflow"
❌ "menu_flow" → ✅ "Navigation Menu Exploration and Section Access"
❌ "button_flow" → ✅ "Action Button Interaction and Response Handling"

EDGE NAMING RULES:
✅ GOOD EDGE DESCRIPTIONS (specific and clear):
- "User clicks Upload button to open file selection dialog"
- "System displays validation error after form submission"
- "Navigation menu expands revealing section options"
- "Login form validates credentials and redirects to dashboard"
- "File preview appears after successful file selection"

EDGE ACTION NAMING RULES:
✅ GOOD ACTION NAMES (specific verbs):
- "expand_navigation_menu" (not "click_menu")
- "open_file_dialog" (not "click_upload")
- "validate_login_form" (not "submit_form")
- "display_error_message" (not "show_error")
- "redirect_to_dashboard" (not "navigate")

🔍 CONTEXT-BASED NAMING:
Base your flow names on what you actually see in the screenshots:
- If you see login forms → "User Authentication Process"
- If you see file upload dialogs → "Document Upload Workflow" 
- If you see shopping cart → "E-commerce Checkout Process"
- If you see settings panels → "System Configuration Flow"
- If you see search results → "Content Discovery Journey"
- If you see dashboard elements → "User Portal Navigation"
- If you see forms with validation → "Data Entry Validation Process"

💡 FLOW ID GENERATION:
Convert descriptive names to IDs by:
- "User Authentication Process" → id: "user_authentication_process"
- "File Upload Workflow" → id: "file_upload_workflow"  
- "Modal Interaction Sequence" → id: "modal_interaction_sequence"

📋 REQUIRED METADATA STRUCTURE:
Every node MUST have complete metadata structure with ALL fields:
{
  "metadata": {
    "visibleElements": ["Login form", "Email input", "Password field"],
    "clickableElements": ["Submit button", "Forgot password link"],
    "flowsConnected": ["user_authentication_process"], 
    "dialogsOpen": [],
    "timestamp": "2024-01-01T12:00:00Z",
    "pageTitle": "Login Page"
  }
}

⚠️ NEVER omit any metadata fields - use empty arrays [] if no elements exist

🔥 CRITICAL REQUIREMENTS:
1. **PRESERVE EVERYTHING**: Include ALL existing nodes, edges, flows, descriptions
2. **VISUAL DEDUPLICATION**: Merge visually identical screenshots into single nodes
3. **FLOW GROUPING**: Create logical workflow groupings with clear start/end states
4. **ACTION PRECISION**: Use specific action names like "expand_navigation_menu"
5. **NO DATA LOSS**: Your response completely replaces existing graph - don't lose anything
6. **COMPREHENSIVE ANALYSIS**: Analyze every screenshot for visual elements and interactions
7. **VISUAL CHANGE VALIDATION**: Only create edges when you can confirm visual differences
8. **COMPLETE METADATA**: Every node MUST have complete metadata structure
9. **STANDARD NAMING**: Initial image MUST be "step_0_initial"
10. **FLOW EXPLANATIONS**: Use descriptive, human-readable flow names that explain the journey

🚨 FINAL PRESERVATION WARNING:
**YOUR RESPONSE MUST CONTAIN EVERY SINGLE EXISTING ITEM PLUS NEW CONTENT.**
**NEVER DELETE, MODIFY, OR REORGANIZE EXISTING DATA.**
**ONLY ADD NEW DISCOVERIES TO THE COMPLETE EXISTING STRUCTURE.**
**MAINTAIN COMPLETE TIMELINE FROM STEP 0 TO CURRENT STEP.**`;

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
            text: `Analyze all the screenshots and create a comprehensive image-based flow diagram. Focus on:

1. **Visual deduplication** of identical states
2. **Flow pattern detection** (linear, branching, circular) 
3. **Action transition mapping** between image states (ONLY when visual changes occur)
4. **Comprehensive metadata** for each visual state
5. **Complete preservation** of all existing graph data

🚨 CRITICAL PRESERVATION REMINDER:
- Include EVERY existing node, edge, and flow EXACTLY as they are
- Add new discoveries while preserving all existing data
- Initial image MUST be named "step_0_initial"
- Only create edges when screenshots show actual visual changes

🔍 COMPLETE ANALYSIS INSTRUCTIONS:
1. **ANALYZE EVERY SCREENSHOT** in the conversation history
2. **CHECK ALL ACTIONS** performed during exploration
3. **IDENTIFY ALL IMAGES** that should be included in flows
4. **ENSURE EVERY IMAGE** is part of at least one flow
5. **ADD MISSING IMAGES** to appropriate flows or create new flows
6. **COMPLETE ALL EDGE LABELS** with detailed transition descriptions
7. **VERIFY COMPLETE COVERAGE** from start to end

${currentGraph ? "UPDATE the existing graph preserving ALL current data and adding any missing images/flows." : "CREATE a complete new visual flow diagram with ALL images included."}

🎯 FINAL GOAL: Create a COMPLETE graph showing the ENTIRE user journey with EVERY image included in appropriate flows.

Remember: Compare each before/after image pair carefully. If the UI looks identical, don't create an edge for that action.`,
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

      // 🆕 USE GENERATEOBJECT FOR ROBUST JSON PARSING
      const response = await generateObject({
        model: vertex("gemini-2.5-flash"),
        system: systemPrompt,
        maxTokens: 8000, // Increased for comprehensive analysis
        messages: interleavedMessages,
        schema: InteractionGraphSchema,
      });

      const graph = response.object as InteractionGraph;

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
   * Generate navigation graph when page changes occur
   * Creates a special node with placeholder image for page transitions
   */
  async generatePageChangeNavigationGraph(
    sourcePageStore: PageStore,
    currentGraph: InteractionGraph | undefined,
    navigationAction: string,
    sourceUrl: string,
    targetUrl: string
  ): Promise<InteractionGraph | null> {
    try {
      logger.info(`🔗 Generating page change navigation graph`, {
        sourceUrl,
        targetUrl,
        action: navigationAction,
      });

      // Create page transition placeholder image URL
      const pageTransitionImageUrl =
        "https://cdn.dribbble.com/userupload/37152919/file/original-2223c68ac929d569c5204e50ab0d302c.png?resize=1504x1128&vertical=center";

      const systemPrompt = `You are an expert UI/UX analyst creating navigation graphs for page-to-page transitions.

${this.flowNamingGuidelines}
${this.edgeNamingGuidelines}

🚨 CRITICAL DATA PRESERVATION WARNING:
Your response will COMPLETELY REPLACE the existing graph. You are STRICTLY FORBIDDEN from losing ANY existing data.
You MUST include EVERY SINGLE existing node, edge, and flow EXACTLY as they are, plus the new page navigation.

⚠️ ABSOLUTE PRESERVATION REQUIREMENTS:
- **NEVER MODIFY** existing flows - keep them exactly as they are
- **NEVER REMOVE** existing nodes or edges - preserve all previous states
- **NEVER CHANGE** existing flow names, descriptions, or structures
- **ONLY ADD** new page navigation to existing flows or create new flows
- **MAINTAIN COMPLETE HISTORY** from the very first step to the current state
- **PRESERVE ALL TIMESTAMPS** and metadata exactly as they were
- **KEEP ALL VISUAL STATES** in chronological order without gaps

🔍 COMPLETE ANALYSIS REQUIREMENT:
You MUST analyze the ENTIRE navigation history and ALL page states to create a COMPLETE graph:
- **EVERY PAGE STATE MUST BE INCLUDED** in at least one flow - this is COMPULSORY
- **NO PAGE TRANSITION CAN BE LEFT OUT** - if a page exists, it must be part of a flow
- **ANALYZE ALL PAGE SCREENSHOTS** from the navigation history
- **CHECK ALL NAVIGATION ACTIONS** performed during exploration
- **IDENTIFY MISSING PAGE STATES** that aren't in existing flows
- **ADD MISSING PAGE STATES** to appropriate flows or create new flows
- **COMPLETE EDGE LABELS** for all page-to-page transitions
- **FULL NAVIGATION COVERAGE** from the very beginning to the very end

🌐 PAGE CHANGE NAVIGATION OVERVIEW:
You are creating a navigation relationship between two different pages:
- **SOURCE PAGE**: ${sourceUrl}
- **TARGET PAGE**: ${targetUrl}  
- **NAVIGATION ACTION**: ${navigationAction}

🎯 YOUR RESPONSIBILITIES:
1. **PRESERVE ALL EXISTING DATA**: Include every existing node, edge, and flow
2. **ADD PAGE TRANSITION**: Create a new node representing the target page
3. **CREATE NAVIGATION EDGE**: Connect source page to target page via the action
4. **MAINTAIN FLOW CONTINUITY**: Ensure navigation fits into existing flows

📝 SOURCE PAGE DATA:
- URL: ${sourcePageStore.url}
- Total Actions on Source: ${sourcePageStore.actionHistory.length}
- Available Image States: ${sourcePageStore.actionHistory.length + 1} (including initial)

${
  currentGraph
    ? `
🔒 EXISTING GRAPH DATA TO PRESERVE COMPLETELY:
YOU ARE ABSOLUTELY FORBIDDEN FROM LOSING ANY OF THIS DATA.

🚨 STRICT PRESERVATION RULES:
- **COPY EVERYTHING EXACTLY** - do not modify, remove, or change anything
- **MAINTAIN COMPLETE TIMELINE** from step 0 to current step
- **PRESERVE ALL FLOW STRUCTURES** exactly as they are
- **KEEP ALL NODE CONNECTIONS** and relationships intact
- **NEVER REORGANIZE** existing flows or change their names
- **ONLY ADD NEW CONTENT** to existing flows or create new flows

CURRENT STATISTICS:
- Image Nodes: ${currentGraph.nodes.length} (PRESERVE ALL)
- Edges: ${currentGraph.edges.length} (PRESERVE ALL)  
- Flows: ${currentGraph.flows?.length || 0} (PRESERVE ALL)

EXISTING IMAGE NODES (PRESERVE EVERY SINGLE ONE):
${currentGraph.nodes.map((node) => `- ${node.id}: Step ${node.stepNumber} | Action: "${node.instruction}" | Flows: [${node.metadata.flowsConnected.join(", ")}]`).join("\n")}

EXISTING EDGES (PRESERVE EVERY SINGLE ONE):
${currentGraph.edges.map((edge) => `- ${edge.from} → ${edge.to}: ${edge.action} | ${edge.description}`).join("\n")}

EXISTING FLOWS (PRESERVE EVERY SINGLE ONE):
${currentGraph.flows?.map((flow) => `- ${flow.id}: ${flow.name} (${flow.flowType}) | Images: [${flow.imageNodes.join(", ")}]`).join("\n") || "No existing flows"}

🚨 CRITICAL: Your response replaces everything. Include ALL existing items above PLUS the new page navigation.
**NEVER REMOVE OR MODIFY** any of the above data - only add new content.

🔍 COMPLETE NAVIGATION GRAPH VERIFICATION:
Before finalizing your response, verify that:
1. **EVERY PAGE STATE** from the navigation history is included in at least one flow
2. **ALL NAVIGATION EDGES** have complete labels describing the page transitions
3. **ALL FLOWS** cover the complete navigation journey from start to end
4. **NO PAGE STATES** are left out or missing from flows
5. **COMPLETE NAVIGATION TIMELINE** is maintained from first page to final page

🎯 YOUR GOAL: Create a COMPLETE navigation graph that shows the ENTIRE page-to-page journey with EVERY page state included in appropriate flows.
`
    : "No existing graph - creating first navigation relationship."
}

🌍 PAGE TRANSITION NODE REQUIREMENTS:
Create a new node for the target page with these specifications:
- **ID**: "page_transition_${this.generateImageHashFromData(targetUrl)}"
- **imageName**: Same as ID
- **imageData**: Use placeholder URL: "${pageTransitionImageUrl}"
- **instruction**: "${navigationAction}"
- **stepNumber**: ${(sourcePageStore.actionHistory.length || 0) + 1}
- **metadata**: 
  - visibleElements: ["New page loading", "Page transition", "Target page content"]
  - clickableElements: []
  - flowsConnected: ["inter_page_navigation_flow"]
  - dialogsOpen: []
  - timestamp: Current ISO timestamp
  - pageTitle: Extract from target URL or use "Navigation Target"

🔗 NAVIGATION EDGE REQUIREMENTS:
Create an edge connecting the source page to target page:
- **from**: Last action node from source page OR "step_0_initial" if no actions
- **to**: The new page transition node ID
- **action**: "navigate_to_new_page"
- **instruction**: "${navigationAction}"
- **description**: "User navigates from ${sourceUrl} to ${targetUrl} via ${navigationAction}"
- **flowId**: "inter_page_navigation_flow"

🌊 NAVIGATION FLOW REQUIREMENTS:
Create or update the "Inter-Page Navigation Flow":
- **id**: "inter_page_navigation_flow"
- **name**: "Inter-Page Navigation Journey"
- **description**: "Cross-page navigation tracking user movement between different URLs"
- **flowType**: "branching"
- Include both source and target page nodes

🔥 CRITICAL REQUIREMENTS:
1. **PRESERVE EVERYTHING**: Include ALL existing nodes, edges, flows exactly as they are
2. **ADD PAGE TRANSITION**: Create new node for target page with placeholder image
3. **CREATE NAVIGATION LINK**: Connect source to target via navigation edge
4. **MAINTAIN FLOW STRUCTURE**: Keep all existing flows and add navigation flow
5. **NO DATA LOSS**: Your response completely replaces existing graph
6. **STANDARD NAMING**: Use consistent ID patterns for page transitions

🚨 FINAL PRESERVATION WARNING:
**YOUR RESPONSE MUST CONTAIN EVERY SINGLE EXISTING ITEM PLUS NEW CONTENT.**
**NEVER DELETE, MODIFY, OR REORGANIZE EXISTING DATA.**
**ONLY ADD NEW DISCOVERIES TO THE COMPLETE EXISTING STRUCTURE.**`;

      // Use a simple prompt for page navigation without complex image analysis
      const messages = [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: `Create a navigation graph showing the transition from ${sourceUrl} to ${targetUrl} via action: "${navigationAction}".

🚨 CRITICAL PRESERVATION:
- Include ALL existing nodes, edges, and flows EXACTLY as they are
- Add new page transition node with placeholder image
- Create navigation edge connecting the pages
- Maintain all existing flow structures

${currentGraph ? "UPDATE the existing graph preserving ALL data while adding the page navigation." : "CREATE new graph with the page navigation relationship."}`,
            },
          ],
        },
      ];

      // Use generateObject for robust parsing
      const response = await generateObject({
        model: vertex("gemini-2.5-flash"),
        system: systemPrompt,
        maxTokens: 6000,
        messages,
        schema: InteractionGraphSchema,
      });

      const graph = response.object as InteractionGraph;

      // Validate structure
      if (!graph.nodes || !graph.edges || !graph.flows) {
        throw new Error("Invalid navigation graph structure");
      }

      // Map real image data for existing nodes
      const imageDataMap = new Map<string, string>();

      // Add initial screenshot
      imageDataMap.set("step_0_initial", sourcePageStore.initialScreenshot);

      // Add action screenshots from source page
      sourcePageStore.actionHistory.forEach((action) => {
        imageDataMap.set(action.imageName, action.after_act);
      });

      // Update nodes with real image data (except page transition node which keeps placeholder)
      graph.nodes.forEach((node) => {
        if (node.id.startsWith("page_transition_")) {
          // Keep the placeholder image for page transitions
          node.imageData = pageTransitionImageUrl;
        } else {
          const realImageData =
            imageDataMap.get(node.imageName) || imageDataMap.get(node.id);
          if (realImageData) {
            node.imageData = realImageData;
          } else {
            logger.warn(
              `⚠️ No image data found for navigation node: ${node.imageName}`
            );
            node.imageData =
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
          }
        }
      });

      logger.info(`📊 Generated page navigation graph`, {
        sourceUrl,
        targetUrl,
        navigationAction,
        totalNodes: graph.nodes.length,
        totalEdges: graph.edges.length,
        totalFlows: graph.flows.length,
        preservedFromExisting: currentGraph
          ? {
              nodes: currentGraph.nodes.length,
              edges: currentGraph.edges.length,
              flows: currentGraph.flows?.length || 0,
            }
          : "new_navigation_graph",
      });

      return graph;
    } catch (error) {
      logger.error("❌ Failed to generate page navigation graph", {
        error: error instanceof Error ? error.message : String(error),
        sourceUrl,
        targetUrl,
        navigationAction,
      });
      return null;
    }
  }

  /**
   * UNIFIED GRAPH GENERATION METHOD
   * Handles both interaction graphs (same page) and page navigation graphs (page changes)
   * This combines the functionality of generateInteractionGraph and generatePageChangeNavigationGraph
   */
  async generateUnifiedInteractionGraph(
    globalStore: PageStore,
    currentGraph: InteractionGraph | undefined,
    options?: {
      isPageNavigation?: boolean;
      navigationAction?: string;
      sourceUrl?: string;
      targetUrl?: string;
    }
  ): Promise<InteractionGraph | null> {
    try {
      const isPageNavigation = options?.isPageNavigation || false;

      if (
        isPageNavigation &&
        options?.navigationAction &&
        options?.sourceUrl &&
        options?.targetUrl
      ) {
        // Handle page navigation case with enhanced naming
        return this.generatePageChangeNavigationGraph(
          globalStore,
          currentGraph,
          options.navigationAction,
          options.sourceUrl,
          options.targetUrl
        );
      } else {
        // Handle same-page interaction case with enhanced naming
        return this.generateInteractionGraph(globalStore, currentGraph);
      }
    } catch (error) {
      logger.error("❌ Failed to generate unified interaction graph", {
        error: error instanceof Error ? error.message : String(error),
        url: globalStore.url,
        isPageNavigation: options?.isPageNavigation || false,
      });
      return null;
    }
  }

  /**
   * SMART IMAGE HANDLING FOR NODES
   * Handles both page navigation and interaction nodes
   */
  private handleNodeImageData(
    node: ImageNode,
    imageDataMap: Map<string, string>,
    pageTransitionImageUrl?: string
  ): void {
    // Case 1: Node already has a URL - preserve it
    if (node.imageData.startsWith("http")) {
      return;
    }

    // Case 2: Page transition node - use transition image
    if (pageTransitionImageUrl && node.id.startsWith("page_transition_")) {
      node.imageData = pageTransitionImageUrl;
      return;
    }

    // Case 3: Try to find real image data
    const realImageData =
      imageDataMap.get(node.imageName) || imageDataMap.get(node.id);
    if (realImageData) {
      node.imageData = realImageData;
      return;
    }

    // Case 4: If node has URL metadata, use that instead of placeholder
    if ((node.metadata as any)?.url) {
      node.imageData = (node.metadata as any).url;
      return;
    }

    // Case 5: Fallback to transparent pixel
    logger.warn(`⚠️ No image data found for node: ${node.imageName}`);
    node.imageData =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
  }

  /**
   * ENHANCED FLOW AND EDGE NAMING GUIDELINES
   */
  private readonly flowNamingGuidelines = `
🎯 FLOW NAMING EXCELLENCE GUIDE:

1. ANALYZE VISUAL CONTENT IN IMAGES:
- Look at the actual UI elements and content shown
- Understand the user's goal from the visual context
- Consider the application domain and purpose

2. CREATE DESCRIPTIVE FLOW NAMES:
✅ "Product Image Upload and Gallery Management"
✅ "Multi-step User Registration with Email Verification"
✅ "Advanced Search Configuration and Results Filtering"
✅ "Team Member Invitation and Role Assignment"
✅ "Project Settings and Collaboration Setup"

3. EDGE NAMING BEST PRACTICES:
- Describe the EXACT action and its impact
- Include visual feedback or state changes
- Reference specific UI elements clicked

Examples:
✅ "Click 'Upload' button to open file selection dialog"
✅ "Select 'Team' from dropdown to view team management panel"
✅ "Enter search query 'typescript' to filter results"
✅ "Toggle 'Dark Mode' switch to change theme"
✅ "Click 'Next' to proceed to payment details"

4. FLOW CATEGORIZATION:
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

5. EDGE DETAIL REQUIREMENTS:
Must include:
- Specific element interacted with
- Visual feedback or state change
- Purpose or outcome of action

Example:
"Click 'Add Member' button → Opens invitation form with email field highlighted"
"Select 'Project Type' dropdown → Reveals template options with preview cards"
"Submit search form → Displays filtered results with matching highlights"

6. VISUAL ANALYSIS FOR NAMING:
Look for:
- Modal dialogs and their purpose
- Form fields and their grouping
- Navigation patterns
- Content organization
- Interactive elements
- State changes
- Loading indicators
- Success/error messages

7. DOMAIN-SPECIFIC NAMING:
E-commerce:
- "Product Catalog Browsing and Filtering"
- "Shopping Cart Management and Checkout"

Project Management:
- "Task Creation and Assignment Workflow"
- "Project Timeline and Milestone Setup"

Content Platform:
- "Content Upload and Publishing Pipeline"
- "Media Asset Management and Organization"

8. USER GOAL ORIENTATION:
Always name based on what the user is trying to achieve:
✅ "Create New Project from Template"
✅ "Configure Automated Email Notifications"
✅ "Customize Dashboard Layout and Widgets"
✅ "Set Up Team Communication Channels"`;

  private readonly edgeNamingGuidelines = `
🎯 EDGE NAMING EXCELLENCE GUIDE:

1. STRUCTURE: [Action] → [Result] → [Purpose]
Example: "Click 'Upload' → Opens file dialog → For adding profile picture"

2. VISUAL FEEDBACK:
Include state changes:
✅ "Click 'Save' → Button shows loading spinner → Settings updated"
✅ "Toggle switch → Background changes to green → Feature enabled"

3. ELEMENT SPECIFICITY:
Reference exact UI:
✅ "Click blue 'Continue' button in top-right"
✅ "Select 'High Priority' from status dropdown"

4. CONTEXT AWARENESS:
Show relationship to flow:
✅ "Enter project name → Creates new workspace → Starts project setup"
✅ "Click 'Add Member' → Opens invitation form → For team expansion"

5. USER INTENTION:
Clarify purpose:
✅ "Click filter icon → Shows advanced search → To refine results"
✅ "Select date range → Updates timeline → To view specific period"`;
}
