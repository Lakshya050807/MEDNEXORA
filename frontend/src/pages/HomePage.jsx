import { useEffect, useMemo, useState } from 'react';
import CategoryCard from '../components/CategoryCard.jsx';
import Icon from '../components/Icon.jsx';
import ProductCard from '../components/ProductCard.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { categories } from '../data/catalog.js';
import { catalogApi } from '../services/catalogApi.js';

function scrollToFeatured() {
  requestAnimationFrame(() => document.getElementById('featured')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function browseSearch(event, searchText) {
  event.preventDefault();
  const query = searchText.trim();
  window.location.assign(query ? `/study-material?q=${encodeURIComponent(query)}` : '/study-material');
}

export default function HomePage() {
  const [searchText, setSearchText] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [materials, setMaterials] = useState([]);
  const [targetExams, setTargetExams] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [catalogState, setCatalogState] = useState('loading');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogState('loading');
    Promise.all([
      catalogApi.listProducts({ limit: 50, sort: 'newest' }, { signal: controller.signal }),
      catalogApi.listExams({ signal: controller.signal }),
      catalogApi.listSubjects(undefined, { signal: controller.signal }),
    ]).then(([catalogue, exams, availableSubjects]) => {
      setMaterials(catalogue.items);
      setTargetExams(exams);
      setSubjects(availableSubjects);
      setCatalogState('ready');
    }).catch((error) => {
      if (error?.name !== 'AbortError') setCatalogState('error');
    });
    return () => controller.abort();
  }, [retryCount]);

  const filteredMaterials = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase();
    return materials.filter((material) => {
      const category = categories.find((item) => item.id === activeCategory);
      const matchesCategory = activeCategory === 'all' || category?.resourceTypes.includes(material.resourceType);
      const searchableText = [material.title, material.subjectName, material.examName, material.categoryLabel, ...(material.keywords ?? [])].join(' ').toLocaleLowerCase();
      return matchesCategory && (!query || searchableText.includes(query));
    });
  }, [activeCategory, materials, searchText]);

  const mockTests = materials.filter((item) => ['mock-test', 'practice-paper'].includes(item.resourceType));
  const coursesAndBundles = materials.filter((item) => ['video-course', 'crash-course', 'bundle'].includes(item.resourceType));
  const freeResources = materials.filter((item) => item.isFree);

  const selectCategory = (categoryId) => {
    setActiveCategory(categoryId);
    setSearchText('');
  };

  const showAllMaterials = () => {
    setActiveCategory('all');
    setSearchText('');
  };

  const updateSearch = (value) => {
    setSearchText(value);
    setActiveCategory('all');
  };

  return (
    <div className="site-shell">
      <SiteHeader />

      <main>
        <section className="hero-section" id="home" aria-labelledby="hero-title">
          <div className="page-width hero-layout">
            <div className="hero-copy">
              <p className="eyebrow"><span className="eyebrow-dot" /> GOVERNMENT COMPETITIVE EXAM PREPARATION</p>
              <h1 id="hero-title">Prepare with focus for <span>Government Competitive Examinations.</span></h1>
              <p className="hero-description">Explore subject resources, question practice, mock tests and video lessons for your selected government competitive examination.</p>

              <form className="hero-search" role="search" onSubmit={(event) => browseSearch(event, searchText)}>
                <Icon name="search" size={21} />
                <label className="sr-only" htmlFor="resource-search">Search entrance subjects and practice resources</label>
                <input
                  id="resource-search"
                  type="search"
                  value={searchText}
                  onChange={(event) => updateSearch(event.target.value)}
                  placeholder="Search subjects, mock tests, study resources..."
                />
                {searchText && <button className="clear-search" type="button" onClick={() => setSearchText('')}>Clear</button>}
                <button className="search-submit" type="submit">Search</button>
              </form>
              <div className="quick-searches" aria-label="Popular subject searches">
                <span>Subjects:</span>
                {['Biology', 'Chemistry', 'Physics'].map((term) => (
                  <button key={term} type="button" onClick={() => { updateSearch(term); scrollToFeatured(); }}>{term}</button>
                ))}
              </div>
              <a className="hero-text-link" href="#target-exams">Choose your target exam <Icon name="arrow" size={17} /></a>
            </div>

            <div className="hero-visual" aria-label="Illustration of an entrance exam preparation plan">
              <div className="visual-top-label"><span className="status-dot" /> YOUR PREPARATION SPACE</div>
              <div className="visual-main-card">
                <div className="planner-heading">
                  <span className="planner-icon"><Icon name="bookmark" size={20} /></span>
                  <span><small>TARGET EXAM</small><strong>{targetExams[0]?.name || 'Choose your target exam'}</strong></span>
                  <Icon name="arrowUpRight" className="planner-arrow" size={18} />
                </div>
                <div className="planner-divider" />
                <p className="planner-label">PREPARE BY SUBJECT</p>
                <div className="planner-subject">
                  <span className="subject-mark anatomy-mark"><Icon name="book" size={19} /></span>
                  <span><strong>Subject materials</strong><small>{targetExams.length ? 'Browse resources by configured subject' : 'Choose an exam to view mapped resources'}</small></span>
                </div>
                <div className="planner-subject">
                  <span className="subject-mark practice-mark"><Icon name="checklist" size={19} /></span>
                  <span><strong>Mock tests & practice</strong><small>Published resources show their exam mapping</small></span>
                </div>
                <a className="planner-link" href="#target-exams">Set your target exam <Icon name="arrow" size={16} /></a>
              </div>
              <div className="floating-note note-top"><Icon name="spark" size={17} /><span>Class 12 & eligible candidates</span></div>
              <div className="floating-note note-bottom"><span className="note-check">✓</span><span>Study at your own pace</span></div>
              <span className="visual-orbit visual-orbit-one" />
              <span className="visual-orbit visual-orbit-two" />
            </div>
          </div>
          <div className="hero-bottom-rule"><span /> <span>PREPARE FOR YOUR NEXT GOVERNMENT COMPETITIVE EXAM</span> <span /></div>
        </section>

        <section className="section target-exams-section" id="target-exams" aria-labelledby="target-exams-title">
          <div className="page-width">
            <div className="section-heading">
              <div>
                <p className="eyebrow">START WITH YOUR GOAL</p>
                <h2 id="target-exams-title">Choose your <span>target entrance examination.</span></h2>
              </div>
                <p className="section-intro">Choose from published Government Competitive Examinations. Eligibility, syllabus and pattern details are maintained separately for each exam.</p>
            </div>
            {catalogState === 'loading' ? <div className="catalog-state-panel" role="status"><span className="loading-mark" /><h3>Loading exam configurations</h3><p>Getting published Government Competitive Examinations.</p></div> : catalogState === 'error' ? <div className="catalog-state-panel" role="alert"><h3>Exam configurations unavailable</h3><p>The catalogue API could not be reached.</p><button className="secondary-button" type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button></div> : targetExams.length ? <div className="target-exam-grid">
              {targetExams.map((exam, index) => (
                <a className="target-exam-card" href={`/study-material?examId=${encodeURIComponent(exam.id ?? exam._id)}`} key={exam.id ?? exam._id}>
                  <span className="target-exam-index">0{index + 1}</span>
                  {exam.isPrimary && <span className="target-exam-primary-label">Primary target</span>}
                  <strong>{exam.name}</strong>
                  <span className="target-exam-description">{exam.description}</span>
                  <span className="target-exam-action">View matching resources <Icon name="arrowUpRight" size={16} /></span>
                </a>
              ))}
            </div> : <div className="catalog-state-panel"><h3>No published entrance exams yet</h3><p>Exam names, eligibility, syllabus and pattern appear here after an administrator publishes verified configuration.</p></div>}
            {targetExams.length > 0 && <p className="exam-data-note"><Icon name="shield" size={16} /> Exam-specific details and official-source references are managed in the catalogue. Check the current official notice before relying on them.</p>}
          </div>
        </section>

        <section className="section categories-section" id="categories" aria-labelledby="categories-title">
          <div className="page-width">
            <div className="section-heading">
              <div>
                <p className="eyebrow">PREPARE YOUR WAY</p>
                <h2 id="categories-title">Find the right <span>kind of practice.</span></h2>
              </div>
              <p className="section-intro">Browse by what you need today, then check exam mapping before relying on a resource.</p>
            </div>
            <div className="category-grid">
              {categories.map((category) => (
                <CategoryCard key={category.id} category={category} onSelect={selectCategory} />
              ))}
            </div>
          </div>
        </section>

        <section className="section subjects-section" id="subjects" aria-labelledby="subjects-title">
          <div className="page-width">
            <div className="section-heading">
              <div>
                <p className="eyebrow">SUBJECT-WISE PREPARATION</p>
                <h2 id="subjects-title">Explore subjects and <span>study materials.</span></h2>
              </div>
              <p className="section-intro">Subject coverage stays configurable for each selected examination.</p>
            </div>
            <div className="subject-link-grid">
              {subjects.map((subject, index) => (
                <a className="subject-link-card" href={`/study-material?subjectId=${encodeURIComponent(subject.id ?? subject._id)}`} key={subject.id ?? subject._id}>
                  <span className={`subject-link-icon subject-link-icon-${index + 1}`}><Icon name={index === 0 ? 'book' : index === 4 ? 'spark' : 'file'} size={19} /></span>
                  <span><strong>{subject.name}</strong><small>Browse published resources</small></span>
                  <Icon name="arrowUpRight" className="subject-link-arrow" size={16} />
                </a>
              ))}
            </div>
            {catalogState === 'loading' && <div className="catalog-state-panel" role="status"><span className="loading-mark" /><h3>Loading subjects</h3><p>Getting published exam subjects.</p></div>}
            {catalogState === 'ready' && !subjects.length && <div className="catalog-state-panel"><h3>Subjects will appear here</h3><p>Subjects and topics are configured for each published entrance examination.</p></div>}
          </div>
        </section>

        <section className="section featured-section" id="featured" aria-labelledby="featured-title">
          <div className="page-width">
            <div className="section-heading featured-heading">
              <div>
                <p className="eyebrow">PUBLISHED CATALOGUE</p>
                <h2 id="featured-title">Entrance preparation <span>resources.</span></h2>
              </div>
              <button className="text-button" type="button" onClick={showAllMaterials}>View all resources <Icon name="arrow" size={17} /></button>
            </div>

            <div className="catalog-notice"><Icon name="spark" size={16} /><span>Only published resources appear here. Previous-year papers are labeled as verified only when source and legal-availability checks are recorded.</span></div>

            <div className="filter-summary" aria-live="polite">
              <span>{filteredMaterials.length} {filteredMaterials.length === 1 ? 'resource' : 'resources'}</span>
              {(activeCategory !== 'all' || searchText) && (
                <button type="button" onClick={showAllMaterials}>Clear filters <Icon name="close" size={14} /></button>
              )}
            </div>

            {catalogState === 'loading' ? <div className="catalog-state-panel" role="status"><span className="loading-mark" /><h3>Loading entrance resources</h3><p>Fetching published study materials.</p></div> : null}
            {catalogState === 'error' ? <div className="catalog-state-panel" role="alert"><h3>Catalogue unavailable</h3><p>The published catalogue could not be loaded. Please check the API connection and try again.</p><button className="secondary-button" type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button></div> : null}
            {catalogState === 'ready' && filteredMaterials.length ? (
              <div className="product-grid">
                {filteredMaterials.slice(0, 6).map((material) => <ProductCard key={material.id} product={material} />)}
              </div>
            ) : catalogState === 'ready' ? (
              <div className="empty-results">
                <span className="empty-icon"><Icon name="search" size={25} /></span>
                <h3>No published resources match</h3>
                <p>{activeCategory === 'previous-year-papers' ? 'No verified previous-year papers are currently published for this catalogue.' : 'Try another search or clear the category filter to browse published resources.'}</p>
                <button className="secondary-button" type="button" onClick={showAllMaterials}>Show all resources</button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="section test-section" id="mock-tests" aria-labelledby="mock-title">
          <div className="page-width">
            <div className="section-heading">
              <div>
                <p className="eyebrow">PRACTICE WITH PURPOSE</p>
                <h2 id="mock-title">Mock tests and <span>practice questions.</span></h2>
              </div>
              <a className="text-button" href="/study-material?resourceType=mock-test">Browse practice <Icon name="arrow" size={17} /></a>
            </div>
            <p className="section-intro mock-section-note">Use published mock tests and practice papers for structured revision. Exam mapping is shown on each resource.</p>
            <div className="product-grid mock-product-grid">
              {mockTests.slice(0, 3).map((item) => <ProductCard key={item.id} product={item} />)}
            </div>
            {catalogState === 'ready' && mockTests.length === 0 && <p className="progress-placeholder-note">Mock tests and practice papers will appear when published for the selected exam.</p>}
          </div>
        </section>

        <section className="section course-section" id="courses" aria-labelledby="course-title">
          <div className="page-width">
            <div className="section-heading">
              <div>
                <p className="eyebrow">LEARN AT YOUR OWN PACE</p>
                <h2 id="course-title">Popular courses and <span>preparation bundles.</span></h2>
              </div>
              <div className="section-intro"><p>Explore published recorded lectures, crash courses and subject bundles.</p><a href="/courses">Browse all courses <Icon name="arrow" size={15} /></a></div>
            </div>
            <div className="product-grid course-product-grid">
              {coursesAndBundles.map((item) => <ProductCard key={item.id} product={item} />)}
            </div>
            {catalogState === 'ready' && coursesAndBundles.length === 0 && <p className="progress-placeholder-note">Courses and bundles will appear here when published.</p>}
          </div>
        </section>

        <section className="section free-practice-section" id="free-practice" aria-labelledby="free-practice-title">
          <div className="page-width free-practice-panel">
            <div className="free-practice-copy">
              <p className="eyebrow">START WITH A FREE RESOURCE</p>
              <h2 id="free-practice-title">Try a little <span>practice first.</span></h2>
              <p>Start with a free resource, then use exam and subject filters to find relevant preparation materials.</p>
              {freeResources[0] ? <a className="secondary-button" href={`/products/${encodeURIComponent(freeResources[0].id)}`}>View free practice resource <Icon name="arrow" size={16} /></a> : <span className="progress-placeholder-note">No free resources are published yet.</span>}
            </div>
            <span className="free-practice-icon"><Icon name="checklist" size={30} /></span>
          </div>
        </section>

        <section className="section progress-section" id="progress" aria-labelledby="progress-title">
          <div className="page-width">
            <div className="section-heading">
              <div>
                <p className="eyebrow">A CLEARER PREPARATION ROUTINE</p>
                <h2 id="progress-title">Build your plan. <span>Track your practice.</span></h2>
              </div>
              <p className="section-intro">Progress indicators will reflect completed practice, not placeholder scores.</p>
            </div>
            <div className="prep-step-grid">
              <article className="prep-step-card"><span>01</span><Icon name="bookmark" size={20} /><h3>Choose an exam</h3><p>Start with the entrance exam you are preparing for.</p></article>
              <article className="prep-step-card"><span>02</span><Icon name="book" size={20} /><h3>Study by subject</h3><p>Use subject resources after checking the exam-specific mapping.</p></article>
              <article className="prep-step-card"><span>03</span><Icon name="checklist" size={20} /><h3>Review practice</h3><p>Use completed questions and tests to guide your next revision session.</p></article>
            </div>
            <p className="progress-placeholder-note">Progress tracking will appear after completed practice activity is available.</p>
          </div>
        </section>

        <section className="section benefits-section" id="why-mednexora" aria-labelledby="benefits-title">
          <div className="page-width">
            <div className="center-heading">
              <p className="eyebrow">SUPPORT FOR THE ADMISSION JOURNEY</p>
              <h2 id="benefits-title">Preparation built around <span>your target exam.</span></h2>
            </div>
            <div className="benefit-grid">
              <article className="benefit-card"><span className="benefit-icon"><Icon name="bookmark" size={22} /></span><h3>Exam-specific when verified</h3><p>Each exam can have separate subject, syllabus and pattern configuration.</p></article>
              <article className="benefit-card"><span className="benefit-icon"><Icon name="shield" size={22} /></span><h3>Clear resource labels</h3><p>Previous-year papers are distinguished from original practice materials and require verified legal availability.</p></article>
              <article className="benefit-card"><span className="benefit-icon"><Icon name="heart" size={22} /></span><h3>Made for aspirants</h3><p>Resources are intended for Class 12 students, 12th-pass learners and other eligible candidates.</p></article>
            </div>
          </div>
        </section>

        <section className="section stories-section" id="student-stories" aria-labelledby="stories-title">
          <div className="page-width story-placeholder">
            <span className="story-icon"><Icon name="quote" size={26} /></span>
            <div>
              <p className="eyebrow">CANDIDATE STORIES</p>
              <h2 id="stories-title">Real preparation stories <span>will come from real learners.</span></h2>
              <p>We’ll add student feedback after candidates have used the platform. No testimonials are invented for this preview.</p>
            </div>
            <span className="story-note">STUDENT STORIES<br />COMING SOON</span>
          </div>
        </section>
      </main>

      <SiteFooter />

    </div>
  );
}
