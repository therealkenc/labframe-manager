import { useState, type ChangeEvent, type SubmitEvent, type JSX } from 'react';
import {
  DEFAULT_QUERY_SEVERITY_THRESHOLD,
  QUERY_SEVERITY_THRESHOLDS,
  telemetryMetadataSchema,
  type QuerySeverityThreshold,
} from '@therealkenc/telemetry/query';
import type { $ZodIssue } from 'zod/v4/core';
import { parseJsonMaybe } from '@therealkenc/app-runtime/core';

import { EMPTY } from './constants.js';
import type { MetadataEntry, Selection, SourceMetadata } from './model.js';

interface FilterBarProps {
  readonly selection: Selection;
  readonly onChange: (selection: Selection) => void;
}

interface MetadataFilterProps {
  readonly metadata: SourceMetadata;
  readonly onChange: (metadata: SourceMetadata) => void;
}

const MetadataFilter = ({ metadata, onChange }: MetadataFilterProps): JSX.Element => {
  const [key, setKey] = useState(EMPTY);
  const [value, setValue] = useState(EMPTY);
  const [error, setError] = useState(EMPTY);
  const add = (): void => {
    const decoded = parseJsonMaybe<unknown>(value);
    const candidate = decoded.ok ? decoded.value : value;
    const result = telemetryMetadataSchema.safeParse({ ...metadata, [key.trim()]: candidate });
    if (!result.success) {
      setError(result.error.issues.map((issue: $ZodIssue) => issue.message).join(' '));
      return;
    }
    onChange(result.data);
    setKey(EMPTY);
    setValue(EMPTY);
    setError(EMPTY);
  };
  const remove = (name: string): void =>
    onChange(
      Object.fromEntries(
        Object.entries(metadata).filter(([existing]: MetadataEntry) => existing !== name)
      )
    );
  return (
    <div className="metadata-filter">
      <div className="metadata-inputs">
        <label>
          Metadata key
          <input
            value={key}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setKey(event.target.value)}
            placeholder="environment"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          Equals
          <input
            value={value}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
            placeholder="prod"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          className="button subtle"
          onClick={add}
          disabled={key.trim().length === 0}
        >
          Add filter
        </button>
      </div>
      {error.length > 0 && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {Object.keys(metadata).length > 0 && (
        <div className="metadata-chips">
          {Object.entries(metadata).map(([name, entry]: MetadataEntry) => (
            <button
              type="button"
              className="metadata-chip"
              key={name}
              onClick={() => remove(name)}
              aria-label={`Remove filter ${name} equals ${String(entry)}`}
            >
              <span>{name}</span>
              <strong>{JSON.stringify(entry)}</strong>
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const FilterBar = ({ selection, onChange }: FilterBarProps): JSX.Element => {
  const [text, setText] = useState(selection.text);
  return (
    <div className="filter-bar">
      <form
        className="search-form"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          onChange({ ...selection, text });
        }}
      >
        <label className="search-field">
          Message contains
          <input
            type="search"
            value={text}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)}
            placeholder="Search log messages…"
            autoComplete="off"
          />
        </label>
        <label>
          Minimum level
          <select
            value={selection.threshold}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              onChange({
                ...selection,
                threshold:
                  QUERY_SEVERITY_THRESHOLDS.find(
                    (threshold: QuerySeverityThreshold) => threshold === event.target.value
                  ) ?? DEFAULT_QUERY_SEVERITY_THRESHOLD,
              })
            }
          >
            {QUERY_SEVERITY_THRESHOLDS.map((threshold: QuerySeverityThreshold) => (
              <option value={threshold} key={threshold}>
                {threshold}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" type="submit">
          Search
        </button>
      </form>
      <MetadataFilter
        metadata={selection.metadata}
        onChange={(metadata: SourceMetadata) => onChange({ ...selection, metadata, run: EMPTY })}
      />
    </div>
  );
};
