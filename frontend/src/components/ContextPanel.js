import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Calendar, Database, Globe } from 'lucide-react';

/**
 * ContextPanel - Shows context and limitations of results
 * Epistemic Principle: CONTEXTUALIZATION
 *
 * Props:
 * - sources: array - The used sources
 * - totalPapers: number - Total number of papers in the system
 * - query: string - The asked question
 */
export default function ContextPanel({ sources = [], totalPapers = 0, query = '' }) {
  const [showDetails, setShowDetails] = useState(false);

  // Calculate time range from sources
  const years = sources
    .map(s => {
      if (s.year) return parseInt(s.year);
      if (s.date) return parseInt(s.date.substring(0, 4));
      return null;
    })
    .filter(y => y && !isNaN(y));

  const minYear = years.length > 0 ? Math.min(...years) : null;
  const maxYear = years.length > 0 ? Math.max(...years) : null;
  const timeRange = minYear && maxYear
    ? (minYear === maxYear ? `${minYear}` : `${minYear} - ${maxYear}`)
    : 'Unknown';

  // Calculate coverage
  const coveragePercent = totalPapers > 0
    ? Math.round((sources.length / totalPapers) * 100)
    : 0;

  // Collect unique journals/sources
  const uniqueJournals = [...new Set(
    sources
      .map(s => s.journal_name)
      .filter(j => j)
  )];

  // Generate limitations based on data
  const limitations = [];

  if (sources.length < 5) {
    limitations.push({
      type: 'warning',
      text: `Only ${sources.length} sources found - results may be incomplete`
    });
  }

  if (coveragePercent < 10 && totalPapers > 0) {
    limitations.push({
      type: 'info',
      text: `Only ${coveragePercent}% of ${totalPapers} papers were classified as relevant`
    });
  }

  if (minYear && maxYear && (maxYear - minYear < 3)) {
    limitations.push({
      type: 'info',
      text: `Sources from short time period (${timeRange}) - limited historical perspective`
    });
  }

  if (uniqueJournals.length === 1) {
    limitations.push({
      type: 'info',
      text: `All sources from one journal - possibly one-sided perspective`
    });
  }

  // Always show default limitation
  limitations.push({
    type: 'default',
    text: 'Results are based only on the uploaded data'
  });

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <span className="text-lg">🌐</span>
          <h4 className="font-semibold text-gray-800">Context & Limitations</h4>
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-amber-700 hover:text-amber-900 transition-colors"
        >
          {showDetails ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {/* Quick Overview */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="bg-white rounded-lg p-2 text-center border border-amber-100">
          <Calendar className="w-4 h-4 mx-auto mb-1 text-amber-600" />
          <p className="text-xs text-gray-500">Time Range</p>
          <p className="text-sm font-medium text-gray-800">{timeRange}</p>
        </div>

        <div className="bg-white rounded-lg p-2 text-center border border-amber-100">
          <Database className="w-4 h-4 mx-auto mb-1 text-amber-600" />
          <p className="text-xs text-gray-500">Sources</p>
          <p className="text-sm font-medium text-gray-800">
            {sources.length} {totalPapers > 0 ? `/ ${totalPapers}` : ''}
          </p>
        </div>

        <div className="bg-white rounded-lg p-2 text-center border border-amber-100">
          <Globe className="w-4 h-4 mx-auto mb-1 text-amber-600" />
          <p className="text-xs text-gray-500">Journals</p>
          <p className="text-sm font-medium text-gray-800">{uniqueJournals.length}</p>
        </div>
      </div>

      {/* Limitations (always visible) */}
      <div className="space-y-2">
        {limitations.slice(0, showDetails ? limitations.length : 2).map((limitation, idx) => (
          <div
            key={idx}
            className={`flex items-start space-x-2 text-sm rounded p-2
              ${limitation.type === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                limitation.type === 'info' ? 'bg-blue-50 text-blue-700' :
                'bg-gray-50 text-gray-600'}
            `}
          >
            <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5
              ${limitation.type === 'warning' ? 'text-yellow-600' :
                limitation.type === 'info' ? 'text-blue-500' :
                'text-gray-400'}
            `} />
            <span>{limitation.text}</span>
          </div>
        ))}
      </div>

      {/* Extended Details */}
      {showDetails && (
        <div className="mt-3 pt-3 border-t border-amber-200">
          <p className="text-sm font-medium text-gray-700 mb-2">Used Journals:</p>
          <div className="flex flex-wrap gap-1">
            {uniqueJournals.length > 0 ? (
              uniqueJournals.map((journal, idx) => (
                <span
                  key={idx}
                  className="px-2 py-1 bg-white text-gray-600 rounded text-xs border border-amber-200"
                >
                  {journal}
                </span>
              ))
            ) : (
              <span className="text-sm text-gray-500">No journal information available</span>
            )}
          </div>

          <div className="mt-3 p-2 bg-amber-100 rounded text-xs text-amber-800">
            <strong>Interpretation note:</strong> Results reflect only the
            perspectives of the found sources. For a complete picture,
            consult additional literature.
          </div>
        </div>
      )}
    </div>
  );
}
