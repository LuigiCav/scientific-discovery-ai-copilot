import React, { useState, useMemo } from 'react';
import { Filter, ChevronDown, ChevronUp, X } from 'lucide-react';

/**
 * FilterPanel - Ermöglicht Filterung der Daten vor Graph-Anzeige
 *
 * Props:
 * - papers: array - Alle Papers aus dem Upload
 * - onFilterChange: function - Callback wenn Filter sich ändern
 * - onGenerateGraph: function - Callback wenn "Graph generieren" geklickt wird
 */
export default function FilterPanel({ papers = [], onFilterChange, onGenerateGraph }) {
  // Filter States
  const [yearRange, setYearRange] = useState({ min: 2015, max: 2025 });
  const [selectedAuthors, setSelectedAuthors] = useState([]);
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [selectedRankings, setSelectedRankings] = useState({ vhb: [], abdc: [] });

  // UI States
  const [expandedSection, setExpandedSection] = useState('authors');

  // Extrahiere einzigartige Werte aus Papers
  const { authors, keywords, years, vhbRankings, abdcRankings } = useMemo(() => {
    const authorsSet = new Set();
    const keywordsSet = new Set();
    const yearsSet = new Set();
    const vhbSet = new Set();
    const abdcSet = new Set();

    papers.forEach(paper => {
      // Autoren extrahieren
      if (paper.authors) {
        paper.authors.split(';').forEach(a => {
          const name = a.trim().replace(/\s*\(\d+\)/g, ''); // Entferne IDs
          if (name) authorsSet.add(name);
        });
      }

      // Keywords extrahieren (aus sources Feld)
      if (paper.sources) {
        paper.sources.split(';').forEach(k => {
          const kw = k.trim();
          if (kw) keywordsSet.add(kw);
        });
      }

      // Jahr extrahieren
      if (paper.date) {
        const year = parseInt(paper.date.substring(0, 4));
        if (!isNaN(year)) yearsSet.add(year);
      }

      // Rankings
      if (paper.vhbRanking) vhbSet.add(paper.vhbRanking);
      if (paper.abdcRanking) abdcSet.add(paper.abdcRanking);
    });

    return {
      authors: Array.from(authorsSet).sort(),
      keywords: Array.from(keywordsSet).sort(),
      years: Array.from(yearsSet).sort((a, b) => a - b),
      vhbRankings: Array.from(vhbSet).sort(),
      abdcRankings: Array.from(abdcSet).sort()
    };
  }, [papers]);

  // Min/Max Jahr berechnen
  const minYear = years.length > 0 ? Math.min(...years) : 2015;
  const maxYear = years.length > 0 ? Math.max(...years) : 2025;

  // Toggle Funktionen
  const toggleAuthor = (author) => {
    setSelectedAuthors(prev =>
      prev.includes(author)
        ? prev.filter(a => a !== author)
        : [...prev, author]
    );
  };

  const toggleKeyword = (keyword) => {
    setSelectedKeywords(prev =>
      prev.includes(keyword)
        ? prev.filter(k => k !== keyword)
        : [...prev, keyword]
    );
  };

  const toggleVhbRanking = (ranking) => {
    setSelectedRankings(prev => ({
      ...prev,
      vhb: prev.vhb.includes(ranking)
        ? prev.vhb.filter(r => r !== ranking)
        : [...prev.vhb, ranking]
    }));
  };

  const toggleAbdcRanking = (ranking) => {
    setSelectedRankings(prev => ({
      ...prev,
      abdc: prev.abdc.includes(ranking)
        ? prev.abdc.filter(r => r !== ranking)
        : [...prev.abdc, ranking]
    }));
  };

  // Alle auswählen / abwählen
  const selectAllAuthors = () => setSelectedAuthors([...authors]);
  const clearAllAuthors = () => setSelectedAuthors([]);
  const selectAllKeywords = () => setSelectedKeywords([...keywords]);
  const clearAllKeywords = () => setSelectedKeywords([]);

  // Filter anwenden und Graph generieren
  const handleGenerateGraph = () => {
    const filters = {
      yearRange,
      authors: selectedAuthors,
      keywords: selectedKeywords,
      rankings: selectedRankings
    };

    if (onFilterChange) onFilterChange(filters);
    if (onGenerateGraph) onGenerateGraph(filters);
  };

  // Anzahl aktiver Filter
  const activeFilterCount =
    selectedAuthors.length +
    selectedKeywords.length +
    selectedRankings.vhb.length +
    selectedRankings.abdc.length;

  // Section Toggle
  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <Filter className="w-6 h-6 mr-2 text-indigo-600" />
          <h2 className="text-2xl font-semibold text-gray-800">
            Schritt 2: Daten filtern
          </h2>
        </div>
        {activeFilterCount > 0 && (
          <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm">
            {activeFilterCount} Filter aktiv
          </span>
        )}
      </div>

      <p className="text-gray-600 mb-4">
        Wähle aus, welche Daten im Knowledge Graph angezeigt werden sollen.
      </p>

      {/* Zeitraum Slider */}
      <div className="mb-4 p-4 bg-gray-50 rounded-lg">
        <h3 className="font-medium text-gray-700 mb-2">Zeitraum</h3>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-600">{yearRange.min}</span>
          <input
            type="range"
            min={minYear}
            max={maxYear}
            value={yearRange.min}
            onChange={(e) => setYearRange(prev => ({ ...prev, min: parseInt(e.target.value) }))}
            className="flex-1"
          />
          <input
            type="range"
            min={minYear}
            max={maxYear}
            value={yearRange.max}
            onChange={(e) => setYearRange(prev => ({ ...prev, max: parseInt(e.target.value) }))}
            className="flex-1"
          />
          <span className="text-sm text-gray-600">{yearRange.max}</span>
        </div>
      </div>

      {/* Autoren Section */}
      <div className="mb-3 border rounded-lg">
        <button
          onClick={() => toggleSection('authors')}
          className="w-full p-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 rounded-t-lg"
        >
          <span className="font-medium text-gray-700">
            Autoren ({authors.length} verfügbar, {selectedAuthors.length} ausgewählt)
          </span>
          {expandedSection === 'authors' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>

        {expandedSection === 'authors' && (
          <div className="p-3 border-t">
            <div className="flex space-x-2 mb-2">
              <button onClick={selectAllAuthors} className="text-xs text-indigo-600 hover:underline">Alle auswählen</button>
              <button onClick={clearAllAuthors} className="text-xs text-gray-500 hover:underline">Alle abwählen</button>
            </div>
            <div className="max-h-40 overflow-y-auto flex flex-wrap gap-2">
              {authors.slice(0, 50).map(author => (
                <button
                  key={author}
                  onClick={() => toggleAuthor(author)}
                  className={`px-2 py-1 rounded-full text-xs transition-colors ${
                    selectedAuthors.includes(author)
                      ? 'bg-indigo-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {author.length > 25 ? author.substring(0, 25) + '...' : author}
                </button>
              ))}
              {authors.length > 50 && (
                <span className="text-xs text-gray-500 px-2 py-1">+{authors.length - 50} weitere</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Themen/Keywords Section */}
      <div className="mb-3 border rounded-lg">
        <button
          onClick={() => toggleSection('keywords')}
          className="w-full p-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100"
        >
          <span className="font-medium text-gray-700">
            Themen ({keywords.length} verfügbar, {selectedKeywords.length} ausgewählt)
          </span>
          {expandedSection === 'keywords' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>

        {expandedSection === 'keywords' && (
          <div className="p-3 border-t">
            <div className="flex space-x-2 mb-2">
              <button onClick={selectAllKeywords} className="text-xs text-indigo-600 hover:underline">Alle auswählen</button>
              <button onClick={clearAllKeywords} className="text-xs text-gray-500 hover:underline">Alle abwählen</button>
            </div>
            <div className="max-h-40 overflow-y-auto flex flex-wrap gap-2">
              {keywords.slice(0, 30).map(kw => (
                <button
                  key={kw}
                  onClick={() => toggleKeyword(kw)}
                  className={`px-2 py-1 rounded-full text-xs transition-colors ${
                    selectedKeywords.includes(kw)
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {kw}
                </button>
              ))}
              {keywords.length > 30 && (
                <span className="text-xs text-gray-500 px-2 py-1">+{keywords.length - 30} weitere</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Journal Rankings Section */}
      <div className="mb-4 border rounded-lg">
        <button
          onClick={() => toggleSection('rankings')}
          className="w-full p-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100"
        >
          <span className="font-medium text-gray-700">
            Journal Rankings ({selectedRankings.vhb.length + selectedRankings.abdc.length} ausgewählt)
          </span>
          {expandedSection === 'rankings' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>

        {expandedSection === 'rankings' && (
          <div className="p-3 border-t">
            <div className="grid grid-cols-2 gap-4">
              {/* VHB Rankings */}
              <div>
                <p className="text-sm font-medium text-gray-600 mb-2">VHB Ranking</p>
                <div className="flex flex-wrap gap-2">
                  {['A+', 'A', 'B', 'C', 'D'].map(ranking => (
                    <button
                      key={`vhb-${ranking}`}
                      onClick={() => toggleVhbRanking(ranking)}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        selectedRankings.vhb.includes(ranking)
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {ranking}
                    </button>
                  ))}
                </div>
              </div>

              {/* ABDC Rankings */}
              <div>
                <p className="text-sm font-medium text-gray-600 mb-2">ABDC Ranking</p>
                <div className="flex flex-wrap gap-2">
                  {['A*', 'A', 'B', 'C'].map(ranking => (
                    <button
                      key={`abdc-${ranking}`}
                      onClick={() => toggleAbdcRanking(ranking)}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        selectedRankings.abdc.includes(ranking)
                          ? 'bg-purple-500 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {ranking}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Generate Button */}
      <button
        onClick={handleGenerateGraph}
        className="w-full py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
      >
        Knowledge Graph generieren
      </button>

      <p className="text-xs text-gray-500 mt-2 text-center">
        Ohne Auswahl werden alle Daten angezeigt
      </p>
    </div>
  );
}
