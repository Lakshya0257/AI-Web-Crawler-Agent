import React, { useState, useEffect, useCallback, type JSX, useRef } from 'react';
import { useSocket } from '../hooks/useSocket';
import { MarkdownViewer } from '../components/ui/markdown-editor';
import { 
  Play, Square, Wifi, WifiOff, Eye, Download, MousePointer, 
  Camera, Globe, Clock, CheckCircle, Loader2, ChevronRight,
  ExternalLink, Maximize2, X, AlertCircle, Network, Sparkles,
  FileText, Code, Link2, Activity, Bot, Settings, Info, Database,
  ChevronDown, ChevronUp, Hash, List, Bell, MessageSquare,
  History, ArrowUpDown
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { cn } from '../lib/utils';
import type { 
  ExplorationConfig, 
  ExplorationState, 
  PageStatus,
  ScreenshotData,
  LLMDecision,
  PageObserveResult,
  PageExtractResult,
  PageActResult,
  URLDiscovery
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
    extract: PageExtractResult[];
    act: PageActResult[];
  };
  urlDiscoveries: URLDiscovery[];
  pageStatuses: PageStatus[];
}

// Group extracts by URL and track versions
interface ExtractVersion {
  extract: PageExtractResult;
  versionNumber: number;
}

interface GroupedExtracts {
  [urlHash: string]: {
    url: string;
    versions: ExtractVersion[];
    latestVersion: number;
  };
}

export default function Home() {
  const { explorationState, startExploration, stopExploration, submitUserInput, isConnected, isRunning } = useSocket();
  
  // State management
  const [showConfigDialog, setShowConfigDialog] = useState<boolean>(true);
  const [showAllExtractsDialog, setShowAllExtractsDialog] = useState<boolean>(false);
  const [selectedPage, setSelectedPage] = useState<PageStatus | null>(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState<ScreenshotData | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<{ [key: string]: number }>({});
  const [showDiscoveries, setShowDiscoveries] = useState<boolean>(true);
  const [persistedData, setPersistedData] = useState<PersistedData>({
    screenshots: [],
    decisions: [],
    toolResults: { observe: [], extract: [], act: [] },
    urlDiscoveries: [],
    pageStatuses: []
  });
  
  const previousExtractCountRef = useRef<number>(0);
  
  const [config, setConfig] = useState<ExplorationConfig>({
    userName: '',
    objective: 'Explore the whole profit.co site all of its url etc and give me detail information',
    startUrl: 'https://profit.co',
    isExploration: true,
    maxPagesToExplore: 6,
    additionalContext: '',
    canLogin: false
  });

  // Persist exploration data - Enhanced to include tool results
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
    
    // Persist tool results with notification for new extracts
    const toolResults = explorationState.toolResults;
    const currentExtractCount = toolResults.extract.length;
    
    // Check for new extracts and show notification
    if (currentExtractCount > previousExtractCountRef.current && previousExtractCountRef.current > 0) {
      const newExtracts = toolResults.extract.slice(previousExtractCountRef.current);
      newExtracts.forEach(extract => {
        if (extract.isNewVersion) {










          toast(
            <div className="flex flex-col gap-1">
              <p className="font-medium">New Data Extracted</p>
              <p className="text-xs">Page: {extract.url}</p>
              <p className="text-xs text-muted-foreground">Version {extract.version} of {extract.totalVersions}</p>
            </div>,
            { duration: 5000 }
          );
        }
      });
    }
    
    previousExtractCountRef.current = currentExtractCount;
    
    setPersistedData(prev => ({
      ...prev,
      toolResults: {
        observe: [...toolResults.observe],
        extract: [...toolResults.extract],
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
  }, [explorationState]);

  // Auto-select first page
  useEffect(() => {
    const pages = isRunning ? explorationState.pageStatuses : persistedData.pageStatuses;
    if (pages.length > 0 && !selectedPage) {
      setSelectedPage(pages[0]);
    }
  }, [explorationState.pageStatuses, persistedData.pageStatuses, selectedPage, isRunning]);

  const handleStartExploration = () => {
    // Generate default objective for exploration mode
    let finalObjective = config.objective;
    if (config.isExploration) {
      finalObjective = generateExplorationObjective(config.startUrl, config.canLogin);
    }
    
    setShowConfigDialog(false);
    startExploration({
      ...config,
      objective: finalObjective
    });
  };

  // Generate a good exploration objective based on the URL and login capability
  const generateExplorationObjective = (url: string, canLogin: boolean = false): string => {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.toLowerCase().replace('www.', '');
      
      // Domain-specific objectives
      if (domain.includes('youtube')) {
        let objective = "Explore YouTube's core product features, video discovery mechanisms, content organization, and platform capabilities. Focus on understanding the user experience, recommendation systems, creator tools, and monetization features. Avoid user-generated content and personal profiles.";
        if (canLogin) objective += " When login is available, access creator tools, analytics, and user-specific features to understand the platform's full capabilities.";
        return objective;
      } else if (domain.includes('github')) {
        let objective = "Explore GitHub's platform features, repository management, collaboration tools, and development workflow capabilities. Focus on understanding code hosting, project management, CI/CD features, and developer productivity tools.";
        if (canLogin) objective += " When login is available, access user dashboards, repository management features, and collaborative tools to understand the developer experience.";
        return objective;
      } else {
        // Generic objective for unknown domains
        let baseObjective = `Explore ${domain}'s core product features, user experience, and platform capabilities. Focus on understanding the main functionality, navigation structure, key features, and business model. Prioritize product-focused content over user-generated content.`;
        
        if (canLogin) {
          baseObjective += ` Since login capability is enabled, you can authenticate when necessary to access protected features, dashboards, user areas, and premium content. Request login credentials when you encounter login forms or restricted areas that would provide valuable insights into the platform's core functionality.`;
        }
        
        return baseObjective;
      }
    } catch (error) {
      // Fallback for invalid URLs
      let fallbackObjective = "Explore this website's core features, user experience, and platform capabilities. Focus on understanding the main functionality, navigation structure, and key features.";
      
      if (canLogin) {
        fallbackObjective += " Since login capability is enabled, you can authenticate when necessary to access protected features and gain deeper insights into the platform.";
      }
      
      return fallbackObjective;
    }
  };

  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getToolIcon = (tool: string): JSX.Element => {
    switch (tool) {
      case 'page_observe': return <Eye className="w-3 h-3" />;
      case 'page_extract': return <FileText className="w-3 h-3" />;
      case 'page_act': return <MousePointer className="w-3 h-3" />;
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
      extract: toolResults.extract.filter(r => r.urlHash === urlHash),
      act: toolResults.act.filter(r => r.urlHash === urlHash)
    };
  };

  // Get grouped extracts with version management
  const getGroupedPageExtracts = (urlHash: string): ExtractVersion[] => {
    const extracts = getPageToolResults(urlHash).extract;
    
    // Group by unique extraction (could be by instruction or other criteria)
    const versions: ExtractVersion[] = extracts.map((extract, index) => ({
      extract,
      versionNumber: extract.version || index + 1
    }));
    
    // Sort by version number descending (latest first)
    return versions.sort((a, b) => b.versionNumber - a.versionNumber);
  };

  // Get all extract results across all pages
  const getAllExtractResults = (): PageExtractResult[] => {
    const toolResults = isRunning ? explorationState.toolResults : persistedData.toolResults;
    return toolResults.extract;
  };

  // Get all pages (running or persisted)
  const allPages = isRunning ? explorationState.pageStatuses : persistedData.pageStatuses;
  const allDiscoveries = isRunning ? explorationState.urlDiscoveries : persistedData.urlDiscoveries;

  return (
    <TooltipProvider>
      <div className="h-screen bg-background text-foreground flex flex-col">
        
        
        {/* Header */}
        <div className="h-14 border-b border-border bg-card flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-medium">AI Web Explorer</h1>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge 
              variant={isConnected ? "outline" : "destructive"}
              className="text-xs h-6 gap-1.5"
            >
              {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isConnected ? 'Connected' : 'Disconnected'}
            </Badge>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAllExtractsDialog(true)}
              className="h-8 px-3 text-xs"
            >
              <Database className="w-3 h-3 mr-1.5" />
              All Extracts
            </Button>
            
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowConfigDialog(true)}
              className="h-8 px-3 text-xs"
            >
              <Settings className="w-3 h-3 mr-1.5" />
              Configure
            </Button>
            
            {isRunning && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => stopExploration(config.userName)}
                className="h-8 px-3 text-xs gap-1.5"
              >
                <Square className="w-3 h-3" />
                Stop
              </Button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Page List */}
          <div className="w-80 border-r border-border bg-card flex flex-col">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Network className="w-4 h-4 text-primary" />
                  Discovered Pages
                </h3>
                <Badge variant="secondary" className="text-xs">
                  {allPages.length}
                </Badge>
              </div>
              
              {/* Current Activity */}
              {isRunning && explorationState.activeToolExecution && (
                <div className="p-3 bg-accent rounded-lg mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-3 h-3 text-accent-foreground animate-pulse" />
                    <span className="text-xs font-medium">Active Execution</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getToolIcon(explorationState.activeToolExecution.tool)}
                    <span className="text-xs text-muted-foreground">
                      {explorationState.activeToolExecution.tool}
                    </span>
                    <Loader2 className="w-3 h-3 animate-spin ml-auto" />
                  </div>
                </div>
              )}
            </div>

            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {allPages.map((page, index) => (
                  <div
                    key={index}
                    onClick={() => setSelectedPage(page)}
                    className={cn(
                      "p-3 rounded-lg cursor-pointer transition-colors",
                      "hover:bg-accent",
                      selectedPage?.urlHash === page.urlHash && "bg-accent"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Badge 
                        variant={page.status === 'completed' ? 'default' : 'secondary'}
                        className="text-xs h-5"
                      >
                        {page.status === 'completed' ? (
                          <CheckCircle className="w-3 h-3 mr-1" />
                        ) : (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        )}
                        {page.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(page.timestamp)}
                      </span>
                    </div>
                    
                    <div className="flex items-start gap-2">
                      <Globe className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <p className="text-xs break-all line-clamp-2">
                        {page.url}
                      </p>
                    </div>
                    
                    {page.stepsExecuted && (
                      <div className="mt-2 flex items-center gap-2">
                        <Activity className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {page.stepsExecuted} actions
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Bottom Bar - URL Discoveries (Expandable) */}
            <div className="border-t border-border">
              <button
                onClick={() => setShowDiscoveries(!showDiscoveries)}
                className="w-full p-4 hover:bg-accent transition-colors"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-medium flex items-center gap-1.5">
                    <Link2 className="w-3 h-3 text-primary" />
                    Recent Discoveries
                  </h4>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {allDiscoveries.length}
                    </Badge>
                    {showDiscoveries ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronUp className="w-3 h-3" />
                    )}
                  </div>
                </div>
              </button>
              
              {showDiscoveries && (
                <div className="border-t border-border">
                  <ScrollArea className="h-80 p-4 pt-0">
                    <div className="space-y-1">
                      {allDiscoveries.slice().reverse().map((discovery, index) => (
                        <div key={index} className="p-2 bg-muted rounded text-xs group hover:bg-accent transition-colors">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-muted-foreground">
                              {formatTime(discovery.timestamp)}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              Priority {discovery.priority}
                            </Badge>
                          </div>
                          <p className="truncate group-hover:whitespace-normal group-hover:break-all">
                            {discovery.newUrl}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            From: {discovery.sourceUrl}
                          </p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Page Details with Extract Data Focus */}
          <div className="flex-1 bg-background overflow-hidden">
            {selectedPage ? (
              <div className="h-full flex flex-col">
                {/* Page Header */}
                <div className="p-4 border-b border-border bg-card">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 mr-4">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium">Page Analysis</h3>
                        <Badge variant="outline" className="text-xs">
                          {selectedPage.status}
                        </Badge>
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

                {/* Page Content with Extract Data as Primary Tab */}
                <div className="flex-1 overflow-hidden">
                  <Tabs defaultValue="extract" className="h-full flex flex-col">
                    <TabsList className="mx-4 mt-4 grid w-fit grid-cols-5 h-8">
                      <TabsTrigger value="extract" className="text-xs">
                        <FileText className="w-3 h-3 mr-1" />
                        Extracted Data
                      </TabsTrigger>
                      <TabsTrigger value="screenshots" className="text-xs">Screenshots</TabsTrigger>
                      <TabsTrigger value="decisions" className="text-xs">Decisions</TabsTrigger>
                      <TabsTrigger value="tools" className="text-xs">Tools</TabsTrigger>
                      <TabsTrigger value="timeline" className="text-xs">Timeline</TabsTrigger>
                    </TabsList>

                    {/* Extract Data Tab (Primary Focus) - Enhanced with Version Management */}
                    <TabsContent value="extract" className="flex-1 overflow-auto p-4">
                      <div className="space-y-4">
                        {(() => {
                          const versions = getGroupedPageExtracts(selectedPage.urlHash);
                          
                          if (versions.length === 0) {
                            return (
                              <div className="flex items-center justify-center h-64">
                                <div className="text-center">
                                  <Database className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                                  <p className="text-sm text-muted-foreground">
                                    No data has been extracted from this page yet
                                  </p>
                                </div>
                              </div>
                            );
                          }
                          
                          // Get selected version or default to latest
                          const selectedVersion = selectedVersions[selectedPage.urlHash] || versions[0].versionNumber;
                          const selectedExtract = versions.find(v => v.versionNumber === selectedVersion) || versions[0];
                          
                          return (
                            <Card className="border-primary/20">
                              <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-primary" />
                                    <CardTitle className="text-sm">Extracted Data</CardTitle>
                                    <Badge variant="outline" className="text-xs">
                                      Step {selectedExtract.extract.stepNumber}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {/* Version Selector */}
                                    {versions.length > 1 && (
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                                            <History className="w-3 h-3" />
                                            Version {selectedVersion}
                                            <ChevronDown className="w-3 h-3" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          {versions.map((version) => (
                                            <DropdownMenuItem
                                              key={version.versionNumber}
                                              onClick={() => {
                                                setSelectedVersions(prev => ({
                                                  ...prev,
                                                  [selectedPage.urlHash]: version.versionNumber
                                                }));
                                              }}
                                              className="text-xs"
                                            >
                                              <div className="flex items-center justify-between w-full">
                                                <span>Version {version.versionNumber}</span>
                                                <div className="flex items-center gap-2 ml-4">
                                                  {version.extract.isNewVersion && (
                                                    <Badge variant="default" className="text-xs h-5">
                                                      New
                                                    </Badge>
                                                  )}
                                                  <span className="text-muted-foreground">
                                                    {formatTime(version.extract.timestamp)}
                                                  </span>
                                                </div>
                                              </div>
                                            </DropdownMenuItem>
                                          ))}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    )}
                                    
                                    <span className="text-xs text-muted-foreground">
                                      {formatTime(selectedExtract.extract.timestamp)}
                                    </span>
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                  {selectedExtract.extract.instruction}
                                </p>
                              </CardHeader>
                              <CardContent>
                                <div className="space-y-4">
                                  {selectedExtract.extract.extractedData && typeof selectedExtract.extract.extractedData === 'string' ? (
                                    <div className="bg-muted/50 rounded-lg p-4">
                                      <MarkdownViewer 
                                        markdown={selectedExtract.extract.extractedData}
                                        className="text-xs"
                                      />
                                    </div>
                                  ) : selectedExtract.extract.extractedData && typeof selectedExtract.extract.extractedData === 'object' ? (
                                    // Legacy format support
                                    <div className="space-y-6">
                                      {Object.entries(selectedExtract.extract.extractedData).map(([key, value]) => (
                                        <div key={key} className="border-l-2 border-primary/20 pl-4">
                                          <h4 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
                                            <Hash className="w-3 h-3" />
                                            {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                          </h4>
                                          <div className="bg-muted/50 rounded-lg p-4">
                                            <pre className="text-xs bg-background p-3 rounded overflow-x-auto">
                                              {JSON.stringify(value, null, 2)}
                                            </pre>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="bg-muted/50 rounded-lg p-6 text-center">
                                      <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                                      <p className="text-sm text-muted-foreground">
                                        No structured data extracted
                                      </p>
                                    </div>
                                  )}
                                  
                                  {selectedExtract.extract.elementsFound && selectedExtract.extract.elementsFound.length > 0 && (
                                    <div className="pt-4 border-t">
                                      <Label className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                                        <List className="w-3 h-3" />
                                        Elements Found
                                      </Label>
                                      <div className="flex flex-wrap gap-1 mt-2">
                                        {selectedExtract.extract.elementsFound.map((element, i) => (
                                          <Badge key={i} variant="secondary" className="text-xs">
                                            {element}
                                          </Badge>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })()}
                      </div>
                    </TabsContent>

                    {/* Screenshots Tab */}
                    <TabsContent value="screenshots" className="flex-1 overflow-auto p-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {getPageScreenshots(selectedPage.urlHash).map((screenshot, index) => (
                          <div
                            key={index}
                            className="group relative cursor-pointer"
                            onClick={() => setSelectedScreenshot(screenshot)}
                          >
                            <div className="aspect-video rounded-lg overflow-hidden border border-border bg-muted">
                              <img
                                src={`data:image/png;base64,${screenshot.screenshotBase64}`}
                                alt={screenshot.action}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                                <Maximize2 className="w-6 h-6 text-white" />
                              </div>
                            </div>
                            <div className="mt-2 space-y-1">
                              <div className="flex items-center justify-between">
                                <Badge variant="outline" className="text-xs">
                                  Step {screenshot.stepNumber}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {formatTime(screenshot.timestamp)}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-1">
                                {screenshot.action}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </TabsContent>

                    {/* Decisions Tab */}
                    <TabsContent value="decisions" className="flex-1 overflow-auto p-4">
                      <div className="space-y-4">
                        {getPageDecisions(selectedPage.urlHash).map((decision, index) => (
                          <Card key={index}>
                            <CardHeader className="pb-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {getToolIcon(decision.decision.tool)}
                                  <CardTitle className="text-sm">
                                    {decision.decision.tool}
                                  </CardTitle>
                                  <Badge variant="outline" className="text-xs">
                                    Step {decision.stepNumber}
                                  </Badge>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {formatTime(decision.timestamp)}
                                </span>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div>
                                <Label className="text-xs text-muted-foreground">Instruction</Label>
                                <p className="text-xs mt-1 p-2 bg-muted rounded">
                                  {decision.decision.instruction}
                                </p>
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">Reasoning</Label>
                                <p className="text-xs mt-1 text-muted-foreground">
                                  {decision.decision.reasoning}
                                </p>
                              </div>
                              {decision.maxPagesReached && (
                                <Badge variant="destructive" className="text-xs">
                                  <AlertCircle className="w-3 h-3 mr-1" />
                                  Max pages reached
                                </Badge>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </TabsContent>

                    {/* Tool Results Tab */}
                    <TabsContent value="tools" className="flex-1 overflow-auto p-4">
                      <Tabs defaultValue="observe" className="h-full">
                        <TabsList className="grid w-full grid-cols-3 h-8">
                          <TabsTrigger value="observe" className="text-xs">Observe</TabsTrigger>
                          <TabsTrigger value="extract" className="text-xs">Extract</TabsTrigger>
                          <TabsTrigger value="act" className="text-xs">Act</TabsTrigger>
                        </TabsList>
                        
                        <TabsContent value="observe" className="mt-4 space-y-3">
                          {getPageToolResults(selectedPage.urlHash).observe.map((result, index) => (
                            <Card key={index}>
                              <CardContent className="pt-4 space-y-2">
                                <div className="flex items-center justify-between mb-2">
                                  <Badge variant="outline" className="text-xs">
                                    Step {result.stepNumber}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {formatTime(result.timestamp)}
                                  </span>
                                </div>
                                <div className="space-y-2">
                                  <div>
                                    <Label className="text-xs text-muted-foreground">Visible Elements</Label>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {result.visibleElements.slice(0, 5).map((el, i) => (
                                        <Badge key={i} variant="secondary" className="text-xs">
                                          {el}
                                        </Badge>
                                      ))}
                                      {result.visibleElements.length > 5 && (
                                        <Badge variant="outline" className="text-xs">
                                          +{result.visibleElements.length - 5} more
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </TabsContent>
                        
                        <TabsContent value="act" className="mt-4 space-y-3">
                          {getPageToolResults(selectedPage.urlHash).act.map((result, index) => (
                            <Card key={index}>
                              <CardContent className="pt-4 space-y-2">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">
                                      Step {result.stepNumber}
                                    </Badge>
                                    {result.actionSuccess ? (
                                      <Badge variant="default" className="text-xs">Success</Badge>
                                    ) : (
                                      <Badge variant="destructive" className="text-xs">Failed</Badge>
                                    )}
                                  </div>
                                  <span className="text-xs text-muted-foreground">
                                    {formatTime(result.timestamp)}
                                  </span>
                                </div>
                                <div>
                                  <Label className="text-xs text-muted-foreground">Action</Label>
                                  <p className="text-xs mt-1">{result.instruction}</p>
                                </div>
                                {result.urlChanged && (
                                  <div>
                                    <Label className="text-xs text-muted-foreground">New URL Discovered</Label>
                                    <p className="text-xs mt-1 text-primary">{result.newUrl}</p>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          ))}
                        </TabsContent>
                      </Tabs>
                    </TabsContent>

                    {/* Timeline Tab */}
                    <TabsContent value="timeline" className="flex-1 overflow-auto p-4">
                      <div className="relative">
                        <div className="absolute left-4 top-0 bottom-0 w-px bg-border"></div>
                        <div className="space-y-4">
                          {[...getPageDecisions(selectedPage.urlHash), ...getPageScreenshots(selectedPage.urlHash)]
                            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                            .map((item, index) => (
                              <div key={index} className="flex gap-4">
                                <div className="w-8 h-8 rounded-full bg-card border-2 border-primary flex items-center justify-center">
                                  {'decision' in item ? getToolIcon(item.decision.tool) : <Camera className="w-3 h-3" />}
                                </div>
                                <div className="flex-1 pb-4">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-medium">
                                      {'decision' in item ? item.decision.tool : 'Screenshot'}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {formatTime(item.timestamp)}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {'decision' in item ? item.decision.instruction : item.action}
                                  </p>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center space-y-2">
                  <Globe className="w-8 h-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Select a page to view details
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Configuration Dialog */}
        <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle className="text-lg flex items-center gap-2">
                <Bot className="w-5 h-5 text-primary" />
                Configure AI Agent
              </DialogTitle>
              <DialogDescription className="text-sm">
                Set up your web exploration parameters
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="userName" className="text-sm">Agent Name</Label>
                <Input
                  id="userName"
                  value={config.userName}
                  onChange={(e) => setConfig(prev => ({ ...prev, userName: e.target.value }))}
                  className="text-sm h-9"
                  placeholder="Your email id"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="startUrl" className="text-sm">Target URL</Label>
                <Input
                  id="startUrl"
                  value={config.startUrl}
                  onChange={(e) => setConfig(prev => ({ ...prev, startUrl: e.target.value }))}
                  className="text-sm h-9"
                  placeholder="https://example.com"
                />
              </div>
              
              {!config.isExploration && (
                <div className="space-y-2">
                  <Label htmlFor="objective" className="text-sm">Mission Objective</Label>
                  <Textarea
                    id="objective"
                    value={config.objective}
                    onChange={(e) => setConfig(prev => ({ ...prev, objective: e.target.value }))}
                    rows={3}
                    className="text-sm resize-none"
                    placeholder="Describe what the AI should explore or find..."
                  />
                </div>
              )}
              
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="exploration-mode" className="text-sm">Exploration Mode</Label>
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

              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="can-login" className="text-sm">Can Login</Label>
                  <p className="text-xs text-muted-foreground">
                    {config.canLogin 
                      ? 'Allow agent to request login credentials for normal email/password forms (no Google/Facebook login)' 
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

              <div className="space-y-2">
                <Label htmlFor="additional-context" className="text-sm">Additional Context <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea
                  id="additional-context"
                  value={config.additionalContext || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, additionalContext: e.target.value }))}
                  rows={2}
                  className="text-sm resize-none"
                  placeholder="Provide additional context, preferences, or special instructions for the AI agent..."
                />
              </div>
              
              <div className="flex items-center justify-between">
                <Label htmlFor="maxPages" className="text-sm">Max Pages to Explore</Label>
                <Input
                  id="maxPages"
                  type="number"
                  value={config.maxPagesToExplore}
                  onChange={(e) => setConfig(prev => ({ ...prev, maxPagesToExplore: parseInt(e.target.value) || 6 }))}
                  className="w-20 text-sm h-9"
                  min="1"
                  max="20"
                />
              </div>
            </div>
            
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConfigDialog(false)}
                className="text-sm"
              >
                Cancel
              </Button>
              <Button
                onClick={handleStartExploration}
                disabled={!isConnected || !config.userName || !config.startUrl || (!config.isExploration && !config.objective)}
                className="text-sm gap-2"
              >
                <Play className="w-3 h-3" />
                Start Exploration
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* All Extracts Dialog - Also with Version Management */}
        <Dialog open={showAllExtractsDialog} onOpenChange={setShowAllExtractsDialog}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="text-lg flex items-center gap-2">
                <Database className="w-5 h-5 text-primary" />
                All Extracted Data
              </DialogTitle>
              <DialogDescription className="text-sm">
                Combined extract results from all explored pages
              </DialogDescription>
            </DialogHeader>
            
            <ScrollArea className="h-[60vh] mt-4">
              <div className="space-y-4">
                {(() => {
                  const allExtracts = getAllExtractResults();
                  
                  // Group by URL
                  const groupedByUrl = allExtracts.reduce((acc, extract) => {
                    const url = extract.url;
                    if (!acc[url]) {
                      acc[url] = [];
                    }
                    acc[url].push(extract);
                    return acc;
                  }, {} as Record<string, PageExtractResult[]>);
                  
                  if (Object.keys(groupedByUrl).length === 0) {
                    return (
                      <div className="text-center py-8">
                        <FileText className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-50" />
                        <p className="text-sm text-muted-foreground">
                          No extract data available yet
                        </p>
                      </div>
                    );
                  }
                  
                  return Object.entries(groupedByUrl).map(([url, extracts]) => {
                    // Sort by version descending (latest first)
                    const sortedExtracts = extracts.sort((a, b) => (b.version || 0) - (a.version || 0));
                    const latestExtract = sortedExtracts[0];
                    
                    return (
                      <Card key={url}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="text-sm flex items-center gap-2">
                                <Link2 className="w-3 h-3" />
                                {url}
                              </CardTitle>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="text-xs">
                                  Step {latestExtract.stepNumber}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {formatTime(latestExtract.timestamp)}
                                </span>
                              </div>
                            </div>
                            {sortedExtracts.length > 1 && (
                              <Badge variant="secondary" className="text-xs">
                                {sortedExtracts.length} versions
                              </Badge>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">Instruction</Label>
                            <p className="text-xs mt-1 p-2 bg-muted rounded">
                              {latestExtract.instruction}
                            </p>
                          </div>
                          
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <Label className="text-xs text-muted-foreground">Extracted Data</Label>
                              {latestExtract.version && latestExtract.totalVersions && (
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs">
                                    Latest: v{latestExtract.version}/{latestExtract.totalVersions}
                                  </Badge>
                                  {latestExtract.isNewVersion && (
                                    <Badge variant="default" className="text-xs flex items-center gap-1">
                                      <Bell className="w-3 h-3" />
                                      New
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="mt-1 p-3 bg-muted rounded max-h-64 overflow-y-auto">
                              {latestExtract.extractedData && typeof latestExtract.extractedData === 'string' ? (
                                <MarkdownViewer 
                                  markdown={latestExtract.extractedData}
                                  className="text-xs"
                                />
                              ) : latestExtract.extractedData && typeof latestExtract.extractedData === 'object' && Object.keys(latestExtract.extractedData).length > 0 ? (
                                // Legacy format support
                                <div className="space-y-4">
                                  {Object.entries(latestExtract.extractedData).map(([key, value]) => (
                                    <div key={key} className="border-b border-border/30 pb-3 last:border-b-0 last:pb-0">
                                      <h4 className="text-sm font-medium text-primary mb-2 capitalize">
                                        {key.replace(/_/g, ' ')}
                                      </h4>
                                      <pre className="text-xs bg-background p-2 rounded overflow-x-auto">
                                        {JSON.stringify(value, null, 2)}
                                      </pre>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">No data extracted</p>
                              )}
                            </div>
                          </div>
                          
                          {latestExtract.elementsFound && latestExtract.elementsFound.length > 0 && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Elements Found</Label>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {latestExtract.elementsFound.map((element, i) => (
                                  <Badge key={i} variant="secondary" className="text-xs">
                                    {element}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  });
                })()}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* Screenshot Preview Dialog */}
        {selectedScreenshot && (
          <Dialog open={!!selectedScreenshot} onOpenChange={() => setSelectedScreenshot(null)}>
            <DialogContent className="max-w-6xl w-[90vw] h-[90vh] p-0 flex flex-col">
              <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
                <DialogTitle className="text-sm flex items-center justify-between">
                  <span>Screenshot - Step {selectedScreenshot.stepNumber}</span>
                  <Badge variant="outline" className="text-xs">
                    {selectedScreenshot.action}
                  </Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="flex-1 overflow-auto p-6">
                <img
                  src={`data:image/png;base64,${selectedScreenshot.screenshotBase64}`}
                  alt={selectedScreenshot.action}
                  className="w-full h-auto rounded-lg shadow-lg block"
                />
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* User Input Dialog */}
        <UserInputDialog
          isOpen={!!explorationState.userInputRequest}
          onClose={() => {
            // Handle cancellation - this would stop the exploration
            if (explorationState.userInputRequest && config.userName) {
              stopExploration(config.userName);
            }
          }}
          userInputRequest={explorationState.userInputRequest}
          onSubmit={submitUserInput}
        />
      </div>
    </TooltipProvider>
  );
}