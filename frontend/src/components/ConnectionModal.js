import React from 'react';
import { X, Users, Tag, FileText, ExternalLink } from 'lucide-react';

/**
 * ConnectionModal - Shows details of connection between two papers
 * Epistemic Principle: TRANSPARENCY
 *
 * Props:
 * - connection: { source: Paper, target: Paper, sharedAuthors: [], sharedKeywords: [], type: string, reason: string }
 * - onClose: function
 * - onPaperClick: function - When user wants more details about a paper
 */
export default function ConnectionModal({ connection, onClose, onPaperClick }) {
  if (!connection) return null;

  const { source, target, sharedAuthors = [], sharedKeywords = [], type = 'relational', reason = '', strength = 0 } = connection;
  const isRelational = type === 'relational';
  const isSemantic = type === 'semantic';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className={`sticky top-0 border-b px-6 py-4 flex items-center justify-between ${
          isRelational ? 'bg-emerald-50' : 'bg-indigo-50'
        }`}>
          <div>
            <div className="flex items-center">
              <span className={`px-2 py-0.5 rounded text-xs font-medium mr-2 ${
                isRelational
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-indigo-100 text-indigo-700'
              }`}>
                {isRelational ? 'Relational' : 'Semantic'}
              </span>
              <h3 className="text-lg font-semibold text-gray-800">
                Connection between Papers
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/50 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* The two papers */}
          <div className="flex items-center justify-center mb-6">
            <div className="flex-1 text-center p-3 bg-green-50 rounded-lg border border-green-200">
              <FileText className="w-6 h-6 mx-auto mb-2 text-green-600" />
              <p className="text-sm font-medium text-gray-800 line-clamp-2">
                {source?.title || 'Paper A'}
              </p>
            </div>

            <div className="px-4 text-2xl text-gray-400">↔</div>

            <div className="flex-1 text-center p-3 bg-green-50 rounded-lg border border-green-200">
              <FileText className="w-6 h-6 mx-auto mb-2 text-green-600" />
              <p className="text-sm font-medium text-gray-800 line-clamp-2">
                {target?.title || 'Paper B'}
              </p>
            </div>
          </div>

          {/* Transparency Explanation */}
          {isRelational ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6">
              <div className="flex items-center mb-2">
                <span className="text-lg mr-2">🔗</span>
                <h4 className="font-semibold text-emerald-800">Relational Connection</h4>
              </div>
              <p className="text-sm text-emerald-700 mb-3">
                This connection is based on <strong>explicit facts</strong> from the Knowledge Graph (Neo4j).
              </p>
              {reason && (
                <div className="bg-white rounded p-3 text-sm text-emerald-700 font-medium">
                  {reason}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6">
              <div className="flex items-center mb-2">
                <span className="text-lg mr-2">🧠</span>
                <h4 className="font-semibold text-indigo-800">Semantic Connection</h4>
              </div>
              <p className="text-sm text-indigo-700 mb-3">
                This connection is based on <strong>content similarity</strong> of paper texts (vector embeddings).
              </p>
              <div className="bg-white rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-indigo-700 font-medium">Similarity:</span>
                  <span className="text-lg font-bold text-indigo-600">
                    {(strength * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="w-full bg-indigo-100 rounded-full h-2">
                  <div
                    className="bg-indigo-500 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(100, strength * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-indigo-600 mt-2">
                  Based on title, abstract and keywords - interpreted by AI.
                </p>
              </div>
            </div>
          )}

          {/* Shared Authors */}
          {sharedAuthors.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center mb-2">
                <Users className="w-5 h-5 text-indigo-600 mr-2" />
                <h4 className="font-medium text-gray-800">
                  Shared Authors ({sharedAuthors.length})
                </h4>
              </div>
              <div className="flex flex-wrap gap-2 pl-7">
                {sharedAuthors.map((author, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm"
                  >
                    {author}
                  </span>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2 pl-7">
                These authors have contributed to both papers.
              </p>
            </div>
          )}

          {/* Shared Topics/Keywords */}
          {sharedKeywords.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center mb-2">
                <Tag className="w-5 h-5 text-amber-600 mr-2" />
                <h4 className="font-medium text-gray-800">
                  Shared Topics ({sharedKeywords.length})
                </h4>
              </div>
              <div className="flex flex-wrap gap-2 pl-7">
                {sharedKeywords.map((keyword, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2 pl-7">
                Both papers cover these topics.
              </p>
            </div>
          )}

          {/* No connection found - only for relational */}
          {isRelational && sharedAuthors.length === 0 && sharedKeywords.length === 0 && (
            <div className="text-center py-4 text-gray-500">
              <p>No shared properties found.</p>
            </div>
          )}

          {/* Connection strength - only for relational */}
          {isRelational && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-700 mb-2">Connection Strength</h4>
              <div className="flex items-center">
                <div className="flex-1 bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-gradient-to-r from-emerald-400 to-emerald-600 h-3 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (sharedAuthors.length * 30 + sharedKeywords.length * 20))}%`
                    }}
                  />
                </div>
                <span className="ml-3 text-sm font-medium text-gray-600">
                  {sharedAuthors.length > 0 && sharedKeywords.length > 0
                    ? 'Strong'
                    : sharedAuthors.length > 0 || sharedKeywords.length > 1
                    ? 'Medium'
                    : 'Weak'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Based on: {sharedAuthors.length} shared authors, {sharedKeywords.length} shared topics
              </p>
            </div>
          )}

          {/* Paper Details Buttons */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              onClick={() => onPaperClick?.(source)}
              className="flex items-center justify-center px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium text-gray-700"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Paper A Details
            </button>
            <button
              onClick={() => onPaperClick?.(target)}
              className="flex items-center justify-center px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium text-gray-700"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Paper B Details
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
