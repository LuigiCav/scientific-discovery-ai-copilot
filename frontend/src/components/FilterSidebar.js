import React, { useState, useMemo } from 'react';
import { Filter, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';

/**
 * FilterSidebar - Compact sidebar for graph filters
 *
 * Props:
 * - papers: array - All papers
 * - filters: object - Current filters
 * - onFilterChange: function - Callback on filter change
 */
export default function FilterSidebar({ papers = [], filters, onFilterChange }) {
  // Local filter states
  const [yearRange, setYearRange] = useState(filters?.yearRange || { min: 2015, max: 2025 });
  const [selectedAuthors, setSelectedAuthors] = useState(filters?.authors || []);
  const [selectedKeywords, setSelectedKeywords] = useState(filters?.keywords || []);
  const [selectedAuthorKeywords, setSelectedAuthorKeywords] = useState(filters?.authorKeywords || []);
  const [selectedIndexKeywords, setSelectedIndexKeywords] = useState(filters?.indexKeywords || []);
  const [selectedRankings, setSelectedRankings] = useState(filters?.rankings || { vhb: [], abdc: [] });

  // Collapsed States (section header collapse)
  const [collapsed, setCollapsed] = useState({
    authors: false,
    keywords: true,
    authorKeywords: false,
    indexKeywords: true,
    rankings: true
  });

  // Extract options from papers
  const { authors, keywords, authorKeywords, indexKeywords, years, vhbRankings, abdcRankings } = useMemo(() => {
    const authorsSet = new Set();
    const keywordsSet = new Set();
    const authorKeywordsSet = new Set();
    const indexKeywordsSet = new Set();
    const yearsSet = new Set();
    const vhbSet = new Set();
    const abdcSet = new Set();

    papers.forEach(paper => {
      if (paper.authors) {
        paper.authors.split(';').forEach(a => {
          const name = a.trim().replace(/\s*\(\d+\)/g, '');
          if (name) authorsSet.add(name);
        });
      }
      // Legacy sources field
      if (paper.sources) {
        paper.sources.split(';').forEach(k => {
          if (k.trim()) keywordsSet.add(k.trim());
        });
      }
      // Author Keywords (from author_keywords field)
      if (paper.author_keywords) {
        const kws = Array.isArray(paper.author_keywords)
          ? paper.author_keywords
          : paper.author_keywords.split(';');
        kws.forEach(k => {
          if (k && k.trim()) authorKeywordsSet.add(k.trim());
        });
      }
      // Index/Plus Keywords (from keywords_plus field)
      if (paper.keywords_plus) {
        const kws = Array.isArray(paper.keywords_plus)
          ? paper.keywords_plus
          : paper.keywords_plus.split(';');
        kws.forEach(k => {
          if (k && k.trim()) indexKeywordsSet.add(k.trim());
        });
      }
      if (paper.date) {
        const year = parseInt(paper.date.substring(0, 4));
        if (!isNaN(year)) yearsSet.add(year);
      }
      if (paper.vhbRanking) vhbSet.add(paper.vhbRanking);
      if (paper.abdcRanking) abdcSet.add(paper.abdcRanking);
    });

    return {
      authors: Array.from(authorsSet).sort(),
      keywords: Array.from(keywordsSet).sort(),
      authorKeywords: Array.from(authorKeywordsSet).sort(),
      indexKeywords: Array.from(indexKeywordsSet).sort(),
      years: Array.from(yearsSet).sort((a, b) => a - b),
      vhbRankings: Array.from(vhbSet).sort(),
      abdcRankings: Array.from(abdcSet).sort()
    };
  }, [papers]);

  const minYear = years.length > 0 ? Math.min(...years) : 2015;
  const maxYear = years.length > 0 ? Math.max(...years) : 2025;

  // Apply filters
  const applyFilters = (newFilters) => {
    if (onFilterChange) {
      onFilterChange(newFilters);
    }
  };

  // Toggle functions with immediate update
  const toggleAuthor = (author) => {
    const newAuthors = selectedAuthors.includes(author)
      ? selectedAuthors.filter(a => a !== author)
      : [...selectedAuthors, author];
    setSelectedAuthors(newAuthors);
    applyFilters({ yearRange, authors: newAuthors, keywords: selectedKeywords, authorKeywords: selectedAuthorKeywords, indexKeywords: selectedIndexKeywords, rankings: selectedRankings });
  };

  const toggleKeyword = (keyword) => {
    const newKeywords = selectedKeywords.includes(keyword)
      ? selectedKeywords.filter(k => k !== keyword)
      : [...selectedKeywords, keyword];
    setSelectedKeywords(newKeywords);
    applyFilters({ yearRange, authors: selectedAuthors, keywords: newKeywords, authorKeywords: selectedAuthorKeywords, indexKeywords: selectedIndexKeywords, rankings: selectedRankings });
  };

  const toggleAuthorKeyword = (keyword) => {
    const newKeywords = selectedAuthorKeywords.includes(keyword)
      ? selectedAuthorKeywords.filter(k => k !== keyword)
      : [...selectedAuthorKeywords, keyword];
    setSelectedAuthorKeywords(newKeywords);
    applyFilters({ yearRange, authors: selectedAuthors, keywords: selectedKeywords, authorKeywords: newKeywords, indexKeywords: selectedIndexKeywords, rankings: selectedRankings });
  };

  const toggleIndexKeyword = (keyword) => {
    const newKeywords = selectedIndexKeywords.includes(keyword)
      ? selectedIndexKeywords.filter(k => k !== keyword)
      : [...selectedIndexKeywords, keyword];
    setSelectedIndexKeywords(newKeywords);
    applyFilters({ yearRange, authors: selectedAuthors, keywords: selectedKeywords, authorKeywords: selectedAuthorKeywords, indexKeywords: newKeywords, rankings: selectedRankings });
  };

  const toggleVhbRanking = (ranking) => {
    const newVhb = selectedRankings.vhb.includes(ranking)
      ? selectedRankings.vhb.filter(r => r !== ranking)
      : [...selectedRankings.vhb, ranking];
    const newRankings = { ...selectedRankings, vhb: newVhb };
    setSelectedRankings(newRankings);
    applyFilters({ yearRange, authors: selectedAuthors, keywords: selectedKeywords, authorKeywords: selectedAuthorKeywords, indexKeywords: selectedIndexKeywords, rankings: newRankings });
  };

  const toggleAbdcRanking = (ranking) => {
    const newAbdc = selectedRankings.abdc.includes(ranking)
      ? selectedRankings.abdc.filter(r => r !== ranking)
      : [...selectedRankings.abdc, ranking];
    const newRankings = { ...selectedRankings, abdc: newAbdc };
    setSelectedRankings(newRankings);
    applyFilters({ yearRange, authors: selectedAuthors, keywords: selectedKeywords, authorKeywords: selectedAuthorKeywords, indexKeywords: selectedIndexKeywords, rankings: newRankings });
  };

  const handleYearChange = (type, value) => {
    const newRange = { ...yearRange, [type]: parseInt(value) };
    setYearRange(newRange);
    applyFilters({ yearRange: newRange, authors: selectedAuthors, keywords: selectedKeywords, authorKeywords: selectedAuthorKeywords, indexKeywords: selectedIndexKeywords, rankings: selectedRankings });
  };

  // Reset filters
  const resetFilters = () => {
    setYearRange({ min: minYear, max: maxYear });
    setSelectedAuthors([]);
    setSelectedKeywords([]);
    setSelectedAuthorKeywords([]);
    setSelectedIndexKeywords([]);
    setSelectedRankings({ vhb: [], abdc: [] });
    applyFilters({ yearRange: { min: minYear, max: maxYear }, authors: [], keywords: [], authorKeywords: [], indexKeywords: [], rankings: { vhb: [], abdc: [] } });
  };

  const activeCount = selectedAuthors.length + selectedKeywords.length +
    selectedAuthorKeywords.length + selectedIndexKeywords.length +
    selectedRankings.vhb.length + selectedRankings.abdc.length;

  // Helper function to group items alphabetically
  const groupByFirstLetter = (items) => {
    const groups = {};
    items.forEach(item => {
      const firstLetter = item.charAt(0).toUpperCase();
      if (!groups[firstLetter]) {
        groups[firstLetter] = [];
      }
      groups[firstLetter].push(item);
    });
    return groups;
  };

  // State for expanded letters per list
  const [expandedLetters, setExpandedLetters] = useState({
    authors: {},
    authorKeywords: {},
    indexKeywords: {}
  });

  const toggleLetter = (listKey, letter) => {
    setExpandedLetters(prev => ({
      ...prev,
      [listKey]: {
        ...prev[listKey],
        [letter]: !prev[listKey][letter]
      }
    }));
  };

  // Alphabetical list component with clickable letter buttons
  const AlphabetList = ({ items, selectedItems, onToggle, colorClass, listKey }) => {
    const grouped = groupByFirstLetter(items);
    const letters = Object.keys(grouped).sort();
    const letterExpanded = expandedLetters[listKey] || {};

    // Count selected per letter
    const getSelectedCount = (letter) => {
      return grouped[letter].filter(item => selectedItems.includes(item)).length;
    };

    return (
      <div className="space-y-1">
        {/* Alphabet buttons */}
        <div className="flex flex-wrap gap-1 mb-2">
          {letters.map(letter => {
            const count = grouped[letter].length;
            const selectedCount = getSelectedCount(letter);
            const isExpanded = letterExpanded[letter];

            return (
              <button
                key={letter}
                onClick={() => toggleLetter(listKey, letter)}
                className={`relative min-w-[28px] h-7 px-1.5 text-xs font-medium rounded transition-all ${
                  isExpanded
                    ? 'bg-indigo-500 text-white shadow-sm'
                    : selectedCount > 0
                    ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title={`${letter}: ${count} items`}
              >
                {letter}
                {selectedCount > 0 && !isExpanded && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-indigo-500 text-white text-[9px] rounded-full flex items-center justify-center">
                    {selectedCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Expanded letter sections */}
        <div className="max-h-52 overflow-y-auto space-y-1">
          {letters.filter(letter => letterExpanded[letter]).map(letter => (
            <div key={letter} className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-600 flex justify-between items-center">
                <span>{letter} ({grouped[letter].length})</span>
                <button
                  onClick={() => toggleLetter(listKey, letter)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
              </div>
              <div className="p-1 space-y-0.5 max-h-40 overflow-y-auto">
                {grouped[letter].map(item => (
                  <label key={item} className="flex items-center text-sm cursor-pointer hover:bg-slate-50 p-1.5 rounded transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(item)}
                      onChange={() => onToggle(item)}
                      className={`mr-2 rounded ${colorClass} border-slate-300`}
                    />
                    <span className="truncate text-slate-700" title={item}>
                      {item.length > 28 ? item.substring(0, 28) + '...' : item}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Show selected items if any letter is not expanded */}
        {selectedItems.length > 0 && letters.every(l => !letterExpanded[l]) && (
          <div className="pt-1 border-t border-slate-100">
            <p className="text-xs text-slate-500 mb-1">Selected ({selectedItems.length}):</p>
            <div className="flex flex-wrap gap-1">
              {selectedItems.slice(0, 5).map(item => (
                <span
                  key={item}
                  onClick={() => onToggle(item)}
                  className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full cursor-pointer ${colorClass.replace('text-', 'bg-').replace('600', '100')} ${colorClass}`}
                  title="Click to remove"
                >
                  {item.length > 15 ? item.substring(0, 15) + '...' : item}
                  <span className="ml-1">&times;</span>
                </span>
              ))}
              {selectedItems.length > 5 && (
                <span className="text-xs text-slate-400">+{selectedItems.length - 5} more</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center">
          <div className="w-7 h-7 bg-indigo-100 rounded-lg flex items-center justify-center mr-2">
            <Filter className="w-4 h-4 text-indigo-600" />
          </div>
          <h3 className="font-medium text-gray-800">Filters</h3>
          {activeCount > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium">
              {activeCount}
            </span>
          )}
        </div>
        <button
          onClick={resetFilters}
          className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
          title="Reset filters"
        >
          <RotateCcw className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Time Range */}
        <div>
          <h4 className="text-sm font-medium text-slate-600 mb-2">Time Range</h4>
          <div className="flex items-center space-x-2 text-sm">
            <input
              type="number"
              value={yearRange.min}
              onChange={(e) => handleYearChange('min', e.target.value)}
              min={minYear}
              max={maxYear}
              className="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <span className="text-slate-400">–</span>
            <input
              type="number"
              value={yearRange.max}
              onChange={(e) => handleYearChange('max', e.target.value)}
              min={minYear}
              max={maxYear}
              className="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Authors */}
        <div>
          <button
            onClick={() => setCollapsed(c => ({ ...c, authors: !c.authors }))}
            className="w-full flex items-center justify-between text-sm font-medium text-slate-600 mb-2"
          >
            <span>Authors ({authors.length})</span>
            {collapsed.authors ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
          </button>
          {!collapsed.authors && (
            <AlphabetList
              items={authors}
              selectedItems={selectedAuthors}
              onToggle={toggleAuthor}
              colorClass="text-indigo-600"
              listKey="authors"
            />
          )}
        </div>

        {/* Author Keywords */}
        {authorKeywords.length > 0 && (
          <div>
            <button
              onClick={() => setCollapsed(c => ({ ...c, authorKeywords: !c.authorKeywords }))}
              className="w-full flex items-center justify-between text-sm font-medium text-slate-600 mb-2"
            >
              <span>Author Keywords ({authorKeywords.length})</span>
              {collapsed.authorKeywords ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
            </button>
            {!collapsed.authorKeywords && (
              <AlphabetList
                items={authorKeywords}
                selectedItems={selectedAuthorKeywords}
                onToggle={toggleAuthorKeyword}
                colorClass="text-emerald-600"
                listKey="authorKeywords"
              />
            )}
          </div>
        )}

        {/* Keywords (from Keywords Plus / Index Keywords) */}
        {indexKeywords.length > 0 && (
          <div>
            <button
              onClick={() => setCollapsed(c => ({ ...c, indexKeywords: !c.indexKeywords }))}
              className="w-full flex items-center justify-between text-sm font-medium text-slate-600 mb-2"
            >
              <span>Index Keywords ({indexKeywords.length})</span>
              {collapsed.indexKeywords ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
            </button>
            {!collapsed.indexKeywords && (
              <AlphabetList
                items={indexKeywords}
                selectedItems={selectedIndexKeywords}
                onToggle={toggleIndexKeyword}
                colorClass="text-amber-600"
                listKey="indexKeywords"
              />
            )}
          </div>
        )}

        {/* Rankings */}
        <div>
          <button
            onClick={() => setCollapsed(c => ({ ...c, rankings: !c.rankings }))}
            className="w-full flex items-center justify-between text-sm font-medium text-slate-600 mb-2"
          >
            <span>Journal Rankings</span>
            {collapsed.rankings ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
          </button>
          {!collapsed.rankings && (
            <div className="space-y-3">
              {/* VHB */}
              <div>
                <p className="text-xs text-slate-500 mb-1.5">VHB</p>
                <div className="flex flex-wrap gap-1.5">
                  {['A+', 'A', 'B', 'C'].map(r => (
                    <button
                      key={`vhb-${r}`}
                      onClick={() => toggleVhbRanking(r)}
                      className={`px-2.5 py-1 text-xs rounded-lg transition-colors font-medium ${
                        selectedRankings.vhb.includes(r)
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              {/* ABDC */}
              <div>
                <p className="text-xs text-slate-500 mb-1.5">ABDC</p>
                <div className="flex flex-wrap gap-1.5">
                  {['A*', 'A', 'B', 'C'].map(r => (
                    <button
                      key={`abdc-${r}`}
                      onClick={() => toggleAbdcRanking(r)}
                      className={`px-2.5 py-1 text-xs rounded-lg transition-colors font-medium ${
                        selectedRankings.abdc.includes(r)
                          ? 'bg-purple-500 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
