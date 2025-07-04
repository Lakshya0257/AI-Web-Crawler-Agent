import React, { useCallback, useMemo, useState, useEffect } from "react";
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
  type Connection,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";

import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Badge } from "./badge";
import { Button } from "./button";
import {
  Network,
  MousePointer,
  Link2,
  ToggleLeft,
  FileText,
  Square,
  Circle,
  Globe,
  Info,
  ZoomIn,
  ZoomOut,
  Maximize,
  Play,
  Pause,
  RotateCcw,
  Eye,
  EyeOff,
  Expand,
  X,
  ChevronLeft,
  Clock,
  Hash,
  Layers,
  ArrowRight,
  GitBranch,
  ArrowDown,
} from "lucide-react";
import type {
  InteractionGraph,
  ImageNode,
  ImageEdge,
  FlowDefinition,
} from "../../types/exploration";
import { Separator } from "./separator";
import { ScrollArea } from "./scroll-area";
import { cn } from "../../lib/utils";

interface NetworkGraphProps {
  graph: InteractionGraph;
  className?: string;
}

// Node dimensions matching your requirements
const nodeWidth = 400;
const nodeHeight = 300;

const getFlowColor = (flowType: string) => {
  switch (flowType) {
    case "linear":
      return {
        bg: "#3b82f6",
        border: "#2563eb",
        text: "#ffffff",
        soft: "#dbeafe",
      };
    case "branching":
      return {
        bg: "#22c55e",
        border: "#16a34a",
        text: "#ffffff",
        soft: "#dcfce7",
      };
    case "circular":
      return {
        bg: "#f97316",
        border: "#ea580c",
        text: "#ffffff",
        soft: "#fed7aa",
      };
    default:
      return {
        bg: "#6b7280",
        border: "#4b5563",
        text: "#ffffff",
        soft: "#e5e7eb",
      };
  }
};

// Custom node data types
interface ImageNodeData extends ImageNode, Record<string, unknown> {
  nodeType: "image";
}

interface FlowContainerData extends Record<string, unknown> {
  nodeType: "flowContainer";
  flow: FlowDefinition;
}

type CustomNodeData = ImageNodeData | FlowContainerData;

// Simple Image Node Component
const ImageNodeComponent: React.FC<NodeProps> = ({
  data,
  isConnectable,
}) => {
  const [imageError, setImageError] = useState(false);
  const nodeData = data as ImageNodeData;

  return (
    <div className="relative group cursor-pointer">
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={isConnectable}
        className="opacity-0"
        style={{
          background: "#3b82f6",
          width: 8,
          height: 8,
        }}
      />

      <div className="w-[400px] h-[300px] rounded-lg overflow-hidden shadow-lg ring-2 ring-white/50 hover:ring-4 hover:ring-blue-400/50 transition-all duration-200">
        {!imageError ? (
          <img
            src={nodeData.imageData}
            alt={`Step ${nodeData.stepNumber}`}
            className="w-full h-full object-contain bg-white"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full bg-gray-100 flex items-center justify-center">
            <Square className="h-8 w-8 text-gray-400" />
          </div>
        )}

        {/* Step indicator */}
        <div className="absolute top-2 right-2 bg-black/70 text-white text-sm px-2 py-1 rounded">
          {nodeData.stepNumber}
        </div>

        {/* Instruction preview on hover */}
        <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {nodeData.instruction.length > 60
            ? nodeData.instruction.substring(0, 60) + "..."
            : nodeData.instruction}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={isConnectable}
        className="opacity-0"
        style={{
          background: "#3b82f6",
          width: 8,
          height: 8,
        }}
      />
    </div>
  );
};

// Flow Container Node Component
const FlowContainerNode: React.FC<NodeProps> = ({
  data,
}) => {
  const nodeData = data as FlowContainerData;
  const colors = getFlowColor(nodeData.flow.flowType);

  return (
    <div
      className="px-4 py-2 rounded-lg shadow-sm border-2 backdrop-blur-sm bg-white"
      style={{
        borderColor: colors.border + "40",
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: colors.bg }}
        />
        <span
          className="text-sm font-semibold"
          style={{ color: colors.border }}
        >
          {nodeData.flow.name}
        </span>
        <Badge
          variant="outline"
          className="text-xs"
          style={{
            borderColor: colors.border,
            color: colors.border,
          }}
        >
          {nodeData.flow.imageNodes.length} states
        </Badge>
      </div>
    </div>
  );
};

const nodeTypes = {
  imageNode: ImageNodeComponent,
  flowContainer: FlowContainerNode,
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
  dagreGraph.setGraph({ rankdir: direction, nodesep: 100, ranksep: 150 });

  nodes.forEach((node) => {
    const width = node.type === "flowContainer" ? 200 : nodeWidth;
    const height = node.type === "flowContainer" ? 50 : nodeHeight;
    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const width = node.type === "flowContainer" ? 200 : nodeWidth;
    const height = node.type === "flowContainer" ? 50 : nodeHeight;

    const newNode = {
      ...node,
      targetPosition: isHorizontal ? "left" : "top",
      sourcePosition: isHorizontal ? "right" : "bottom",
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };

    return newNode;
  });

  return { nodes: newNodes, edges };
};

export function NetworkGraph({ graph, className = "" }: NetworkGraphProps) {
  const [selectedElement, setSelectedElement] = useState<{
    type: "node" | "edge";
    data: any;
  } | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const [layoutDirection, setLayoutDirection] = useState<"TB" | "LR">("TB");

  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  // Convert graph data to React Flow format with dagre layout
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const allNodes: Node[] = [];
    const allEdges: Edge[] = [];

    // Process each flow separately to create individual dagre trees
    let xOffset = 0;

    if (graph.flows && graph.flows.length > 0) {
      graph.flows.forEach((flow, flowIndex) => {
        const flowNodes: Node[] = [];
        const flowEdges: Edge[] = [];

        // Add flow container node
        const flowContainerId = `flow-container-${flow.id}`;
        flowNodes.push({
          id: flowContainerId,
          type: "flowContainer",
          position: { x: 0, y: 0 }, // Will be set by dagre
          data: {
            nodeType: "flowContainer" as const,
            flow: flow,
          } as FlowContainerData,
          draggable: true,
        });

        // Add all image nodes for this flow
        const nodeMapping = new Map<string, string>(); // Original ID to flow-specific ID

        flow.imageNodes.forEach((nodeId) => {
          const node = graph.nodes.find((n) => n.id === nodeId);
          if (node) {
            const flowNodeId = `${nodeId}-${flow.id}`;
            nodeMapping.set(nodeId, flowNodeId);

            flowNodes.push({
              id: flowNodeId,
              type: "imageNode",
              position: { x: 0, y: 0 }, // Will be set by dagre
              data: {
                ...node,
                nodeType: "image" as const,
              } as ImageNodeData,
              draggable: true,
            });
          }
        });

        // Add edges for this flow
        graph.edges.forEach((edge, edgeIndex) => {
          const sourceInFlow = flow.imageNodes.includes(edge.from);
          const targetInFlow = flow.imageNodes.includes(edge.to);

          if (sourceInFlow && targetInFlow) {
            const sourceId = nodeMapping.get(edge.from);
            const targetId = nodeMapping.get(edge.to);

            if (sourceId && targetId) {
              flowEdges.push({
                id: `edge-${flow.id}-${edgeIndex}`,
                source: sourceId,
                target: targetId,
                animated: false,
                label: edge.action || edge.instruction.substring(0, 30) + "...",
                labelStyle: {
                  fill: "#000000",
                  fontWeight: 500,
                  fontSize: "11px",
                  backgroundColor: "rgba(255, 255, 255, 0.95)",
                  borderRadius: "3px",
                  padding: "2px 6px",
                },
                labelBgStyle: {
                  fill: "rgba(255, 255, 255, 0.95)",
                  fillOpacity: 0.95,
                },
                style: {
                  stroke: getFlowColor(flow.flowType).border,
                  strokeWidth: 2,
                  cursor: "pointer",
                },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  width: 20,
                  height: 20,
                  color: getFlowColor(flow.flowType).border,
                },
                data: {...edge},
              });
            }
          }
        });

        // Connect flow container to first nodes
        if (flow.startImageName) {
          const startNodeId = nodeMapping.get(flow.startImageName);
          if (startNodeId) {
            flowEdges.push({
              id: `edge-container-${flow.id}`,
              source: flowContainerId,
              target: startNodeId,
              animated: false,
              style: {
                stroke: getFlowColor(flow.flowType).border,
                strokeWidth: 2,
                strokeDasharray: "5 5",
              },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 20,
                height: 20,
                color: getFlowColor(flow.flowType).border,
              },
            });
          }
        }

        // Layout this flow with dagre
        const { nodes: layoutedFlowNodes, edges: layoutedFlowEdges } =
          getLayoutedElements(flowNodes, flowEdges, layoutDirection);

        // Offset the flow to avoid overlap
        const offsetNodes = layoutedFlowNodes.map((node) => ({
          ...node,
          position: {
            x: node.position.x + xOffset,
            y: node.position.y,
          },
          sourcePosition: node.sourcePosition as Position,
          targetPosition: node.targetPosition as Position,
        }));

        allNodes.push(...offsetNodes);
        allEdges.push(...layoutedFlowEdges);

        // Calculate next offset based on flow width
        const maxX = Math.max(
          ...offsetNodes.map(
            (n) => n.position.x + (n.type === "flowContainer" ? 200 : nodeWidth)
          )
        );
        xOffset = maxX + 200; // Add gap between flows
      });
    }

    // Handle nodes not in any flow
    const nodesInFlows = new Set(
      graph.flows?.flatMap((f) => f.imageNodes) || []
    );
    const orphanNodes = graph.nodes.filter((n) => !nodesInFlows.has(n.id));

    if (orphanNodes.length > 0) {
      const orphanFlowNodes: Node[] = orphanNodes.map(
        (node, index) => ({
          id: node.id,
          type: "imageNode",
          position: { x: 0, y: 0 }, // Will be set by dagre
          data: {
            ...node,
            nodeType: "image" as const,
          } as ImageNodeData,
          draggable: true,
        })
      );

      const orphanEdges: Edge[] = graph.edges
        .filter(
          (edge) =>
            orphanNodes.some((n) => n.id === edge.from) &&
            orphanNodes.some((n) => n.id === edge.to)
        )
        .map((edge, index) => ({
          id: `edge-orphan-${index}`,
          source: edge.from,
          target: edge.to,
          animated: false,
          label: edge.action || edge.instruction.substring(0, 30) + "...",
          labelStyle: {
            fill: "#000000",
            fontWeight: 500,
            fontSize: "11px",
            backgroundColor: "rgba(255, 255, 255, 0.95)",
            borderRadius: "3px",
            padding: "2px 6px",
          },
          style: {
            stroke: "#6b7280",
            strokeWidth: 2,
            cursor: "pointer",
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
            color: "#6b7280",
          },
          data: {...edge},
        }));

      if (orphanFlowNodes.length > 0) {
        const { nodes: layoutedOrphanNodes, edges: layoutedOrphanEdges } =
          getLayoutedElements(orphanFlowNodes, orphanEdges, layoutDirection);

        const offsetOrphanNodes = layoutedOrphanNodes.map((node) => ({
          ...node,
          position: {
            x: node.position.x + xOffset,
            y: node.position.y,
          },
          sourcePosition: node.sourcePosition as Position,
          targetPosition: node.targetPosition as Position,
        }));

        allNodes.push(...offsetOrphanNodes);
        allEdges.push(...layoutedOrphanEdges);
      }
    }

    return { nodes: allNodes, edges: allEdges };
  }, [graph, layoutDirection]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when graph or layout changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    if (node.type === "imageNode") {
      setSelectedElement({ type: "node", data: node.data });
      setShowSidePanel(true);
    }
  }, []);

  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    setSelectedElement({ type: "edge", data: edge.data });
    setShowSidePanel(true);
  }, []);

  const onLayout = useCallback((direction: "TB" | "LR") => {
    setLayoutDirection(direction);
  }, []);

  if (showCanvas) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-100">
        <div className="absolute top-4 left-4 right-4 z-10 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h3 className="text-lg font-semibold">Flow Visualization</h3>
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
            onEdgeClick={onEdgeClick}
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
        {showSidePanel && selectedElement && (
          <div className="absolute top-16 right-0 h-[calc(100%-4rem)] w-96 bg-white shadow-2xl border-l border-gray-200 z-20">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-lg">
                {selectedElement.type === "node"
                  ? "State Details"
                  : "Transition Details"}
              </h3>
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
                {selectedElement.type === "node" &&
                selectedElement.data.nodeType === "image" ? (
                  // Node Details
                  <>
                    <div className="aspect-video rounded-lg overflow-hidden border">
                      <img
                        src={selectedElement.data.imageData}
                        alt={`Step ${selectedElement.data.stepNumber}`}
                        className="w-full h-full object-contain bg-white"
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          Step {selectedElement.data.stepNumber}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(
                            selectedElement.data.metadata?.timestamp ||
                              new Date().toISOString()
                          )}
                        </span>
                      </div>

                      <div>
                        <h4 className="font-medium mb-1">Instruction</h4>
                        <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                          {selectedElement.data.instruction}
                        </p>
                      </div>

                      {selectedElement.data.metadata?.flowsConnected?.length >
                        0 && (
                        <div>
                          <h4 className="font-medium mb-1">Connected Flows</h4>
                          <div className="flex flex-wrap gap-1">
                            {selectedElement.data.metadata.flowsConnected.map(
                              (flowId: string) => {
                                const flow = graph.flows?.find(
                                  (f) => f.id === flowId
                                );
                                const colors = getFlowColor(
                                  flow?.flowType || "linear"
                                );
                                return (
                                  <Badge
                                    key={flowId}
                                    className="text-xs"
                                    style={{
                                      backgroundColor: colors.soft,
                                      color: colors.border,
                                      borderColor: colors.border,
                                    }}
                                  >
                                    {flow?.name || flowId}
                                  </Badge>
                                );
                              }
                            )}
                          </div>
                        </div>
                      )}

                      <Separator />

                      <div>
                        <h4 className="font-medium mb-1">Visible Elements</h4>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {(
                            selectedElement.data.metadata?.visibleElements || []
                          ).map((element: string, idx: number) => (
                            <div
                              key={idx}
                              className="text-xs text-gray-500 flex items-start gap-1 p-2 bg-gray-50 rounded"
                            >
                              <Eye className="w-3 h-3 mt-0.5 flex-shrink-0" />
                              {element}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-medium mb-1">
                          Interactive Elements
                        </h4>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {(
                            selectedElement.data.metadata?.clickableElements ||
                            []
                          ).map((element: string, idx: number) => (
                            <div
                              key={idx}
                              className="text-xs text-gray-500 flex items-start gap-1 p-2 bg-blue-50 rounded"
                            >
                              <MousePointer className="w-3 h-3 mt-0.5 flex-shrink-0 text-blue-500" />
                              {element}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : selectedElement.type === "edge" ? (
                  // Edge Details
                  <>
                    <div className="space-y-3">
                      <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg">
                        <h4 className="font-medium mb-1">Action</h4>
                        <p className="text-sm text-gray-800">
                          {selectedElement.data.action}
                        </p>
                      </div>

                      <div>
                        <h4 className="font-medium mb-1">Full Instruction</h4>
                        <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                          {selectedElement.data.instruction}
                        </p>
                      </div>

                      <div>
                        <h4 className="font-medium mb-1">Description</h4>
                        <p className="text-sm text-gray-600">
                          {selectedElement.data.description}
                        </p>
                      </div>

                      {selectedElement.data.flowId && (
                        <div>
                          <h4 className="font-medium mb-1">Part of Flow</h4>
                          <Badge>
                            {graph.flows?.find(
                              (f) => f.id === selectedElement.data.flowId
                            )?.name || selectedElement.data.flowId}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("h-full w-full bg-gray-50 rounded-lg", className)}>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-semibold text-gray-800">
              Visual Flow Analysis
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {graph.nodes.length} states • {graph.edges.length} transitions •{" "}
              {graph.flows?.length || 0} flows discovered
            </p>
          </div>
          <Button
            onClick={() => setShowCanvas(true)}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
          >
            <Expand className="w-4 h-4 mr-2" />
            Open Canvas View
          </Button>
        </div>

        <div className="bg-white rounded-xl border shadow-sm p-8">
          <div className="max-w-2xl mx-auto text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <GitBranch className="w-10 h-10 text-blue-600" />
            </div>
            <h4 className="text-lg font-semibold text-gray-800 mb-3">
              Dagre Tree Visualization Ready
            </h4>
            <p className="text-gray-600 mb-6">
              Click "Open Canvas View" to explore the complete interaction graph
              with hierarchical flow trees, organized states, and clear
              transitions.
            </p>

            {graph.flows && graph.flows.length > 0 && (
              <div className="pt-6 border-t">
                <h5 className="text-sm font-medium text-gray-700 mb-3">
                  Discovered Flows
                </h5>
                <div className="flex flex-wrap gap-2 justify-center">
                  {graph.flows.map((flow) => {
                    const colors = getFlowColor(flow.flowType);
                    return (
                      <Badge
                        key={flow.id}
                        variant="outline"
                        className="text-sm px-3 py-1"
                        style={{
                          backgroundColor: colors.soft + "30",
                          borderColor: colors.border,
                          color: colors.border,
                        }}
                      >
                        <Circle
                          className="w-2 h-2 mr-1.5"
                          style={{ fill: colors.bg }}
                        />
                        {flow.name}
                        <span className="ml-2 opacity-70">
                          ({flow.imageNodes.length})
                        </span>
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
