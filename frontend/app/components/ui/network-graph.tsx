import React, { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  addEdge,
  ConnectionLineType,
  Panel,
  useNodesState,
  useEdgesState,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Badge } from './badge';
import { Button } from './button';
import { 
  Network, MousePointer, Link2, ToggleLeft, FileText, 
  Square, Circle, Globe, Info, ZoomIn, ZoomOut, Maximize,
  Play, Pause, RotateCcw, Eye, EyeOff
} from 'lucide-react';
import type { InteractionGraph, ImageNode, ImageEdge, FlowDefinition } from '../../types/exploration';
import { Separator } from './separator';

interface NetworkGraphProps {
  graph: InteractionGraph;
  className?: string;
}

const getFlowColor = (flowType: string) => {
  switch (flowType) {
    case 'linear': return { bg: '#3b82f6', border: '#2563eb', text: '#ffffff' };
    case 'branching': return { bg: '#22c55e', border: '#16a34a', text: '#ffffff' };
    case 'circular': return { bg: '#f97316', border: '#ea580c', text: '#ffffff' };
    default: return { bg: '#6b7280', border: '#4b5563', text: '#ffffff' };
  }
};

const getFlowIcon = (flowType: string) => {
  switch (flowType) {
    case 'linear': return '➡️';
    case 'branching': return '🔀';
    case 'circular': return '🔄';
    default: return '🔗';
  }
};

// Custom Image Node Component
const ImageNode = ({ data, isConnectable }: {
  data: ImageNode;
  isConnectable: boolean
}) => {
  const [imageError, setImageError] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  
  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div 
      className="relative group"
      style={{ 
        minWidth: '200px',
        maxWidth: '300px'
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={isConnectable}
        style={{
          background: '#3b82f6',
          width: 10,
          height: 10,
          border: '2px solid #fff'
        }}
      />
      
      <Card className="shadow-lg hover:shadow-xl transition-all border-2 border-blue-200 hover:border-blue-400">
        <CardHeader className="p-3 pb-2">
          <div className="flex items-center justify-between">
            <Badge variant="secondary" className="text-xs">
              Step {data.stepNumber}
            </Badge>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-6 w-6 p-0"
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </Button>
          </div>
          <CardTitle className="text-sm font-semibold text-gray-800 leading-tight">
            {data.instruction}
          </CardTitle>
        </CardHeader>
        
        <CardContent className="p-3 pt-0">
          {/* Screenshot Image */}
          <div className="relative mb-3 rounded-lg overflow-hidden border border-gray-200">
            {!imageError ? (
              <img 
                src={data.imageData}
                alt={`Screenshot for ${data.instruction}`}
                className="w-full h-32 object-cover object-top hover:h-48 transition-all duration-300"
                onError={() => setImageError(true)}
                style={{ maxHeight: showDetails ? '200px' : '128px' }}
              />
            ) : (
              <div className="w-full h-32 bg-gray-100 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <Square className="h-8 w-8 mx-auto mb-2" />
                  <span className="text-xs">Image unavailable</span>
                </div>
              </div>
            )}
          </div>

          {/* Flow Badges */}
          <div className="flex flex-wrap gap-1 mb-2">
            {(data.metadata?.flowsConnected || []).map((flowId) => (
              <Badge 
                key={flowId} 
                variant="outline" 
                className="text-xs px-2 py-0 bg-blue-50 text-blue-700 border-blue-200"
              >
                {flowId.replace('_', ' ')}
              </Badge>
            ))}
          </div>

          {/* Detailed Information */}
          {showDetails && (
            <div className="space-y-2 text-xs text-gray-600">
              <Separator />
              
              <div>
                <strong>Time:</strong> {formatTime(data.metadata?.timestamp || new Date().toISOString())}
              </div>
              
              {(data.metadata?.dialogsOpen || []).length > 0 && (
                <div>
                  <strong>Dialogs:</strong> {(data.metadata?.dialogsOpen || []).join(', ')}
                </div>
              )}
              
              <div>
                <strong>Visible Elements:</strong>
                <div className="mt-1 max-h-20 overflow-y-auto">
                  {(data.metadata?.visibleElements || []).slice(0, 3).map((element, idx) => (
                    <div key={idx} className="text-xs text-gray-500">• {element}</div>
                  ))}
                  {(data.metadata?.visibleElements || []).length > 3 && (
                    <div className="text-xs text-gray-400">
                      +{(data.metadata?.visibleElements || []).length - 3} more...
                    </div>
                  )}
                </div>
              </div>
              
              <div>
                <strong>Interactive:</strong>
                <div className="mt-1 max-h-16 overflow-y-auto">
                  {(data.metadata?.clickableElements || []).slice(0, 2).map((element, idx) => (
                    <div key={idx} className="text-xs text-gray-500">• {element}</div>
                  ))}
                  {(data.metadata?.clickableElements || []).length > 2 && (
                    <div className="text-xs text-gray-400">
                      +{(data.metadata?.clickableElements || []).length - 2} more...
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={isConnectable}
        style={{
          background: '#3b82f6',
          width: 10,
          height: 10,
          border: '2px solid #fff'
        }}
      />
    </div>
  );
};

const nodeTypes = {
  imageNode: ImageNode,
};

// Edge label component with action information
const ActionEdgeLabel = ({ label, instruction }: { label: string; instruction: string }) => (
  <div className="px-2 py-1 bg-white rounded-md shadow-md border border-gray-200 max-w-40">
    <div className="text-xs font-medium text-gray-700 truncate">{label}</div>
    <div className="text-xs text-gray-500 truncate">{instruction}</div>
  </div>
);

export function NetworkGraph({ graph, className = '' }: NetworkGraphProps) {
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null);
  const [showAllFlows, setShowAllFlows] = useState(true);

  console.log('Graph Data:', graph);

  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  // Convert graph data to React Flow format with flow-based layout
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    // Group nodes by flows for better layout
    const flowGroups: { [flowId: string]: ImageNode[] } = {};
    const unassignedNodes: ImageNode[] = [];

    graph.nodes.forEach(node => {
      if ((node.metadata?.flowsConnected || []).length > 0) {
        (node.metadata?.flowsConnected || []).forEach(flowId => {
          if (!flowGroups[flowId]) {
            flowGroups[flowId] = [];
          }
          flowGroups[flowId].push(node);
        });
      } else {
        unassignedNodes.push(node);
      }
    });

    // Create nodes with flow-based positioning
    const nodes: Node[] = [];
    let flowYOffset = 0;
    
    // Position nodes by flow
    Object.entries(flowGroups).forEach(([flowId, flowNodes]) => {
      const flow = graph.flows?.find(f => f.id === flowId);
      const isSelectedFlow = selectedFlow === flowId || showAllFlows;
      
      if (!isSelectedFlow) return;

      flowNodes.forEach((node, index) => {
        const xOffset = index * 350 + 100;
        const yPos = flowYOffset + 50;
        
                 nodes.push({
           id: node.id,
           type: 'imageNode',
           position: node.position || { x: xOffset, y: yPos },
           data: node as any,
           draggable: true,
           hidden: !isSelectedFlow,
         });
      });
      
      flowYOffset += 400; // Space between flows
    });

    // Add unassigned nodes
    if (unassignedNodes.length > 0 && (selectedFlow === null || showAllFlows)) {
      unassignedNodes.forEach((node, index) => {
        const xOffset = (index % 4) * 350 + 100;
        const yPos = flowYOffset + Math.floor(index / 4) * 300 + 50;
        
                 nodes.push({
           id: node.id,
           type: 'imageNode',
           position: node.position || { x: xOffset, y: yPos },
           data: node as any,
           draggable: true,
         });
      });
    }

    // Create edges with flow filtering
    const edges: Edge[] = graph.edges
      .filter(edge => {
        if (showAllFlows) return true;
        if (!selectedFlow) return true;
        return edge.flowId === selectedFlow;
      })
      .map((edge: ImageEdge, index: number) => ({
        id: `${edge.from}-${edge.to}-${index}`,
        source: edge.from,
        target: edge.to,
        type: 'smoothstep',
        animated: true,
        style: { 
          stroke: edge.flowId ? getFlowColor(
            graph.flows?.find(f => f.id === edge.flowId)?.flowType || 'linear'
          ).border : '#6b7280',
          strokeWidth: 2
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edge.flowId ? getFlowColor(
            graph.flows?.find(f => f.id === edge.flowId)?.flowType || 'linear'
          ).border : '#6b7280',
        },
        label: edge.action,
        labelStyle: { fontSize: 12, fontWeight: 600 },
        labelBgPadding: [8, 4],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
      }));

    return { nodes, edges };
  }, [graph, selectedFlow, showAllFlows]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when graph or flow selection changes
  React.useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className={`h-full w-full ${className}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        attributionPosition="bottom-left"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
        <MiniMap 
          nodeStrokeColor="#3b82f6"
          nodeColor="#e2e8f0"
          nodeBorderRadius={8}
          style={{ background: '#f8fafc' }}
        />
        
        {/* Flow Control Panel */}
        <Panel position="top-right" className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border p-4 max-w-80">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Visual Flow Diagram</h3>
              <Badge variant="secondary">{graph.nodes.length} states</Badge>
            </div>
            
            <Separator />
            
            {/* Flow Filter Controls */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Flows</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllFlows(!showAllFlows)}
                  className="h-7 px-2"
                >
                  {showAllFlows ? 'Filter' : 'Show All'}
                </Button>
              </div>
              
              {graph.flows && graph.flows.length > 0 ? (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {graph.flows.map((flow) => {
                    const colors = getFlowColor(flow.flowType);
                    const isSelected = selectedFlow === flow.id;
                    
                    return (
                      <Button
                        key={flow.id}
                        variant={isSelected ? "default" : "ghost"}
                        size="sm"
                        className="w-full justify-start h-8 px-2"
                        style={isSelected ? { backgroundColor: colors.bg, borderColor: colors.border } : {}}
                        onClick={() => setSelectedFlow(isSelected ? null : flow.id)}
                      >
                        <span className="mr-2">{getFlowIcon(flow.flowType)}</span>
                        <div className="flex flex-col items-start flex-1 min-w-0">
                          <span className="text-xs font-medium truncate w-full">
                            {flow.name}
                          </span>
                          <span className="text-xs opacity-70 truncate w-full">
                            {flow.imageNodes.length} states
                          </span>
                        </div>
                      </Button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-gray-500 text-center py-2">
                  No flows detected yet
                </div>
              )}
            </div>
            
            <Separator />
            
            {/* Summary Information */}
            <div className="text-xs text-gray-600 space-y-1">
              <div>
                <strong>Last Updated:</strong> {formatTime(graph.lastUpdated)}
              </div>
              {graph.flows && (
                <div>
                  <strong>Total Flows:</strong> {graph.flows.length}
                </div>
              )}
              <div>
                <strong>Connections:</strong> {graph.edges.length}
              </div>
            </div>
          </div>
        </Panel>
      </ReactFlow>
         </div>
   );
 }