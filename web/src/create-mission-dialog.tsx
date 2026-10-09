/**
 * The "Create new mission" dialog. It collects the planning fields Parallix
 * owns (title, description and context, labels, success criteria, dependencies)
 * and sends them as one typed creation request. The host allocates the identity
 * and records the mission in backlog; nothing here starts an agent.
 *
 * The form keeps one `requestKey` for its whole life, so a retry after a
 * failure or a lost response cannot create a second mission. Failures leave
 * every entered value in place.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import type { WebCreateMissionRequest } from '../../src/interfaces/web/transport.js';
import { sendCreateMission } from './board-data.js';
import { C } from './palette.js';

export interface DependencyOption { readonly id: string; readonly title: string }

const FIELD: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: C.log, border: `1px solid ${C.cardEdge}`, borderRadius: 4,
  color: C.text, fontFamily: 'inherit', fontSize: 12, padding: '6px 8px',
};
const LABEL: CSSProperties = { display: 'block', color: C.muted, fontSize: 10.5, letterSpacing: 0.6, margin: '10px 0 4px' };
const BUTTON: CSSProperties = { borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, letterSpacing: 0.5, padding: '5px 12px' };

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),textarea:not([disabled])';

function lines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

function newRequestKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `form-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function DependencyPicker({ options, selected, disabled, onChange }: {
  options: readonly DependencyOption[]; selected: readonly string[]; disabled: boolean; onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]);
  return (
    <div>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); } }}
        style={{ ...FIELD, textAlign: 'left', cursor: 'pointer' }}
      >
        {selected.length === 0 ? 'Select dependencies…' : `${selected.length} selected: ${selected.join(', ')}`}
      </button>
      {open && (
        <fieldset
          id={panel}
          aria-label="Unfinished missions"
          onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}
          style={{ ...FIELD, margin: '4px 0 0', maxHeight: 150, overflowY: 'auto' }}
        >
          {options.length === 0 && <p style={{ margin: 0, color: C.dim }}>No unfinished missions to depend on.</p>}
          {options.map((option) => (
            <label key={option.id} style={{ display: 'flex', gap: 7, alignItems: 'baseline', padding: '2px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.includes(option.id)} onChange={() => toggle(option.id)} />
              <span style={{ color: C.cyan }}>{option.id}</span>
              <span style={{ color: C.muted }}>{option.title}</span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

type Built = { readonly request: WebCreateMissionRequest } | { readonly problem: string; readonly focusTitle: boolean };

/**
 * Turn the form's current entries into the typed request, or the one problem to
 * show. Text fields are uncontrolled: the DOM is the single owner of what was
 * typed, so a failed request can never discard an entry.
 */
function buildRequest(form: HTMLFormElement, requestKey: string, dependencies: readonly string[]): Built {
  const read = (name: string) => ((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '').trim();
  const [title, description, context] = [read('title'), read('description'), read('context')];
  if (title === '') { return { problem: 'Title is required. Enter a short name for the mission.', focusTitle: true }; }
  if (description === '' && context !== '') {
    return { problem: 'Add a description, or clear the context.', focusTitle: false };
  }
  return {
    request: {
      kind: 'mission:create', requestKey, title,
      ...(description === '' ? {} : { description, ...(context === '' ? {} : { context }) }),
      labels: read('labels').split(',').map((label) => label.trim()).filter(Boolean),
      successCriteria: lines(read('criteria')),
      dependencies,
    },
  };
}

function Fields({ id, pending, invalidTitle, titleField }: { id: string; pending: boolean; invalidTitle: boolean; titleField: RefObject<HTMLInputElement | null> }) {
  return (
    <>
      <label style={LABEL} htmlFor={`${id}-title`}>Title (required)</label>
      <input id={`${id}-title`} name="title" ref={titleField} style={FIELD} disabled={pending} aria-invalid={invalidTitle} />
      <label style={LABEL} htmlFor={`${id}-description`}>Description</label>
      <textarea id={`${id}-description`} name="description" rows={3} style={FIELD} disabled={pending} />
      <label style={LABEL} htmlFor={`${id}-context`}>Context (why it matters, optional)</label>
      <textarea id={`${id}-context`} name="context" rows={2} style={FIELD} disabled={pending} />
      <label style={LABEL} htmlFor={`${id}-labels`}>Labels (comma separated)</label>
      <input id={`${id}-labels`} name="labels" style={FIELD} disabled={pending} />
      <label style={LABEL} htmlFor={`${id}-criteria`}>Success criteria (one per line)</label>
      <textarea id={`${id}-criteria`} name="criteria" rows={3} style={FIELD} disabled={pending} />
    </>
  );
}

export function CreateMissionDialog({ options, onClose, onCreated }: {
  options: readonly DependencyOption[];
  /** Dismissal without creating; focus returns to the opener. */
  onClose: () => void;
  /** The host created the mission; the parent refreshes the board. */
  onCreated: (missionId: string) => void;
}) {
  const heading = useId();
  const errorId = useId();
  const dialog = useRef<HTMLElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const requestKey = useRef(newRequestKey());
  const mounted = useRef(true);
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidTitle, setInvalidTitle] = useState(false);
  useEffect(() => {
    titleField.current?.focus();
    return () => { mounted.current = false; };
  }, []);

  const fail = (message: string, focusTitle = false) => {
    setError(message);
    setInvalidTitle(focusTitle);
    if (focusTitle) { titleField.current?.focus(); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) { return; }
    const built = buildRequest(event.currentTarget as HTMLFormElement, requestKey.current, dependencies);
    if ('problem' in built) { fail(built.problem, built.focusTitle); return; }
    submitting.current = true;
    setPending(true);
    setError(null);
    setInvalidTitle(false);
    try {
      const result = await sendCreateMission(built.request);
      const created = (result.value as { missionId?: unknown } | null | undefined)?.missionId;
      if (result.status === 'completed' && typeof created === 'string') {
        if (mounted.current) { onCreated(created); }
        return;
      }
      if (mounted.current) { fail(`${result.error?.message ?? `Creation ${result.status}.`} Your entries are kept — fix them or try again.`); }
    } catch (failure) {
      if (mounted.current) { fail(`Could not reach the board host (${failure instanceof Error ? failure.message : String(failure)}). Your entries are kept — try again.`); }
    } finally {
      submitting.current = false;
      if (mounted.current) { setPending(false); }
    }
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    // The dialog is modal: the board's arrow-key card navigation must not see its keystrokes.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); if (!submitting.current) { onClose(); } return; }
    if (event.key !== 'Tab') { return; }
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (controls.length === 0) { return; }
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = globalThis.document?.activeElement;
    if (event.shiftKey && (active === first || !dialog.current?.contains(active as Node | null))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div
      role="presentation"
      onClick={(event) => { if (event.target === event.currentTarget && !submitting.current) { onClose(); } }}
      style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.6)' }}
    >
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
        onKeyDown={keys}
        style={{ width: 520, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', padding: 18, background: C.panel, border: `1px solid ${C.headEdge}`, borderRadius: 8, color: C.text, fontFamily: 'inherit' }}
      >
        <h2 id={heading} style={{ margin: 0, fontSize: 15, letterSpacing: 1 }}>Create new mission</h2>
        <p style={{ margin: '4px 0 0', color: C.dim, fontSize: 11 }}>The mission is added to the backlog. Nothing is drafted or started.</p>
        <form onSubmit={(event) => { void submit(event); }} noValidate aria-describedby={error === null ? undefined : errorId}>
          <Fields id={heading} pending={pending} invalidTitle={invalidTitle} titleField={titleField} />
          <span style={LABEL}>Dependencies</span>
          <DependencyPicker options={options} selected={dependencies} disabled={pending} onChange={setDependencies} />
          {error !== null && <p id={errorId} role="alert" style={{ margin: '12px 0 0', color: C.red, fontSize: 11.5 }}>{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" onClick={onClose} disabled={pending} style={{ ...BUTTON, background: 'none', border: `1px solid ${C.cardEdge}`, color: C.muted }}>Cancel</button>
            <button type="submit" aria-disabled={pending} style={{ ...BUTTON, background: C.greenFill, border: `1px solid ${C.greenEdge}`, color: C.green, cursor: pending ? 'progress' : 'pointer' }}>
              {pending ? 'Creating…' : 'Create mission'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
