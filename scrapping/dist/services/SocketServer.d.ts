export declare class SocketServer {
    private io;
    private server;
    private activeExplorations;
    private port;
    constructor(port?: number);
    private setupEventHandlers;
    private cleanupUserSession;
    private stopExploration;
    private startExploration;
    start(): void;
    stop(): void;
}
