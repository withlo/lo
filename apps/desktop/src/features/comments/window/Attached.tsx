// What a comment box's frame draws of the files attached to it (`./uploads.ts`): their notes, the
// warning first; a row for each file, with its size, how far it has gone and "Cancel", then
// "Uploaded", or "Insert" for one whose placeholder went meanwhile; the dropzone while files are
// dragged over it; and "Attach" in its foot, off where the view's boxes take no uploads. As a box is
// drawn, main is asked once a view whether its account can upload at all.

import {
  CommentBoxDropzone,
  CommentBoxUploads,
  type CommentBoxAttach,
  type CommentBoxNote,
} from '@lo/ui';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

import { usePull, useRun } from '../../tab/window/shared.ts';
import {
  type Attachable,
  type AttachState,
  attachingOf,
  cancelUpload,
  checkUploads,
  insertUpload,
  offNote,
  onUploadsOff,
  pickFiles,
  uploadsHold,
  uploadsOff,
  type UploadsHold,
  whyNoAttach,
} from './uploads.ts';

function useAttaching(box: Attachable): AttachState {
  const attaching = attachingOf(box);
  return useSyncExternalStore(attaching.subscribe, () => attaching.state);
}

/** What a box's frame shows of the files attached to it, and its foot's "Attach". */
export interface BoxUploads {
  /** Its notes of them: why the view takes none, the warning, what went from each, and refusals. */
  readonly notes: CommentBoxNote[];
  readonly attach: CommentBoxAttach;
  /**
   * Why the comment isn't sent yet for its files: one is on its way in, or the text holds a
   * placeholder whose upload isn't.
   */
  readonly hold: UploadsHold | undefined;
}

/**
 * What `box`'s frame shows of its files, with `keys`, "Attach"'s key as this system shows it, while
 * its text is `text`.
 */
export function useUploads(box: Attachable, keys: readonly string[], text: string): BoxUploads {
  const state = useAttaching(box);
  const off = useSyncExternalStore(onUploadsOff, () => uploadsOff(box.view));
  // What "Attach" depends on besides: the view's account, its layers and whether it's offline.
  const pull = usePull(box.view);
  useRun(box.view);
  const login = pull?.acting?.kind === 'account' ? pull.acting.login : undefined;
  useEffect(() => {
    if (login !== undefined) void checkUploads(box.view);
  }, [box.view, login]);
  const notes = [...(off === undefined ? [] : [offNote(off)]), ...state.notes];
  return {
    notes: notes.map((note) => ({ key: note.key, tone: note.tone, text: note.text })),
    attach: {
      keys,
      disabled: whyNoAttach(box.view) !== undefined,
      onClick: () => pickFiles(box),
    },
    hold: uploadsHold(box, text),
  };
}

/** Each file attached to `box`, uploading or uploaded, with "Insert" for one not in its text. */
export function UploadRows({ box }: { box: Attachable }): ReactNode {
  const { rows } = useAttaching(box);
  if (rows.length === 0) return null;
  return (
    <CommentBoxUploads
      uploads={rows.map((row) => ({
        key: row.key,
        name: row.name,
        size: row.size,
        progress: row.progress,
        uploaded: row.uploaded,
        onCancel: () => cancelUpload(box, row.key),
        onInsert: row.unplaced ? () => insertUpload(box, row.key) : undefined,
      }))}
    />
  );
}

/** How many files would be attached, while they're dragged over `box`. */
export function Dropzone({ box }: { box: Attachable }): ReactNode {
  const { dropping } = useAttaching(box);
  return <CommentBoxDropzone dropping={dropping} />;
}
