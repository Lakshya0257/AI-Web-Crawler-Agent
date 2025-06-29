# Socket.IO Real-Time Web Exploration API

## Overview

The Socket.IO implementation provides real-time communication between the backend web exploration system and the frontend. It enables:

- **Real-time exploration updates** with detailed progress tracking
- **Screenshot streaming** as they're captured
- **Tool execution monitoring** with separate events for different tools
- **LLM decision tracking** to see what Claude is thinking
- **User session management** with automatic cleanup

## Getting Started

### Start the Socket.IO Server

```bash
# Development mode (with auto-reload)
npm run socket:dev

# Production mode
npm run socket
```

The server runs on port **3001** by default (configurable via `SOCKET_PORT` environment variable).

## Client Events (Frontend → Backend)

### 1. `execute_exploration`
Start a new exploration session.

```javascript
socket.emit('execute_exploration', {
  userName: "john_doe",
  objective: "explore the entire website and discover all features",
  startUrl: "https://example.com",
  isExploration: true,
  maxPagesToExplore: 10  // optional, defaults to 6
});
```

**Parameters:**
- `userName` (string): Unique identifier for the user session
- `objective` (string): What the exploration should accomplish
- `startUrl` (string): Starting URL for exploration
- `isExploration` (boolean): Whether this is exploration or task-focused
- `maxPagesToExplore` (number, optional): Maximum pages to explore

### 2. `stop_exploration`
Stop an active exploration session.

```javascript
socket.emit('stop_exploration', {
  userName: "john_doe"
});
```

## Server Events (Backend → Frontend)

### Connection Events

#### `execution_started`
Acknowledges that exploration has begun.

```javascript
socket.on('execution_started', (data) => {
  // data: { userName, timestamp }
});
```

#### `exploration_completed`
Exploration session finished.

```javascript
socket.on('exploration_completed', (data) => {
  // data: { userName, success, timestamp }
});
```

#### `exploration_stopped`
Exploration was manually stopped.

```javascript
socket.on('exploration_stopped', (data) => {
  // data: { userName, timestamp }
});
```

#### `exploration_error`
An error occurred during exploration.

```javascript
socket.on('exploration_error', (data) => {
  // data: { userName?, error, timestamp }
});
```

### Real-Time Updates

All real-time updates come through the `exploration_update` event with different `type` values:

```javascript
socket.on('exploration_update', (update) => {
  const { type, timestamp, data } = update;
  
  switch(type) {
    case 'page_started':
      // Handle page processing start
      break;
    case 'llm_decision':
      // Handle LLM decision
      break;
    case 'tool_execution_started':
      // Handle tool execution start
      break;
    // ... more cases
  }
});
```

### Page Lifecycle Events

#### `page_started`
A new page has started processing.

```javascript
{
  type: 'page_started',
  timestamp: '2024-01-15T10:30:00Z',
  data: {
    userName: 'john_doe',
    url: 'https://example.com/about',
    urlHash: 'abc123',
    status: 'in_progress'
  }
}
```

#### `page_completed`
Page processing finished.

```javascript
{
  type: 'page_completed',
  timestamp: '2024-01-15T10:35:00Z',
  data: {
    userName: 'john_doe',
    url: 'https://example.com/about',
    urlHash: 'abc123',
    status: 'completed',
    stepsExecuted: 5
  }
}
```

### LLM Decision Events

#### `llm_decision`
Claude has made a decision about what tool to use next.

```javascript
{
  type: 'llm_decision',
  timestamp: '2024-01-15T10:31:00Z',
  data: {
    userName: 'john_doe',
    url: 'https://example.com/about',
    urlHash: 'abc123',
    stepNumber: 3,
    decision: {
      tool: 'page_extract',
      instruction: 'Extract all navigation links and product features',
      reasoning: 'Need to understand page structure before proceeding',
      nextPlan: 'Click on discovered navigation links',
      isPageCompleted: false
    },
    maxPagesReached: false
  }
}
```

### Tool Execution Events

#### `tool_execution_started`
A tool has started executing.

```javascript
{
  type: 'tool_execution_started',
  timestamp: '2024-01-15T10:31:05Z',
  data: {
    userName: 'john_doe',
    url: 'https://example.com/about',
    urlHash: 'abc123',
    stepNumber: 3,
    tool: 'page_extract',
    instruction: 'Extract all navigation links and product features'
  }
}
```

#### `tool_execution_completed`
Tool execution finished.

```javascript
{
  type: 'tool_execution_completed',
  timestamp: '2024-01-15T10:31:10Z',
  data: {
    userName: 'john_doe',
    url: 'https://example.com/about',
    urlHash: 'abc123',
    stepNumber: 3,
    tool: 'page_extract',
    instruction: 'Extract all navigation links and product features',
    success: true,
    result: '{"extracted_data": "..."}',
    urlChanged: false,
    newUrl: null,
    objectiveAchieved: false
  }
}
```

### Specific Tool Result Events

#### `page_observe_result`
Results from page observation tool.

```javascript
{
  type: 'page_observe_result',
  timestamp: '2024-01-15T10:31:10Z',
  data: {
    userName: 'john_doe',
    url: 'https://example.com/about',
    urlHash: 'abc123',
    stepNumber: 3,
    instruction: 'Identify all clickable navigation elements',
    visibleElements: ['[0] About Us link', '[1] Contact button'],
    interactiveElements: ['[0] click: About Us link'],
    navigationOptions: ['[0] About Us link'],
    formsPresent: false
  }
}
```

#### `page_extract_result`
Results from content extraction tool.

```javascript
{
  type: 'page_extract_result',
  timestamp: '2024-01-15T10:31:10Z',
  data: {
    userName: 'john_doe',
    url: 'https://example.com/about',
    urlHash: 'abc123',
    stepNumber: 3,
    instruction: 'Extract all product features and pricing information',
    extractedData: 'Premium plan: $29/month, Basic plan: $9/month',
    elementsFound: ['pricing-table', 'feature-list'],
    pageStructure: 'Header with navigation, main content area, footer',
    interactiveElements: ['signup-button', 'contact-form']
  }
}
```

#### `page_act_result`
Results from page action tool.

```javascript
{
  type: 'page_act_result',
  timestamp: '2024-01-15T10:31:10Z',
  data: {
    userName: 'john_doe',
    url: 'https://example.com/about',
    urlHash: 'abc123',
    stepNumber: 3,
    instruction: 'Click the "Pricing" link',
    actionSuccess: true,
    urlChanged: true,
    newUrl: 'https://example.com/pricing',
    result: 'Action executed successfully. URL changed to: https://example.com/pricing'
  }
}
```

### Discovery Events

#### `url_discovered`
A new URL was discovered and added to the exploration queue.

```javascript
{
  type: 'url_discovered',
  timestamp: '2024-01-15T10:31:15Z',
  data: {
    userName: 'john_doe',
    newUrl: 'https://example.com/pricing',
    sourceUrl: 'https://example.com/about',
    priority: 2,
    queueSize: 5
  }
}
```

#### `screenshot_captured`
A screenshot was taken during exploration.

```javascript
{
  type: 'screenshot_captured',
  timestamp: '2024-01-15T10:31:20Z',
  data: {
    userName: 'john_doe',
    urlHash: 'abc123',
    stepNumber: 3,
    action: 'before_decision',
    filename: 'step_003_before_decision.png',
    screenshotPath: '/path/to/screenshot.png',
    screenshotBase64: 'iVBORw0KGgoAAAANS...' // Base64 encoded image
  }
}
```

### Session Events

#### `session_completed`
Complete exploration session finished with all data.

```javascript
{
  type: 'session_completed',
  timestamp: '2024-01-15T10:45:00Z',
  data: {
    userName: 'john_doe',
    objectiveAchieved: true,
    totalPages: 8,
    totalActions: 24,
    pageLinkages: {
      'https://example.com': ['https://example.com/about', 'https://example.com/pricing'],
      'https://example.com/about': ['https://example.com/contact']
    },
    sessionId: 'john-doe_2024-01-15T10-30-00',
    duration: '900000ms'
  }
}
```

## Frontend Integration Examples

### React Implementation

```jsx
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

function ExplorationDashboard() {
  const [socket, setSocket] = useState(null);
  const [explorationState, setExplorationState] = useState({
    isRunning: false,
    currentPage: null,
    screenshots: [],
    decisions: [],
    toolResults: []
  });

  useEffect(() => {
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);

    // Listen for exploration updates
    newSocket.on('exploration_update', (update) => {
      handleExplorationUpdate(update);
    });

    return () => newSocket.close();
  }, []);

  const handleExplorationUpdate = (update) => {
    const { type, data } = update;

    switch(type) {
      case 'page_started':
        setExplorationState(prev => ({
          ...prev,
          currentPage: data.url
        }));
        break;

      case 'screenshot_captured':
        setExplorationState(prev => ({
          ...prev,
          screenshots: [...prev.screenshots, data]
        }));
        break;

      case 'llm_decision':
        setExplorationState(prev => ({
          ...prev,
          decisions: [...prev.decisions, data]
        }));
        break;

      case 'page_extract_result':
        setExplorationState(prev => ({
          ...prev,
          toolResults: [...prev.toolResults, { type: 'extract', ...data }]
        }));
        break;

      case 'page_observe_result':
        setExplorationState(prev => ({
          ...prev,
          toolResults: [...prev.toolResults, { type: 'observe', ...data }]
        }));
        break;

      case 'page_act_result':
        setExplorationState(prev => ({
          ...prev,
          toolResults: [...prev.toolResults, { type: 'act', ...data }]
        }));
        break;
    }
  };

  const startExploration = () => {
    socket.emit('execute_exploration', {
      userName: 'demo_user',
      objective: 'explore the entire website',
      startUrl: 'https://example.com',
      isExploration: true,
      maxPagesToExplore: 8
    });
    setExplorationState(prev => ({ ...prev, isRunning: true }));
  };

  return (
    <div className="exploration-dashboard">
      <div className="controls">
        <button onClick={startExploration} disabled={explorationState.isRunning}>
          Start Exploration
        </button>
      </div>

      <div className="sections">
        <div className="current-page">
          <h3>Current Page</h3>
          <p>{explorationState.currentPage || 'Not started'}</p>
        </div>

        <div className="decisions">
          <h3>LLM Decisions</h3>
          {explorationState.decisions.map((decision, i) => (
            <div key={i} className="decision">
              <strong>Step {decision.stepNumber}:</strong> {decision.decision.tool}
              <p>{decision.decision.instruction}</p>
              <small>{decision.decision.reasoning}</small>
            </div>
          ))}
        </div>

        <div className="tool-results">
          <h3>Tool Results</h3>
          {explorationState.toolResults.map((result, i) => (
            <div key={i} className={`tool-result ${result.type}`}>
              <strong>{result.type.toUpperCase()}:</strong> {result.instruction}
              {result.type === 'extract' && (
                <p>Extracted: {result.extractedData}</p>
              )}
              {result.type === 'observe' && (
                <p>Found {result.visibleElements.length} elements</p>
              )}
              {result.type === 'act' && (
                <p>Action: {result.actionSuccess ? 'Success' : 'Failed'}</p>
              )}
            </div>
          ))}
        </div>

        <div className="screenshots">
          <h3>Screenshots</h3>
          {explorationState.screenshots.map((screenshot, i) => (
            <div key={i} className="screenshot">
              <img 
                src={`data:image/png;base64,${screenshot.screenshotBase64}`}
                alt={screenshot.action}
                style={{ maxWidth: '200px' }}
              />
              <p>{screenshot.action} - Step {screenshot.stepNumber}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

## Key Features

1. **Real-time Progress**: See exploration progress as it happens
2. **Tool Separation**: Different events for observe, extract, and act tools
3. **Screenshot Streaming**: Live screenshots with base64 encoding
4. **Decision Transparency**: See exactly what Claude is thinking
5. **User Session Management**: Automatic cleanup of user folders
6. **Error Handling**: Comprehensive error reporting
7. **Linkage Tracking**: Complete page relationship mapping
8. **Background Processing**: Non-blocking exploration for exploration mode

## Best Practices

1. **Event Filtering**: Filter events by `userName` in multi-user scenarios
2. **State Management**: Use proper state management for complex UIs
3. **Error Handling**: Always handle connection errors and reconnection
4. **Memory Management**: Clean up event listeners and large screenshot data
5. **UI Updates**: Debounce rapid updates for better performance
6. **Loading States**: Show appropriate loaders for different tool types 