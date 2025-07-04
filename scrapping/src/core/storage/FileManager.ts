import fs from "fs";
import path from "path";
import crypto from "crypto";
import { SessionMetadata, PageData } from "../../types/exploration.js";
import type { Socket } from "socket.io";
import logger from "../../utils/logger.js";

export class FileManager {
  private baseDir: string;
  private sessionDir: string;
  private socket?: Socket;
  private userName?: string;

  constructor(
    private sessionId: string,
    socket?: Socket,
    userName?: string
  ) {
    this.socket = socket;
    this.userName = userName;

    // Use userName as base directory if provided, otherwise use exploration_sessions
    this.baseDir = userName ? userName : "exploration_sessions";
    this.sessionDir = path.join(this.baseDir, sessionId);
  }

  /**
   * Clean up all existing sessions for a user
   */
  static cleanupUserSessions(userName: string): void {
    try {
      const userDir = path.join(process.cwd(), userName);
      if (fs.existsSync(userDir)) {
        fs.rmSync(userDir, { recursive: true, force: true });
        logger.info("🗑️ Cleaned up user session directory", {
          userName,
          path: userDir,
        });
      }
    } catch (error) {
      logger.error("❌ Failed to cleanup user sessions", { userName, error });
    }
  }

  /**
   * Generate a consistent hash for a URL to use as folder name
   */
  static generateUrlHash(url: string): string {
    // Normalize URL and create a readable hash
    try {
      const urlObj = new URL(url);
      // Include hash fragment to distinguish between different SPA routes
      const normalizedUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}${urlObj.hash}`;
      const hash = crypto
        .createHash("md5")
        .update(normalizedUrl)
        .digest("hex")
        .substring(0, 8);

      // Create readable folder name
      const domain = urlObj.hostname.replace(/^www\./, "").replace(/\./g, "-");
      const pathPart =
        urlObj.pathname === "/"
          ? "home"
          : urlObj.pathname.replace(/[^a-zA-Z0-9]/g, "-").substring(0, 20);

      // Include hash part in folder name for SPA routes
      const hashPart = urlObj.hash
        ? urlObj.hash.replace(/[^a-zA-Z0-9]/g, "-").substring(0, 15)
        : "";

      return hashPart
        ? `${domain}_${pathPart}${hashPart}_${hash}`
        : `${domain}_${pathPart}_${hash}`;
    } catch {
      // Fallback for invalid URLs
      const hash = crypto
        .createHash("md5")
        .update(url)
        .digest("hex")
        .substring(0, 8);
      const safeName = url.replace(/[^a-zA-Z0-9]/g, "-").substring(0, 30);
      return `${safeName}_${hash}`;
    }
  }

  /**
   * Initialize session directory structure
   */
  initializeSession(): void {
    // Create main session directory
    fs.mkdirSync(this.sessionDir, { recursive: true });

    // Create urls subdirectory
    const urlsDir = path.join(this.sessionDir, "urls");
    fs.mkdirSync(urlsDir, { recursive: true });

    logger.info("📁 Initialized session directory", {
      sessionDir: this.sessionDir,
      userName: this.userName,
      baseDir: this.baseDir,
    });
  }

  /**
   * Initialize directory structure for a specific URL
   */
  initializeUrlDirectory(urlHash: string): void {
    const urlDir = path.join(this.sessionDir, "urls", urlHash);
    const screenshotsDir = path.join(urlDir, "screenshots");
    const llmResponsesDir = path.join(urlDir, "llm_responses");

    fs.mkdirSync(urlDir, { recursive: true });
    fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.mkdirSync(llmResponsesDir, { recursive: true });
  }

  /**
   * Save session metadata
   */
  saveSessionMetadata(metadata: SessionMetadata): void {
    const metadataPath = path.join(this.sessionDir, "session_metadata.json");
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Save page data
   */
  savePageData(urlHash: string, pageData: PageData): void {
    const pagePath = path.join(
      this.sessionDir,
      "urls",
      urlHash,
      "page_data.json"
    );

    // Convert Map and Set to serializable objects
    const serializable = {
      ...pageData,
      executedSteps: pageData.executedSteps || [],
    };

    fs.writeFileSync(pagePath, JSON.stringify(serializable, null, 2));
  }

  /**
   * Save screenshot
   */
  saveScreenshot(
    urlHash: string,
    stepNumber: number,
    action: string,
    buffer: Buffer
  ): string {
    const filename = `step_${stepNumber.toString().padStart(3, "0")}_${action.replace(/[^a-zA-Z0-9]/g, "_")}.png`;
    const screenshotPath = path.join(
      this.sessionDir,
      "urls",
      urlHash,
      "screenshots",
      filename
    );

    fs.writeFileSync(screenshotPath, buffer);

    // Emit screenshot event to frontend
    if (this.socket && this.userName) {
      this.socket.emit("exploration_update", {
        type: "screenshot_captured",
        timestamp: new Date().toISOString(),
        data: {
          userName: this.userName,
          urlHash,
          stepNumber,
          action,
          filename,
          screenshotPath,
          screenshotBase64: buffer.toString("base64"),
        },
      });
    }

    return screenshotPath;
  }

  /**
   * Save Claude LLM response for analysis
   */
  saveLLMResponse(
    urlHash: string,
    stepNumber: number,
    phase: string,
    response: any
  ): string {
    const filename = `step_${stepNumber.toString().padStart(3, "0")}_${phase}_response.json`;
    const responsePath = path.join(
      this.sessionDir,
      "urls",
      urlHash,
      "llm_responses",
      filename
    );

    // Create llm_responses directory if it doesn't exist
    const responseDir = path.join(
      this.sessionDir,
      "urls",
      urlHash,
      "llm_responses"
    );
    fs.mkdirSync(responseDir, { recursive: true });

    // Save the response with metadata
    const responseData = {
      step: stepNumber,
      phase,
      timestamp: new Date().toISOString(),
      response: response,
    };

    fs.writeFileSync(responsePath, JSON.stringify(responseData, null, 2));
    return responsePath;
  }

  /**
   * Save raw LLM response with versioning
   */
  saveRawLLMResponse(
    urlHash: string,
    version: string,
    responseType: string,
    rawResponse: string
  ): string {
    const filename = `${responseType}_${version}.txt`;
    const responsePath = path.join(
      this.sessionDir,
      "urls",
      urlHash,
      "llm_responses",
      filename
    );

    // Create llm_responses directory if it doesn't exist
    const responseDir = path.join(
      this.sessionDir,
      "urls",
      urlHash,
      "llm_responses"
    );
    fs.mkdirSync(responseDir, { recursive: true });

    fs.writeFileSync(responsePath, rawResponse);

    return responsePath;
  }

  /**
   * Save decision context for debugging and analysis
   */
  saveDecisionContext(
    urlHash: string,
    stepNumber: number,
    context: any
  ): string {
    const filename = `step_${stepNumber.toString().padStart(3, "0")}_decision_context.json`;
    const contextPath = path.join(
      this.sessionDir,
      "urls",
      urlHash,
      "llm_responses",
      filename
    );

    // Create llm_responses directory if it doesn't exist
    const responseDir = path.join(
      this.sessionDir,
      "urls",
      urlHash,
      "llm_responses"
    );
    fs.mkdirSync(responseDir, { recursive: true });

    fs.writeFileSync(contextPath, JSON.stringify(context, null, 2));
    return contextPath;
  }

  /**
   * Save session-level conversation history
   */
  saveSessionConversationHistory(history: any[]): string {
    const historyPath = path.join(this.sessionDir, "conversation_history.json");
    const historyData = {
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      totalDecisions: history.length,
      history: history,
    };

    fs.writeFileSync(historyPath, JSON.stringify(historyData, null, 2));
    return historyPath;
  }

  /**
   * Generate unique session ID
   */
  static generateSessionId(baseUrl: string): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, -5);

    try {
      const urlObj = new URL(baseUrl);
      const domain = urlObj.hostname.replace(/^www\./, "").replace(/\./g, "-");
      return `${domain}_${timestamp}`;
    } catch {
      const safeDomain = baseUrl.replace(/[^a-zA-Z0-9]/g, "-").substring(0, 20);
      return `${safeDomain}_${timestamp}`;
    }
  }
}
