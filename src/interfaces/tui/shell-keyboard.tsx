import React from 'react';
import { useInput } from 'ink';
import type { Key } from 'ink';
import type { BoardProjection } from '../../application/projections/board.js';

import type { BoardCommandKind } from '../../application/controller/board-command.js';

import { type NavigationKey } from './navigation.js';

export function navigationKeyForInput(input: string, key: Pick<Key, 'upArrow' | 'downArrow' | 'leftArrow' | 'rightArrow' | 'ctrl' | 'meta'>): NavigationKey | undefined {
  if (key.upArrow) { return 'up'; }
  if (key.downArrow) { return 'down'; }
  if (key.leftArrow) { return 'left'; }
  if (key.rightArrow) { return 'right'; }
  if (key.ctrl || key.meta) { return undefined; }
  return ({ w: 'up', a: 'left', s: 'down', d: 'right' } as const)[input];
}

/** PTYs can normalize Enter from carriage return to line feed before Ink reads it. */
function isUnmodifiedEnter(input: string, key: Pick<Key, 'return' | 'ctrl' | 'meta'>): boolean {
  return (input === '\r' || input === '\n' || key.return) && !key.ctrl && !key.meta;
}

/** Ctrl-key lifecycle shortcut to the command it dispatches. */
const LIFECYCLE_SHORTCUTS: Readonly<Record<string, BoardCommandKind>> = {
  d: 'draft:create',
  a: 'active:execute',
  r: 'review:submit',
};
/** The control codes Ink reports for Ctrl+D / Ctrl+A / Ctrl+R. */
const LIFECYCLE_CONTROL_CODES: Readonly<Record<string, string>> = { '\u0004': 'd', '\u0001': 'a', '\u0012': 'r' };

/**
 * Lifecycle shortcuts: Ctrl+D = draft, Ctrl+A = activate, Ctrl+R = review.
 * Ctrl+I (integrate) is excluded: Ink reports Ctrl+I as Tab (0x09) with
 * ctrl:false, so it cannot be distinguished from the Tab focus-toggle binding.
 */
function lifecycleKindForInput(input: string, key: { ctrl: boolean; meta: boolean }, hasSelection: boolean): BoardCommandKind | null {
  if (!hasSelection || key.meta) { return null; }
  if (!key.ctrl && !(input in LIFECYCLE_CONTROL_CODES)) { return null; }
  return LIFECYCLE_SHORTCUTS[LIFECYCLE_CONTROL_CODES[input] ?? input] ?? null;
}

/** Answer an armed prompt: the arming key confirms, Escape cancels, anything else waits. */
function answerArmedPrompt(
  armed: { current: boolean },
  confirmed: boolean,
  cancelled: boolean,
  onConfirm: () => void,
  onCancel: () => void,
): void {
  if (confirmed) { armed.current = false; onConfirm(); return; }
  if (cancelled) { armed.current = false; onCancel(); }
}

/** Up/down move within a focused rail; everything else navigates the board. */
function handleNavigationKey(
  navigation: NavigationKey,
  input: string,
  key: { upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean },
  context: {
    focusedArea: 'rail' | 'board';
    queueItemsList: readonly unknown[];
    setFocusedIdx: (_update: (_previous: number) => number) => void;
    onNavigate: (_direction: NavigationKey) => void;
  },
): void {
  const { focusedArea, queueItemsList, setFocusedIdx, onNavigate } = context;
  if (focusedArea === 'rail' && queueItemsList.length > 0) {
    if (key.upArrow || input === 'w') { setFocusedIdx((previous) => Math.max(0, previous - 1)); return; }
    if (key.downArrow || input === 's') { setFocusedIdx((previous) => Math.min(queueItemsList.length - 1, previous + 1)); return; }
  }
  /* Board area: normal navigation (arrows + WASD). */
  if (focusedArea === 'board') { onNavigate(navigation); return; }
  /* When rail is focused and key is not up/down, treat left/right as board nav. */
  if (key.leftArrow || key.rightArrow || input === 'a' || input === 'd') { onNavigate(navigation); }
}

type KeyHandlerContext = {
  onExit: () => void;
  onNavigate: (_key: NavigationKey | 'self') => void;
  onToggleHelp: () => void;
  onToggleFlow: () => void;
  onToggleDone: () => void;
  onEnterAttention: (_item: BoardProjection['attentionQueue'][number]) => void;
  onStartAction: (_missionId: string) => boolean;
  selectedMissionId: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onLifecycle: (_kind: BoardCommandKind) => boolean;
  queueItemsList: readonly BoardProjection['attentionQueue'][number][];
  focusedIdx: number;
  setFocusedIdx: React.Dispatch<React.SetStateAction<number>>;
  focusedArea: 'rail' | 'board';
  setFocusedArea: React.Dispatch<React.SetStateAction<'rail' | 'board'>>;
};

/** Quit is process-wide and must not be swallowed by a confirmation modal. */
function handleQuitKey(input: string, key: { ctrl: boolean; meta: boolean }, onExit: () => void): boolean {
  if ((input === 'q' && !key.ctrl && !key.meta) || (input === 'c' && key.ctrl)) { onExit(); return true; }
  return false;
}

/**
 * The destructive confirmation answers only to a second Shift+X. Enter, which
 * confirms every ordinary lifecycle command, does nothing while it is armed.
 */
function handleArmedPrompt(
  input: string,
  key: { ctrl: boolean; meta: boolean; escape: boolean; return: boolean },
  cancelArmedRef: { current: boolean },
  confirmationArmedRef: { current: boolean },
  onConfirm: () => void,
  onCancel: () => void,
): boolean {
  if (cancelArmedRef.current) {
    answerArmedPrompt(cancelArmedRef, input === 'X' && !key.ctrl && !key.meta, key.escape, onConfirm, onCancel);
    return true;
  }
  if (confirmationArmedRef.current) {
    answerArmedPrompt(confirmationArmedRef, isUnmodifiedEnter(input, key), key.escape, onConfirm, onCancel);
    return true;
  }
  return false;
}

/** Help/flow/done toggles and the Tab rail/board focus switch. */
function handleToggleKey(
  input: string,
  key: { ctrl: boolean; meta: boolean; tab: boolean },
  context: Pick<KeyHandlerContext, 'onToggleHelp' | 'onToggleFlow' | 'onToggleDone' | 'setFocusedArea'>,
): boolean {
  if (input === '?' && !key.ctrl && !key.meta) { context.onToggleHelp(); return true; }
  if ((input === 'f' || input === 'F') && !key.ctrl && !key.meta) { context.onToggleFlow(); return true; }
  /* Shift+S: toggle done lane collapse.
   * Ink reports Shift+S as input 'S' with no dedicated shift flag. */
  if (input === 'S' && !key.ctrl && !key.meta) { context.onToggleDone(); return true; }
  /* Tab / Shift+Tab: switch focus between rail and board.
   * Ink sets input='' for non-alphanumeric keys; use key.tab instead. */
  if (key.tab && !key.ctrl && !key.meta) {
    context.setFocusedArea((current) => (current === 'rail' ? 'board' : 'rail'));
    return true;
  }
  return false;
}

/** Lifecycle shortcuts (Ctrl+D/A/R) and Shift+X, both arming confirmations. */
function handleLifecycleKey(
  input: string,
  key: { ctrl: boolean; meta: boolean },
  context: Pick<KeyHandlerContext, 'onLifecycle' | 'selectedMissionId'>,
  confirmationArmedRef: { current: boolean },
  cancelArmedRef: { current: boolean },
): boolean {
  const lifecycleKind = lifecycleKindForInput(input, key, Boolean(context.selectedMissionId));
  if (lifecycleKind) { confirmationArmedRef.current = context.onLifecycle(lifecycleKind); return true; }
  /* Shift+X: arm cancellation for the selected mission. */
  if (input === 'X' && !key.ctrl && !key.meta && context.selectedMissionId) {
    cancelArmedRef.current = context.onLifecycle('mission:cancel');
    return true;
  }
  return false;
}

/** Enter selects the focused attention item on the rail or starts the board card's action. */
function handleEnterKey(
  input: string,
  key: { ctrl: boolean; meta: boolean; return: boolean },
  context: Pick<KeyHandlerContext, 'focusedArea' | 'focusedIdx' | 'queueItemsList' | 'onNavigate' | 'onEnterAttention' | 'selectedMissionId' | 'onStartAction'>,
  confirmationArmedRef: { current: boolean },
): void {
  if (!isUnmodifiedEnter(input, key)) { return; }
  if (context.focusedArea === 'rail') {
    /* Enter on the attention rail: select the focused item and show wave-5
     * run-affordance message. Only activates when the rail has keyboard focus;
     * pressing Enter on the board does not trigger attention selection. */
    const item = context.queueItemsList[context.focusedIdx];
    if (item) { context.onNavigate('self'); context.onEnterAttention(item); }
    return;
  }
  if (context.focusedArea === 'board') {
    // The shell's board selection is already the current card; callback uses
    // the same stable mission id as the projection request.
    if (context.selectedMissionId) { confirmationArmedRef.current = context.onStartAction(context.selectedMissionId); }
  }
}

export function KeyHandler({ onExit, onNavigate, onToggleHelp, onToggleFlow, onToggleDone, onEnterAttention, onStartAction, selectedMissionId, onConfirm, onCancel, onLifecycle, queueItems: queueItemsList, focusedAttentionIndex: focusedIdx, setFocusedIdx, focusedArea, setFocusedArea }: {
  readonly onExit: () => void;
  readonly onNavigate: (_key: NavigationKey | 'self') => void;
  readonly onToggleHelp: () => void;
  readonly onToggleFlow: () => void;
  readonly onToggleDone: () => void;
  readonly onEnterAttention: (_item: BoardProjection['attentionQueue'][number]) => void;
  readonly onStartAction: (_missionId: string) => boolean;
  readonly selectedMissionId: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** Returns whether this shortcut opened a confirmation dialog. */
  readonly onLifecycle: (_kind: BoardCommandKind) => boolean;
  readonly queueItems: readonly BoardProjection['attentionQueue'][number][];
  readonly focusedAttentionIndex: number;
  readonly setFocusedIdx: React.Dispatch<React.SetStateAction<number>>;
  readonly focusedArea: 'rail' | 'board';
  readonly setFocusedArea: React.Dispatch<React.SetStateAction<'rail' | 'board'>>;
}): React.ReactElement {
  // Keep Ink's subscription alive across renders. `useInput` resubscribes when
  // its callback identity changes; the shell intentionally re-renders when a
  // confirmation opens or the done lane toggles, so a changing callback can
  // drop the immediately following keypress.
  const latest = React.useRef({
    onExit, onNavigate, onToggleHelp, onToggleFlow, onToggleDone,
    onEnterAttention, onStartAction, selectedMissionId, onConfirm, onCancel,
    onLifecycle, queueItemsList, focusedIdx, setFocusedIdx, focusedArea,
    setFocusedArea,
  });
  latest.current = {
    onExit, onNavigate, onToggleHelp, onToggleFlow, onToggleDone,
    onEnterAttention, onStartAction, selectedMissionId, onConfirm, onCancel,
    onLifecycle, queueItemsList, focusedIdx, setFocusedIdx, focusedArea,
    setFocusedArea,
  };
  const confirmationArmedRef = React.useRef(false);
  /** Armed separately from Enter: cancellation deletes rows, so it takes its own key. */
  const cancelArmedRef = React.useRef(false);

  useInput(React.useCallback((input, key) => {
    const context = latest.current;
    if (handleQuitKey(input, key, context.onExit)) { return; }
    if (handleArmedPrompt(input, key, cancelArmedRef, confirmationArmedRef, context.onConfirm, context.onCancel)) { return; }
    const navigation = navigationKeyForInput(input, key);
    if (navigation) {
      handleNavigationKey(navigation, input, key, { focusedArea: context.focusedArea, queueItemsList: context.queueItemsList, setFocusedIdx: context.setFocusedIdx, onNavigate: context.onNavigate });
      return;
    }
    if (handleToggleKey(input, key, context)) { return; }
    if (handleLifecycleKey(input, key, context, confirmationArmedRef, cancelArmedRef)) { return; }
    handleEnterKey(input, key, context, confirmationArmedRef);
  }, []));

  return <></>;
}
