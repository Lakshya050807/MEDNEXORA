import { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import { adminApi } from '../../services/adminApi.js';

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

function idOf(value) {
  if (value && typeof value === 'object') return String(value._id ?? value.id ?? '');
  return value == null ? '' : String(value);
}

function initialValue(field, record) {
  const value = record?.[field.name];
  if (field.toForm) return field.toForm(value, record);
  if (field.type === 'json') {
    const jsonValue = value ?? field.defaultValue;
    return jsonValue == null ? '' : JSON.stringify(jsonValue, null, 2);
  }
  if (field.type === 'multi-select') return (value ?? []).map(idOf);
  if (field.type === 'select') return idOf(value ?? field.defaultValue);
  if (field.type === 'csv' || field.type === 'lines') return Array.isArray(value) ? value.map(idOf).join(field.type === 'csv' ? ', ' : '\n') : value ?? '';
  if (field.type === 'checkbox') return Boolean(value ?? field.defaultValue);
  if (field.type === 'number') return value ?? field.defaultValue ?? '';
  return value ?? field.defaultValue ?? '';
}

function createValues(fields, record = null) {
  return Object.fromEntries(fields.map((field) => [field.name, initialValue(field, record)]));
}

function convertValues(fields, values, isEditing) {
  const output = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.visibleWhen && !field.visibleWhen(values)) continue;
    if (field.omitWhenEmpty && (value === null || value === undefined || value === '')) continue;
    if (field.writeOnly && isEditing && !String(value ?? '').trim()) continue;
    if (field.writeOnly && !String(value ?? '').trim()) continue;
    if (field.toApi) {
      Object.assign(output, field.toApi(value, values));
      continue;
    }
    if (field.type === 'json') {
      try { output[field.name] = value.trim() ? JSON.parse(value) : field.emptyValue ?? null; }
      catch { throw new Error(`${field.label} must contain valid JSON.`); }
    } else if (field.type === 'number') {
      output[field.name] = value === '' ? null : Number(value);
    } else if (field.type === 'multi-select') {
      output[field.name] = Array.isArray(value) ? value : [];
    } else if (field.type === 'checkbox') {
      output[field.name] = Boolean(value);
    } else if (field.type === 'csv' || field.type === 'lines') {
      output[field.name] = String(value ?? '').split(field.type === 'csv' ? ',' : '\n').map((entry) => entry.trim()).filter(Boolean);
    } else {
      output[field.name] = value;
    }
  }
  return output;
}

function getCell(item, column) {
  const value = column.value ? column.value(item) : item[column.name];
  if (value === null || value === undefined || value === '') return '—';
  if (column.type === 'date') return new Date(value).toLocaleDateString('en-IN');
  if (column.type === 'reference') return value?.name || value?.title || idOf(value) || '—';
  return String(value);
}

export default function AdminResourcePanel({
  resource,
  title,
  description,
  fields,
  columns,
  options = {},
  filters = [],
  sortOptions = [
    { value: 'updated-newest', label: 'Recently updated' },
    { value: 'updated-oldest', label: 'Least recently updated' },
  ],
  statusFilter = true,
  onSaved,
  emptyMessage = 'No records match these filters.',
}) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sort, setSort] = useState('updated-newest');
  const [filterValues, setFilterValues] = useState(() => Object.fromEntries(filters.map((filter) => [filter.queryParam, ''])));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null);
  const [formValues, setFormValues] = useState(() => createValues(fields));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formMessage, setFormMessage] = useState(null);

  const load = async (signal) => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await adminApi.list(resource, { page, limit: 10, status, q: appliedSearch, sort, ...filterValues }, { signal });
      setItems(result.items ?? []);
      setPagination(result.pagination ?? { page, pages: 1, total: (result.items ?? []).length });
    } catch (error) {
      if (error?.name !== 'AbortError') setLoadError(error.message || 'Records could not be loaded.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [resource, page, status, appliedSearch, sort, JSON.stringify(filterValues)]);

  const startCreate = () => {
    setEditing(null);
    setFormValues(createValues(fields));
    setFormMessage(null);
    document.getElementById(`admin-form-${resource}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const startEdit = (record) => {
    setEditing(record);
    setFormValues(createValues(fields, record));
    setFormMessage(null);
    document.getElementById(`admin-form-${resource}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const changeStatus = async (record, nextStatus) => {
    setFormMessage(null);
    try {
      await adminApi.update(resource, idOf(record), { publicationStatus: nextStatus });
      setFormMessage({ kind: 'success', text: `Status updated to ${nextStatus}.` });
      await load();
      onSaved?.();
    } catch (error) {
      setFormMessage({ kind: 'error', text: error.message || 'The status could not be changed.' });
    }
  };

  const removeRecord = async (record) => {
    const label = record.title ?? record.name ?? 'this record';
    if (!window.confirm(`Permanently delete “${label}”? Records that still use it must be remapped first.`)) return;
    setFormMessage(null);
    try {
      const result = await adminApi.remove(resource, idOf(record));
      setFormMessage({ kind: 'success', text: result.message || 'Record deleted.' });
      if (editing && idOf(editing) === idOf(record)) {
        setEditing(null);
        setFormValues(createValues(fields));
      }
      await load();
      onSaved?.();
    } catch (error) {
      setFormMessage({ kind: 'error', text: error.message || 'The record could not be deleted.' });
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormMessage(null);
    try {
      const body = convertValues(fields, formValues, Boolean(editing));
      if (editing) await adminApi.update(resource, idOf(editing), body);
      else await adminApi.create(resource, body);
      setFormMessage({ kind: 'success', text: editing ? 'Changes saved.' : 'Record created.' });
      setEditing(null);
      setFormValues(createValues(fields));
      setPage(1);
      await load();
      onSaved?.();
    } catch (error) {
      setFormMessage({ kind: 'error', text: error.message || 'The record could not be saved.' });
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field) => {
    const value = formValues[field.name];
    const isFreePricing = formValues.pricingMode === 'free';
    const setValue = (next) => setFormValues((current) => ({ ...current, [field.name]: next }));
    const fieldId = `admin-field-${resource}-${field.name}`;
    if (field.type === 'checkbox') {
      return <label className="admin-checkbox-field" key={field.name} htmlFor={fieldId}><input id={fieldId} type="checkbox" checked={Boolean(value)} onChange={(event) => setValue(event.target.checked)} /><span>{field.label}</span>{field.help && <small>{field.help}</small>}</label>;
    }
    if (field.type === 'pdf-upload') {
      const uploadFile = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setUploading(true);
        setFormMessage(null);
        try {
          const result = await adminApi.uploadPdf(file);
          if (!result.reference) throw new Error('The server did not return a private file reference.');
          setValue({ reference: result.reference, sizeBytes: result.sizeBytes });
          setFormMessage({ kind: 'success', text: 'PDF uploaded privately. Save this product to attach it.' });
        } catch (error) {
          setFormMessage({ kind: 'error', text: error.message || 'The PDF could not be uploaded.' });
        } finally {
          setUploading(false);
          event.target.value = '';
        }
      };
      return <label className="admin-field admin-field-wide" key={field.name} htmlFor={fieldId}><span>{field.label}</span><input id={fieldId} type="file" accept="application/pdf,.pdf" disabled={uploading} onChange={uploadFile} />{field.help && <small>{field.help}</small>}{value && <small className="admin-upload-state">Private PDF uploaded ({Math.max(1, Math.ceil((value.sizeBytes ?? 0) / 1024))} KB). Save the form to link it to this product.</small>}</label>;
    }
    if (field.type === 'select' || field.type === 'multi-select') {
      const rows = typeof field.options === 'function' ? field.options(options, formValues) : (field.options ?? []);
      const isRequired = field.required || field.requiredWhen?.(formValues) === true;
      const handleSelectChange = (event) => {
        const nextValue = field.type === 'multi-select'
          ? Array.from(event.target.selectedOptions, (option) => option.value)
          : event.target.value;
        if (resource === 'products' && field.name === 'exam') {
          setFormValues((current) => ({ ...current, exam: nextValue, subject: '', chapter: '', topic: '', topics: [] }));
        } else if (resource === 'products' && field.name === 'subject') {
          setFormValues((current) => ({ ...current, subject: nextValue, chapter: '', topic: '', topics: [] }));
        } else if (resource === 'products' && field.name === 'resourceType') {
          setFormValues((current) => ({ ...current, resourceType: nextValue, paperClassification: '', previousYearSource: nextValue === 'previous-year-paper' ? current.previousYearSource : '{}' }));
        } else {
          setValue(nextValue);
        }
      };
      return <label className="admin-field" key={`${field.name}-${field.label}`} htmlFor={fieldId}><span>{field.label}{isRequired && <em>Required</em>}</span><select id={fieldId} multiple={field.type === 'multi-select'} required={isRequired} value={value} onChange={handleSelectChange}>{field.type === 'select' && <option value="">{field.emptyLabel ?? (isRequired ? 'Choose…' : 'Select…')}</option>}{rows.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{field.help && <small>{field.help}</small>}</label>;
    }
    const multiline = field.type === 'textarea' || field.type === 'json' || field.type === 'csv' || field.type === 'lines';
      const pricingDisabled = isFreePricing && ['pricePaise', 'discountPaise'].includes(field.name);
      const displayValue = pricingDisabled ? '0.00' : value;
      return <label className={`admin-field${field.wide || multiline ? ' admin-field-wide' : ''}`} key={field.name} htmlFor={fieldId}><span>{field.label}{field.required && <em>Required</em>}{field.writeOnly && <em>Write only</em>}</span>{multiline ? <textarea id={fieldId} rows={field.rows ?? (field.type === 'json' ? 7 : 3)} required={field.required} value={value} placeholder={field.placeholder} onChange={(event) => setValue(event.target.value)} /> : <input id={fieldId} type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'} min={field.min} max={field.max} step={field.step} required={field.required} disabled={pricingDisabled} value={displayValue} placeholder={field.placeholder} autoComplete={field.type === 'password' ? 'new-password' : 'off'} onChange={(event) => setValue(event.target.value)} />}{field.help && <small>{field.help}</small>}</label>;
  };

  return (
    <section className="admin-resource-panel" aria-labelledby={`admin-${resource}-title`}>
      <div className="admin-panel-heading">
        <div><h2 id={`admin-${resource}-title`}>{title}</h2><p>{description}</p></div>
        <button className="admin-primary-button" type="button" onClick={startCreate}><Icon name="spark" size={16} /> Add {title.replace(/s$/u, '').toLowerCase()}</button>
      </div>

      <section className="admin-editor-card" id={`admin-form-${resource}`} aria-label={`${editing ? 'Edit' : 'Create'} ${title}`}>
        <div className="admin-editor-heading"><div><p className="eyebrow">{editing ? 'EDIT RECORD' : 'NEW RECORD'}</p><h3>{editing ? `Edit ${editing.title ?? editing.name ?? title.replace(/s$/u, '').toLowerCase()}` : `Create ${title.replace(/s$/u, '').toLowerCase()}`}</h3></div>{editing && <button type="button" className="admin-quiet-button" onClick={startCreate}>Cancel edit</button>}</div>
        <form onSubmit={submit} className="admin-resource-form">
          <div className="admin-form-grid">{fields.filter((field) => !field.visibleWhen || field.visibleWhen(formValues)).map(renderField)}</div>
          {formMessage && <p className={`admin-message is-${formMessage.kind}`} role={formMessage.kind === 'error' ? 'alert' : 'status'}>{formMessage.text}</p>}
          <div className="admin-form-actions"><button className="admin-primary-button" type="submit" disabled={saving || uploading}>{uploading ? 'Uploading PDF…' : saving ? 'Saving…' : editing ? 'Save changes' : 'Create record'}</button></div>
        </form>
      </section>

      <div className="admin-list-card">
        <div className="admin-list-toolbar"><form className="admin-search-form" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()); }}><label className="sr-only" htmlFor={`admin-search-${resource}`}>Search {title}</label><input id={`admin-search-${resource}`} type="search" placeholder={`Search ${title.toLowerCase()}…`} value={search} onChange={(event) => setSearch(event.target.value)} /><button className="admin-quiet-button" type="submit"><Icon name="search" size={16} /> Search</button></form><div className="admin-filter-group">{filters.map((filter) => { const rows = typeof filter.options === 'function' ? filter.options(options) : filter.options; return <label className="admin-status-filter" key={filter.queryParam} htmlFor={`admin-filter-${resource}-${filter.queryParam}`}><span>{filter.label}</span><select id={`admin-filter-${resource}-${filter.queryParam}`} value={filterValues[filter.queryParam] ?? ''} onChange={(event) => { setFilterValues((current) => ({ ...current, [filter.queryParam]: event.target.value })); setPage(1); }}><option value="">All</option>{rows.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; })}{statusFilter && <label className="admin-status-filter" htmlFor={`admin-status-${resource}`}><span>Status</span><select id={`admin-status-${resource}`} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}<label className="admin-status-filter" htmlFor={`admin-sort-${resource}`}><span>Sort</span><select id={`admin-sort-${resource}`} value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div></div>
        {loading ? <div className="admin-state" role="status"><span className="loading-mark" /> Loading records…</div> : loadError ? <div className="admin-state is-error" role="alert"><p>{loadError}</p><button className="admin-quiet-button" type="button" onClick={() => void load()}>Try again</button></div> : !items.length ? <div className="admin-state"><Icon name="file" size={21} /><p>{emptyMessage}</p></div> : <div className="admin-table-scroll"><table className="admin-table"><thead><tr>{columns.map((column) => <th key={column.name ?? column.label}>{column.label}</th>)}<th>Updated</th><th>Actions</th></tr></thead><tbody>{items.map((item) => <tr key={idOf(item)}>{columns.map((column) => <td key={column.name ?? column.label}>{column.name === 'publicationStatus' || column.name === 'status' ? <span className={`admin-status-pill status-${getCell(item, column)}`}>{getCell(item, column)}</span> : getCell(item, column)}</td>)}<td>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('en-IN') : '—'}</td><td><div className="admin-row-actions"><button className="admin-quiet-button" type="button" onClick={() => startEdit(item)}>Edit</button>{item.publicationStatus !== undefined && <><button className="admin-quiet-button" type="button" disabled={item.publicationStatus === 'published'} onClick={() => void changeStatus(item, 'published')}>Publish</button><button className="admin-quiet-button" type="button" disabled={item.publicationStatus === 'draft'} onClick={() => void changeStatus(item, 'draft')}>Unpublish</button><button className="admin-quiet-button" type="button" disabled={item.publicationStatus === 'archived'} onClick={() => void changeStatus(item, 'archived')}>Archive</button></>}{['subjects', 'chapters', 'topics'].includes(resource) && <button className="admin-quiet-button" type="button" onClick={() => void removeRecord(item)}>Delete</button>}</div></td></tr>)}</tbody></table></div>}
        {!loading && !loadError && pagination.pages > 1 && <div className="admin-pagination"><span>{pagination.total} records · page {page} of {pagination.pages}</span><div><button type="button" className="admin-quiet-button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><button type="button" className="admin-quiet-button" disabled={page >= pagination.pages} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>}
      </div>
    </section>
  );
}
