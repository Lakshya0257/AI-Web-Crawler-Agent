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
} from "@xyflow/react";
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
} from "lucide-react";
import type {
  InteractionGraph,
  ImageNode,
  ImageEdge,
  FlowDefinition,
} from "../../types/exploration";
import { Separator } from "./separator";
import { ScrollArea } from "./scroll-area";

interface NetworkGraphProps {
  graph: InteractionGraph;
  className?: string;
}

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

// Simple Image Node Component
const ImageNodeComponent = ({ data, isConnectable }: NodeProps) => {
  const [imageError, setImageError] = useState(false);
  const nodeData = data as unknown as ImageNode;

  return (
    <div className="relative group cursor-pointer">
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        className="opacity-0"
      />

      <div className="w-[800px] h-[600px] rounded-lg overflow-hidden shadow-lg ring-2 ring-white/50 hover:ring-4 hover:ring-blue-400/50 transition-all duration-200">
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
        position={Position.Right}
        isConnectable={isConnectable}
        className="opacity-0"
      />
    </div>
  );
};

// Flow Container Node Component
const FlowContainerNode = ({ data }: NodeProps) => {
  const flowData = data as { flow: FlowDefinition };
  const colors = getFlowColor(flowData.flow.flowType);

  return (
    <div
      className="px-3 py-1.5 rounded-full shadow-sm border backdrop-blur-sm"
      style={{
        backgroundColor: colors.soft + "60",
        borderColor: colors.border + "80",
      }}
    >
      <div className="flex items-center gap-1.5">
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: colors.bg }}
        />
        <span className="text-xs font-medium" style={{ color: colors.border }}>
          {flowData.flow.name}
        </span>
      </div>
    </div>
  );
};

const nodeTypes = {
  imageNode: ImageNodeComponent,
  flowContainer: FlowContainerNode,
};

export function NetworkGraph({ graph, className = "" }: NetworkGraphProps) {
  console.log("Graph", graph);
  console.log(
    "Graph nodes:",
    graph.nodes.map((n) => ({ id: n.id, flows: n.metadata?.flowsConnected }))
  );
  console.log(
    "Graph edges:",
    graph.edges.map((e) => ({ from: e.from, to: e.to, action: e.action }))
  );
  const [selectedElement, setSelectedElement] = useState<{
    type: "node" | "edge";
    data: any;
  } | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);

  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  // Convert graph data to React Flow format
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Group nodes by flows
    const flowGroups: { [flowId: string]: ImageNode[] } = {};
    const processedNodes = new Set<string>();

    graph.nodes.forEach((node) => {
      if ((node.metadata?.flowsConnected || []).length > 0) {
        (node.metadata?.flowsConnected || []).forEach((flowId) => {
          if (!flowGroups[flowId]) {
            flowGroups[flowId] = [];
          }
          flowGroups[flowId].push(node);
        });
      }
    });

    let currentY = 0; // Start from top

    // Create flow container nodes and image nodes
    Object.entries(flowGroups).forEach(([flowId, flowNodes], flowIndex) => {
      const flow = graph.flows?.find((f) => f.id === flowId);
      if (!flow) return;

      // Flow container node - positioned just above images
      const flowContainerY = currentY;
      const imageRowY = currentY + 400; // Images 40px below flow label

      const flowContainerId = `flow-${flowId}`;
      nodes.push({
        id: flowContainerId,
        type: "flowContainer",
        position: { x: 20, y: flowContainerY },
        data: { flow },
        draggable: true,
      });

      // Image nodes in this flow
      flowNodes.forEach((node, index) => {
        const nodeId = `${node.id}-${flowId}`;
        const xOffset = 300 + index * 1000; // Desktop spacing for 800px wide images

        nodes.push({
          id: nodeId,
          type: "imageNode",
          position: { x: xOffset, y: 0 },
          data: node as any,
          draggable: true,
          parentId: flowContainerId,
        });

        processedNodes.add(node.id);
      });

      // Move to next row: current image row + image height + gap
      currentY = imageRowY + 400; // 600px image + 80px gap to next flow
    });

    // Create edges - we need to find which flows contain the source and target nodes
    graph.edges.forEach((edge: ImageEdge, index: number) => {
      // Find the flows that contain both source and target nodes
      const sourceNode = graph.nodes.find((n) => n.id === edge.from);
      const targetNode = graph.nodes.find((n) => n.id === edge.to);

      if (!sourceNode || !targetNode) {
        console.warn(
          `Edge ${edge.from} -> ${edge.to}: Could not find source or target node`
        );
        return;
      }

      // Find common flows between source and target nodes
      const sourceFlows = sourceNode.metadata?.flowsConnected || [];
      const targetFlows = targetNode.metadata?.flowsConnected || [];
      const commonFlows = sourceFlows.filter((flow) =>
        targetFlows.includes(flow)
      );

      // Create edges for each common flow (usually there will be one)
      if (commonFlows.length > 0) {
        commonFlows.forEach((flowId, flowIndex) => {
          const sourceId = `${edge.from}-${flowId}`;
          const targetId = `${edge.to}-${flowId}`;

          edges.push({
            id: `edge-${index}-${flowIndex}`,
            source: sourceId,
            target: targetId,
            animated: false, // Removed animation for clean minimal style
            label: edge.action || edge.instruction.substring(0, 30) + "...", // Show action label
            labelStyle: {
              fill: "#000000", // Black text for minimal style
              fontWeight: 500,
              fontSize: "11px",
              backgroundColor: "rgba(255, 255, 255, 0.95)",
              borderRadius: "3px",
              padding: "1px 4px",
            },
            labelBgStyle: {
              fill: "rgba(255, 255, 255, 0.95)",
              fillOpacity: 0.95,
            },
            style: {
              stroke: "#000000", // Solid black for minimal style
              strokeWidth: 2, // Clean 2px width
              cursor: "pointer",
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: "#000000", // Black arrow for minimal style
            },
            data: edge as any,
          });
        });
      } else {
        // If no common flows, try to create edge without flow suffix
        console.warn(
          `Edge ${edge.from} -> ${edge.to}: No common flows found, attempting direct connection`
        );
        edges.push({
          id: `edge-${index}`,
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
            padding: "1px 4px",
          },
          labelBgStyle: {
            fill: "rgba(255, 255, 255, 0.95)",
            fillOpacity: 0.95,
          },
          style: {
            stroke: "#000000",
            strokeWidth: 2,
            cursor: "pointer",
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: "#000000",
          },
          data: edge as any,
        });
      }
    });

    console.log(
      "Created nodes:",
      nodes.map((n) => ({ id: n.id, type: n.type, position: n.position }))
    );
    console.log(
      "Created edges:",
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
      }))
    );

    return { nodes, edges };
  }, [graph]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when graph changes
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

  if (showCanvas) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <div className="absolute top-4 right-4 z-10 flex gap-2">
          <Button
            onClick={() => setShowCanvas(false)}
            size="sm"
            variant="outline"
            className="bg-white/90 backdrop-blur-sm"
          >
            <X className="w-4 h-4 mr-1" />
            Close Canvas
          </Button>
        </div>

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
          className="bg-gray-50"
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

        {/* Side Panel */}
        {showSidePanel && selectedElement && (
          <div className="absolute top-0 right-0 h-full w-96 bg-white shadow-2xl border-l border-gray-200 z-20">
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
                {selectedElement.type === "node" ? (
                  // Node Details
                  <>
                    <div className="aspect-video rounded-lg overflow-hidden border">
                      <img
                        src={selectedElement.data.imageData}
                        alt={`Step ${selectedElement.data.stepNumber}`}
                        className="w-full h-full object-cover"
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
                        <p className="text-sm text-gray-600">
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
                        <div className="space-y-1">
                          {(
                            selectedElement.data.metadata?.visibleElements || []
                          )
                            .slice(0, 5)
                            .map((element: string, idx: number) => (
                              <div
                                key={idx}
                                className="text-xs text-gray-500 flex items-start gap-1"
                              >
                                <Circle className="w-2 h-2 mt-1 flex-shrink-0" />
                                {element}
                              </div>
                            ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-medium mb-1">
                          Interactive Elements
                        </h4>
                        <div className="space-y-1">
                          {(
                            selectedElement.data.metadata?.clickableElements ||
                            []
                          )
                            .slice(0, 5)
                            .map((element: string, idx: number) => (
                              <div
                                key={idx}
                                className="text-xs text-gray-500 flex items-start gap-1"
                              >
                                <MousePointer className="w-2 h-2 mt-1 flex-shrink-0" />
                                {element}
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  // Edge Details
                  <>
                    <div className="space-y-3">
                      <div>
                        <h4 className="font-medium mb-1">Action</h4>
                        <p className="text-sm text-gray-600">
                          {selectedElement.data.action}
                        </p>
                      </div>

                      <div>
                        <h4 className="font-medium mb-1">Full Instruction</h4>
                        <p className="text-sm text-gray-600">
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
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`h-full w-full ${className} bg-gray-50 rounded-lg`}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Visual Flow Analysis</h3>
            <p className="text-sm text-muted-foreground">
              {graph.nodes.length} states • {graph.edges.length} transitions •{" "}
              {graph.flows?.length || 0} flows
            </p>
          </div>
          <Button
            onClick={() => setShowCanvas(true)}
            size="sm"
            className="gap-2"
          >
            <Expand className="w-4 h-4" />
            View Canvas
          </Button>
        </div>

        <div className="bg-white rounded-lg border p-6 text-center">
          <div className="max-w-md mx-auto">
            <Network className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <h4 className="font-medium mb-2">Interactive Flow Diagram</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Click "View Canvas" to explore the complete interaction graph with
              all discovered flows and states.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {graph.flows?.map((flow) => {
                const colors = getFlowColor(flow.flowType);
                return (
                  <Badge
                    key={flow.id}
                    variant="outline"
                    className="text-xs"
                    style={{
                      backgroundColor: colors.soft + "20",
                      borderColor: colors.border,
                      color: colors.border,
                    }}
                  >
                    {flow.name}
                  </Badge>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
