import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceCollide } from 'd3-force';
import { ZoomIn, ZoomOut, Maximize2, Info, List, Network, HelpCircle, X, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import FilterSidebar from './FilterSidebar';
import ConnectionModal from './ConnectionModal';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

/**
 * GraphExplorer - Combines filter sidebar with interactive paper graph
 *
 * Props:
 * - papers: array - All papers from upload
 */
export default function GraphExplorer({ papers = [], highlightedSources = null }) {
  const graphRef = useRef();

  // State
  const [filters, setFilters] = useState({
    yearRange: { min: 2015, max: 2025 },
    authors: [],
    keywords: [],
    authorKeywords: [],
    indexKeywords: [],
    rankings: { vhb: [], abdc: [] }
  });
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [selectedPaper, setSelectedPaper] = useState(null);
  const [viewMode, setViewMode] = useState('graph'); // 'graph' or 'list'
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showOnlyHighlighted, setShowOnlyHighlighted] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [focusedNode, setFocusedNode] = useState(null); // For focus mode
  const [semanticSimilarities, setSemanticSimilarities] = useState([]);
  const [showRelational, setShowRelational] = useState(true); // Show relational (Neo4j) edges
  const [showSemantic, setShowSemantic] = useState(true); // Show semantic (Vector) edges
  const [showDragHint, setShowDragHint] = useState(true); // Show hint to drag nodes

  // Get DOIs of highlighted sources for filtering
  const highlightedDOIs = useMemo(() => {
    if (!highlightedSources) return new Set();
    return new Set(highlightedSources.map(s => s.doi).filter(Boolean));
  }, [highlightedSources]);

  // Fetch semantic similarities when papers are loaded
  useEffect(() => {
    const fetchSemanticSimilarities = async () => {
      if (papers.length === 0) return;

      try {
        const response = await fetch(`${API_BASE}/api/semantic-similarities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threshold: 0.3, max_per_paper: 3 })
        });

        if (response.ok) {
          const data = await response.json();
          setSemanticSimilarities(data.similarities || []);
        }
      } catch (error) {
        console.log('Semantic similarities not available:', error);
      }
    };

    fetchSemanticSimilarities();
  }, [papers]);

  // Filter papers based on filters
  const filteredPapers = useMemo(() => {
    return papers.filter(paper => {
      // Highlighted Sources Filter (if active, show only these)
      if (showOnlyHighlighted && highlightedDOIs.size > 0) {
        if (!highlightedDOIs.has(paper.doi)) {
          return false;
        }
      }

      // Year Filter
      if (paper.date) {
        const year = parseInt(paper.date.substring(0, 4));
        if (year < filters.yearRange.min || year > filters.yearRange.max) {
          return false;
        }
      }

      // Authors Filter (if selected, paper must have at least one)
      if (filters.authors.length > 0) {
        const paperAuthors = paper.authors?.split(';').map(a => a.trim().replace(/\s*\(\d+\)/g, '')) || [];
        if (!filters.authors.some(a => paperAuthors.includes(a))) {
          return false;
        }
      }

      // Keywords Filter (legacy sources field)
      if (filters.keywords.length > 0) {
        const paperKeywords = paper.sources?.split(';').map(k => k.trim()) || [];
        if (!filters.keywords.some(k => paperKeywords.includes(k))) {
          return false;
        }
      }

      // Author Keywords Filter
      if (filters.authorKeywords && filters.authorKeywords.length > 0) {
        const paperAuthorKws = Array.isArray(paper.author_keywords)
          ? paper.author_keywords
          : (paper.author_keywords?.split(';').map(k => k.trim()) || []);
        if (!filters.authorKeywords.some(k => paperAuthorKws.includes(k))) {
          return false;
        }
      }

      // Index Keywords Filter
      if (filters.indexKeywords && filters.indexKeywords.length > 0) {
        const paperIndexKws = Array.isArray(paper.keywords_plus)
          ? paper.keywords_plus
          : (paper.keywords_plus?.split(';').map(k => k.trim()) || []);
        if (!filters.indexKeywords.some(k => paperIndexKws.includes(k))) {
          return false;
        }
      }

      // VHB Ranking Filter
      if (filters.rankings.vhb.length > 0) {
        if (!filters.rankings.vhb.includes(paper.vhbRanking)) {
          return false;
        }
      }

      // ABDC Ranking Filter
      if (filters.rankings.abdc.length > 0) {
        if (!filters.rankings.abdc.includes(paper.abdcRanking)) {
          return false;
        }
      }

      return true;
    });
  }, [papers, filters, showOnlyHighlighted, highlightedDOIs]);

  // Helper function: Create citation-style label (e.g. "Verhoef et al., 2021")
  const getCitationLabel = (paper) => {
    const firstAuthor = paper.authors?.split(';')[0]?.trim().replace(/\s*\(\d+\)/g, '') || 'Unknown';
    const lastName = firstAuthor.split(',')[0]?.trim() || firstAuthor;
    const year = paper.date?.substring(0, 4) || 'n.d.';
    const authorCount = paper.authors?.split(';').length || 1;
    return authorCount > 1 ? `${lastName} et al., ${year}` : `${lastName}, ${year}`;
  };

  // Helper function: Color based on year (older = light green, newer = dark green)
  const getYearColor = (paper) => {
    const year = parseInt(paper.date?.substring(0, 4)) || 2020;
    const minYear = 2015;
    const maxYear = 2025;
    const normalized = Math.max(0, Math.min(1, (year - minYear) / (maxYear - minYear)));

    // Gradient from light teal (#99d8c9) to dark teal (#006d5b)
    const r = Math.round(153 - normalized * 103); // 153 -> 50
    const g = Math.round(216 - normalized * 107); // 216 -> 109
    const b = Math.round(201 - normalized * 110); // 201 -> 91
    return `rgb(${r}, ${g}, ${b})`;
  };

  // Helper function: Size based on citations
  const getNodeSize = (paper) => {
    const citations = parseInt(paper.citations) || 0;
    // Min 3, Max 15, scaled logarithmically
    return Math.max(3, Math.min(15, 3 + Math.log(citations + 1) * 2));
  };

  // Helper function to normalize DOI for comparison
  const normalizeDoi = (doi) => {
    if (!doi) return '';
    // Remove common prefixes to get just the DOI identifier
    return doi.replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:/i, '').trim();
  };

  // Generate graph data: Papers as nodes, relational + semantic connections
  const graphData = useMemo(() => {
    // Create DOI to index mapping for semantic similarities (normalized)
    const doiToIndex = {};
    filteredPapers.forEach((paper, idx) => {
      if (paper.doi) {
        const normalizedDoi = normalizeDoi(paper.doi);
        doiToIndex[normalizedDoi] = idx;
        // Also map the full URL version
        doiToIndex[paper.doi] = idx;
      }
    });

    const nodes = filteredPapers.map((paper, idx) => ({
      id: `paper-${idx}`,
      label: getCitationLabel(paper),
      paper: paper,
      color: getYearColor(paper),
      size: getNodeSize(paper),
      citations: parseInt(paper.citations) || 0
    }));

    const relationalLinks = [];
    const semanticLinks = [];
    const linkDetails = {}; // Stores details for each connection

    // 1. Relational connections (shared authors/keywords)
    for (let i = 0; i < filteredPapers.length; i++) {
      for (let j = i + 1; j < filteredPapers.length; j++) {
        const paperA = filteredPapers[i];
        const paperB = filteredPapers[j];

        // Find shared authors
        const authorsA = paperA.authors?.split(';').map(a => a.trim().replace(/\s*\(\d+\)/g, '')) || [];
        const authorsB = paperB.authors?.split(';').map(a => a.trim().replace(/\s*\(\d+\)/g, '')) || [];
        const sharedAuthors = authorsA.filter(a => authorsB.includes(a));

        // Find shared keywords (filter out generic sources like "Scopus")
        const keywordsA = paperA.sources?.split(';').map(k => k.trim()).filter(k => k.toLowerCase() !== 'scopus') || [];
        const keywordsB = paperB.sources?.split(';').map(k => k.trim()).filter(k => k.toLowerCase() !== 'scopus') || [];
        const sharedKeywords = keywordsA.filter(k => keywordsB.includes(k));

        // Only author-based connections (not keywords like "Scopus")
        if (sharedAuthors.length > 0) {
          const linkId = `relational-${i}-${j}`;
          const strength = sharedAuthors.length * 2;

          relationalLinks.push({
            source: `paper-${i}`,
            target: `paper-${j}`,
            id: linkId,
            strength: strength,
            width: Math.min(5, 1 + strength * 0.8),
            type: 'relational' // Solid line
          });

          linkDetails[linkId] = {
            source: paperA,
            target: paperB,
            sharedAuthors,
            sharedKeywords,
            strength,
            type: 'relational',
            reason: `Shared authors: ${sharedAuthors.join(', ')}`
          };
        }
      }
    }

    // 2. Semantic connections (from vector embeddings)
    semanticSimilarities.forEach(sim => {
      // Try both normalized and original DOI formats
      const sourceIdx = doiToIndex[sim.source_doi] ?? doiToIndex[normalizeDoi(sim.source_doi)];
      const targetIdx = doiToIndex[sim.target_doi] ?? doiToIndex[normalizeDoi(sim.target_doi)];

      if (sourceIdx !== undefined && targetIdx !== undefined) {
        const linkId = `semantic-${sourceIdx}-${targetIdx}`;

        // Skip if there's already a relational link between these papers
        const hasRelational = relationalLinks.some(l => {
          const relSourceIdx = parseInt(l.source.replace('paper-', ''));
          const relTargetIdx = parseInt(l.target.replace('paper-', ''));
          return (relSourceIdx === sourceIdx && relTargetIdx === targetIdx) ||
                 (relSourceIdx === targetIdx && relTargetIdx === sourceIdx);
        });

        if (!hasRelational) {
          semanticLinks.push({
            source: `paper-${sourceIdx}`,
            target: `paper-${targetIdx}`,
            id: linkId,
            strength: sim.similarity,
            width: Math.min(4, 0.5 + sim.similarity * 3),
            type: 'semantic' // Dashed line
          });

          linkDetails[linkId] = {
            source: filteredPapers[sourceIdx],
            target: filteredPapers[targetIdx],
            sharedAuthors: [],
            sharedKeywords: [],
            strength: sim.similarity,
            type: 'semantic',
            reason: `Semantic similarity: ${(sim.similarity * 100).toFixed(0)}%`
          };
        }
      }
    });

    // Apply Top-3 filtering per type
    const MAX_LINKS_PER_NODE = 3;

    const filterTopLinks = (links) => {
      const nodeLinkCount = {};
      links.sort((a, b) => b.strength - a.strength);

      return links.filter(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;

        const sourceCount = nodeLinkCount[sourceId] || 0;
        const targetCount = nodeLinkCount[targetId] || 0;

        if (sourceCount < MAX_LINKS_PER_NODE && targetCount < MAX_LINKS_PER_NODE) {
          nodeLinkCount[sourceId] = sourceCount + 1;
          nodeLinkCount[targetId] = targetCount + 1;
          return true;
        }
        return false;
      });
    };

    const filteredRelational = filterTopLinks(relationalLinks);
    const filteredSemantic = filterTopLinks(semanticLinks);

    // Combine based on toggle states
    let combinedLinks = [];
    if (showRelational) combinedLinks = [...combinedLinks, ...filteredRelational];
    if (showSemantic) combinedLinks = [...combinedLinks, ...filteredSemantic];

    // Normalize strength for visualization
    const maxStrength = Math.max(...combinedLinks.map(l => l.strength), 1);
    combinedLinks.forEach(link => {
      link.normalizedStrength = link.strength / maxStrength;
    });

    return {
      nodes,
      links: combinedLinks,
      linkDetails,
      maxStrength,
      relationalCount: filteredRelational.length,
      semanticCount: filteredSemantic.length,
      allLinksCount: relationalLinks.length + semanticLinks.length
    };
  }, [filteredPapers, semanticSimilarities, showRelational, showSemantic]);

  // Handlers
  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
  };

  const handleLinkClick = useCallback((link) => {
    const details = graphData.linkDetails[link.id];
    if (details) {
      setSelectedConnection(details);
    }
  }, [graphData.linkDetails]);

  const handleNodeClick = useCallback((node) => {
    // Toggle focus mode: click same node again to unfocus
    if (focusedNode === node.id) {
      setFocusedNode(null);
    } else {
      setFocusedNode(node.id);
    }
    setSelectedPaper(node.paper);
  }, [focusedNode]);

  const handleBackgroundClick = useCallback(() => {
    setFocusedNode(null);
  }, []);

  // Get connected nodes for focus mode
  const connectedNodes = useMemo(() => {
    if (!focusedNode) return new Set();
    const connected = new Set([focusedNode]);
    graphData.links.forEach(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      if (sourceId === focusedNode) connected.add(targetId);
      if (targetId === focusedNode) connected.add(sourceId);
    });
    return connected;
  }, [focusedNode, graphData.links]);

  const handleZoomIn = () => graphRef.current?.zoom(graphRef.current.zoom() * 1.5, 400);
  const handleZoomOut = () => graphRef.current?.zoom(graphRef.current.zoom() / 1.5, 400);
  const handleFitView = () => graphRef.current?.zoomToFit(400, 50);

  // PNG Export Handler
  const handleExportPNG = useCallback(() => {
    if (!graphRef.current || graphData.nodes.length === 0) return;

    try {
      // ForceGraph2D renders to a canvas element inside its container
      // Access it through the DOM
      const graphContainer = graphRef.current;
      const canvas = graphContainer?.renderer?.()?.domElement;

      if (!canvas) {
        // Fallback: try to find canvas in document
        const containerCanvas = document.querySelector('.force-graph-container canvas') ||
          document.querySelector('canvas');
        if (containerCanvas) {
          exportCanvasToPNG(containerCanvas);
        } else {
          console.error('Could not find canvas element');
        }
        return;
      }

      exportCanvasToPNG(canvas);
    } catch (error) {
      console.error('PNG export error:', error);
    }
  }, [graphData.nodes.length]);

  const exportCanvasToPNG = (canvas) => {
    // Create a new canvas with white background
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const ctx = exportCanvas.getContext('2d');

    // Fill with light background (matches app background)
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Draw the original canvas content on top
    ctx.drawImage(canvas, 0, 0);

    // Convert to data URL and trigger download
    const dataURL = exportCanvas.toDataURL('image/png', 1.0);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `knowledge_graph_${timestamp}.png`;

    // Create download link
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataURL;
    link.click();
  };

  // Excel Export Handler for List View
  const handleExportExcel = useCallback(() => {
    if (filteredPapers.length === 0) return;

    const excelData = filteredPapers
      .sort((a, b) => (parseInt(b.citations) || 0) - (parseInt(a.citations) || 0))
      .map((paper, index) => ({
        'No.': index + 1,
        'Title': paper.title || '',
        'Authors': paper.authors || '',
        'Year': paper.date ? paper.date.substring(0, 4) : '',
        'Journal': paper.journal_name || '',
        'VHB Ranking': paper.vhbRanking || '',
        'ABDC Ranking': paper.abdcRanking || '',
        'Citations': paper.citations || 0,
        'DOI': paper.doi || '',
        'Abstract': paper.abstract || ''
      }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Papers');

    worksheet['!cols'] = [
      { wch: 5 },   // No.
      { wch: 50 },  // Title
      { wch: 40 },  // Authors
      { wch: 6 },   // Year
      { wch: 30 },  // Journal
      { wch: 10 },  // VHB
      { wch: 10 },  // ABDC
      { wch: 10 },  // Citations
      { wch: 30 },  // DOI
      { wch: 100 }  // Abstract
    ];

    const timestamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `papers_${timestamp}.xlsx`);
  }, [filteredPapers]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-lg font-medium text-gray-800">Knowledge Graph</h2>
          <p className="text-xs text-slate-500">
            {filteredPapers.length} Papers
            {graphData.links.length > 0 && (
              <span>
                {' '}- <span className="text-emerald-600">{graphData.relationalCount} relational</span>
                {' '}/ <span className="text-indigo-600">{graphData.semanticCount} semantic</span>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {/* Edge Type Toggles */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setShowRelational(!showRelational)}
              className={`flex items-center px-2 py-1 rounded text-xs font-medium transition-colors ${
                showRelational ? 'bg-emerald-100 text-emerald-700' : 'text-gray-400'
              }`}
              title="Relational connections (shared authors)"
            >
              <span className="w-3 h-0.5 bg-current mr-1"></span>
              Rel
            </button>
            <button
              onClick={() => setShowSemantic(!showSemantic)}
              className={`flex items-center px-2 py-1 rounded text-xs font-medium transition-colors ${
                showSemantic ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400'
              }`}
              title="Semantic connections (text similarity)"
            >
              <span className="w-3 border-t border-dashed border-current mr-1"></span>
              Sem
            </button>
          </div>
          {/* Show Only Sources Toggle */}
          {highlightedSources && highlightedSources.length > 0 && (
            <button
              onClick={() => setShowOnlyHighlighted(!showOnlyHighlighted)}
              className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showOnlyHighlighted
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              title="Show only sources from last answer"
            >
              {showOnlyHighlighted ? `Sources (${highlightedSources.length})` : 'Sources only'}
            </button>
          )}
          {/* View Toggle */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('graph')}
              className={`flex items-center px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === 'graph' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Network className="w-3.5 h-3.5 mr-1" />
              Graph
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === 'list' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <List className="w-3.5 h-3.5 mr-1" />
              List
            </button>
          </div>
          {/* Info Button */}
          <button
            onClick={() => setShowInfoModal(true)}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
            title="Legend & Explanation"
          >
            <HelpCircle className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Main Content: Sidebar + Graph */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Fixed width */}
        <div className="w-72 flex-shrink-0 border-r border-slate-100 bg-white overflow-hidden">
          <FilterSidebar
            papers={papers}
            filters={filters}
            onFilterChange={handleFilterChange}
          />
        </div>

        {/* Graph Area - Takes remaining space */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Graph Controls - only show in graph mode */}
          {viewMode === 'graph' && (
            <div className="flex items-center justify-between px-4 py-2 bg-slate-50/50 border-b border-slate-100">
              {/* Year Gradient Legend */}
              <div className="flex items-center space-x-3 text-xs">
                <span className="text-slate-500">Year:</span>
                <div className="flex items-center">
                  <div
                    className="w-24 h-3 rounded-full mr-2"
                    style={{
                      background: 'linear-gradient(to right, rgb(153, 216, 201), rgb(50, 109, 91))'
                    }}
                  />
                  <span className="text-slate-500">2015 → 2025</span>
                </div>
              </div>

              {/* Zoom Controls */}
              <div className="flex items-center space-x-1">
                <button onClick={handleZoomIn} className="p-1.5 hover:bg-slate-200 rounded" title="Zoom In">
                  <ZoomIn className="w-4 h-4 text-slate-500" />
                </button>
                <button onClick={handleZoomOut} className="p-1.5 hover:bg-slate-200 rounded" title="Zoom Out">
                  <ZoomOut className="w-4 h-4 text-slate-500" />
                </button>
                <button onClick={handleFitView} className="p-1.5 hover:bg-slate-200 rounded" title="Fit to view">
                  <Maximize2 className="w-4 h-4 text-slate-500" />
                </button>
                <div className="w-px h-4 bg-slate-200 mx-1" />
                <button
                  onClick={handleExportPNG}
                  disabled={graphData.nodes.length === 0}
                  className="p-1.5 hover:bg-slate-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Download graph as PNG image"
                >
                  <Download className="w-4 h-4 text-slate-500" />
                </button>
              </div>
            </div>
          )}

          {/* Graph View */}
          {viewMode === 'graph' && (
            <div className="flex-1 bg-slate-50 relative">
              {/* Drag Hint Overlay */}
              {showDragHint && graphData.nodes.length > 0 && (
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                  <div
                    className="bg-gray-900/80 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 pointer-events-auto cursor-pointer hover:bg-gray-900/90 transition-colors"
                    onClick={() => setShowDragHint(false)}
                  >
                    <span className="text-2xl">👆</span>
                    <div>
                      <p className="font-medium">Drag nodes to explore</p>
                      <p className="text-xs text-gray-300">Click anywhere to dismiss</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowDragHint(false); }}
                      className="ml-2 text-gray-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {graphData.nodes.length > 0 ? (
                <ForceGraph2D
                  ref={graphRef}
                  graphData={graphData}
                  nodeLabel={(node) => node.label}
                  nodeColor={(node) => {
                    // Dim nodes not connected to focused node
                    if (focusedNode && !connectedNodes.has(node.id)) {
                      return 'rgba(200, 200, 200, 0.3)';
                    }
                    return node.color;
                  }}
                  nodeVal={3}
                  // Edge width based on strength
                  linkWidth={(link) => {
                    if (focusedNode) {
                      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                      if (sourceId === focusedNode || targetId === focusedNode) {
                        return (link.width || 1) * 1.5; // Highlight connected links
                      }
                    }
                    return link.width || 1;
                  }}
                  // Custom link rendering: solid for relational, dashed for semantic
                  linkCanvasObjectMode={() => 'replace'}
                  linkCanvasObject={(link, ctx) => {
                    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                    const targetId = typeof link.target === 'object' ? link.target.id : link.target;

                    // Calculate link opacity based on focus mode
                    let alpha = 0.4 + (link.normalizedStrength || 0) * 0.5;
                    let color;

                    if (focusedNode) {
                      if (sourceId === focusedNode || targetId === focusedNode) {
                        alpha = 0.9;
                        color = link.type === 'relational'
                          ? `rgba(16, 185, 129, ${alpha})`  // Emerald for relational
                          : `rgba(99, 102, 241, ${alpha})`; // Indigo for semantic
                      } else {
                        color = 'rgba(200, 200, 200, 0.1)';
                      }
                    } else {
                      color = link.type === 'relational'
                        ? `rgba(16, 185, 129, ${alpha})`  // Emerald for relational
                        : `rgba(99, 102, 241, ${alpha})`; // Indigo for semantic
                    }

                    // Get coordinates
                    const start = link.source;
                    const end = link.target;

                    ctx.beginPath();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = link.width || 1;

                    // Dashed line for semantic, solid for relational
                    if (link.type === 'semantic') {
                      ctx.setLineDash([4, 4]);
                    } else {
                      ctx.setLineDash([]);
                    }

                    ctx.moveTo(start.x, start.y);
                    ctx.lineTo(end.x, end.y);
                    ctx.stroke();

                    // Reset line dash
                    ctx.setLineDash([]);
                  }}
                  // Always show edges (we already filtered to top-3)
                  linkVisibility={() => true}
                  onNodeClick={handleNodeClick}
                  onLinkClick={handleLinkClick}
                  onBackgroundClick={handleBackgroundClick}
                  onNodeDragStart={() => setShowDragHint(false)}
                  onZoom={({ k }) => setZoomLevel(k)}
                  linkDirectionalParticles={0}
                  cooldownTicks={300}
                  d3VelocityDecay={0.3}
                  d3AlphaDecay={0.02}
                  d3AlphaMin={0.001}
                  // Distance: strong connections = closer, weak = further
                  linkDistance={(link) => {
                    const baseDistance = 60;
                    const strength = link.normalizedStrength || 0.5;
                    return baseDistance * (1.5 - strength * 0.5);
                  }}
                  nodeRelSize={4}
                  d3Force={(d3) => {
                    // Less repulsion → Clusters closer together
                    d3('charge').strength(-80).distanceMax(150);
                    // Collision detection → Nodes don't overlap
                    d3('collision', forceCollide()
                      .radius(node => (node.size || 4) + 8)
                      .strength(0.8)
                    );
                    // Center force → Keeps everything together
                    d3('center').strength(0.1);
                  }}
                  onEngineStop={() => graphRef.current?.zoomToFit(400, 80)}
                  nodeCanvasObject={(node, ctx, globalScale) => {
                    const size = node.size || 4;
                    const isDimmed = focusedNode && !connectedNodes.has(node.id);
                    const isFocused = focusedNode === node.id;

                    ctx.beginPath();
                    ctx.arc(node.x, node.y, isFocused ? size * 1.3 : size, 0, 2 * Math.PI);
                    ctx.fillStyle = isDimmed ? 'rgba(200, 200, 200, 0.3)' : node.color;
                    ctx.fill();

                    // Ring for focused node
                    if (isFocused) {
                      ctx.strokeStyle = 'rgba(79, 70, 229, 0.9)';
                      ctx.lineWidth = 3;
                    } else {
                      ctx.strokeStyle = isDimmed ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)';
                      ctx.lineWidth = 1.5;
                    }
                    ctx.stroke();

                    // Label: show if zoomed in OR if node is connected to focused
                    const showLabel = globalScale > 1.2 || (focusedNode && connectedNodes.has(node.id));
                    if (showLabel && !isDimmed) {
                      const label = node.label || '';
                      const fontSize = Math.max(10 / globalScale, 4);
                      ctx.font = `${isFocused ? 'bold ' : ''}${fontSize}px Sans-Serif`;
                      ctx.textAlign = 'center';
                      ctx.textBaseline = 'top';
                      ctx.fillStyle = isFocused ? '#4f46e5' : '#374151';
                      ctx.fillText(label, node.x, node.y + size + 2);
                    }
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <p className="mb-2">No papers match the filters.</p>
                    <p className="text-sm">Try adjusting the filters.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* List View */}
          {viewMode === 'list' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* List Controls */}
              <div className="flex items-center justify-between px-4 py-2 bg-slate-50/50 border-b border-slate-100">
                <span className="text-xs text-slate-500">{filteredPapers.length} papers</span>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={handleExportExcel}
                    disabled={filteredPapers.length === 0}
                    className="p-1.5 hover:bg-slate-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Download paper list as Excel file"
                  >
                    <Download className="w-4 h-4 text-slate-500" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="border-b border-slate-200">
                    <th className="text-center px-2 py-3 font-medium text-slate-600 w-12">No.</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Title</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Authors</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600 w-20">Year</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600 w-24">Citations ↓</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600 w-20">VHB</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600 w-20">ABDC</th>
                  </tr>
                </thead>
                <tbody>
                  {[...filteredPapers].sort((a, b) => (parseInt(b.citations) || 0) - (parseInt(a.citations) || 0)).map((paper, idx) => (
                    <tr
                      key={idx}
                      onClick={() => setSelectedPaper(paper)}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-2 py-3 text-center text-slate-500">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center">
                          <div
                            className="w-3 h-3 rounded-full mr-3 flex-shrink-0"
                            style={{ backgroundColor: getYearColor(paper) }}
                          />
                          <span className="text-gray-800 line-clamp-2">{paper.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {getCitationLabel(paper)}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">
                        {paper.date?.substring(0, 4)}
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-gray-800">
                        {paper.citations || 0}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {paper.vhbRanking && (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                            {paper.vhbRanking}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {paper.abdcRanking && (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">
                            {paper.abdcRanking}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredPapers.length === 0 && (
                <div className="h-64 flex items-center justify-center text-gray-500">
                  <p>No papers match the filters.</p>
                </div>
              )}
              </div>
            </div>
          )}

          {/* Info Bar - only in graph mode */}
          {viewMode === 'graph' && (
            <div className="px-4 py-2 bg-indigo-50/50 border-t border-slate-100 flex items-center justify-between text-sm text-slate-600">
              <div className="flex items-center">
                <Info className="w-4 h-4 mr-2 text-indigo-500" />
                {focusedNode ? (
                  <span>
                    <span className="font-medium text-indigo-600">Focus mode:</span> Only connected papers are shown.
                    Click on background or same node to reset.
                  </span>
                ) : (
                  <span>
                    <span className="font-medium">Click on a paper</span> to see only its connections.
                    Click on an edge for details.
                  </span>
                )}
              </div>
              {focusedNode && (
                <button
                  onClick={() => setFocusedNode(null)}
                  className="px-2.5 py-1 bg-indigo-100 hover:bg-indigo-200 rounded-lg text-xs font-medium text-indigo-700"
                >
                  Clear focus
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Connection Modal */}
      {selectedConnection && (
        <ConnectionModal
          connection={selectedConnection}
          onClose={() => setSelectedConnection(null)}
          onPaperClick={(paper) => {
            setSelectedPaper(paper);
            setSelectedConnection(null);
          }}
        />
      )}

      {/* Paper Detail Modal */}
      {selectedPaper && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-medium text-gray-800 pr-4">{selectedPaper.title}</h3>
              <button
                onClick={() => setSelectedPaper(null)}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <span className="font-medium text-gray-600">Authors:</span>
                <p className="text-gray-800">{selectedPaper.authors}</p>
              </div>
              <div>
                <span className="font-medium text-gray-600">Year:</span>
                <p className="text-gray-800">{selectedPaper.date?.substring(0, 4)}</p>
              </div>
              {selectedPaper.journal_name && (
                <div>
                  <span className="font-medium text-gray-600">Journal:</span>
                  <p className="text-gray-800">{selectedPaper.journal_name}</p>
                </div>
              )}
              <div className="flex space-x-4">
                {selectedPaper.vhbRanking && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                    VHB: {selectedPaper.vhbRanking}
                  </span>
                )}
                {selectedPaper.abdcRanking && (
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
                    ABDC: {selectedPaper.abdcRanking}
                  </span>
                )}
              </div>
              {selectedPaper.doi && (
                <div>
                  <a
                    href={`https://doi.org/${selectedPaper.doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    DOI: {selectedPaper.doi}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info Modal */}
      {showInfoModal && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-medium text-gray-800">Legend & Explanation</h3>
              <button
                onClick={() => setShowInfoModal(false)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Node Size */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Node Size</h4>
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full bg-teal-500"></div>
                    <span className="text-sm text-gray-600">Few citations</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-6 rounded-full bg-teal-500"></div>
                    <span className="text-sm text-gray-600">Many citations</span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  The larger the node, the more often the paper was cited.
                </p>
              </div>

              {/* Node Color */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Node Color</h4>
                <div className="flex items-center space-x-2">
                  <div
                    className="w-32 h-4 rounded-full"
                    style={{
                      background: 'linear-gradient(to right, rgb(153, 216, 201), rgb(50, 109, 91))'
                    }}
                  />
                  <span className="text-sm text-gray-600">2015 → 2025</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Lighter color = older paper, darker color = newer paper.
                </p>
              </div>

              {/* Hybrid Connections */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Connection Types</h4>
                <div className="space-y-2">
                  {/* Relational */}
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-0.5 bg-emerald-500"></div>
                    <div>
                      <span className="text-sm font-medium text-emerald-700">Relational</span>
                      <span className="text-xs text-gray-500 ml-1">(solid)</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 ml-15 pl-[60px]">
                    Shared authors - explicit facts from Neo4j
                  </p>

                  {/* Semantic */}
                  <div className="flex items-center space-x-3 mt-2">
                    <div className="w-12 border-t-2 border-dashed border-indigo-500"></div>
                    <div>
                      <span className="text-sm font-medium text-indigo-700">Semantic</span>
                      <span className="text-xs text-gray-500 ml-1">(dashed)</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 ml-15 pl-[60px]">
                    Similar content - interpreted from vector embeddings
                  </p>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  Line thickness shows connection strength.
                  Max. 3 connections per type and paper are shown.
                </p>
              </div>

              {/* Interaction */}
              <div className="bg-gray-50 rounded-lg p-3">
                <h4 className="font-medium text-gray-700 mb-2">Interaction</h4>
                <ul className="text-xs text-gray-600 space-y-1">
                  <li><strong>Click on paper:</strong> Focus mode - shows only connected papers</li>
                  <li><strong>Click on edge:</strong> Shows why papers are connected</li>
                  <li><strong>Click on background:</strong> Clear focus</li>
                  <li><strong>Rel/Sem buttons:</strong> Show/hide connection types</li>
                  <li><strong>Mouse wheel:</strong> Zoom in/out</li>
                </ul>
              </div>

              {/* Hybrid Graph Info */}
              <div className="bg-gradient-to-r from-emerald-50 to-indigo-50 rounded-lg p-3">
                <h4 className="font-medium text-gray-800 mb-1">Hybrid Knowledge Graph</h4>
                <p className="text-xs text-gray-700">
                  This graph combines two data sources:
                </p>
                <ul className="text-xs text-gray-600 mt-1 space-y-0.5">
                  <li>• <span className="text-emerald-700 font-medium">Neo4j</span>: Explicit relations (authors, keywords)</li>
                  <li>• <span className="text-indigo-700 font-medium">Vector DB</span>: Semantic similarity (text content)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
