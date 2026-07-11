import React, { useState } from 'react';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';

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

  const confidencePercent = Math.round(confidence * 100);

  // Determine confidence level
  const getConfidenceLevel = (percent) => {
    if (percent >= 80) return { label: 'High', color: 'green' };
    if (percent >= 50) return { label: 'Medium', color: 'yellow' };
    return { label: 'Low', color: 'red' };
  };

  const level = getConfidenceLevel(confidencePercent);

  // Calculate average similarity of sources
  const avgSimilarity = sources.length > 0
    ? Math.round(sources.reduce((sum, s) => sum + (s.similarity || 0), 0) / sources.length * 100)
    : 0;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
      {/* Header with Icon */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <span className="text-lg">🎯</span>
          <h4 className="font-semibold text-gray-800">Transparency</h4>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium
          ${level.color === 'green' ? 'bg-green-100 text-green-700' : ''}
          ${level.color === 'yellow' ? 'bg-yellow-100 text-yellow-700' : ''}
          ${level.color === 'red' ? 'bg-red-100 text-red-700' : ''}
        `}>
          {level.label} Confidence
        </span>
      </div>

      {/* Confidence Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-600">Confidence</span>
          <span className="font-medium text-gray-800">{confidencePercent}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-500
              ${level.color === 'green' ? 'bg-green-500' : ''}
              ${level.color === 'yellow' ? 'bg-yellow-500' : ''}
              ${level.color === 'red' ? 'bg-red-500' : ''}
            `}
            style={{ width: `${confidencePercent}%` }}
          />
        </div>
      </div>

      {/* Explanation Toggle */}
      <button
        onClick={() => setShowExplanation(!showExplanation)}
        className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800 transition-colors"
      >
        <Info className="w-4 h-4" />
        <span>How is confidence calculated?</span>
        {showExplanation ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {/* Explanation (expandable) */}
      {showExplanation && (
        <div className="mt-3 p-3 bg-white rounded-lg border border-blue-100 text-sm">
          <p className="text-gray-700 mb-2">
            <strong>Confidence is based on:</strong>
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
                <strong>Calculation:</strong> Weighted average of similarity scores
              </span>
            </li>
          </ul>
          <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-xs">
            <strong>Note:</strong> High confidence does not mean the answer is correct.
            Please verify the sources.
          </div>
        </div>
      )}
    </div>
  );
}
