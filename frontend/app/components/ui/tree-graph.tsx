import React, { useCallback, useMemo, useState, useEffect } from "react";
import {
  ReactFlow,
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
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";

import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Badge } from "./badge";
import { Button } from "./button";
import {
  MousePointer,
  Square,
  Circle,
  X,
  ArrowRight,
  ArrowDown,
  CheckCircle,
  Clock,
  Activity,
  Expand,
  GitBranch,
  TreePine,
  Play,
  Pause,
} from "lucide-react";
import type { TreeStructure, TreeNode } from "../../types/exploration";
import { Separator } from "./separator";
import { ScrollArea } from "./scroll-area";
import { cn } from "../../lib/utils";

interface TreeGraphProps {
  treeStructure: TreeStructure;
  className?: string;
}

// Node dimensions
const nodeWidth = 300;
const nodeHeight = 80;

const getActionTypeColor = (actionType: string, completed: boolean) => {
  const baseColors = {
    click: { bg: "#3b82f6", border: "#2563eb", text: "#ffffff" },
    hover: { bg: "#f59e0b", border: "#d97706", text: "#ffffff" },
    scroll: { bg: "#8b5cf6", border: "#7c3aed", text: "#ffffff" },
    nothing: { bg: "#6b7280", border: "#4b5563", text: "#ffffff" },
  };

  const color = baseColors[actionType as keyof typeof baseColors] || baseColors.nothing;
  
  if (completed) {
    return {
      ...color,
      bg: "#22c55e",
      border: "#16a34a",
    };
  }
  
  return color;
};

const getActionTypeIcon = (actionType: string) => {
  switch (actionType) {
    case "click":
      return <MousePointer className="w-4 h-4" />;
    case "hover":
      return <Activity className="w-4 h-4" />;
    case "scroll":
      return <Square className="w-4 h-4" />;
    case "nothing":
      return <Circle className="w-4 h-4" />;
    default:
      return <Square className="w-4 h-4" />;
  }
};

// Custom node data types
interface TreeNodeData extends Record<string, unknown> {
  id: string;
  completed: boolean;
  action: string;
  actionType: "hover" | "click" | "scroll" | "nothing";
  children: TreeNode[];
  hasChildren?: boolean;
  childrenCount?: number;
  depth?: number;
  nodeType: "treeNode";
  isCurrentNode: boolean;
}

// Tree Node Component
const TreeNodeComponent: React.FC<NodeProps> = ({ data, isConnectable }) => {
  const nodeData = data as TreeNodeData;
  const colors = getActionTypeColor(nodeData.actionType, nodeData.completed);
  const icon = getActionTypeIcon(nodeData.actionType);

  return (
    <div className="relative group cursor-pointer">
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={isConnectable}
        className="opacity-0"
        style={{
          background: colors.border,
          width: 8,
          height: 8,
        }}
      />

      <div
        className={cn(
          "w-[300px] h-[80px] rounded-lg border-2 shadow-lg transition-all duration-200 p-3 flex items-center gap-3",
          nodeData.isCurrentNode
            ? "ring-4 ring-yellow-400/50 border-yellow-400"
            : "hover:shadow-xl"
        )}
        style={{
          backgroundColor: colors.bg,
          borderColor: colors.border,
          color: colors.text,
        }}
      >
        {/* Status Icon */}
        <div className="flex-shrink-0">
          {nodeData.completed ? (
            <CheckCircle className="w-6 h-6 text-white" />
          ) : (
            <Clock className="w-6 h-6 text-white/70" />
          )}
        </div>

        {/* Action Type Icon */}
        <div className="flex-shrink-0 opacity-70">{icon}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            {nodeData.action || "Root Node"}
          </div>
          <div className="text-xs opacity-70 capitalize">
            {nodeData.actionType}
            {nodeData.isCurrentNode && " (Current)"}
          </div>
        </div>

        {/* Children Count */}
        {nodeData.children.length > 0 && (
          <div className="flex-shrink-0">
            <Badge
              variant="outline"
              className="text-xs border-white/30 text-white/90"
            >
              {nodeData.children.length}
            </Badge>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={isConnectable}
        className="opacity-0"
        style={{
          background: colors.border,
          width: 8,
          height: 8,
        }}
      />
    </div>
  );
};

const nodeTypes = {
  treeNode: TreeNodeComponent,
};

// Dagre layout function
const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  direction = "TB"
) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === "LR";
  dagreGraph.setGraph({ rankdir: direction, nodesep: 80, ranksep: 120 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);

    const newNode: Node = {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };

    return newNode;
  });

  return { nodes: newNodes, edges };
};

// Convert tree structure to React Flow format
const convertTreeToFlowData = (
  treeStructure: TreeNode,
  currentNodeId: string | null
): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const traverse = (node: TreeNode, parentId?: string) => {
    const isCurrentNode = node.id === currentNodeId;
    
    // Add node
    nodes.push({
      id: node.id,
      type: "treeNode",
      position: { x: 0, y: 0 }, // Will be set by dagre
      data: {
        ...node,
        nodeType: "treeNode" as const,
        isCurrentNode,
      },
      draggable: true,
    });

    // Add edge from parent to this node
    if (parentId) {
      edges.push({
        id: `edge-${parentId}-${node.id}`,
        source: parentId,
        target: node.id,
        animated: isCurrentNode,
        style: {
          stroke: isCurrentNode ? "#fbbf24" : "#6b7280",
          strokeWidth: isCurrentNode ? 3 : 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: isCurrentNode ? "#fbbf24" : "#6b7280",
        },
      });
    }

    // Recursively process children
    if (node.children && node.children.length > 0) {
      node.children.forEach((child) => {
        traverse(child, node.id);
      });
    }
  };

  traverse(treeStructure);
  return { nodes, edges };
};

export function TreeGraph({ treeStructure, className = "" }: TreeGraphProps) {
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const [layoutDirection, setLayoutDirection] = useState<"TB" | "LR">("TB");

  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  // Convert tree data to React Flow format with dagre layout
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    // Add null checks and debugging
    if (!treeStructure || !treeStructure.treeStructure) {
      console.warn('TreeGraph: Invalid tree structure', treeStructure);
      return { nodes: [], edges: [] };
    }
    
    const { nodes, edges } = convertTreeToFlowData(
      treeStructure.treeStructure,
      treeStructure.currentNodeId
    );
    
    console.log('TreeGraph: Successfully converted tree - nodes:', nodes.length, 'edges:', edges.length);
    
    return getLayoutedElements(nodes, edges, layoutDirection);
  }, [treeStructure, layoutDirection]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when tree or layout changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    if (node.type === "treeNode") {
      setSelectedNode(node.data as unknown as TreeNode);
      setShowSidePanel(true);
    }
  }, []);

  const onLayout = useCallback((direction: "TB" | "LR") => {
    setLayoutDirection(direction);
  }, []);

  if (showCanvas) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-100">
        <div className="absolute top-4 left-4 right-4 z-10 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h3 className="text-lg font-semibold">Tree Structure Visualization</h3>
            <div className="flex gap-2">
              <Button
                onClick={() => onLayout("TB")}
                size="sm"
                variant={layoutDirection === "TB" ? "default" : "outline"}
                className="gap-2"
              >
                <ArrowDown className="w-4 h-4" />
                Vertical
              </Button>
              <Button
                onClick={() => onLayout("LR")}
                size="sm"
                variant={layoutDirection === "LR" ? "default" : "outline"}
                className="gap-2"
              >
                <ArrowRight className="w-4 h-4" />
                Horizontal
              </Button>
            </div>
          </div>
          <Button
            onClick={() => setShowCanvas(false)}
            size="sm"
            variant="outline"
            className="bg-white"
          >
            <X className="w-4 h-4 mr-1" />
            Close Canvas
          </Button>
        </div>

        <div className="pt-16 h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            connectionLineType={ConnectionLineType.SmoothStep}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.1}
            maxZoom={2}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="#e5e7eb"
            />
            <Controls className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg" />
            <MiniMap
              nodeStrokeColor="#3b82f6"
              nodeColor="#f3f4f6"
              nodeBorderRadius={8}
              className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg"
            />
          </ReactFlow>
        </div>

        {/* Side Panel */}
        {showSidePanel && selectedNode && (
          <div className="absolute top-16 right-0 h-[calc(100%-4rem)] w-96 bg-white shadow-2xl border-l border-gray-200 z-20">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-lg">Node Details</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSidePanel(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <ScrollArea className="h-[calc(100%-64px)]">
              <div className="p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    {selectedNode.completed ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <Clock className="w-5 h-5 text-yellow-500" />
                    )}
                    <span className="font-medium">
                      {selectedNode.completed ? "Completed" : "Pending"}
                    </span>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {selectedNode.actionType}
                  </Badge>
                </div>

                <div>
                  <h4 className="font-medium mb-1">Action</h4>
                  <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                    {selectedNode.action || "Root Node"}
                  </p>
                </div>

                <div>
                  <h4 className="font-medium mb-1">Node ID</h4>
                  <p className="text-sm text-gray-600 font-mono">
                    {selectedNode.id}
                  </p>
                </div>

                <div>
                  <h4 className="font-medium mb-1">Children</h4>
                  <p className="text-sm text-gray-600">
                    {selectedNode.children.length} child nodes
                  </p>
                </div>

                {selectedNode.children.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-1">Child Actions</h4>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {selectedNode.children.map((child, idx) => (
                        <div
                          key={idx}
                          className="text-xs text-gray-500 flex items-start gap-2 p-2 bg-gray-50 rounded"
                        >
                          <div className="flex items-center gap-1">
                            {getActionTypeIcon(child.actionType)}
                            <span className="capitalize">{child.actionType}</span>
                          </div>
                          <span>{child.action || "No action"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    );
  }

  // Show loading state if tree structure is invalid
  if (!treeStructure || !treeStructure.treeStructure || !treeStructure.treeStructure.id) {
    return (
      <div className={cn("h-full w-full bg-gray-50 rounded-lg", className)}>
        <div className="p-6">
          <div className="bg-white rounded-xl border shadow-sm p-8">
            <div className="max-w-2xl mx-auto text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-green-100 to-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <TreePine className="w-10 h-10 text-green-600" />
              </div>
              <h4 className="text-lg font-semibold text-gray-800 mb-3">
                No Tree Structure Available
              </h4>
              <p className="text-gray-600 mb-6">
                The tree structure is still being generated or no data is available yet.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("h-full w-full bg-gray-50 rounded-lg", className)}>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-semibold text-gray-800">
              Tree Structure Analysis
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {treeStructure.stats?.totalNodes || 0} nodes •{" "}
              {treeStructure.stats?.completedNodes || 0} completed •{" "}
              {treeStructure.stats?.incompleteNodes || 0} pending
            </p>
          </div>
          <Button
            onClick={() => setShowCanvas(true)}
            className="bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 text-white"
          >
            <Expand className="w-4 h-4 mr-2" />
            Open Tree Canvas
          </Button>
        </div>

        <div className="bg-white rounded-xl border shadow-sm p-8">
          <div className="max-w-2xl mx-auto text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-green-100 to-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <TreePine className="w-10 h-10 text-green-600" />
            </div>
            <h4 className="text-lg font-semibold text-gray-800 mb-3">
              Tree Structure Ready
            </h4>
            <p className="text-gray-600 mb-6">
              Click "Open Tree Canvas" to explore the complete action tree with
              hierarchical structure, completion status, and navigation flow.
            </p>

            <div className="pt-6 border-t">
              <h5 className="text-sm font-medium text-gray-700 mb-3">
                Tree Statistics
              </h5>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {treeStructure.stats?.completedNodes || 0}
                  </div>
                  <div className="text-sm text-gray-600">Completed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">
                    {treeStructure.stats?.incompleteNodes || 0}
                  </div>
                  <div className="text-sm text-gray-600">Pending</div>
                </div>
              </div>
            </div>

            {treeStructure.currentNodeId && (
              <div className="mt-4 p-3 bg-yellow-50 rounded-lg">
                <div className="flex items-center justify-center gap-2 text-yellow-800">
                  <Play className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    Current Node: {treeStructure.currentNodeId}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 