# Intelligent Web Scraper - TypeScript

AI-driven web exploration and scraping tool with real-time frontend dashboard.

## 🏗️ Project Structure

```
scrapping/
├── src/                          # Source code
│   ├── core/                     # Core business logic
│   │   ├── exploration/          # Web exploration functionality
│   │   │   ├── WebExplorer.ts    # Main exploration engine
│   │   │   └── index.ts          # Export module
│   │   ├── llm/                  # LLM clients and interfaces
│   │   │   ├── LLMClient.ts      # Claude LLM client
│   │   │   ├── GlobalStagehandClient.ts # Stagehand LLM adapter
│   │   │   └── index.ts          # Export module
│   │   ├── storage/              # Data persistence and file management
│   │   │   ├── FileManager.ts    # File system operations
│   │   │   └── index.ts          # Export module
│   │   └── index.ts              # Core module exports
│   ├── server/                   # Server-related code
│   │   ├── SocketServer.ts       # Socket.IO server implementation
│   │   └── index.ts              # Export module
│   ├── interfaces/               # TypeScript interfaces
│   │   ├── IExplorer.ts          # Explorer interface
│   │   ├── ILLMClient.ts         # LLM client interface
│   │   └── index.ts              # Export module
│   ├── types/                    # Type definitions
│   │   └── exploration.ts        # Core exploration types
│   ├── utils/                    # Utility functions
│   │   └── logger.ts             # Winston logging configuration
│   ├── index.ts                  # Main entry point + exports
│   └── socket-server.ts          # Socket server entry point
├── tests/                        # Test files
│   ├── test-all-clients.ts       # Multi-provider LLM tests
│   ├── test-individual-tools.ts  # Individual tool tests
│   ├── test-gemini.ts            # Gemini-specific tests
│   ├── OpenAIStagehandClient.ts  # OpenAI client (testing only)
│   └── GoogleVertexStagehandClient.ts # Vertex client (testing only)
├── docs/                         # Documentation
│   ├── README.md                 # Main documentation
│   ├── QUICK_START.md            # Quick start guide
│   ├── SOCKET_IO_API.md          # Socket.IO API documentation
│   ├── USER_INPUT_MODULE.md      # User input system docs
│   ├── BACKGROUND_PROCESSING.md  # Background processing guide
│   ├── TOOL_TESTER_README.md     # Tool testing guide
│   ├── DEMO_README.md            # Demo instructions
│   └── FOLDER_STRUCTURE.md       # Previous structure docs
├── config/                       # Configuration files
│   ├── tsconfig.json             # TypeScript configuration
│   └── tailwind.config.js        # Tailwind CSS config
├── scripts/                      # Build and deployment scripts
├── dist/                         # Compiled output (auto-generated)
├── logs/                         # Log files
├── downloads/                    # Downloaded files
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TS config (extends config/tsconfig.json)
└── .gitignore                    # Git ignore rules
```

## 🚀 Quick Start

### Installation
```bash
npm install
```

### Build
```bash
npm run build
```

### Run
```bash
# Main exploration tool
npm start

# Socket.IO server for frontend dashboard
npm run start:socket

# Development mode (with compilation)
npm run dev
npm run dev:socket
```

### Testing
```bash
# Test all LLM providers
npm run test

# Test individual tools
npm run test:tools

# Test Gemini specifically
npm run test:gemini
```

## 🔧 Development Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run clean` - Remove compiled output
- `npm run type-check` - Type check without compilation
- `npm run lint` - Run linting (placeholder)
- `npm run format` - Format code (placeholder)

## 📦 Core Modules

### `core/exploration`
- **WebExplorer**: Main exploration engine that orchestrates web crawling and AI decision-making
- **Features**: Page processing, tool execution, session management, objective tracking

### `core/llm`  
- **LLMClient**: Claude Anthropic integration for AI decision-making
- **GlobalStagehandClient**: Adapter for Stagehand browser automation
- **Features**: Decision making, page analysis, action planning, extraction formatting

### `core/storage`
- **FileManager**: File system operations and session persistence
- **Features**: Screenshot storage, session data, conversation history, URL organization

### `server`
- **SocketServer**: Real-time communication with frontend dashboard
- **Features**: Exploration management, user input handling, progress streaming

## 🎯 Key Features

- **AI-Driven Exploration**: Claude-powered decision making
- **Real-time Dashboard**: Live progress tracking via Socket.IO
- **User Input System**: Interactive authentication flows
- **Standby Tool**: Loading state detection and waiting
- **Enhanced Extraction**: Versioned data extraction with comprehensive formatting
- **Action History**: Persistent tracking of all page interactions
- **URL Management**: Smart queue management with hash fragment support
- **Session Persistence**: Full exploration session recovery

## 🔄 Architecture Benefits

1. **Modular Design**: Clear separation of concerns
2. **Type Safety**: Comprehensive TypeScript interfaces  
3. **Testability**: Isolated modules with clean interfaces
4. **Maintainability**: Logical organization and documentation
5. **Extensibility**: Easy to add new LLM providers or tools
6. **Clean Imports**: Barrel exports for better developer experience

## 📝 Environment Variables

Create a `.env` file:
```env
ANTHROPIC_API_KEY=your_claude_key
BROWSERBASE_PROJECT_ID=your_browserbase_id
BROWSERBASE_API_KEY=your_browserbase_key
```

## 🤝 Contributing

1. Follow the established folder structure
2. Add proper TypeScript types
3. Update relevant interfaces
4. Add tests for new functionality
5. Update documentation

## 📄 License

MIT License - see LICENSE file for details. 