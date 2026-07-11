import React, { useState, useEffect } from 'react';
import { Upload, Search, FileText, Loader, CheckCircle, MessageSquare, Send, ChevronDown, ChevronUp, Home, Eye, Clock, Code, Info, X, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import TransparencyPanel from './components/TransparencyPanel';
import ProportionalityPanel from './components/ProportionalityPanel';
import SourceCard from './components/SourceCard';
import ContextPanel from './components/ContextPanel';
import GraphExplorer from './components/GraphExplorer';
import WelcomeScreen from './components/WelcomeScreen';

// API Configuration - uses environment variable with fallback
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// ========== DEMO DATA FOR DESIGN PREVIEW ==========

const DEMO_PAPERS = [
  {
    title: "Customer Experience Management: A Critical Review of an Emerging Idea",
    authors: "Verhoef, Peter C.; Lemon, Katherine N.; Parasuraman, A.",
    date: "2021-03-15",
    sources: "Customer Experience; Marketing; Service Quality; Management",
    vhbRanking: "A",
    abdcRanking: "A*",
    doi: "10.1016/j.jretai.2020.11.002",
    journal_name: "Journal of Retailing",
    citations: 342
  },
  {
    title: "Understanding Customer Experience Throughout the Customer Journey",
    authors: "Lemon, Katherine N.; Verhoef, Peter C.",
    date: "2016-11-01",
    sources: "Customer Journey; Touchpoints; Marketing; Customer Experience",
    vhbRanking: "A+",
    abdcRanking: "A*",
    doi: "10.1509/jm.15.0420",
    journal_name: "Journal of Marketing",
    citations: 891
  },
  {
    title: "Artificial Intelligence in Customer Experience: A Systematic Review",
    authors: "Klaus, Phil; Zaichkowsky, Judith",
    date: "2022-06-20",
    sources: "Artificial Intelligence; Customer Experience; Machine Learning; Digital",
    vhbRanking: "B",
    abdcRanking: "A",
    doi: "10.1108/JSM-02-2022-0045",
    journal_name: "Journal of Service Management",
    citations: 56
  },
  {
    title: "Digital Transformation and Customer Loyalty in Retail",
    authors: "Klaus, Phil; Verhoef, Peter C.",
    date: "2023-01-10",
    sources: "Digital Transformation; Customer Loyalty; Marketing; Retail",
    vhbRanking: "A",
    abdcRanking: "A",
    doi: "10.1016/j.jbusres.2022.12.001",
    journal_name: "Journal of Business Research",
    citations: 28
  },
  {
    title: "The Role of AI in Modern Marketing Strategies",
    authors: "Smith, John; Klaus, Phil",
    date: "2024-05-15",
    sources: "Artificial Intelligence; Marketing; Strategy; Digital",
    vhbRanking: "B",
    abdcRanking: "A",
    doi: "10.1016/j.jmr.2023.01.001",
    journal_name: "Journal of Marketing Research",
    citations: 12
  },
  {
    title: "Service Quality and Customer Satisfaction: A Meta-Analysis",
    authors: "Parasuraman, A.; Lemon, Katherine N.",
    date: "2017-08-20",
    sources: "Service Quality; Customer Satisfaction; Meta-Analysis; Marketing",
    vhbRanking: "A",
    abdcRanking: "A*",
    doi: "10.1016/j.jsr.2019.05.002",
    journal_name: "Journal of Service Research",
    citations: 523
  }
];

const DEMO_RESULTS = {
  answer: "Customer Experience (CX) refers to the totality of all experiences a customer has with a company. According to the analyzed papers, CX encompasses all interactions across various touchpoints - from initial awareness to the post-purchase phase. Research shows that positive customer experience leads to higher customer loyalty and willingness to recommend.",
  confidence: 0.85,
  graphUsed: true,
  cypherQuery: "MATCH (p:Paper)-[:HAS_KEYWORD]->(k:Keyword) WHERE k.name CONTAINS 'customer experience' RETURN p.title, p.authors LIMIT 5",
  sources: [
    {
      title: "Customer Experience Management: A Critical Review of an Emerging Idea",
      authors: "Verhoef, Peter C.; Lemon, Katherine N.; Parasuraman, A.",
      date: "2021-03-15",
      similarity: 0.92,
      doi: "10.1016/j.jretai.2020.11.002",
      url: "https://www.scopus.com/record/example1",
      journal_name: "Journal of Retailing",
      vhbRanking: "A",
      abdcRanking: "A*",
      citations: 342,
      abstract: "This paper provides a critical review of the customer experience concept and its management."
    },
    {
      title: "Understanding Customer Experience Throughout the Customer Journey",
      authors: "Lemon, Katherine N.; Verhoef, Peter C.",
      date: "2020-11-01",
      similarity: 0.87,
      doi: "10.1509/jm.15.0420",
      url: "https://www.scopus.com/record/example2",
      journal_name: "Journal of Marketing",
      vhbRanking: "A+",
      abdcRanking: "A*",
      citations: 891,
      abstract: "Customer experience is a multidimensional construct focusing on cognitive, emotional, and behavioral responses."
    },
    {
      title: "Artificial Intelligence in Customer Experience: A Systematic Review",
      authors: "Klaus, Phil; Zaichkowsky, Judith",
      date: "2022-06-20",
      similarity: 0.78,
      doi: "10.1108/JSM-02-2022-0045",
      url: "https://www.scopus.com/record/example3",
      journal_name: "Journal of Service Management",
      vhbRanking: "B",
      abdcRanking: "A",
      citations: 56,
      abstract: "This systematic review examines how AI technologies are transforming customer experience management."
    }
  ]
};

// ========== CITATION COMPONENT ==========

function AnswerWithCitations({ answer, sources = [] }) {
  const [hoveredCitation, setHoveredCitation] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Track mouse position for tooltip
  const handleMouseMove = (e) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  // Parse answer and replace [1], [2], etc. with interactive elements
  const renderAnswerWithCitations = () => {
    if (!answer) return null;

    // Split by citation pattern [number]
    const parts = answer.split(/(\[\d+\])/g);

    return parts.map((part, index) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (match) {
        const citationNum = parseInt(match[1]);
        const source = sources[citationNum - 1];

        if (source) {
          return (
            <span
              key={index}
              className="inline-block"
              onMouseEnter={() => setHoveredCitation(citationNum)}
              onMouseLeave={() => setHoveredCitation(null)}
              onMouseMove={handleMouseMove}
            >
              <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-semibold bg-indigo-100 text-indigo-700 rounded cursor-pointer hover:bg-indigo-200 transition-colors mx-0.5">
                {citationNum}
              </span>
            </span>
          );
        }
      }
      return <span key={index}>{part}</span>;
    });
  };

  // Get hovered source for tooltip
  const hoveredSource = hoveredCitation ? sources[hoveredCitation - 1] : null;

  return (
    <>
      {renderAnswerWithCitations()}
      {/* Floating tooltip at mouse position */}
      {hoveredSource && (
        <div
          className="fixed w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl z-[9999] pointer-events-none"
          style={{
            left: mousePos.x + 15,
            top: mousePos.y + 15,
            maxWidth: 'calc(100vw - 40px)'
          }}
        >
          <p className="font-semibold mb-1 line-clamp-2">{hoveredSource.title}</p>
          <p className="text-gray-300 text-xs">
            {hoveredSource.authors?.split(';')[0]?.trim()}, {hoveredSource.year || hoveredSource.date?.substring(0, 4)}
          </p>
          {hoveredSource.journal_name && (
            <p className="text-gray-400 text-xs italic mt-1">{hoveredSource.journal_name}</p>
          )}
          {(hoveredSource.vhbRanking || hoveredSource.abdcRanking) && (
            <div className="flex gap-2 mt-2">
              {hoveredSource.vhbRanking && hoveredSource.vhbRanking !== 'N/A' && (
                <span className="px-1.5 py-0.5 bg-blue-600 rounded text-xs">VHB: {hoveredSource.vhbRanking}</span>
              )}
              {hoveredSource.abdcRanking && hoveredSource.abdcRanking !== 'N/A' && (
                <span className="px-1.5 py-0.5 bg-purple-600 rounded text-xs">ABDC: {hoveredSource.abdcRanking}</span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ========== QUERY TRANSPARENCY COMPONENT ==========

function QueryTransparencyPanel({ transparency, cypherQuery }) {
  const [expanded, setExpanded] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  if (!transparency || !transparency.steps) return null;

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-100 rounded-xl transition-colors"
      >
        <div className="flex items-center">
          <Eye className="w-4 h-4 text-slate-500 mr-2" />
          <span className="text-sm font-medium text-slate-700">Query Transparency</span>
          {transparency.timing?.total && (
            <span className="ml-2 px-2 py-0.5 bg-slate-200 text-slate-600 rounded-full text-xs">
              {transparency.timing.total}s total
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Methods Used */}
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Methods Used:</p>
            <div className="flex flex-wrap gap-1">
              {transparency.methods_used?.map((method, i) => (
                <span key={i} className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs">
                  {method}
                </span>
              ))}
            </div>
          </div>

          {/* Steps */}
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">Processing Steps:</p>
            <div className="space-y-2">
              {transparency.steps?.map((step, i) => (
                <div key={i} className="bg-white rounded-lg p-2 border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">{step.name}</span>
                    {transparency.timing?.[step.name.toLowerCase().replace(' ', '_')] && (
                      <span className="flex items-center text-xs text-slate-400">
                        <Clock className="w-3 h-3 mr-1" />
                        {transparency.timing[step.name.toLowerCase().replace(' ', '_')]}s
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>
                  <p className="text-xs text-green-600 mt-0.5">{step.result}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Timing Breakdown */}
          {transparency.timing && (
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">Timing:</p>
              <div className="flex flex-wrap gap-2 text-xs">
                {transparency.timing.semantic_search && (
                  <span className="text-slate-600">Semantic: {transparency.timing.semantic_search}s</span>
                )}
                {transparency.timing.graph_search && (
                  <span className="text-slate-600">Graph: {transparency.timing.graph_search}s</span>
                )}
                {transparency.timing.llm_generation && (
                  <span className="text-slate-600">LLM: {transparency.timing.llm_generation}s</span>
                )}
              </div>
            </div>
          )}

          {/* Cypher Query */}
          {cypherQuery && (
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">Cypher Query:</p>
              <code className="text-xs text-slate-600 block bg-white p-2 rounded-lg border border-slate-200 overflow-x-auto whitespace-pre-wrap">
                {cypherQuery}
              </code>
            </div>
          )}

          {/* LLM Prompt Toggle */}
          {transparency.prompt && (
            <div>
              <button
                onClick={() => setShowPrompt(!showPrompt)}
                className="flex items-center text-xs text-indigo-600 hover:text-indigo-800"
              >
                <Code className="w-3 h-3 mr-1" />
                {showPrompt ? 'Hide LLM Prompt' : 'Show LLM Prompt'}
              </button>
              {showPrompt && (
                <pre className="mt-2 text-xs text-slate-600 bg-white p-2 rounded-lg border border-slate-200 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {transparency.prompt}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ========== MAIN COMPONENT ==========

export default function HybridRAGInterface() {
  // Upload State
  const [uploadStatus, setUploadStatus] = useState('idle'); // idle, uploading, ready, error
  const [uploadProgress, setUploadProgress] = useState('');

  // Data State
  const [papers, setPapers] = useState([]);
  const [papersCount, setPapersCount] = useState(0);

  // Search State
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const [searchTime, setSearchTime] = useState(0);

  // Error State
  const [uploadError, setUploadError] = useState(null);

  // Timer for search progress
  useEffect(() => {
    let interval;
    if (searching) {
      setSearchTime(0);
      interval = setInterval(() => {
        setSearchTime(t => t + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [searching]);

  // UI State
  const [fileInputKey, setFileInputKey] = useState(0);

  // Welcome Screen State (always show on launch)
  const [showWelcome, setShowWelcome] = useState(true);

  // Info Modal State for Ask Questions
  const [showAskInfo, setShowAskInfo] = useState(false);

  const handleDismissWelcome = () => {
    setShowWelcome(false);
  };

  // ========== DEMO MODE ==========
  const activateDemoMode = () => {
    setPapers(DEMO_PAPERS);
    setPapersCount(DEMO_PAPERS.length);
    setUploadStatus('ready');
    setUploadProgress(`Demo: ${DEMO_PAPERS.length} papers loaded`);
  };

  // ========== BACK TO START ==========
  const resetToWelcome = () => {
    setUploadStatus('idle');
    setUploadProgress('');
    setUploadError(null);
    setPapers([]);
    setPapersCount(0);
    setQuery('');
    setSearching(false);
    setResults(null);
    setShowResults(false);
    setFileInputKey(k => k + 1);
  };

  // ========== UPLOAD HANDLER ==========
  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    // Clear previous state
    setUploadError(null);
    setResults(null);
    setShowResults(false);
    setQuery('');

    setUploadStatus('uploading');
    setUploadProgress('Uploading and processing file...');

    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);

      const uploadResponse = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        body: formData
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok) {
        // Show error from backend
        throw new Error(uploadResult.error || 'Upload failed');
      }

      if (!uploadResult.papers || uploadResult.papers.length === 0) {
        throw new Error('No valid papers found in file. Please check the file format.');
      }

      setPapers(uploadResult.papers);
      setPapersCount(uploadResult.papers_count || uploadResult.papers.length);
      setUploadStatus('ready');
      setUploadProgress(`${uploadResult.papers_count} papers processed`);
      setUploadError(null);
    } catch (err) {
      // Show error message instead of falling back to demo
      console.error('Upload error:', err);
      setUploadStatus('error');
      setUploadError(err.message || 'Failed to process file. Please try again.');
      setUploadProgress('');
      setPapers([]);
      setPapersCount(0);
    }

    // Reset file input to allow re-uploading the same file
    setFileInputKey(k => k + 1);
  };

  // ========== SEARCH HANDLER ==========
  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setShowResults(false);

    try {
      const response = await fetch(`${API_BASE_URL}/api/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: query.trim() })
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setResults(data);
      setSearching(false);
      setShowResults(true);
    } catch (err) {
      // Fallback to demo results if backend unavailable
      console.warn('Backend unavailable, using demo results:', err);
      setResults(DEMO_RESULTS);
      setSearching(false);
      setShowResults(true);
    }
  };

  // ========== EXCEL EXPORT ==========
  const exportToExcel = () => {
    if (!results?.sources || results.sources.length === 0) return;

    // Transform sources data to flat structure for Excel
    const excelData = results.sources.map((source, index) => ({
      'No.': index + 1,
      'Title': source.title || '',
      'Authors': source.authors || '',
      'Year': source.year || (source.date ? source.date.substring(0, 4) : ''),
      'Journal': source.journal_name || '',
      'VHB Ranking': source.vhbRanking || '',
      'ABDC Ranking': source.abdcRanking || '',
      'Citations': source.citations || 0,
      'Similarity %': Math.round((source.similarity || 0) * 100),
      'DOI': source.doi || '',
      'URL': source.url || '',
      'Abstract': source.abstract || ''
    }));

    // Create workbook and worksheet
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Search Results');

    // Set column widths for better readability
    worksheet['!cols'] = [
      { wch: 5 },   // No.
      { wch: 50 },  // Title
      { wch: 40 },  // Authors
      { wch: 6 },   // Year
      { wch: 30 },  // Journal
      { wch: 10 },  // VHB
      { wch: 10 },  // ABDC
      { wch: 10 },  // Citations
      { wch: 12 },  // Similarity
      { wch: 30 },  // DOI
      { wch: 40 },  // URL
      { wch: 100 }  // Abstract
    ];

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `search_results_${timestamp}.xlsx`;

    // Trigger download
    XLSX.writeFile(workbook, filename);
  };

  // ========== RENDER ==========

  // Show welcome screen first
  if (showWelcome) {
    return <WelcomeScreen onDismiss={handleDismissWelcome} />;
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-white px-6 py-4 flex items-center justify-between flex-shrink-0 shadow-sm">
        <div className="flex items-center space-x-4">
          {uploadStatus !== 'idle' && (
            <button
              onClick={resetToWelcome}
              className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              title="Back to start"
            >
              <Home className="w-5 h-5" />
            </button>
          )}
          <div>
            <h1 className="text-xl font-semibold text-gray-800">AI Knowledge Platform</h1>
            <p className="text-xs text-gray-400">
              Based on the 5 epistemic principles (Malik & Terzidis, 2025)
            </p>
          </div>
        </div>
        {uploadStatus === 'idle' && (
          <button
            onClick={activateDemoMode}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium shadow-sm"
          >
            Start Demo
          </button>
        )}
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Upload + Graph */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Upload Section - Collapsible */}
          {uploadStatus === 'idle' || uploadStatus === 'error' ? (
            <div className="p-6 bg-white">
              {/* Error Message */}
              {uploadError && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">Upload Error</h3>
                      <p className="mt-1 text-sm text-red-600">{uploadError}</p>
                    </div>
                    <button
                      onClick={() => setUploadError(null)}
                      className="ml-auto text-red-400 hover:text-red-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-indigo-300 hover:bg-indigo-50/30 transition-all">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                  key={`file-upload-${fileInputKey}`}
                />
                <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8 text-slate-400" />
                  </div>
                  <p className="text-gray-700 font-medium mb-1">Upload Excel or CSV</p>
                  <p className="text-sm text-slate-400">.xlsx, .xls, .csv</p>
                </label>
              </div>
            </div>
          ) : uploadStatus === 'uploading' ? (
            <div className="p-6 bg-white">
              <div className="flex items-center justify-center py-8">
                <Loader className="w-8 h-8 animate-spin text-indigo-600 mr-3" />
                <span className="text-gray-600">{uploadProgress}</span>
              </div>
            </div>
          ) : (
            <div className="bg-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-6 h-6 bg-emerald-100 rounded-full flex items-center justify-center mr-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                </div>
                <span className="text-sm text-gray-600">{uploadProgress}</span>
              </div>
              <div className="flex items-center">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload-new"
                  key={`file-upload-new-${fileInputKey}`}
                />
                <label
                  htmlFor="file-upload-new"
                  className="text-sm text-indigo-600 hover:text-indigo-700 cursor-pointer flex items-center"
                >
                  <Upload className="w-4 h-4 mr-1" />
                  Upload new file
                </label>
              </div>
            </div>
          )}

          {/* Graph Explorer */}
          {papers.length > 0 ? (
            <div className="flex-1 overflow-hidden p-4">
              <GraphExplorer papers={papers} highlightedSources={results?.sources} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Upload className="w-10 h-10 text-slate-300" />
                </div>
                <p className="text-slate-400">Upload papers or start demo mode</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar: Search & Results */}
        <div className="w-96 bg-white border-l border-slate-200 flex flex-col flex-shrink-0">
          {/* Search Header */}
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center">
                <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center mr-2">
                  <MessageSquare className="w-4 h-4 text-indigo-600" />
                </div>
                <h2 className="font-medium text-gray-800">Ask Questions</h2>
              </div>
              <button
                onClick={() => setShowAskInfo(true)}
                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                title="How does this work?"
              >
                <Info className="w-4 h-4" />
              </button>
            </div>

            {/* Info Modal */}
            {showAskInfo && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAskInfo(false)}>
                <div className="bg-white rounded-2xl shadow-xl max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-5 py-4 flex items-center justify-between">
                    <h3 className="text-white font-semibold flex items-center">
                      <MessageSquare className="w-5 h-5 mr-2" />
                      Ask Questions - How it works
                    </h3>
                    <button onClick={() => setShowAskInfo(false)} className="text-white/80 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="p-5 space-y-4 text-sm">
                    <div>
                      <h4 className="font-semibold text-gray-800 mb-1">🔍 Hybrid Search</h4>
                      <p className="text-gray-600">Combines <span className="font-medium text-indigo-600">Semantic Search</span> (AI embeddings) with <span className="font-medium text-purple-600">Knowledge Graph</span> (Neo4j) for accurate results.</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-800 mb-1">💬 Query Types</h4>
                      <ul className="text-gray-600 space-y-1 ml-4">
                        <li>• <b>Author queries:</b> "Papers by Kim", "Who collaborated with Davis?"</li>
                        <li>• <b>Topic queries:</b> "Papers about AI", "What topics does Smith research?"</li>
                        <li>• <b>Concept questions:</b> "What is machine learning?"</li>
                        <li>• <b>List queries:</b> "List all authors", "What topics are covered?"</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-800 mb-1">🤖 LLM Intent Classification</h4>
                      <p className="text-gray-600">An AI model analyzes your question to determine the best search strategy before querying the database.</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-800 mb-1">📊 Dynamic Results</h4>
                      <p className="text-gray-600">Returns all papers above 35% relevance threshold (up to 10). More relevant queries = more sources.</p>
                    </div>
                    <div className="pt-2 border-t border-slate-100">
                      <p className="text-xs text-slate-500">Tip: Click on citation numbers [1], [2] in answers to see source details.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Search Input */}
            <div className="flex space-x-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Ask about authors, topics, or concepts..."
                className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-slate-50 focus:bg-white transition-colors"
                disabled={papers.length === 0}
              />
              <button
                onClick={handleSearch}
                disabled={!query.trim() || searching || papers.length === 0}
                className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
              >
                {searching ? (
                  <Loader className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>

            {/* Example Questions */}
            {papers.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Papers by Smith",
                    "Who collaborated with Davis?",
                    "What does Allen write about?",
                    "Papers about AI",
                    "Topics by Kim",
                    "What is machine learning?"
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => setQuery(q)}
                      className="text-xs px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Results Area */}
          <div className="flex-1 overflow-y-auto">
            {!results && !searching && (
              <div className="h-full flex items-center justify-center p-4">
                <div className="text-center">
                  <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Search className="w-7 h-7 text-slate-300" />
                  </div>
                  <p className="text-sm text-slate-400">
                    {papers.length === 0
                      ? "Upload papers first"
                      : "Ask a question about your papers"
                    }
                  </p>
                </div>
              </div>
            )}

            {searching && (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Loader className="w-6 h-6 animate-spin text-indigo-600" />
                  </div>
                  <p className="text-sm text-slate-600 mb-1">
                    {searchTime < 5 ? 'Searching Knowledge Graph...' :
                     searchTime < 15 ? 'Generating answer with LLM...' :
                     searchTime < 30 ? 'Analyzing sources...' :
                     'Please wait, complex query...'}
                  </p>
                  <p className="text-xs text-slate-400">{searchTime}s</p>
                  {searchTime > 20 && (
                    <p className="text-xs text-amber-600 mt-2">LLM responses can take up to 2 minutes</p>
                  )}
                </div>
              </div>
            )}

            {showResults && results && (
              <div className="p-4 space-y-4">
                {/* Answer */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-gray-800">Answer</h3>
                    {results.graphUsed && (
                      <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-xs font-medium">
                        Knowledge Graph
                      </span>
                    )}
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl text-sm text-gray-700 leading-relaxed">
                    <AnswerWithCitations answer={results.answer} sources={results.sources} />
                  </div>
                </div>

                {/* Sources - directly after answer */}
                {results.sources?.length > 0 && (
                  <div>
                    <h4 className="font-medium text-gray-800 mb-2 flex items-center">
                      <FileText className="w-4 h-4 mr-1.5 text-slate-500" />
                      Sources ({results.sources.length})
                    </h4>
                    <div className="space-y-2">
                      {results.sources.map((source, idx) => (
                        <SourceCard key={idx} source={source} index={idx + 1} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Query Transparency Panel */}
                <QueryTransparencyPanel
                  transparency={results.transparency}
                  cypherQuery={results.cypherQuery}
                />

                {/* Epistemic Panels */}
                <TransparencyPanel confidence={results.confidence} sources={results.sources} />
                <ProportionalityPanel sources={results.sources} />
                <ContextPanel sources={results.sources} totalPapers={papersCount} query={query} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-white px-4 py-3 text-center text-xs text-slate-400 flex-shrink-0 border-t border-slate-100">
        <span className="text-slate-500">5 Principles:</span> Transparency · Traceability · Proportionality · Intersubjectivity · Contextualization
      </footer>
    </div>
  );
}
