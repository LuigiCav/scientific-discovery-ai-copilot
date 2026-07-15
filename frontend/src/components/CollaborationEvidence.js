import React from 'react';
import { Users, FileText } from 'lucide-react';

const cleanAuthor = (author) => author.replace(/\s*\(\d+\)\s*$/, '').trim();

export default function CollaborationEvidence({ sources = [] }) {
  if (!sources.length) return null;

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
          <Users className="w-4 h-4" />
        </span>
        <div>
          <h4 className="font-semibold text-slate-800">Collaboration evidence</h4>
          <p className="text-xs text-slate-500">Co-authorship relationships stored in Neo4j</p>
        </div>
      </div>

      <div className="space-y-3">
        {sources.map((source, sourceIndex) => {
          const authors = (source.authors || '')
            .split(';')
            .map(cleanAuthor)
            .filter(Boolean);

          return (
            <div key={source.doi || sourceIndex} className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <div className="flex flex-wrap justify-center gap-2 mb-2">
                {authors.map((author) => (
                  <span key={author} className="px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-medium">
                    {author}
                  </span>
                ))}
              </div>
              <div className="flex justify-center text-indigo-300 text-lg leading-none">↓</div>
              <div className="mt-1 flex items-start justify-center gap-2 text-center text-sm text-slate-700">
                <FileText className="w-4 h-4 mt-0.5 text-slate-400 flex-shrink-0" />
                <span><strong>[{sourceIndex + 1}]</strong> {source.title}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
