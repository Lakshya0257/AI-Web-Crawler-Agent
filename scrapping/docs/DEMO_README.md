# 🚀 Intelligent Web Explorer - Demo Guide

## 🎯 New Tool-Driven Architecture

This system now uses **Claude for decision-making** and **Stagehand for execution**:

### 🧠 How It Works

1. **Claude Analyzes**: Takes a screenshot and decides which tool to use
2. **Stagehand Executes**: Performs the actual browser actions
3. **Claude Evaluates**: Analyzes results and checks objective progress
4. **Loop Continues**: Until objective is achieved or max steps reached

### 🛠️ Available Tools

- **`page_observe`**: Get clickable elements and page structure
- **`page_extract`**: Extract structured data from the page  
- **`page_act`**: Perform actions (click, type, scroll, etc.)

### 🔄 Workflow Example

```
📸 Take Screenshot → 🧠 Claude Decision → 🛠️ Stagehand Execution → 📊 Claude Analysis
                                     ↓
📈 Check Objective Progress → 🔄 Next Tool Decision → Continue...
```

### 📁 Folder Structure Created

```
exploration_sessions/
└── {session_id}/
    ├── session_metadata.json
    └── urls/
        └── {url_hash}/
            ├── page_data.json
            ├── screenshots/
            │   ├── step_001_before_page_observe.png
            │   ├── step_002_before_page_act.png
            │   └── step_003_after_page_act.png
            └── llm_responses/
                ├── step_001_decision_raw.json
                ├── step_001_decision_response.json
                ├── step_002_page_observe_raw.json
                └── step_002_page_observe_response.json
```

### 🎮 Usage

```bash
npm run start -- --url "https://example.com" --objective "Find pricing information"
```

### 🔧 Setup Requirements

1. **Anthropic API Key**: Set `ANTHROPIC_API_KEY` environment variable
2. **Stagehand**: Already integrated for browser automation
3. **Dependencies**: All required packages are installed

### 📊 Key Features

✅ **Smart Decision Making**: Claude analyzes each page and chooses the best tool  
✅ **Real Browser Actions**: Stagehand performs actual browser interactions  
✅ **Progress Tracking**: Claude evaluates if objective is being achieved  
✅ **Complete Logging**: Every decision and action is saved with screenshots  
✅ **URL Queue Management**: Automatically discovers and queues new URLs  
✅ **Error Handling**: Robust error handling with fallback strategies  

### 🎯 Example Flow

1. **Start**: Load GitHub homepage
2. **Claude Decision**: "Use page_observe to find navigation elements"
3. **Stagehand Execute**: Observe page and return clickable elements
4. **Claude Analysis**: "Found pricing link in navigation"
5. **Claude Decision**: "Use page_act to click the pricing link"
6. **Stagehand Execute**: Click the pricing link
7. **Claude Analysis**: "Successfully navigated to pricing page"
8. **Claude Decision**: "Use page_extract to extract pricing information"
9. **Stagehand Execute**: Extract structured pricing data
10. **Claude Analysis**: "Objective achieved - pricing information found!"

### 🔍 What's Different From Before

**Old System**: Rigid two-phase approach (observe all, then act on all)  
**New System**: Dynamic tool selection based on current page state and objective

**Old System**: Mock LLM actions  
**New System**: Real browser automation with Stagehand

**Old System**: Limited context awareness  
**New System**: Conversation history and objective-focused decisions

### 🚨 Current Status

✅ Architecture fully implemented  
✅ Stagehand integration complete  
✅ File structure and logging working  
✅ Error handling robust  
⚠️ Requires valid Anthropic API key to run  

Once API key is configured, the system will autonomously explore websites and achieve objectives! 