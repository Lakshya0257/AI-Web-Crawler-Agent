import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { 
  ExplorationConfig, 
  ExplorationState, 
  ExplorationUpdate,
  ScreenshotData,
  URLDiscovery,
  PageStatus,
  SessionCompletion,
  PageObserveResult,
  PageActResult,
  StandbyResult,
  UserInputRequest,
  InteractionGraph,
  ChatMessage
} from '../types/exploration';

const SOCKET_URL = 'http://localhost:3001';

const initialState: ExplorationState = {
  isConnected: false,
  isRunning: false,
  currentPage: null,
  screenshots: [],
  decisions: [],
  toolResults: {
    observe: [],
    act: [],
    standby: []
  },
  urlDiscoveries: [],
  pageStatuses: [],
  sessionCompletion: null,
  totalSteps: 0,
  activeToolExecution: null,
  userInputRequest: null,
  graphs: {},
  trees: {},
  chatState: {
    messages: [],
    isActive: false,
    isProcessing: false
  },
  isGraphUpdating: false
};

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [explorationState, setExplorationState] = useState<ExplorationState>(initialState);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    // Connection events
    newSocket.on('connect', () => {
      setExplorationState(prev => ({ ...prev, isConnected: true }));
      console.log('🔌 Connected to Socket.IO server');
    });

    newSocket.on('disconnect', () => {
      setExplorationState(prev => ({ ...prev, isConnected: false, isRunning: false }));
      console.log('🔌 Disconnected from Socket.IO server');
    });

    // Exploration lifecycle events
    newSocket.on('execution_started', (data: { userName: string; timestamp: string }) => {
      setExplorationState(prev => ({ ...prev, isRunning: true }));
      console.log('🚀 Exploration started', data);
    });

    newSocket.on('exploration_completed', (data: { userName: string; success: boolean; timestamp: string }) => {
      setExplorationState(prev => ({ ...prev, isRunning: false }));
      console.log('✅ Exploration completed', data);
    });

    newSocket.on('exploration_stopped', (data: { userName: string; timestamp: string }) => {
      setExplorationState(prev => ({ ...prev, isRunning: false }));
      console.log('⏹️ Exploration stopped', data);
    });

    newSocket.on('exploration_error', (data: { userName?: string; error: string; timestamp: string }) => {
      setExplorationState(prev => ({ ...prev, isRunning: false }));
      console.error('❌ Exploration error', data);
    });

    // Real-time exploration updates
    newSocket.on('exploration_update', (update: ExplorationUpdate) => {
      handleExplorationUpdate(update);
    });

    // Direct chat error events (not through exploration_update)
    newSocket.on('chat_error', (data: { userName: string; error: string; timestamp: string }) => {
      setExplorationState(prev => ({
        ...prev,
        chatState: {
          ...prev.chatState,
          isProcessing: false,
          messages: [...prev.chatState.messages, {
            id: Date.now().toString(),
            type: 'assistant',
            content: `Error: ${data.error}`,
            timestamp: data.timestamp
          } as ChatMessage]
        }
      }));
      console.error('❌ Chat error (direct)', data);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const handleExplorationUpdate = useCallback((update: ExplorationUpdate) => {
    const { type, data } = update;

    setExplorationState(prev => {
      switch (type) {
        case 'page_started':
          return {
            ...prev,
            currentPage: data.url,
            pageStatuses: [...prev.pageStatuses.filter(p => p.urlHash !== data.urlHash), data as PageStatus]
          };

        case 'page_completed':
          return {
            ...prev,
            pageStatuses: prev.pageStatuses.map(p => 
              p.urlHash === data.urlHash ? { ...p, ...data } : p
            )
          };

        case 'llm_decision':
          return {
            ...prev,
            decisions: [...prev.decisions, {
              stepNumber: data.stepNumber,
              decision: data.decision,
              url: data.url,
              urlHash: data.urlHash,
              maxPagesReached: data.maxPagesReached,
              timestamp: update.timestamp
            }],
            totalSteps: data.stepNumber
          };

        case 'tool_execution_started':
          return {
            ...prev,
            activeToolExecution: {
              tool: data.tool,
              instruction: data.instruction,
              stepNumber: data.stepNumber
            }
          };

        case 'tool_execution_completed':
          return {
            ...prev,
            activeToolExecution: null
          };

        case 'after_page_act':
          // Handle screenshot capture after page action
          return {
            ...prev,
            screenshots: data.screenshot ? 
              [...prev.screenshots, { ...data, timestamp: update.timestamp } as ScreenshotData] :
              prev.screenshots
          };

        case 'page_act_result':
          return {
            ...prev,
            toolResults: {
              ...prev.toolResults,
              act: [...prev.toolResults.act, { ...data, timestamp: update.timestamp } as PageActResult]
            }
          };

        case 'screenshot_captured':
          return {
            ...prev,
            screenshots: [...prev.screenshots, { ...data, timestamp: update.timestamp } as ScreenshotData]
          };

        case 'url_discovered':
          return {
            ...prev,
            urlDiscoveries: [...prev.urlDiscoveries, { ...data, timestamp: update.timestamp } as URLDiscovery]
          };

        case 'session_completed':
          return {
            ...prev,
            sessionCompletion: { ...data, timestamp: update.timestamp } as SessionCompletion,
            isRunning: false
          };

        case 'user_input_request':
          return {
            ...prev,
            userInputRequest: { ...data, timestamp: update.timestamp } as UserInputRequest
          };

        case 'user_input_received':
          return {
            ...prev,
            userInputRequest: null
          };

        case 'standby_completed':
          return {
            ...prev,
            toolResults: {
              ...prev.toolResults,
              standby: [...prev.toolResults.standby, { ...data, timestamp: update.timestamp } as StandbyResult]
            }
          };

        // New graph events
        case 'updating_graph':
          return {
            ...prev,
            isGraphUpdating: true
          };

        case 'graph_updated':
          return {
            ...prev,
            isGraphUpdating: false,
            graphs: {
              ...prev.graphs,
              [data.urlHash]: data.graph as InteractionGraph
            },
            pageStatuses: prev.pageStatuses.map(p => 
              p.urlHash === data.urlHash 
                ? { ...p, hasGraph: true, graphLastUpdated: update.timestamp }
                : p
            )
          };

        case 'tree_updated':
          console.log('🌳 Tree updated event received:', data);
          console.log('🌳 Tree structure:', data.treeStructure);
          console.log('🌳 URL Hash:', data.urlHash);
          return {
            ...prev,
            trees: {
              ...prev.trees,
              [data.urlHash]: data.treeStructure
            }
          };

        // New chat events
        case 'chat_message':
          return {
            ...prev,
            chatState: {
              ...prev.chatState,
              messages: [...prev.chatState.messages, {
                id: data.id || Date.now().toString(),
                type: data.type,
                content: data.content,
                timestamp: update.timestamp,
                requestType: data.requestType
              } as ChatMessage],
              isProcessing: data.type === 'user' // Processing when user sends message
            }
          };

        case 'chat_navigation':
          return {
            ...prev,
            chatState: {
              ...prev.chatState,
              isProcessing: false
            },
            currentPage: data.url
          };

        case 'chat_error':
          return {
            ...prev,
            chatState: {
              ...prev.chatState,
              isProcessing: false,
              messages: [...prev.chatState.messages, {
                id: Date.now().toString(),
                type: 'assistant',
                content: `Error: ${data.error}`,
                timestamp: update.timestamp
              } as ChatMessage]
            }
          };

        default:
          return prev;
      }
    });
  }, []);

  const startExploration = useCallback((config: ExplorationConfig) => {
    if (socket && !explorationState.isRunning) {
      // Reset state before starting new exploration
      setExplorationState(prev => ({
        ...initialState,
        isConnected: prev.isConnected
      }));
      
      socket.emit('execute_exploration', config);
      console.log('🚀 Starting exploration with config:', config);
    }
  }, [socket, explorationState.isRunning]);

  const stopExploration = useCallback((userName: string) => {
    if (socket && explorationState.isRunning) {
      socket.emit('stop_exploration', { userName });
      console.log('⏹️ Stopping exploration for user:', userName);
    }
  }, [socket, explorationState.isRunning]);

  const submitUserInput = useCallback((inputs: { [key: string]: string }) => {
    if (socket && explorationState.userInputRequest) {
      socket.emit('user_input_response', { inputs });
      console.log('📥 Submitting user input:', inputs);
    }
  }, [socket, explorationState.userInputRequest]);

  const skipUserInput = useCallback(() => {
    if (socket && explorationState.userInputRequest) {
      socket.emit('user_input_response', { isSkipped: true });
      console.log('⏭️ Skipping user input');
    }
  }, [socket, explorationState.userInputRequest]);

  // New chat functionality
  const sendChatMessage = useCallback((message: string, userName: string) => {
    if (socket && explorationState.isConnected) {
      const chatData = {
        userName: userName,
        message: message
      };
      
      socket.emit('chat_message', chatData);
      console.log('💬 Sending chat message:', { userName, message });
      
      // Add user message immediately to UI
      const timestamp = new Date().toISOString();
      setExplorationState(prev => ({
        ...prev,
        chatState: {
          ...prev.chatState,
          messages: [...prev.chatState.messages, {
            id: Date.now().toString(),
            type: 'user',
            content: message,
            timestamp: timestamp
          } as ChatMessage],
          isProcessing: true
        }
      }));
    }
  }, [socket, explorationState.isConnected]);

  const toggleChatMode = useCallback(() => {
    setExplorationState(prev => ({
      ...prev,
      chatState: {
        ...prev.chatState,
        isActive: !prev.chatState.isActive
      }
    }));
  }, []);

  return {
    socket,
    explorationState,
    startExploration,
    stopExploration,
    submitUserInput,
    skipUserInput,
    sendChatMessage,
    toggleChatMode,
    isConnected: explorationState.isConnected,
    isRunning: explorationState.isRunning
  };
} 