export interface NoticeProps {
  /** What to say, or nothing. */
  message: string | undefined;
}

/**
 * A quiet note at the bottom right of the window, for something that didn't happen and why. Its
 * live region is always there, so a screen reader hears each message as it comes.
 */
export function Notice({ message }: NoticeProps) {
  return (
    <div
      role="status"
      aria-atomic="true"
      className="pointer-events-none fixed right-16 bottom-16 left-16 z-toast flex justify-end"
    >
      {message !== undefined && (
        <div className="max-w-toast-w rounded-md bg-bg-overlay px-12 py-8 text-fg shadow-pop text-ui">
          {message}
        </div>
      )}
    </div>
  );
}
