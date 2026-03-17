'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { getAgentColor } from '@/lib/format-utils'

interface TrustEdgeData {
  source_agent_id: number
  target_agent_id: number
  source_name: string
  target_name: string
  trust_score: number
  interaction_count: number
}

interface GraphNode {
  id: number
  name: string
  x: number
  y: number
  px: number
  py: number
  fx: number
  fy: number
  pinned: boolean
}

interface GraphEdge {
  source: number // index into nodes array
  target: number // index into nodes array
  trust: number  // 0-1 normalized
}

const REPULSION_STRENGTH = 5000
const SPRING_STRENGTH = 0.05
const REST_LENGTH = 100
const CENTER_STRENGTH = 0.01
const DAMPING = 0.9
const DT = 1
const MAX_ITERATIONS = 200
const ENERGY_THRESHOLD = 0.5
const WIDTH = 600
const HEIGHT = 400
const NODE_RADIUS = 16

function buildGraph(edges: TrustEdgeData[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = new Map<number, { id: number; name: string }>()
  for (const e of edges) {
    if (!nodeMap.has(e.source_agent_id)) {
      nodeMap.set(e.source_agent_id, { id: e.source_agent_id, name: e.source_name })
    }
    if (!nodeMap.has(e.target_agent_id)) {
      nodeMap.set(e.target_agent_id, { id: e.target_agent_id, name: e.target_name })
    }
  }

  const nodeEntries = Array.from(nodeMap.values())
  const cx = WIDTH / 2
  const cy = HEIGHT / 2
  const nodes: GraphNode[] = nodeEntries.map((n, i) => {
    // Distribute initial positions in a circle
    const angle = (2 * Math.PI * i) / nodeEntries.length
    const radius = Math.min(WIDTH, HEIGHT) * 0.3
    return {
      id: n.id,
      name: n.name,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      px: cx + radius * Math.cos(angle),
      py: cy + radius * Math.sin(angle),
      fx: 0,
      fy: 0,
      pinned: false,
    }
  })

  const idToIndex = new Map<number, number>()
  nodes.forEach((n, i) => idToIndex.set(n.id, i))

  const graphEdges: GraphEdge[] = edges
    .filter(e => idToIndex.has(e.source_agent_id) && idToIndex.has(e.target_agent_id))
    .map(e => ({
      source: idToIndex.get(e.source_agent_id)!,
      target: idToIndex.get(e.target_agent_id)!,
      trust: Math.max(0, Math.min(1, e.trust_score)),
    }))

  return { nodes, edges: graphEdges }
}

function simulate(nodes: GraphNode[], edges: GraphEdge[]): void {
  const cx = WIDTH / 2
  const cy = HEIGHT / 2
  const n = nodes.length

  // Reset forces
  for (let i = 0; i < n; i++) {
    nodes[i].fx = 0
    nodes[i].fy = 0
  }

  // Repulsion: every pair
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = nodes[i].x - nodes[j].x
      let dy = nodes[i].y - nodes[j].y
      let distSq = dx * dx + dy * dy
      if (distSq < 1) distSq = 1
      const dist = Math.sqrt(distSq)
      const force = REPULSION_STRENGTH / distSq
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      nodes[i].fx += fx
      nodes[i].fy += fy
      nodes[j].fx -= fx
      nodes[j].fy -= fy
    }
  }

  // Attraction: along edges
  for (const edge of edges) {
    const a = nodes[edge.source]
    const b = nodes[edge.target]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    const displacement = dist - REST_LENGTH
    const force = SPRING_STRENGTH * displacement
    const fx = (dx / dist) * force
    const fy = (dy / dist) * force
    a.fx += fx
    a.fy += fy
    b.fx -= fx
    b.fy -= fy
  }

  // Centering force
  for (let i = 0; i < n; i++) {
    nodes[i].fx += -CENTER_STRENGTH * (nodes[i].x - cx)
    nodes[i].fy += -CENTER_STRENGTH * (nodes[i].y - cy)
  }

  // Verlet integration
  for (let i = 0; i < n; i++) {
    if (nodes[i].pinned) continue
    const node = nodes[i]
    const vx = (node.x - node.px) * DAMPING
    const vy = (node.y - node.py) * DAMPING
    const oldX = node.x
    const oldY = node.y
    node.x = node.x + vx + node.fx * DT * DT
    node.y = node.y + vy + node.fy * DT * DT
    node.px = oldX
    node.py = oldY
    // Clamp to bounds
    node.x = Math.max(NODE_RADIUS, Math.min(WIDTH - NODE_RADIUS, node.x))
    node.y = Math.max(NODE_RADIUS, Math.min(HEIGHT - NODE_RADIUS, node.y))
  }
}

function totalEnergy(nodes: GraphNode[]): number {
  let energy = 0
  for (const node of nodes) {
    if (node.pinned) continue
    const vx = node.x - node.px
    const vy = node.y - node.py
    energy += vx * vx + vy * vy
  }
  return energy
}

interface TrustNetworkGraphProps {
  trustData: TrustEdgeData[]
}

export function TrustNetworkGraph({ trustData }: TrustNetworkGraphProps) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [stabilized, setStabilized] = useState(false)
  const nodesRef = useRef<GraphNode[]>([])
  const edgesRef = useRef<GraphEdge[]>([])
  const rafRef = useRef<number>(0)
  const dragRef = useRef<{ nodeIndex: number; offsetX: number; offsetY: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const iterRef = useRef(0)

  // Build graph when trust data changes
  useEffect(() => {
    if (!trustData || trustData.length === 0) return

    const graph = buildGraph(trustData)
    nodesRef.current = graph.nodes
    edgesRef.current = graph.edges
    setEdges(graph.edges)
    setStabilized(false)
    iterRef.current = 0

    console.time('trust-graph-stabilize')

    const step = () => {
      if (iterRef.current >= MAX_ITERATIONS) {
        console.timeEnd('trust-graph-stabilize')
        setNodes([...nodesRef.current])
        setStabilized(true)
        return
      }

      simulate(nodesRef.current, edgesRef.current)
      iterRef.current++

      const energy = totalEnergy(nodesRef.current)
      if (energy < ENERGY_THRESHOLD) {
        console.timeEnd('trust-graph-stabilize')
        setNodes([...nodesRef.current])
        setStabilized(true)
        return
      }

      // Update render every 10 iterations for smoothness during simulation
      if (iterRef.current % 10 === 0) {
        setNodes([...nodesRef.current])
      }

      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [trustData])

  const getSVGPoint = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const scaleX = WIDTH / rect.width
    const scaleY = HEIGHT / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent, nodeIndex: number) => {
    e.preventDefault()
    const pt = getSVGPoint(e)
    const node = nodesRef.current[nodeIndex]
    dragRef.current = {
      nodeIndex,
      offsetX: node.x - pt.x,
      offsetY: node.y - pt.y,
    }
    node.pinned = true
  }, [getSVGPoint])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return
    const pt = getSVGPoint(e)
    const node = nodesRef.current[dragRef.current.nodeIndex]
    const newX = Math.max(NODE_RADIUS, Math.min(WIDTH - NODE_RADIUS, pt.x + dragRef.current.offsetX))
    const newY = Math.max(NODE_RADIUS, Math.min(HEIGHT - NODE_RADIUS, pt.y + dragRef.current.offsetY))
    node.x = newX
    node.y = newY
    node.px = newX
    node.py = newY
    setNodes([...nodesRef.current])
  }, [getSVGPoint])

  const handleMouseUp = useCallback(() => {
    if (!dragRef.current) return
    nodesRef.current[dragRef.current.nodeIndex].pinned = false
    dragRef.current = null
  }, [])

  if (!trustData || trustData.length === 0) {
    return null
  }

  return (
    <div className="bg-card border border-border rounded-lg p-2">
      <div className="text-[9px] font-mono text-muted-foreground mb-1">Trust Network Graph</div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        style={{ background: 'transparent' }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Edges */}
        {edges.map((edge, i) => {
          const src = nodes[edge.source]
          const tgt = nodes[edge.target]
          if (!src || !tgt) return null
          return (
            <line
              key={`edge-${i}`}
              x1={src.x}
              y1={src.y}
              x2={tgt.x}
              y2={tgt.y}
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1 + edge.trust * 3}
              opacity={0.3 + edge.trust * 0.5}
            />
          )
        })}
        {/* Nodes */}
        {nodes.map((node, i) => {
          const color = getAgentColor(node.id)
          return (
            <g key={`node-${node.id}`}>
              <circle
                cx={node.x}
                cy={node.y}
                r={NODE_RADIUS}
                fill={color.bg}
                stroke="rgba(255,255,255,0.2)"
                strokeWidth={2}
                style={{ cursor: 'grab' }}
                onMouseDown={(e) => handleMouseDown(e, i)}
              />
              <text
                x={node.x}
                y={node.y + NODE_RADIUS + 12}
                textAnchor="middle"
                fontSize={10}
                fill="hsl(var(--muted-foreground))"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {node.name.split(/[\s_-]/)[0]}
              </text>
            </g>
          )
        })}
        {/* Stabilization indicator */}
        {!stabilized && nodes.length > 0 && (
          <text
            x={WIDTH / 2}
            y={20}
            textAnchor="middle"
            fontSize={10}
            fill="hsl(var(--muted-foreground))"
            opacity={0.6}
          >
            Stabilizing...
          </text>
        )}
      </svg>
    </div>
  )
}
