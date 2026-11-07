import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import ProductCard from '../components/ProductCard.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import { materialCategories, resourceTypes, sortOptions } from '../data/catalog.js';
import { catalogApi } from '../services/catalogApi.js';

const pageSize = 12;

export default function StudyMaterialPage() {
  const searchParams = new URLSearchParams(window.location.search);
  const [materials, setMaterials] = useState([]);
  const [exams, setExams] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [topics, setTopics] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 });
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [configError, setConfigError] = useState('');
  const [searchText, setSearchText] = useState(searchParams.get('q') ?? '');
  const [examId, setExamId] = useState(searchParams.get('examId') ?? searchParams.get('exam') ?? 'all');
  const [subjectId, setSubjectId] = useState(searchParams.get('subjectId') ?? 'all');
  const [chapterId, setChapterId] = useState(searchParams.get('chapterId') ?? 'all');
  const [topicId, setTopicId] = useState(searchParams.get('topicId') ?? 'all');
  const requestedType = searchParams.get('resourceType') ?? searchParams.get('type');
  const [resourceType, setResourceType] = useState(resourceTypes.some((item) => item.id === requestedType) ? requestedType : 'all');
  const [category, setCategory] = useState('all');
  const [availability, setAvailability] = useState('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setConfigError('');
    Promise.all([
      catalogApi.listExams({ signal: controller.signal }),
      catalogApi.listSubjects(examId === 'all' ? undefined : examId, { signal: controller.signal }),
    ]).then(([availableExams, availableSubjects]) => {
      setExams(availableExams);
      setSubjects(availableSubjects);
      if (subjectId !== 'all' && !availableSubjects.some((subject) => String(subject._id ?? subject.id) === subjectId)) {
        setSubjectId('all');
        setChapterId('all');
        setTopicId('all');
      }
    }).catch((error) => {
      if (error?.name !== 'AbortError') setConfigError(error.message || 'Exam filters could not be loaded.');
    });
    return () => controller.abort();
  }, [examId]);

  useEffect(() => {
    const controller = new AbortController();
    if (subjectId === 'all') {
      setChapters([]);
      setChapterId('all');
      return () => controller.abort();
    }
    catalogApi.listChapters(subjectId, { signal: controller.signal }).then((availableChapters) => {
      setChapters(availableChapters);
      if (chapterId !== 'all' && !availableChapters.some((chapter) => String(chapter._id ?? chapter.id) === chapterId)) {
        setChapterId('all');
        setTopicId('all');
      }
    }).catch((error) => {
      if (error?.name !== 'AbortError') setConfigError(error.message || 'Chapter filters could not be loaded.');
    });
    return () => controller.abort();
  }, [subjectId]);

  useEffect(() => {
    const controller = new AbortController();
    if (subjectId === 'all') {
      setTopics([]);
      setTopicId('all');
      return () => controller.abort();
    }
    catalogApi.listTopics(subjectId, { signal: controller.signal, chapterId: chapterId === 'all' ? undefined : chapterId }).then(setTopics).catch((error) => {
      if (error?.name !== 'AbortError') setConfigError(error.message || 'Topic filters could not be loaded.');
    });
    return () => controller.abort();
  }, [subjectId, chapterId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState('loading');
    setLoadError('');
    const minPricePaise = minPrice === '' ? undefined : Math.round(Number(minPrice) * 100);
    const maxPricePaise = maxPrice === '' ? undefined : Math.round(Number(maxPrice) * 100);
    catalogApi.listProducts({
      q: searchText.trim(),
      examId: examId === 'all' ? undefined : examId,
      subjectId: subjectId === 'all' ? undefined : subjectId,
      chapterId: chapterId === 'all' ? undefined : chapterId,
      topicId: topicId === 'all' ? undefined : topicId,
      resourceType: resourceType === 'all' ? undefined : resourceType,
      category: category === 'all' ? undefined : category,
      free: availability === 'all' ? undefined : availability,
      minPricePaise,
      maxPricePaise,
      sort: sortBy,
      page,
      limit: pageSize,
    }, { signal: controller.signal }).then((result) => {
      setMaterials(result.items);
      setPagination(result.pagination ?? { page, pages: 0, total: result.items.length });
      setLoadState('ready');
    }).catch((error) => {
      if (error?.name !== 'AbortError') {
        setLoadError(error.message || 'The catalogue could not be loaded.');
        setLoadState('error');
      }
    });
    return () => controller.abort();
  }, [searchText, examId, subjectId, chapterId, topicId, resourceType, category, availability, minPrice, maxPrice, sortBy, page, retryCount]);

  const clearFilters = () => {
    setSearchText('');
    setExamId('all');
    setSubjectId('all');
    setChapterId('all');
    setTopicId('all');
    setResourceType('all');
    setCategory('all');
    setAvailability('all');
    setMinPrice('');
    setMaxPrice('');
    setSortBy('newest');
    setPage(1);
  };

  const hasActiveFilters = Boolean(
    searchText || examId !== 'all' || subjectId !== 'all' || chapterId !== 'all' || topicId !== 'all' || resourceType !== 'all' || category !== 'all' || availability !== 'all' || minPrice || maxPrice,
  );

  return (
    <div className="site-shell">
      <SiteHeader activePage="study-material" />

      <main className="catalog-page">
        <section className="catalog-hero" aria-labelledby="catalog-title">
          <div className="page-width">
            <nav className="catalog-breadcrumb" aria-label="Breadcrumb">
              <a href="/">Home</a><span aria-hidden="true">/</span><span aria-current="page">Government exam resources</span>
            </nav>
            <div className="catalog-hero-copy">
              <p className="eyebrow"><span className="eyebrow-dot" /> GOVERNMENT COMPETITIVE EXAM PREPARATION</p>
              <h1 id="catalog-title">Find resources for your <span>target entrance exam.</span></h1>
              <p>Search published notes, original practice papers, verified previous-year papers, mock tests and courses. Subject, chapter and topic filters come from the configured exam catalogue.</p>
            </div>
            <form className="catalog-search" role="search" onSubmit={(event) => event.preventDefault()}>
              <Icon name="search" size={21} />
              <label className="sr-only" htmlFor="catalog-search-input">Search titles, subjects and topics</label>
              <input id="catalog-search-input" type="search" value={searchText} onChange={(event) => { setSearchText(event.target.value); setPage(1); }} placeholder="Search Biology notes, mock tests, MCQs..." />
              {searchText && <button className="clear-search" type="button" onClick={() => { setSearchText(''); setPage(1); }}>Clear</button>}
            </form>
          </div>
        </section>

        <section className="catalog-section" id="catalog-results" aria-labelledby="results-title">
          <div className="page-width">
            <div className="catalog-notice"><Icon name="shield" size={16} /><span>Only published resources are listed. Original practice papers are labeled separately from verified previous-year papers, which require source and legal-availability records.</span></div>
            {configError && <p className="catalog-config-warning" role="status">Exam, subject, chapter or topic options could not be loaded: {configError}</p>}

            <div className="catalog-content-layout">
              <aside className="catalog-filters" aria-label="Filter study materials">
                <div className="catalog-filter-heading">
                  <div><span className="eyebrow">NARROW YOUR SEARCH</span><h2>Filters</h2></div>
                  {hasActiveFilters && <button type="button" onClick={clearFilters}>Clear all</button>}
                </div>
                <div className="catalog-filter-fields">
                  <label className="catalog-field" htmlFor="exam-filter"><span>Target entrance exam</span>
                    <select id="exam-filter" value={examId} onChange={(event) => { setExamId(event.target.value); setSubjectId('all'); setChapterId('all'); setTopicId('all'); setPage(1); }}>
                      <option value="all">All published exams</option>
                      {exams.map((exam) => <option key={exam._id ?? exam.id} value={exam._id ?? exam.id}>{exam.name}</option>)}
                    </select>
                  </label>
                  <label className="catalog-field" htmlFor="subject-filter"><span>Subject</span>
                    <select id="subject-filter" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setChapterId('all'); setTopicId('all'); setPage(1); }}>
                      <option value="all">All subjects</option>
                      {subjects.map((subject) => <option key={subject._id ?? subject.id} value={subject._id ?? subject.id}>{subject.name}</option>)}
                    </select>
                  </label>
                  <label className="catalog-field" htmlFor="chapter-filter"><span>Chapter</span>
                    <select id="chapter-filter" value={chapterId} disabled={subjectId === 'all'} onChange={(event) => { setChapterId(event.target.value); setTopicId('all'); setPage(1); }}>
                      <option value="all">All chapters</option>
                      {chapters.map((chapter) => <option key={chapter._id ?? chapter.id} value={chapter._id ?? chapter.id}>{chapter.name}</option>)}
                    </select>
                  </label>
                  <label className="catalog-field" htmlFor="topic-filter"><span>Topic</span>
                    <select id="topic-filter" value={topicId} disabled={subjectId === 'all'} onChange={(event) => { setTopicId(event.target.value); setPage(1); }}>
                      <option value="all">All topics</option>
                      {topics.map((topic) => <option key={topic._id ?? topic.id} value={topic._id ?? topic.id}>{topic.name}</option>)}
                    </select>
                  </label>
                  <label className="catalog-field" htmlFor="type-filter"><span>Resource type</span>
                    <select id="type-filter" value={resourceType} onChange={(event) => { setResourceType(event.target.value); setPage(1); }}>
                      <option value="all">All resource types</option>
                      {resourceTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                    </select>
                  </label>
                  <label className="catalog-field" htmlFor="category-filter"><span>Material category</span>
                    <select id="category-filter" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
                      <option value="all">All categories</option>
                      {materialCategories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className="catalog-field" htmlFor="availability-filter"><span>Price availability</span>
                    <select id="availability-filter" value={availability} onChange={(event) => { setAvailability(event.target.value); setPage(1); }}>
                      <option value="all">Free and paid</option>
                      <option value="true">Free resources</option>
                      <option value="false">Paid resources</option>
                    </select>
                  </label>
                  <fieldset className="catalog-price-filter"><legend>Current price range</legend>
                    <div className="price-range-inputs">
                      <label htmlFor="min-price"><span>Min ₹</span><input id="min-price" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0" value={minPrice} onChange={(event) => { setMinPrice(event.target.value); setPage(1); }} /></label>
                      <span aria-hidden="true" className="price-range-separator">to</span>
                      <label htmlFor="max-price"><span>Max ₹</span><input id="max-price" type="number" min="0" step="0.01" inputMode="decimal" placeholder="Any" value={maxPrice} onChange={(event) => { setMaxPrice(event.target.value); setPage(1); }} /></label>
                    </div>
                  </fieldset>
                </div>
              </aside>

              <div className="catalog-results">
                <div className="catalog-results-heading">
                  <div><p className="eyebrow">GOVERNMENT EXAM CATALOGUE</p><h2 id="results-title">Study materials and practice</h2></div>
                  <label className="catalog-sort" htmlFor="sort-materials"><span>Sort by</span>
                    <select id="sort-materials" value={sortBy} onChange={(event) => { setSortBy(event.target.value); setPage(1); }}>
                      {sortOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                </div>

                <div className="catalog-result-count" aria-live="polite">
                  {loadState === 'ready' && <span>{pagination.total ?? materials.length} published {pagination.total === 1 ? 'resource' : 'resources'}</span>}
                  {hasActiveFilters && loadState === 'ready' && <button type="button" onClick={clearFilters}>Reset filters</button>}
                </div>

                {loadState === 'loading' && <div className="catalog-state-panel" role="status"><span className="loading-mark" /><h3>Loading entrance resources</h3><p>Searching the published catalogue.</p></div>}
                {loadState === 'error' && <div className="catalog-state-panel" role="alert"><span className="state-icon"><Icon name="file" size={23} /></span><h3>We couldn’t load the catalogue</h3><p>{loadError}</p><button className="secondary-button" type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button></div>}
                {loadState === 'ready' && materials.length > 0 && <div className="product-grid catalog-product-grid">{materials.map((material) => <ProductCard key={material.id} product={material} />)}</div>}
                {loadState === 'ready' && materials.length === 0 && <div className="empty-results"><span className="empty-icon"><Icon name="search" size={25} /></span><h3>No matching published resources</h3><p>{resourceType === 'previous-year-paper' ? 'No verified previous-year papers are currently published for these filters.' : 'Try another subject or topic, widen the price range, or clear the filters.'}</p><button className="secondary-button" type="button" onClick={clearFilters}>Clear filters</button></div>}

                {loadState === 'ready' && pagination.pages > 1 && <nav className="catalog-pagination" aria-label="Catalogue pages">
                  <button className="secondary-button" type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
                  <span>Page {page} of {pagination.pages}</span>
                  <button className="secondary-button" type="button" disabled={page >= pagination.pages} onClick={() => setPage((current) => current + 1)}>Next</button>
                </nav>}
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
