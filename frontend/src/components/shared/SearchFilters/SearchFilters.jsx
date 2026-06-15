// SearchFilters — a shared, collapsible "advanced search" bar used by every
// management screen (volunteers / guides / groups / registrations / events).
//
// It always shows a free-text search box, plus a "סינון מתקדם" button that
// opens and closes a panel of structured filters. The screen using it decides
// WHICH filters appear by passing a `fields` list; this component only knows
// how to render them and report changes back up — it holds no business logic.

// React hook for the open/closed state of the advanced panel.
import { useState } from 'react';

// Component styles.
import './SearchFilters.css';


// Normalise one select field's options into a consistent { value, label } list.
// Callers may pass plain strings (["בוקר", "ערב"]) or objects ({ value, label }),
// so we accept both and turn them into the same shape here.
function normaliseOptions(rawOptions) {
  // No options supplied — render an empty list.
  if (!rawOptions) {
    return [];
  }

  return rawOptions.map((option) => {
    // A plain string becomes its own value and label.
    if (typeof option === 'string') {
      return { value: option, label: option };
    }

    // Otherwise assume it already has value/label (label falls back to value).
    return { value: option.value, label: option.label ?? option.value };
  });
}


function SearchFilters({
  // The free-text search box value and its change handler.
  searchValue,
  onSearchChange,

  // Placeholder text for the free-text box.
  searchPlaceholder = '🔍 חיפוש חופשי...',

  // The structured filter fields shown inside the advanced panel.
  // Each field: { name, label, type: 'select' | 'text' | 'number', options?, placeholder? }
  fields = [],

  // The current values of those structured filters, keyed by field name.
  values = {},

  // Called with (fieldName, newValue) whenever one structured filter changes.
  onChange,

  // Called when the user clears all structured filters.
  onClear,
}) {
  // Whether the advanced filter panel is currently open.
  const [isOpen, setIsOpen] = useState(false);

  // How many structured filters currently hold a value — shown as a small
  // badge on the toggle button so an active filter is visible while collapsed.
  const activeCount = fields.filter((field) => {
    const value = values[field.name];
    return value !== undefined && value !== null && value !== '';
  }).length;

  // Render the right control for a single field, based on its type.
  const renderField = (field) => {
    // A dropdown of fixed choices (group, activity time, status…).
    if (field.type === 'select') {
      return (
        <select
          id={`sf-${field.name}`}
          className="sf-control"
          value={values[field.name] ?? ''}
          onChange={(event) => onChange(field.name, event.target.value)}
        >
          {/* The empty "all" choice clears this filter. */}
          <option value="">{field.placeholder || 'הכול'}</option>

          {/* One option per supplied choice. */}
          {normaliseOptions(field.options).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    // A numeric field (e.g. minimum / maximum age).
    if (field.type === 'number') {
      return (
        <input
          id={`sf-${field.name}`}
          className="sf-control"
          type="number"
          inputMode="numeric"
          value={values[field.name] ?? ''}
          placeholder={field.placeholder || ''}
          onChange={(event) => onChange(field.name, event.target.value)}
        />
      );
    }

    // Default: a free-text field that matches "contains" on that column.
    return (
      <input
        id={`sf-${field.name}`}
        className="sf-control"
        type="text"
        value={values[field.name] ?? ''}
        placeholder={field.placeholder || ''}
        onChange={(event) => onChange(field.name, event.target.value)}
      />
    );
  };

  return (
    <div className="sf-wrap" dir="rtl">

      {/* Top row: the always-visible search box + the open/close toggle. */}
      <div className="sf-bar">

        {/* Free-text search — searches across every text column of the screen. */}
        <input
          type="search"
          className="sf-search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label="חיפוש חופשי"
        />

        {/* Only offer the advanced panel when the screen actually defines fields. */}
        {fields.length > 0 && (
          <button
            type="button"
            className={`sf-toggle ${isOpen ? 'is-open' : ''}`}
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            aria-controls="sf-panel"
          >
            <span className="sf-toggle-label">סינון מתקדם</span>

            {/* Badge with the number of active filters (hidden when none). */}
            {activeCount > 0 && (
              <span className="sf-badge" aria-label={`${activeCount} סינונים פעילים`}>
                {activeCount}
              </span>
            )}

            {/* Chevron flips to show the panel's open/closed state. */}
            <span className="sf-chevron" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
          </button>
        )}
      </div>

      {/* The advanced panel — only in the DOM while open. */}
      {isOpen && fields.length > 0 && (
        <div className="sf-panel" id="sf-panel">

          {/* A responsive grid of labelled filter controls. */}
          <div className="sf-grid">
            {fields.map((field) => (
              <div className="sf-field" key={field.name}>
                <label className="sf-field-label" htmlFor={`sf-${field.name}`}>
                  {field.label}
                </label>
                {renderField(field)}
              </div>
            ))}
          </div>

          {/* Footer: clear all structured filters (only when something is set). */}
          {activeCount > 0 && (
            <div className="sf-panel-footer">
              <button type="button" className="sf-clear" onClick={onClear}>
                נקה סינון ({activeCount})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchFilters;
