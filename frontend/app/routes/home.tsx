import React, { useState, useEffect, type JSX } from 'react';
import { useSocket } from '../hooks/useSocket';
import { NetworkGraph } from '../components/ui/network-graph';
import { TreeGraph } from '../components/ui/tree-graph';
import { ChatInterface } from '../components/ui/chat-interface';
import { 
  Play, Square, Wifi, WifiOff, Eye, Download, MousePointer, 
  Camera, Globe, Clock, CheckCircle, Loader2, ChevronRight,
  ExternalLink, Maximize2, X, AlertCircle, Network, Sparkles,
  FileText, Code, Link2, Activity, Bot, Settings, Info, Database,
  MessageSquare, ChevronDown, ChevronUp, GitBranch
} from 'lucide-react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import { 
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger 
} from '../components/ui/tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { UserInputDialog } from '../components/ui/user-input-dialog';
import { cn } from '../lib/utils';
import type { 
  ExplorationConfig, 
  ExplorationState, 
  PageStatus,
  ScreenshotData,
  LLMDecision,
  PageObserveResult,
  PageActResult,
  URLDiscovery,
  InteractionGraph,
  TreeStructure,
} from '../types/exploration';
import { toast } from 'sonner';

interface PersistedData {
  screenshots: ScreenshotData[];
  decisions: Array<{
    stepNumber: number;
    decision: LLMDecision;
    url: string;
    urlHash: string;
    maxPagesReached: boolean;
    timestamp: string;
  }>;
  toolResults: {
    observe: PageObserveResult[];
    act: PageActResult[];
  };
  urlDiscoveries: URLDiscovery[];
  pageStatuses: PageStatus[];
  graphs: { [urlHash: string]: InteractionGraph };
  trees: { [urlHash: string]: TreeStructure };
}

export default function Home() {
  const { 
    explorationState, 
    startExploration, 
    stopExploration, 
    submitUserInput,
    skipUserInput,
    sendChatMessage,
    toggleChatMode,
    isConnected, 
    isRunning 
  } = useSocket();
  
  // State management
  const [showConfigDialog, setShowConfigDialog] = useState<boolean>(true);
  const [selectedPage, setSelectedPage] = useState<PageStatus | null>(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState<ScreenshotData | null>(null);
  const [showDiscoveries, setShowDiscoveries] = useState<boolean>(false);
  const [persistedData, setPersistedData] = useState<PersistedData>({
    screenshots: [],
    decisions: [],
    toolResults: { observe: [], act: [] },
    urlDiscoveries: [],
    pageStatuses: [],
    graphs: {},
    trees: {}
  });
  
  const [config, setConfig] = useState<ExplorationConfig>({
    userName: '',
    objective: 'Explore the whole profit.co site all of its url etc and give me detail information',
    startUrl: 'https://profit.co',
    isExploration: true,
    maxPagesToExplore: 6,
    additionalContext: '',
    canLogin: false
  });

  // Persist exploration data
  useEffect(() => {
    // Persist screenshots
    if (explorationState.screenshots.length > persistedData.screenshots.length) {
      setPersistedData(prev => ({
        ...prev,
        screenshots: [...explorationState.screenshots]
      }));
    }
    
    // Persist decisions
    if (explorationState.decisions.length > persistedData.decisions.length) {
      setPersistedData(prev => ({
        ...prev,
        decisions: [...explorationState.decisions]
      }));
    }
    
    // Persist page statuses
    if (explorationState.pageStatuses.length > 0) {
      setPersistedData(prev => ({
        ...prev,
        pageStatuses: [...explorationState.pageStatuses]
      }));
    }
    
    // Persist tool results
    const toolResults = explorationState.toolResults;
    setPersistedData(prev => ({
      ...prev,
      toolResults: {
        observe: [...toolResults.observe],
        act: [...toolResults.act]
      }
    }));
    
    // Persist URL discoveries
    if (explorationState.urlDiscoveries.length > persistedData.urlDiscoveries.length) {
      setPersistedData(prev => ({
        ...prev,
        urlDiscoveries: [...explorationState.urlDiscoveries]
      }));
    }

    // Persist graphs
    if (Object.keys(explorationState.graphs).length > 0) {
      setPersistedData(prev => ({
        ...prev,
        graphs: { ...explorationState.graphs }
      }));
    }

    // Persist trees
    if (Object.keys(explorationState.trees).length > 0) {
      console.log('Home: Persisting trees:', explorationState.trees);
      setPersistedData(prev => ({
        ...prev,
        trees: { ...explorationState.trees }
      }));
    }
  }, [explorationState]);

  // Auto-select first page
  useEffect(() => {
    const pages = isRunning ? explorationState.pageStatuses : persistedData.pageStatuses;
    if (pages.length > 0 && !selectedPage) {
      setSelectedPage(pages[0]);
    }
  }, [explorationState.pageStatuses, persistedData.pageStatuses, selectedPage, isRunning]);

  // Show notifications for new graphs
  useEffect(() => {
    const graphs = explorationState.graphs;
    Object.values(graphs).forEach(graph => {
      const pageStatus = explorationState.pageStatuses.find(p => p.url === graph.pageUrl);
      if (pageStatus?.hasGraph) {
        toast(
          <div className="flex flex-col gap-1">
            <p className="font-medium">📊 Page Analysis Complete</p>
            <p className="text-xs">Page: {graph.pageUrl}</p>
            <p className="text-xs text-muted-foreground">{graph.nodes.length} elements mapped</p>
          </div>,
          { duration: 3000 }
        );
      }
    });
  }, [explorationState.graphs]);

  const handleStartExploration = () => {
    // Generate default objective for exploration mode
    let finalObjective = config.objective;
    if (config.isExploration) {
      finalObjective = generateExplorationObjective(config.startUrl, config.canLogin);
    }

    const explorationConfig = {
      ...config,
      objective: finalObjective,
      userName: config.userName || `user_${Date.now()}`
    };

    setShowConfigDialog(false);
    startExploration(explorationConfig);
  };

  const generateExplorationObjective = (url: string, canLogin: boolean = false): string => {
    const loginText = canLogin ? "including login flows" : "without requiring login";
    return `Systematically explore the website "${url}" by:
1. Click through ALL interactive elements (buttons, dropdowns, filters, tabs, toggles, etc.)
2. Navigate to all accessible pages and sections
3. Discover the complete functionality and content structure
4. Capture comprehensive page interactions and relationships
5. Focus on complete exploration ${loginText}

Goal: Map the entire user experience and create detailed interaction graphs for each page discovered.`;
  };

  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getToolIcon = (tool: string): JSX.Element => {
    switch (tool) {
      case 'page_act': return <MousePointer className="w-3 h-3" />;
      case 'user_input': return <Bot className="w-3 h-3" />;
      case 'standby': return <Clock className="w-3 h-3" />;
      default: return <Activity className="w-3 h-3" />;
    }
  };

  const getPageScreenshots = (urlHash: string): ScreenshotData[] => {
    const screenshots = isRunning ? explorationState.screenshots : persistedData.screenshots;
    return screenshots.filter(s => s.urlHash === urlHash);
  };

  const getPageDecisions = (urlHash: string) => {
    const decisions = isRunning ? explorationState.decisions : persistedData.decisions;
    return decisions.filter(d => d.urlHash === urlHash);
  };

  const getPageToolResults = (urlHash: string) => {
    const toolResults = isRunning ? explorationState.toolResults : persistedData.toolResults;
    return {
      observe: toolResults.observe.filter(r => r.urlHash === urlHash),
      act: toolResults.act.filter(r => r.urlHash === urlHash)
    };
  };

  const getPageGraph = (urlHash: string): InteractionGraph | null => {
    const graphs = isRunning ? explorationState.graphs : persistedData.graphs;
    return graphs[urlHash] || null;
  };

  const getPageTree = (urlHash: string): TreeStructure | null => {
    const trees = isRunning ? explorationState.trees : persistedData.trees;
    const tree = trees[urlHash] || null;
    if (!tree && Object.keys(trees).length > 0) {
      console.log('Home: Tree not found for urlHash:', urlHash, 'Available:', Object.keys(trees));
    }
    return tree;
  };

  return (
    <TooltipProvider>
      <div className="h-screen bg-background flex flex-col">
        {/* Header */}
        <header className="h-14 bg-card border-b border-border flex-shrink-0">
          <div className="h-full px-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Globe className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-sm font-semibold">Web Explorer AI</h1>
                <p className="text-xs text-muted-foreground">Intelligent Web Analysis</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {/* Connection Status */}
              <Badge 
                variant={isConnected ? "outline" : "destructive"}
                className="text-xs"
              >
                {isConnected ? (
                  <>
                    <Wifi className="w-3 h-3 mr-1" />
                    Connected
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3 h-3 mr-1" />
                    Disconnected
                  </>
                )}
              </Badge>

              {/* Control Buttons */}
              {!showConfigDialog && (
                <div className="flex items-center gap-2">
                  {!isRunning ? (
                    <Button 
                      onClick={() => setShowConfigDialog(true)} 
                      size="sm"
                      disabled={!isConnected}
                    >
                      <Play className="w-4 h-4 mr-1.5" />
                      Start
                    </Button>
                  ) : (
                    <Button 
                      onClick={() => stopExploration(config.userName)} 
                      size="sm" 
                      variant="destructive"
                    >
                      <Square className="w-4 h-4 mr-1.5" />
                      Stop
                    </Button>
                  )}
                  
                  {isRunning && (
                    <Button 
                      onClick={toggleChatMode}
                      size="sm" 
                      variant="outline"
                      className="relative"
                    >
                      <MessageSquare className="w-4 h-4 mr-1.5" />
                      Chat
                      {explorationState.chatState.messages.length > 0 && (
                        <Badge className="absolute -top-2 -right-2 h-4 w-4 p-0 text-xs">
                          {explorationState.chatState.messages.length}
                        </Badge>
                      )}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        {!showConfigDialog && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left Sidebar - Page List */}
            <div className="w-80 bg-card border-r border-border flex flex-col">
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold">Discovered Pages</h2>
                  <Badge variant="secondary" className="text-xs">
                    {(isRunning ? explorationState.pageStatuses : persistedData.pageStatuses).length}
                  </Badge>
                </div>
                
                {/* Current Status */}
                {isRunning && explorationState.currentPage && (
                  <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
                    <div className="flex items-center gap-2 mb-1">
                      <Loader2 className="w-3 h-3 animate-spin text-primary" />
                      <span className="text-xs font-medium">Exploring</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {explorationState.currentPage}
                    </p>
                  </div>
                )}

                {/* Graph Update Status */}
                {explorationState.isGraphUpdating && (
                  <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-2">
                      <Network className="w-3 h-3 animate-pulse text-blue-600 dark:text-blue-400" />
                      <span className="text-xs font-medium text-blue-800 dark:text-blue-200">
                        Analyzing page structure...
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Page List */}
              <ScrollArea className="flex-1 overflow-auto">
                <div className="p-2">
                  {(isRunning ? explorationState.pageStatuses : persistedData.pageStatuses).map((page) => (
                    <div
                      key={page.urlHash}
                      className={cn(
                        "mb-2 p-3 rounded-lg border cursor-pointer transition-all hover:shadow-sm",
                        selectedPage?.urlHash === page.urlHash 
                          ? "bg-accent border-primary" 
                          : "bg-card border-border hover:bg-accent/50"
                      )}
                      onClick={() => setSelectedPage(page)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Badge 
                          variant={page.status === 'completed' ? 'default' : 'secondary'} 
                          className="text-xs"
                        >
                          {page.status}
                        </Badge>
                        {page.hasGraph && (
                          <Tooltip>
                            <TooltipTrigger>
                              <Network className="w-3 h-3 text-primary" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Graph available</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <p className="text-xs font-medium truncate mb-1">
                        {new URL(page.url).pathname || '/'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {page.url}
                      </p>
                      {page.stepsExecuted && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {page.stepsExecuted} steps
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Bottom Bar - URL Discoveries */}
              <div className="border-t border-border">
                <button
                  onClick={() => setShowDiscoveries(!showDiscoveries)}
                  className="w-full p-4 hover:bg-accent/50 transition-colors flex items-center justify-between"
                >
                  <h4 className="text-xs font-medium flex items-center gap-1.5">
                    <Link2 className="w-3 h-3 text-primary" />
                    Recent Discoveries
                  </h4>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {(isRunning ? explorationState.urlDiscoveries : persistedData.urlDiscoveries).length}
                    </Badge>
                    {showDiscoveries ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </button>
                
                {showDiscoveries && (
                  <div className="border-t border-border max-h-64 overflow-auto">
                    <ScrollArea className="h-full">
                      <div className="p-3 space-y-2">
                        {(isRunning ? explorationState.urlDiscoveries : persistedData.urlDiscoveries).length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <Link2 className="w-6 h-6 mx-auto mb-2 opacity-30" />
                            <p className="text-xs">No discoveries yet</p>
                          </div>
                        ) : (
                          (isRunning ? explorationState.urlDiscoveries : persistedData.urlDiscoveries)
                            .slice()
                            .reverse()
                            .map((discovery, index) => (
                              <div key={index} className="p-2 bg-muted rounded-md text-xs">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-muted-foreground">
                                    {formatTime(discovery.timestamp)}
                                  </span>
                                  <Badge variant="outline" className="text-xs">
                                    P{discovery.priority}
                                  </Badge>
                                </div>
                                <p className="truncate font-medium">
                                  {discovery.newUrl}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1 truncate">
                                  From: {discovery.sourceUrl}
                                </p>
                              </div>
                            ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel - Page Details */}
            <div className="flex-1 bg-background flex flex-col overflow-hidden">
              {selectedPage ? (
                <>
                  {/* Page Header */}
                  <div className="p-4 bg-card border-b border-border">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 mr-4">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-medium">Page Analysis</h3>
                          <Badge variant="outline" className="text-xs">
                            {selectedPage.status}
                          </Badge>
                          {selectedPage.hasGraph && (
                            <Badge variant="default" className="text-xs">
                              <Network className="w-3 h-3 mr-1" />
                              Graph
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Link2 className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <p className="text-xs text-muted-foreground truncate">
                            {selectedPage.url}
                          </p>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => window.open(selectedPage.url, '_blank')}
                              >
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Open in new tab</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Page Content Tabs */}
                  <Tabs defaultValue="tree" className="flex-1 flex flex-col overflow-hidden">
                    <div className="bg-card px-4 pt-2">
                      <TabsList className="h-8">
                        <TabsTrigger value="graph" className="text-xs data-[state=active]:text-xs">
                          <Network className="w-3 h-3 mr-1" />
                          Graph
                        </TabsTrigger>
                        <TabsTrigger value="tree" className="text-xs data-[state=active]:text-xs">
                          <GitBranch className="w-3 h-3 mr-1" />
                          Tree
                        </TabsTrigger>
                        <TabsTrigger value="screenshots" className="text-xs data-[state=active]:text-xs">
                          Screenshots
                        </TabsTrigger>
                        <TabsTrigger value="decisions" className="text-xs data-[state=active]:text-xs">
                          Decisions
                        </TabsTrigger>
                        <TabsTrigger value="actions" className="text-xs data-[state=active]:text-xs">
                          Actions
                        </TabsTrigger>
                      </TabsList>
                    </div>

                    {/* Tree Tab */}
                    <TabsContent value="tree" className="flex-1 overflow-auto p-4">
                      {(() => {
                        const tree = getPageTree(selectedPage.urlHash);
                        
                        // Debug logging
                        console.log('Home: Tree tab rendering for urlHash:', selectedPage.urlHash, 'hasTree:', !!tree);
                        
                        if (!tree) {
                          return (
                            <div className="flex items-center justify-center h-full">
                              <div className="text-center">
                                <Network className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                                <p className="text-sm text-muted-foreground">
                                  {selectedPage.status === 'in_progress' 
                                    ? 'Tree structure is being generated...' 
                                    : 'No tree structure available for this page yet'
                                  }
                                </p>
                                <div className="mt-4 text-xs text-muted-foreground">
                                  <p>URL Hash: {selectedPage.urlHash}</p>
                                  <p>Available trees: {Object.keys(isRunning ? explorationState.trees : persistedData.trees).join(', ')}</p>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        
                        return <TreeGraph treeStructure={tree} />;
                      })()}
                    </TabsContent>

                    {/* Graph Tab */}
                    <TabsContent value="graph" className="flex-1 overflow-auto p-4">
                      {(() => {
                        const graph = getPageGraph(selectedPage.urlHash);
                        
                        if (!graph) {
                          return (
                            <div className="flex items-center justify-center h-full">
                              <div className="text-center">
                                <Network className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                                <p className="text-sm text-muted-foreground">
                                  {selectedPage.status === 'in_progress' 
                                    ? 'Page graph is being generated...' 
                                    : 'No interaction graph available for this page yet'
                                  }
                                </p>
                                {explorationState.isGraphUpdating && (
                                  <div className="flex items-center justify-center gap-2 mt-4">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span className="text-xs text-muted-foreground">
                                      Analyzing page structure...
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }
                        
                        return <NetworkGraph graph={graph} />;
                      })()}
                    </TabsContent>

                    {/* Screenshots Tab */}
                    <TabsContent value="screenshots" className="flex-1 overflow-auto p-4">
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        {getPageScreenshots(selectedPage.urlHash).map((screenshot) => (
                          <Card 
                            key={screenshot.filename} 
                            className="cursor-pointer hover:shadow-md transition-shadow overflow-hidden"
                            onClick={() => setSelectedScreenshot(screenshot)}
                          >
                            <div className="aspect-video relative">
                              <img
                                src={`data:image/png;base64,${screenshot.screenshotBase64}`}
                                alt={`Screenshot at step ${screenshot.stepNumber}`}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 hover:opacity-100 transition-opacity flex items-end p-3">
                                <div className="text-white">
                                  <p className="text-xs font-medium">Step {screenshot.stepNumber}</p>
                                  <p className="text-xs opacity-90">{screenshot.action}</p>
                                </div>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </TabsContent>

                    {/* Decisions Tab */}
                    <TabsContent value="decisions" className="flex-1 overflow-auto p-4">
                      <div className="space-y-3">
                        {getPageDecisions(selectedPage.urlHash).map((decision, index) => (
                          <Card key={index}>
                            <CardHeader className="pb-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {getToolIcon(decision.decision.tool)}
                                  <span className="text-sm font-medium">
                                    Step {decision.stepNumber}: {decision.decision.tool}
                                  </span>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {formatTime(decision.timestamp)}
                                </span>
                              </div>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-3">
                              <div>
                                <Label className="text-xs text-muted-foreground">Instruction</Label>
                                <p className="text-xs mt-1">{decision.decision.instruction}</p>
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">Reasoning</Label>
                                <p className="text-xs mt-1 text-muted-foreground">{decision.decision.reasoning}</p>
                              </div>
                              {decision.decision.nextPlan && (
                                <div>
                                  <Label className="text-xs text-muted-foreground">Next Plan</Label>
                                  <p className="text-xs mt-1 text-muted-foreground">{decision.decision.nextPlan}</p>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </TabsContent>

                    {/* Actions Tab */}
                    <TabsContent value="actions" className="flex-1 overflow-auto p-4">
                      <div className="space-y-3">
                        {(() => {
                          const toolResults = getPageToolResults(selectedPage.urlHash);
                          const allResults = [
                            ...toolResults.observe.map(r => ({ ...r, type: 'observe' })),
                            ...toolResults.act.map(r => ({ ...r, type: 'act' }))
                          ].sort((a, b) => a.stepNumber - b.stepNumber);

                          return allResults.map((result, index) => (
                            <Card key={index}>
                              <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    {getToolIcon(result.type)}
                                    <span className="text-sm font-medium">
                                      Step {result.stepNumber}: {result.type}
                                    </span>
                                  </div>
                                  <span className="text-xs text-muted-foreground">
                                    {formatTime(result.timestamp)}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">{result.instruction}</p>
                              </CardHeader>
                              {result.type === 'act' && (
                                <CardContent className="pt-0 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Badge 
                                      variant={(result as any).actionSuccess ? 'default' : 'destructive'} 
                                      className="text-xs"
                                    >
                                      {(result as any).actionSuccess ? 'Success' : 'Failed'}
                                    </Badge>
                                    {(result as any).urlChanged && (
                                      <Badge variant="outline" className="text-xs">URL Changed</Badge>
                                    )}
                                  </div>
                                  <p className="text-xs">{(result as any).result}</p>
                                  {(result as any).newUrl && (
                                    <div>
                                      <Label className="text-xs text-muted-foreground">New URL</Label>
                                      <p className="text-xs font-mono mt-1">{(result as any).newUrl}</p>
                                    </div>
                                  )}
                                </CardContent>
                              )}
                            </Card>
                          ));
                        })()}
                      </div>
                    </TabsContent>
                  </Tabs>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <Eye className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      Select a page from the sidebar to view details
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Chat Interface */}
        <ChatInterface
          chatState={explorationState.chatState}
          onSendMessage={(message) => sendChatMessage(message, config.userName)}
          onToggleChat={toggleChatMode}
          isConnected={isConnected}
        />

        {/* User Input Dialog */}
        {explorationState.userInputRequest && (
          <UserInputDialog
            userInputRequest={explorationState.userInputRequest}
            onSubmit={submitUserInput}
            onSkip={skipUserInput}
            onClose={() => {
              if (explorationState.userInputRequest && config.userName) {
                stopExploration(config.userName);
              }
            }}
            isOpen={!!explorationState.userInputRequest}
          />
        )}

        {/* Screenshot Modal */}
        {selectedScreenshot && (
          <Dialog open={!!selectedScreenshot} onOpenChange={() => setSelectedScreenshot(null)}>
            <DialogContent className="max-w-4xl max-h-[90vh] p-0">
              <DialogHeader className="p-4 pb-2">
                <DialogTitle className="text-sm">
                  Screenshot - Step {selectedScreenshot.stepNumber}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {selectedScreenshot.action}
                </DialogDescription>
              </DialogHeader>
              <div className="p-4 pt-0 overflow-auto">
                <img
                  src={`data:image/png;base64,${selectedScreenshot.screenshotBase64}`}
                  alt={`Screenshot at step ${selectedScreenshot.stepNumber}`}
                  className="w-full rounded-md"
                />
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Configuration Dialog */}
        <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Configure Web Exploration</DialogTitle>
              <DialogDescription>
                Set up your AI-powered web exploration session
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="userName" className="text-sm">Your Name</Label>
                  <Input
                    id="userName"
                    value={config.userName}
                    onChange={(e) => setConfig(prev => ({ ...prev, userName: e.target.value }))}
                    placeholder="Enter your name"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="startUrl" className="text-sm">Starting URL</Label>
                  <Input
                    id="startUrl"
                    value={config.startUrl}
                    onChange={(e) => setConfig(prev => ({ ...prev, startUrl: e.target.value }))}
                    placeholder="https://example.com"
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="maxPages" className="text-sm">Max Pages to Explore</Label>
                <Input
                  id="maxPages"
                  type="number"
                  value={config.maxPagesToExplore}
                  onChange={(e) => setConfig(prev => ({ ...prev, maxPagesToExplore: parseInt(e.target.value) || 6 }))}
                  min="1"
                  max="20"
                  className="mt-1 w-32"
                />
              </div>

              {/* Exploration Mode Toggle */}
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="exploration-mode" className="text-sm font-medium">
                    Exploration Mode
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {config.isExploration ? 'Deep product discovery with smart objectives' : 'Custom focused task'}
                  </p>
                </div>
                <Switch
                  id="exploration-mode"
                  checked={config.isExploration}
                  onCheckedChange={(checked) => setConfig(prev => ({ ...prev, isExploration: checked }))}
                />
              </div>

              {/* Can Login Toggle */}
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="can-login" className="text-sm font-medium">
                    Can Login
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {config.canLogin 
                      ? 'Allow agent to request login credentials' 
                      : 'Keep exploration to public content only'
                    }
                  </p>
                </div>
                <Switch
                  id="can-login"
                  checked={config.canLogin}
                  onCheckedChange={(checked) => setConfig(prev => ({ ...prev, canLogin: checked }))}
                />
              </div>

              {/* Custom Objective - Only show when NOT in exploration mode */}
              {!config.isExploration && (
                <div>
                  <Label htmlFor="objective" className="text-sm">Mission Objective</Label>
                  <Textarea
                    id="objective"
                    value={config.objective}
                    onChange={(e) => setConfig(prev => ({ ...prev, objective: e.target.value }))}
                    placeholder="Describe what the AI should explore or find..."
                    rows={3}
                    className="mt-1"
                  />
                </div>
              )}

              <div>
                <Label htmlFor="additionalContext" className="text-sm">
                  Additional Context (Optional)
                </Label>
                <Textarea
                  id="additionalContext"
                  value={config.additionalContext}
                  onChange={(e) => setConfig(prev => ({ ...prev, additionalContext: e.target.value }))}
                  placeholder="Any additional context or constraints..."
                  rows={2}
                  className="mt-1"
                />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button
                variant="outline"
                onClick={() => setShowConfigDialog(false)}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleStartExploration}
                disabled={!isConnected || !config.startUrl || (!config.isExploration && !config.objective)}
              >
                <Play className="w-4 h-4 mr-2" />
                Start Exploration
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}