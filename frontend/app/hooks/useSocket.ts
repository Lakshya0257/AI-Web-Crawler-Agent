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
  PageExtractResult,
  PageActResult,
  StandbyResult,
  UserInputRequest
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
    extract: [],
    act: [],
    standby: []
  },
  urlDiscoveries: [],
  pageStatuses: [],
  sessionCompletion: null,
  totalSteps: 0,
  activeToolExecution: null,
  userInputRequest: null
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

        case 'page_extract_result':
          return {
            ...prev,
            toolResults: {
              ...prev.toolResults,
              extract: [...prev.toolResults.extract, { ...data, timestamp: update.timestamp } as PageExtractResult]
            }
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

  return {
    socket,
    explorationState,
    startExploration,
    stopExploration,
    submitUserInput,
    isConnected: explorationState.isConnected,
    isRunning: explorationState.isRunning
  };
} 