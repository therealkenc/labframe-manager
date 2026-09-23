import { useEffect, useState, type JSX } from 'react';
import type { QueryResult } from '@therealkenc/telemetry/query';

import { TELEMETRY_API, hostManagementSnapshotSchema } from '../src/api-contracts.js';
import type {
  HostManagementSnapshot,
  ListenerObservation,
  ManagedProcessObservation,
  ManagedServiceObservation,
  WindowsOnlyOfficeObservation,
} from '../src/contracts.js';
import { request } from './api.js';
import { EMPTY } from './constants.js';

const statusResultSchema = hostManagementSnapshotSchema.transform(
  (value: HostManagementSnapshot) => ({
    ok: true as const,
    value,
  })
);

interface DependencyState {
  readonly snapshot: HostManagementSnapshot | undefined;
  readonly error: string;
  readonly loading: boolean;
}

const NativeObservation = ({
  office,
}: {
  readonly office: WindowsOnlyOfficeObservation;
}): JSX.Element => (
  <>
    <div className="dependency-overview">
      <div>
        <h3>Local Windows installation</h3>
        <p>Installed version {office.installedVersion}</p>
      </div>
      <span className={`status-pill ${office.condition}`}>{office.condition}</span>
    </div>
    {office.notes.map((note: string) => (
      <p className="inline-notice warning" key={note}>
        {note}
      </p>
    ))}
    <h3 className="subsection-title">Windows services</h3>
    <div className="table-scroll">
      <table className="dependency-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>State</th>
            <th>Process</th>
            <th>Start mode</th>
          </tr>
        </thead>
        <tbody>
          {office.services.map((service: ManagedServiceObservation) => (
            <tr key={service.name}>
              <td>
                {service.displayName}
                <span className="table-detail">{service.name}</span>
              </td>
              <td>{service.state}</td>
              <td>{service.processId}</td>
              <td>{service.startMode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {office.services.length === 0 && <p className="muted">No local services observed</p>}
    <details className="probe-details">
      <summary>Process and listener observations</summary>
      <h4>Processes</h4>
      {office.processes.map((process: ManagedProcessObservation) => (
        <p key={process.processId}>
          {process.name} · PID {process.processId} · parent {process.parentProcessId}
        </p>
      ))}
      <h4>Listeners</h4>
      {office.listeners.map((listener: ListenerObservation) => (
        <p key={`${listener.address}:${listener.port}:${listener.processId}`}>
          {listener.address}:{listener.port} · PID {listener.processId}
        </p>
      ))}
    </details>
  </>
);

const Observation = ({ snapshot }: { readonly snapshot: HostManagementSnapshot }): JSX.Element => {
  const { endpoint, native } = snapshot.onlyOffice;
  return (
    <>
      <div className="dependency-overview">
        <div>
          <span className="eyebrow">Document editing</span>
          <h2>ONLYOFFICE endpoint</h2>
        </div>
        <span className={`status-pill ${endpoint.kind}`}>{endpoint.kind}</span>
      </div>
      <dl className="dependency-facts">
        <div>
          <dt>HTTP healthcheck</dt>
          <dd>
            {endpoint.kind === 'healthy'
              ? `Responding · ${endpoint.latencyMilliseconds} ms`
              : endpoint.description}
            {endpoint.kind !== 'unavailable' && (
              <span className="table-detail">{endpoint.url}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Observed at</dt>
          <dd>{new Date(snapshot.observedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Manager</dt>
          <dd>
            PID {snapshot.control.processId} · {snapshot.control.version}
          </dd>
        </div>
      </dl>
      {native.kind === 'windows' ? (
        <NativeObservation office={native} />
      ) : (
        <p className="muted">Local inspection not configured</p>
      )}
    </>
  );
};

export const Dependencies = (): JSX.Element => {
  const [state, setState] = useState<DependencyState>({
    snapshot: undefined,
    error: EMPTY,
    loading: true,
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState((previous: DependencyState) => ({ ...previous, loading: true }));
    void request(TELEMETRY_API.status, statusResultSchema, undefined, controller.signal).then(
      (result: QueryResult<HostManagementSnapshot>) => {
        if (!controller.signal.aborted) {
          setState((previous: DependencyState) =>
            result.ok
              ? { snapshot: result.value, error: EMPTY, loading: false }
              : { ...previous, error: result.error.description, loading: false }
          );
        }
      }
    );
    return (): void => controller.abort();
  }, [revision]);
  return (
    <section
      className="dependencies-panel"
      aria-label="Dependency observations"
      aria-busy={state.loading}
    >
      <div className="dependency-intro">
        <button
          type="button"
          className="button"
          disabled={state.loading}
          onClick={() => setRevision((previous: number) => previous + 1)}
        >
          {state.loading ? 'Checking…' : 'Refresh observations'}
        </button>
      </div>
      {state.error.length > 0 && (
        <p className="inline-notice warning" role="status">
          {state.error}
          {state.snapshot === undefined ? '' : ' Showing the previous observation.'}
        </p>
      )}
      {state.snapshot === undefined ? (
        <div className="empty-state">
          <h3>{state.loading ? 'Checking dependencies…' : 'No observation available'}</h3>
        </div>
      ) : (
        <Observation snapshot={state.snapshot} />
      )}
    </section>
  );
};
