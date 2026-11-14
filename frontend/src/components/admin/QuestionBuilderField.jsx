import Icon from '../Icon.jsx';

const optionLabels = ['A', 'B', 'C', 'D'];

function idOf(value) {
  const id = value?._id ?? value?.id ?? value;
  return id == null ? '' : String(id);
}

function withFourOptions(question = {}) {
  const options = Array.isArray(question.options) ? [...question.options] : [];
  while (options.length < 4) options.push('');
  return { ...question, options };
}

export default function QuestionBuilderField({ value = [], onChange, topics = [], examId = '', subjectId = '' }) {
  const questions = Array.isArray(value) ? value : [];
  const availableTopics = topics.filter((topic) => (!examId || idOf(topic.exam) === examId)
    && (!subjectId || idOf(topic.subject) === subjectId));

  const update = (index, patch) => onChange(questions.map((question, current) => current === index
    ? { ...withFourOptions(question), ...patch }
    : question));
  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const reordered = [...questions];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onChange(reordered);
  };

  return (
    <fieldset className="admin-question-builder">
      <legend>MCQ questions</legend>
      <p className="admin-field-help">Enter administrator-authored or properly licensed questions. Students never receive answer keys before an allowed result review.</p>
      {!questions.length && <p className="admin-inline-empty">No questions added. A draft bank may be saved empty; add questions before publishing it.</p>}
      {questions.map((rawQuestion, index) => {
        const question = withFourOptions(rawQuestion);
        const extraOptions = question.options.slice(4);
        return (
          <article className="admin-question-card" key={idOf(question) || `new-question-${index}`} aria-label={`Question ${index + 1}`}>
            <header className="admin-question-card-heading"><div><span className="admin-status-pill status-draft">Question {index + 1}</span><small>Single correct answer</small></div><div className="admin-question-order-actions"><button type="button" className="admin-quiet-button" disabled={index === 0} aria-label={`Move question ${index + 1} up`} onClick={() => move(index, -1)}>Move up</button><button type="button" className="admin-quiet-button" disabled={index === questions.length - 1} aria-label={`Move question ${index + 1} down`} onClick={() => move(index, 1)}>Move down</button><button type="button" className="admin-quiet-button" aria-label={`Remove question ${index + 1}`} onClick={() => onChange(questions.filter((_, current) => current !== index))}>Remove</button></div></header>
            <label className="admin-field admin-field-wide"><span>Question prompt</span><textarea required value={question.prompt ?? ''} maxLength={5000} rows={3} onChange={(event) => update(index, { prompt: event.target.value })} /></label>
            <div className="admin-question-options"><strong>Four answer options</strong>{optionLabels.map((label, optionIndex) => <label className="admin-field" key={label}><span>Option {label}</span><input required value={question.options[optionIndex] ?? ''} maxLength={1000} onChange={(event) => { const nextOptions = [...question.options]; nextOptions[optionIndex] = event.target.value; update(index, { options: nextOptions }); }} /></label>)}</div>
            {extraOptions.length > 0 && <div className="admin-question-legacy-note" role="note"><p>This saved question has {question.options.length} options. Reduce it to four before publishing.</p>{extraOptions.map((option, extraIndex) => <div key={`${extraIndex}-${option}`}><span>Legacy option: {option || 'Blank option'}</span><button type="button" className="admin-quiet-button" onClick={() => update(index, { options: question.options.filter((_, optionIndex) => optionIndex !== extraIndex + 4) })}>Remove extra option</button></div>)}</div>}
            <div className="admin-question-meta-grid"><label className="admin-field"><span>Correct answer</span><select value={Number.isInteger(question.correctAnswerIndex) ? question.correctAnswerIndex : 0} onChange={(event) => update(index, { correctAnswerIndex: Number(event.target.value) })}>{optionLabels.map((label, optionIndex) => <option key={label} value={optionIndex}>Option {label}</option>)}</select></label><label className="admin-field"><span>Topic (optional)</span><select value={idOf(question.topic)} onChange={(event) => update(index, { topic: event.target.value || null })}><option value="">No topic</option>{availableTopics.map((topic) => <option key={idOf(topic)} value={idOf(topic)}>{topic.name} · {topic.publicationStatus}</option>)}</select></label></div>
            <label className="admin-field admin-field-wide"><span>Answer explanation</span><textarea value={question.explanation ?? ''} maxLength={5000} rows={3} onChange={(event) => update(index, { explanation: event.target.value })} /></label>
          </article>
        );
      })}
      <button type="button" className="admin-secondary-button" onClick={() => onChange([...questions, { prompt: '', options: ['', '', '', ''], correctAnswerIndex: 0, explanation: '', topic: null }])}><Icon name="plus" size={15} /> Add question</button>
    </fieldset>
  );
}
