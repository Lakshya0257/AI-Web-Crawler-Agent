import { SessionMetadata, PageData } from "../types/exploration.js";
import type { Socket } from "socket.io";
export declare class FileManager {
    private sessionId;
    private baseDir;
    private sessionDir;
    private socket?;
    private userName?;
    constructor(sessionId: string, socket?: Socket, userName?: string);
    /**
     * Clean up all existing sessions for a user
     */
    static cleanupUserSessions(userName: string): void;
    /**
     * Generate a consistent hash for a URL to use as folder name
     */
    static generateUrlHash(url: string): string;
    /**
     * Initialize session directory structure
     */
    initializeSession(): void;
    /**
     * Initialize directory structure for a specific URL
     */
    initializeUrlDirectory(urlHash: string): void;
    /**
     * Save session metadata
     */
    saveSessionMetadata(metadata: SessionMetadata): void;
    /**
     * Save page data
     */
    savePageData(urlHash: string, pageData: PageData): void;
    /**
     * Save screenshot
     */
    saveScreenshot(urlHash: string, stepNumber: number, action: string, buffer: Buffer): string;
    /**
     * Save Claude LLM response for analysis
     */
    saveLLMResponse(urlHash: string, stepNumber: number, phase: string, response: any): string;
    /**
     * Save decision context for debugging and analysis
     */
    saveDecisionContext(urlHash: string, stepNumber: number, context: any): string;
    /**
     * Save session-level conversation history
     */
    saveSessionConversationHistory(history: any[]): string;
    /**
     * Generate unique session ID
     */
    static generateSessionId(baseUrl: string): string;
}
