import React, { useState } from 'react';
import { Info, ChevronDown, ChevronUp, Gauge } from 'lucide-react';

/**
 * TransparencyPanel - Shows confidence with explanation
 * Epistemic Principle: TRANSPARENCY
 *
 * Props:
 * - confidence: number (0-1) - The confidence value
 * - sources: array - The sources used for calculation
 */
export default function TransparencyPanel({ confidence, sources = [] }) {
  const [showExplanation, setShowExplanation] = useState(false);

  if (confidence === null || confidence === undefined) return null;

  const relevancePercent = Math.round(confidence * 100);

  // Determine confidence level
  const getConfidenceLevel = (percent) => {
    // MiniLM query-to-abstract cosine scores commonly sit around 20-40%,
    // even for relevant matches. These are retrieval bands, not probabilities.
    if (percent >= 35) return { label: 'Strong', color: 'green' };
    if (percent >= 25) return { label: 'Relevant', color: 'yellow' };
    return { label: 'Weak', color: 'red' };
  };

  const level = getConfidenceLevel(relevancePercent);

  // Calculate average similarity of sources
  const avgSimilarity = sources.length > 0
    ? Math.round(sources.reduce((sum, s) => sum + (s.similarity || 0), 0) / sources.length * 100)
    : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 shadow-soft">
      {/* Header with Icon */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <span className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
            <Gauge className="w-4 h-4" />
          </span>
          <h4 className="font-semibold text-slate-800">Transparency</h4>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium
          ${level.color === 'green' ? 'bg-green-100 text-green-700' : ''}
          ${level.color === 'yellow' ? 'bg-yellow-100 text-yellow-700' : ''}
          ${level.color === 'red' ? 'bg-red-100 text-red-700' : ''}
        `}>
          {level.label} Retrieval Relevance
        </span>
      </div>

      {/* Confidence Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-600">Best semantic match</span>
          <span className="font-medium text-gray-800">{relevancePercent}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-500
              ${level.color === 'green' ? 'bg-green-500' : ''}
              ${level.color === 'yellow' ? 'bg-yellow-500' : ''}
              ${level.color === 'red' ? 'bg-red-500' : ''}
            `}
            style={{ width: `${relevancePercent}%` }}
          />
        </div>
      </div>

      {/* Explanation Toggle */}
      <button
        onClick={() => setShowExplanation(!showExplanation)}
        className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800 transition-colors"
      >
        <Info className="w-4 h-4" />
        <span>How is retrieval relevance calculated?</span>
        {showExplanation ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {/* Explanation (expandable) */}
      {showExplanation && (
        <div className="mt-3 p-3 bg-white rounded-lg border border-blue-100 text-sm">
          <p className="text-gray-700 mb-2">
            <strong>Retrieval relevance is based on:</strong>
          </p>
          <ul className="space-y-1 text-gray-600">
            <li className="flex items-start">
              <span className="mr-2">•</span>
              <span>
                <strong>Average similarity:</strong> {avgSimilarity}%
                (Semantic proximity of sources to the question)
              </span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">•</span>
              <span>
                <strong>Number of sources:</strong> {sources.length} papers found
              </span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">•</span>
              <span>
                <strong>Displayed score:</strong> Highest query-to-paper cosine similarity
              </span>
            </li>
          </ul>
          <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-xs">
            <strong>Note:</strong> High retrieval relevance does not prove that the
            generated answer is correct. Please verify the cited sources.
          </div>
        </div>
      )}
    </div>
  );
}
