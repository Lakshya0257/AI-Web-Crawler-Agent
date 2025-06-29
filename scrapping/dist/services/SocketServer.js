import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import logger from '../utils/logger.js';
import { WebExplorer } from './WebExplorer.js';
import { FileManager } from './FileManager.js';
import { Stagehand } from '@browserbasehq/stagehand';
import { GlobalStagehandClient } from './GlobalStagehandClient.js';
import { anthropic } from '@ai-sdk/anthropic';
export class SocketServer {
    io;
    server;
    activeExplorations = new Map();
    port;
    constructor(port = 3001) {
        this.port = port;
        this.server = createServer();
        this.io = new SocketIOServer(this.server, {
            cors: {
                origin: "*", // Configure this properly for production
                methods: ["GET", "POST"]
            }
        });
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.io.on('connection', (socket) => {
            logger.info('🔌 Client connected', { socketId: socket.id });
            // Handle execution command from frontend
            socket.on('execute_exploration', async (command) => {
                try {
                    logger.info('🎯 Received execution command', command);
                    // Clean up existing user session if any
                    await this.cleanupUserSession(command.userName);
                    // Send acknowledgment
                    socket.emit('execution_started', {
                        userName: command.userName,
                        timestamp: new Date().toISOString()
                    });
                    // Start exploration
                    await this.startExploration(socket, command);
                }
                catch (error) {
                    logger.error('❌ Failed to start exploration', { error });
                    socket.emit('exploration_error', {
                        error: error instanceof Error ? error.message : String(error),
                        timestamp: new Date().toISOString()
                    });
                }
            });
            // Handle stop exploration
            socket.on('stop_exploration', (data) => {
                this.stopExploration(data.userName);
                socket.emit('exploration_stopped', {
                    userName: data.userName,
                    timestamp: new Date().toISOString()
                });
            });
            // Handle user input response (updated for multiple inputs)
            socket.on('user_input_response', (data) => {
                logger.info('📥 Received user input response', { inputKeys: Object.keys(data.inputs) });
                // The input response is automatically handled by the WebExplorer's toolUserInput method
                // which is listening for this event on the same socket
            });
            socket.on('disconnect', () => {
                logger.info('🔌 Client disconnected', { socketId: socket.id });
            });
        });
    }
    async cleanupUserSession(userName) {
        try {
            // Stop any active exploration for this user
            this.stopExploration(userName);
            // Use FileManager's cleanup method
            FileManager.cleanupUserSessions(userName);
        }
        catch (error) {
            logger.error('❌ Failed to cleanup user session', { userName, error });
        }
    }
    stopExploration(userName) {
        const explorer = this.activeExplorations.get(userName);
        if (explorer) {
            // Note: WebExplorer doesn't have a stop method, but we can remove it from active explorations
            this.activeExplorations.delete(userName);
            logger.info('⏹️ Stopped exploration for user', { userName });
        }
    }
    async startExploration(socket, command) {
        const { userName, objective, startUrl, isExploration, maxPagesToExplore = 6, additionalContext, canLogin } = command;
        try {
            const openaiClient = new GlobalStagehandClient({
                model: anthropic("claude-3-5-sonnet-20241022"),
            });
            // Create Stagehand client (which creates its own browser and page)
            const stagehand = new Stagehand({
                env: "LOCAL",
                verbose: 1,
                llmClient: openaiClient,
                localBrowserLaunchOptions: {
                    headless: true,
                },
                browserbaseSessionCreateParams: {
                    projectId: process.env.BROWSERBASE_PROJECT_ID,
                    browserSettings: {
                        blockAds: true,
                        viewport: {
                            width: 1920,
                            height: 1080,
                        },
                    },
                },
            });
            await stagehand.init();
            const page = stagehand.page;
            const browser = stagehand.context.browser();
            // Create explorer with socket integration
            const explorer = new SocketAwareWebExplorer(browser, page, objective, startUrl, stagehand, maxPagesToExplore, socket, userName, this.activeExplorations, isExploration, additionalContext, canLogin);
            // Store active exploration
            this.activeExplorations.set(userName, explorer);
            // Start exploration
            const success = await explorer.explore(maxPagesToExplore);
            // Send completion event
            socket.emit('exploration_completed', {
                userName,
                success,
                timestamp: new Date().toISOString()
            });
            // Cleanup
            await stagehand.close();
            this.activeExplorations.delete(userName);
        }
        catch (error) {
            logger.error('❌ Exploration failed', { userName, error });
            socket.emit('exploration_error', {
                userName,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });
            this.activeExplorations.delete(userName);
        }
    }
    start() {
        this.server.listen(this.port, () => {
            logger.info(`🚀 Socket.IO server running on port ${this.port}`);
        });
    }
    stop() {
        this.io.close();
        this.server.close();
    }
}
// Extended WebExplorer class that emits socket events
class SocketAwareWebExplorer extends WebExplorer {
    constructor(browser, page, objective, startUrl, stagehand, maxPagesToExplore, socket, userName, activeExplorations, isExploration, additionalContext, canLogin = false) {
        super(browser, page, objective, startUrl, stagehand, maxPagesToExplore, socket, userName, activeExplorations, isExploration, additionalContext, canLogin);
    }
}
