import React, { useRef, useCallback, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { ZoomIn, ZoomOut, Maximize2, Info } from 'lucide-react';

/**
 * GraphView - Interaktive Knowledge Graph Visualisierung
 *
 * Props:
 * - graphData: { nodes: [], links: [] } - Graph-Daten im Format für force-graph
 * - onNodeClick: function - Callback wenn ein Knoten geklickt wird
 * - onContinue: function - Callback für "Weiter zu Fragen"
 */
export default function GraphView({ graphData, onNodeClick, onContinue }) {
  const graphRef = useRef();

  // Node Farben basierend auf Typ
  const getNodeColor = (node) => {
    switch (node.type) {
      case 'author': return '#6366f1'; // Indigo
      case 'paper': return '#10b981';  // Grün
      case 'keyword': return '#f59e0b'; // Amber
      default: return '#94a3b8';
    }
  };

  // Node Größe basierend auf Typ und Verbindungen
  const getNodeSize = (node) => {
    const baseSize = {
      'author': 8,
      'paper': 6,
      'keyword': 5
    }[node.type] || 5;

    // Größer wenn mehr Verbindungen
    const connectionBonus = Math.min(node.connections || 0, 10) * 0.5;
    return baseSize + connectionBonus;
  };

  // Node Label
  const getNodeLabel = (node) => {
    if (node.type === 'paper') {
      return node.label?.length > 40 ? node.label.substring(0, 40) + '...' : node.label;
    }
    return node.label;
  };

  // Zoom Controls
  const handleZoomIn = () => {
    if (graphRef.current) {
      graphRef.current.zoom(graphRef.current.zoom() * 1.5, 400);
    }
  };

  const handleZoomOut = () => {
    if (graphRef.current) {
      graphRef.current.zoom(graphRef.current.zoom() / 1.5, 400);
    }
  };

  const handleFitView = () => {
    if (graphRef.current) {
      graphRef.current.zoomToFit(400, 50);
    }
  };

  // Node Click Handler
  const handleNodeClick = useCallback((node) => {
    if (onNodeClick) {
      onNodeClick(node);
    }
    // Zoom auf Knoten
    if (graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 1000);
      graphRef.current.zoom(2, 1000);
    }
  }, [onNodeClick]);

  // Stats berechnen
  const stats = useMemo(() => {
    if (!graphData) return { authors: 0, papers: 0, keywords: 0, links: 0 };

    return {
      authors: graphData.nodes?.filter(n => n.type === 'author').length || 0,
      papers: graphData.nodes?.filter(n => n.type === 'paper').length || 0,
      keywords: graphData.nodes?.filter(n => n.type === 'keyword').length || 0,
      links: graphData.links?.length || 0
    };
  }, [graphData]);

  // Wenn keine Daten
  if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-center h-64 text-gray-500">
          <p>Keine Graph-Daten verfügbar. Bitte Filter anwenden.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold text-gray-800">
          Knowledge Graph
        </h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleZoomIn}
            className="p-2 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-5 h-5 text-gray-600" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-5 h-5 text-gray-600" />
          </button>
          <button
            onClick={handleFitView}
            className="p-2 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
            title="Alles anzeigen"
          >
            <Maximize2 className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Legende */}
      <div className="flex items-center space-x-4 mb-4 text-sm">
        <div className="flex items-center">
          <span className="w-3 h-3 rounded-full bg-indigo-500 mr-1"></span>
          <span className="text-gray-600">Autoren ({stats.authors})</span>
        </div>
        <div className="flex items-center">
          <span className="w-3 h-3 rounded-full bg-green-500 mr-1"></span>
          <span className="text-gray-600">Papers ({stats.papers})</span>
        </div>
        <div className="flex items-center">
          <span className="w-3 h-3 rounded-full bg-amber-500 mr-1"></span>
          <span className="text-gray-600">Themen ({stats.keywords})</span>
        </div>
        <div className="flex items-center text-gray-400">
          <span className="mr-1">—</span>
          <span>{stats.links} Verbindungen</span>
        </div>
      </div>

      {/* Graph Container */}
      <div className="border rounded-lg overflow-hidden bg-gray-50" style={{ height: '500px' }}>
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          nodeLabel={getNodeLabel}
          nodeColor={getNodeColor}
          nodeVal={getNodeSize}
          linkColor={() => '#cbd5e1'}
          linkWidth={1}
          onNodeClick={handleNodeClick}
          cooldownTicks={100}
          onEngineStop={() => graphRef.current?.zoomToFit(400, 50)}
          nodeCanvasObject={(node, ctx, globalScale) => {
            // Zeichne Knoten
            const size = getNodeSize(node);
            ctx.beginPath();
            ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
            ctx.fillStyle = getNodeColor(node);
            ctx.fill();

            // Zeichne Label wenn genug gezoomt
            if (globalScale > 0.7) {
              const label = node.label?.length > 20 ? node.label.substring(0, 20) + '...' : node.label;
              const fontSize = Math.max(10 / globalScale, 3);
              ctx.font = `${fontSize}px Sans-Serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillStyle = '#374151';
              ctx.fillText(label || '', node.x, node.y + size + 2);
            }
          }}
        />
      </div>

      {/* Info Box */}
      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start">
        <Info className="w-5 h-5 text-blue-500 mr-2 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700">
          <strong>Interaktion:</strong> Klicke auf einen Knoten um Details zu sehen.
          Ziehe um zu navigieren, scrolle um zu zoomen.
        </div>
      </div>

      {/* Weiter Button */}
      {onContinue && (
        <button
          onClick={onContinue}
          className="mt-4 w-full py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
        >
          Weiter zu Fragen
        </button>
      )}
    </div>
  );
}
