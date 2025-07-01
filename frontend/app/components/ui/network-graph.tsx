import React, { useCallback, useMemo } from 'react';
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
  Square, Circle, Globe, Info, ZoomIn, ZoomOut, Maximize 
} from 'lucide-react';
import type { InteractionGraph, GraphNode as GraphNodeType, GraphEdge, GraphNode } from '../../types/exploration';
import { Separator } from './separator';

interface NetworkGraphProps {
  graph: InteractionGraph;
  className?: string;
}

const getNodeColor = (type: string) => {
  switch (type) {
    case 'button': return { bg: '#3b82f6', border: '#2563eb', text: '#ffffff' };
    case 'link': return { bg: '#22c55e', border: '#16a34a', text: '#ffffff' };
    case 'input': return { bg: '#a855f7', border: '#9333ea', text: '#ffffff' };
    case 'dropdown': return { bg: '#f97316', border: '#ea580c', text: '#ffffff' };
    case 'toggle': return { bg: '#ec4899', border: '#db2777', text: '#ffffff' };
    case 'tab': return { bg: '#6366f1', border: '#4f46e5', text: '#ffffff' };
    case 'section': return { bg: '#6b7280', border: '#4b5563', text: '#ffffff' };
    case 'dialog': return { bg: '#f59e0b', border: '#d97706', text: '#ffffff' };
    case 'state': return { bg: '#14b8a6', border: '#0d9488', text: '#ffffff' };
    case 'navigation_target': return { bg: '#ef4444', border: '#dc2626', text: '#ffffff' };
    default: return { bg: '#6b7280', border: '#4b5563', text: '#ffffff' };
  }
};

const getNodeIcon = (type: string) => {
  switch (type) {
    case 'button': return '🔘';
    case 'link': return '🔗';
    case 'input': return '📝';
    case 'dropdown': return '📋';
    case 'toggle': return '🔄';
    case 'tab': return '📑';
    case 'dialog': return '💬';
    case 'state': return '⚙️';
    case 'section': return '📦';
    case 'navigation_target': return '🎯';
    default: return '⚪';
  }
};

// Custom Node Component with Handles
const CustomNode = ({ data, isConnectable }: {
  data: GraphNode;
  isConnectable: boolean
}) => {
  const colors = getNodeColor(data.type);
  
  return (
    <div 
      className="relative"
      style={{ 
        minWidth: '180px',
        maxWidth: '220px'
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={isConnectable}
        style={{
          background: colors.border,
          width: 8,
          height: 8,
          border: '2px solid #fff'
        }}
      />
      
      <div 
        className="px-4 py-3 shadow-lg rounded-lg border-2 transition-all hover:shadow-xl"
        style={{ 
          borderColor: colors.border,
          backgroundColor: colors.bg,
          color: colors.text
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">{getNodeIcon(data.type)}</span>
          <div className="font-bold text-sm truncate" style={{ color: colors.text }}>
            {data.label}
          </div>
        </div>
        <div className="text-xs opacity-90 leading-relaxed">
          {data.description}
        </div>
        <div className="mt-2">
          <Badge 
            className="text-xs px-2 py-0"
            style={{ 
              backgroundColor: 'rgba(255,255,255,0.2)',
              color: colors.text,
              borderColor: 'rgba(255,255,255,0.3)'
            }}
          >
            {data.type}
          </Badge>
        </div>
      </div>
      
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={isConnectable}
        style={{
          background: colors.border,
          width: 8,
          height: 8,
          border: '2px solid #fff'
        }}
      />
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

// Edge label component
const EdgeLabel = ({ label }: { label: string }) => (
  <div className="px-2 py-1 bg-white rounded-md shadow-md border border-gray-200">
    <span className="text-xs font-medium text-gray-700">{label}</span>
  </div>
);

export function NetworkGraph({ graph, className = '' }: NetworkGraphProps) {
  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  // Convert graph data to React Flow format with proper layout
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    // Calculate layout positions
    const nodesByType: { [key: string]: GraphNodeType[] } = {};
    graph.nodes.forEach(node => {
      if (!nodesByType[node.type]) {
        nodesByType[node.type] = [];
      }
      nodesByType[node.type].push(node);
    });

    // Create nodes with better positioning
    const nodes: Node[] = [];
    let yOffset = 0;
    
    Object.entries(nodesByType).forEach(([type, typeNodes]) => {
      typeNodes.forEach((node, index) => {
        const xOffset = (index % 3) * 300 + 100;
        const yPos = yOffset + Math.floor(index / 3) * 200;
        
        nodes.push({
          id: node.id,
          type: 'custom',
          position: node.position || { x: xOffset, y: yPos },
          data: {
            label: node.label,
            description: node.description,
            type: node.type,
            actionable: node.actionable,
          },
          draggable: true,
        });
      });
      yOffset += Math.ceil(typeNodes.length / 3) * 200 + 100;
    });

    // Create edges with proper configuration
    const edges: Edge[] = graph.edges.map((edge: GraphEdge, index: number) => ({
      id: `${edge.from}-${edge.to}-${index}`,
      source: edge.from,
      target: edge.to,
      type: 'smoothstep',
      animated: true,
      label: edge.action,
      labelStyle: { 
        fontSize: 11, 
        fontWeight: 600,
        fill: '#374151',
        backgroundColor: 'white',
        padding: '2px 6px',
        borderRadius: '4px',
        border: '1px solid #e5e7eb'
      },
      labelBgStyle: {
        fill: 'white',
        fillOpacity: 0.9
      },
      style: { 
        stroke: '#3b82f6', 
        strokeWidth: 2
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#3b82f6',
        width: 20,
        height: 20
      },
    }));

    return { nodes, edges };
  }, [graph]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: any) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges],
  );

  // Re-initialize nodes and edges when graph changes
  React.useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Graph Info Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm">Page Interaction Flow</CardTitle>
            </div>
            <Badge variant="outline" className="text-xs">
              Updated {formatTime(graph.lastUpdated)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <p className="font-medium mb-1">Elements</p>
              <p className="text-muted-foreground">{graph.nodes.length} components</p>
            </div>
            <div>
              <p className="font-medium mb-1">Connections</p>
              <p className="text-muted-foreground">{graph.edges.length} relationships</p>
            </div>
            <div>
              <p className="font-medium mb-1">Page URL</p>
              <p className="text-muted-foreground truncate">{graph.pageUrl || 'N/A'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Network Graph */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4" />
              <CardTitle className="text-sm">Interactive Network Map</CardTitle>
            </div>
            <div className="text-xs text-muted-foreground">
              Drag to pan • Scroll to zoom • Click and drag nodes
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[600px] border-t">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              connectionLineType={ConnectionLineType.SmoothStep}
              fitView
              fitViewOptions={{
                padding: 0.2,
                includeHiddenNodes: false,
                minZoom: 0.5,
                maxZoom: 1.5
              }}
              minZoom={0.3}
              maxZoom={2}
              defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background 
                variant={BackgroundVariant.Dots} 
                gap={20} 
                size={1}
                color="#e5e7eb"
              />
              <Controls 
                className="bg-white border border-gray-200 rounded-lg shadow-md"
                showInteractive={false}
              />
              <MiniMap 
                className="bg-white border border-gray-200 rounded-lg shadow-md"
                maskColor="rgba(0, 0, 0, 0.1)"
                // @ts-ignore
                nodeColor={(node) => getNodeColor(node.data["type"] || 'default').bg}
                pannable
                zoomable
              />
              
              {/* Legend Panel */}
              <Panel position="top-right" className="bg-white/95 backdrop-blur p-3 rounded-lg border border-gray-200 shadow-md">
                <div className="space-y-2">
                  <div className="font-medium text-xs mb-2">Element Types:</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {[
                      { icon: '🔘', label: 'Button', type: 'button' },
                      { icon: '🔗', label: 'Link', type: 'link' },
                      { icon: '📝', label: 'Input', type: 'input' },
                      { icon: '📋', label: 'Dropdown', type: 'dropdown' },
                      { icon: '💬', label: 'Dialog', type: 'dialog' },
                      { icon: '⚙️', label: 'State', type: 'state' },
                    ].map(item => (
                      <div key={item.type} className="flex items-center gap-1.5">
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            </ReactFlow>
          </div>
        </CardContent>
      </Card>

      {/* Page Summary */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm">Page Summary</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <h4 className="text-xs font-medium mb-1 text-muted-foreground">Page Analysis</h4>
            <p className="text-xs">
              {graph.pageSummary}
            </p>
          </div>
          <Separator />
          <div>
            <h4 className="text-xs font-medium mb-1 text-muted-foreground">Technical Overview</h4>
            <p className="text-xs text-muted-foreground">
              {graph.description}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}