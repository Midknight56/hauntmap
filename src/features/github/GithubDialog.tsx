import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { DialogFrame } from "../import/DialogFrame";
import { analyzing, BUTTON_CANCEL, BUTTON_CLOSE, heading } from "../import/messages";
import type { IntakePurpose, IntakeService } from "../import/types";
import { runGithubIntake, type GithubState, type GithubUi } from "./githubIntake";
import { BUTTON_LOAD, LABEL_REF, LABEL_URL, LISTING, PRIVACY_NOTE, progress as fetchedText, RESOLVING } from "./messages";

// The GitHub dialog (Requirements 7.1, 7.2, 7.3, 8.2, 8.3, 10.2): the address, the ref when it is needed, the privacy note above
// Load, the progress text and Cancel. The work is the state machine in githubIntake.ts; this file only shows it.

export function GithubDialog({ service, purpose }: { service: IntakeService; purpose: IntakePurpose }) {
  const { deps } = service;
  const urlId = useId();
  const refId = useId();
  const noticeId = useId();
  const [phase, setPhase] = useState<GithubState>("url");
  const [url, setUrl] = useState("");
  const [refShown, setRefShown] = useState(false);
  const [refValue, setRefValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [counts, setCounts] = useState({ done: 0, total: 0 });
  const [focusTick, setFocusTick] = useState(0);

  /** What `Load` reads when it starts, whatever render it was created in. */
  const latest = useRef({ url, refShown, refValue });
  latest.current = { url, refShown, refValue };
  const urlInput = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const loadButton = useRef<HTMLButtonElement>(null);
  const wanted = useRef<"url" | "ref" | "load" | null>(null);
  const controller = useRef<AbortController | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  // The machine asks for focus after it has changed the screen. This effect runs after the frame's own focus move, so it wins.
  // Both are layout effects: focus is in place in the same commit that shows the form again, so the alert and the focused Load appear together.
  useLayoutEffect(() => {
    const target = wanted.current;
    if (target === null || phase !== "url") return;
    wanted.current = null;
    (target === "url" ? urlInput : target === "ref" ? refInput : loadButton).current?.focus();
  }, [focusTick, phase, refShown]);

  const close = (): void => service.close({ ok: false, reason: "cancelled" });

  const load = async (): Promise<void> => {
    const github = deps.github;
    if (github === null || running.current) return;
    running.current = true;
    const abort = new AbortController();
    controller.current = abort;
    const ui: GithubUi = {
      get url() {
        return latest.current.url;
      },
      get refField() {
        return latest.current.refShown ? latest.current.refValue : null;
      },
      controller: abort,
      setState: (state) => {
        if (mounted.current) setPhase(state);
      },
      setProgress: (done, total) => {
        if (mounted.current) setCounts({ done, total });
      },
      showRefField: (value) => {
        if (!mounted.current) return;
        setRefShown(true);
        setRefValue(value);
      },
      setNotice: (message) => {
        if (mounted.current) setNotice(message);
      },
      focus: (target) => {
        if (!mounted.current) return;
        wanted.current = target;
        setFocusTick((tick) => tick + 1);
      },
    };
    try {
      const outcome = await runGithubIntake({ ...deps, github }, purpose, ui);
      if (!mounted.current) return;
      if (outcome.ok) service.close(outcome);
      else if (outcome.reason === "failed" && purpose === "after") service.close(outcome);
    } finally {
      running.current = false;
    }
  };

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void load();
  };

  let body;
  if (phase === "url") {
    body = (
      <>
        <div className="intake-field">
          <label htmlFor={urlId}>{LABEL_URL}</label>
          <input
            id={urlId}
            ref={urlInput}
            type="text"
            value={url}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={notice !== null ? noticeId : undefined}
            onChange={(event) => setUrl(event.currentTarget.value)}
            onKeyDown={onFieldKey}
          />
        </div>
        {refShown ? (
          <div className="intake-field">
            <label htmlFor={refId}>{LABEL_REF}</label>
            <input
              id={refId}
              ref={refInput}
              type="text"
              value={refValue}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={notice !== null ? noticeId : undefined}
              onChange={(event) => setRefValue(event.currentTarget.value)}
              onKeyDown={onFieldKey}
            />
          </div>
        ) : null}
        {notice !== null ? (
          <p id={noticeId} className="intake-cap" role="alert">
            {notice}
          </p>
        ) : null}
        <p className="intake-muted">{PRIVACY_NOTE}</p>
        <div className="intake-actions">
          <button type="button" className="primary" ref={loadButton} onClick={() => void load()}>
            {BUTTON_LOAD}
          </button>
          <button type="button" onClick={close}>
            {BUTTON_CLOSE}
          </button>
        </div>
      </>
    );
  } else {
    const text = phase === "resolving" ? RESOLVING : phase === "listing" ? LISTING : phase === "fetching" ? fetchedText(counts.done, counts.total) : analyzing(counts.done, counts.total);
    body = (
      <>
        <p className="intake-progress">{text}</p>
        <div className="intake-actions">
          <button type="button" onClick={() => controller.current?.abort()}>
            {BUTTON_CANCEL}
          </button>
        </div>
      </>
    );
  }

  return (
    <DialogFrame title={heading("github", purpose)} busy={phase !== "url"} screenKey={phase === "url" ? "form" : "working"} onEscape={close}>
      {body}
    </DialogFrame>
  );
}
