"use client";

import { useState } from "react";
import { edgeKey, type Graph } from "@/lib/quantum/maxcut";

export interface Point {
  x: number;
  y: number;
}

interface Props {
  graph: Graph;
  positions: Point[];
  /** Bit per node for the partition to color, or null for neutral nodes. */
  partition: number[] | null;
  onAddNode: (p: Point) => void;
  onToggleEdge: (a: number, b: number) => void;
  onRemoveNode: (i: number) => void;
  canAddNode: boolean;
}

const SIDE = ["#0072B2", "#E69F00"];
const R = 3.6;

export default function GraphEditor({ graph, positions, partition, onAddNode, onToggleEdge, onRemoveNode, canAddNode }: Props) {
  const [selected, setSelected] = useState<number | null>(null);

  const selectNode = (i: number) => {
    if (selected === null) setSelected(i);
    else if (selected === i) setSelected(null);
    else {
      onToggleEdge(selected, i);
      setSelected(null);
    }
  };

  const onBackgroundClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (selected !== null) {
      setSelected(null);
      return;
    }
    if (!canAddNode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    // Ignore clicks too close to an existing node (they were meant for the node).
    if (positions.some((p) => Math.hypot(p.x - x, p.y - y) < R * 2.2)) return;
    onAddNode({ x: Math.min(95, Math.max(5, x)), y: Math.min(95, Math.max(5, y)) });
  };

  return (
    <div>
      <svg
        viewBox="0 0 100 100"
        className="aspect-square w-full cursor-crosshair select-none rounded-[3px] border border-rule bg-paper-raised"
        onClick={onBackgroundClick}
        role="group"
        aria-label={`Graph with ${graph.n} nodes and ${graph.edges.length} edges`}
      >
        {graph.edges.map(([a, b]) => {
          const cut = partition ? partition[a] !== partition[b] : false;
          return (
            <line
              key={edgeKey([a, b])}
              x1={positions[a].x}
              y1={positions[a].y}
              x2={positions[b].x}
              y2={positions[b].y}
              stroke={partition ? (cut ? "#17203a" : "#aab3c2") : "#56607a"}
              strokeWidth={partition && cut ? 0.9 : 0.6}
              strokeDasharray={partition && !cut ? "1.4 1.2" : undefined}
            />
          );
        })}
        {positions.slice(0, graph.n).map((p, i) => {
          const isSelected = selected === i;
          const fill = partition ? SIDE[partition[i]] : "#fbfcfd";
          return (
            <g
              key={i}
              role="button"
              tabIndex={0}
              aria-label={`Node ${i}${isSelected ? ", selected" : ""}`}
              aria-pressed={isSelected}
              onClick={(e) => {
                e.stopPropagation();
                selectNode(i);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectNode(i);
                } else if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  setSelected(null);
                  onRemoveNode(i);
                }
              }}
              className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-accent"
            >
              <circle cx={p.x} cy={p.y} r={R + 1.6} fill="transparent" stroke="transparent" strokeWidth={0.8} />
              <circle
                cx={p.x}
                cy={p.y}
                r={R}
                fill={fill}
                stroke={isSelected ? "#2c6690" : "#17203a"}
                strokeWidth={isSelected ? 1.1 : 0.6}
              />
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={3.2}
                fill={partition ? "#ffffff" : "#17203a"}
                style={{ fontFamily: "var(--font-sans)", pointerEvents: "none" }}
              >
                {i}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-[14px] leading-[1.5] text-ink-muted">
        {selected === null
          ? "Click empty space to add a node. Click two nodes to connect or disconnect them. Focus a node and press Delete to remove it."
          : `Node ${selected} selected. Click another node to toggle an edge, or the same node to cancel.`}
      </p>
    </div>
  );
}
