// The page the avatar spec drives: two avatars that share a picture, served as main serves
// pictures, for Chromium to keep nothing of (`no-store`), drawn once the spec says, and drawn again
// (`redrawPictures`) at an address that counts the changes, or the one they had, as it says.

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Avatar, redrawPictures } from '../../src/Avatar.tsx';

const PICTURE = 'http://pictures.test/cursor.svg';

/** Draws the avatars, as the spec asks once it serves their picture. */
let show: () => void = () => {};

function Scene() {
  const [shown, setShown] = useState(false);
  show = () => setShown(true);
  return (
    <div id="avatars">
      {shown && (
        <>
          <Avatar login="cursor" image={PICTURE} />
          <Avatar login="cursor" image={PICTURE} />
        </>
      )}
    </div>
  );
}

window.addEventListener('show', () => show());
/** How many times the picture changed: its address says so. */
let changes = 0;

window.addEventListener('redraw', () => {
  changes += 1;
  redrawPictures((address) =>
    address.startsWith(PICTURE) ? `${PICTURE}?r=${changes}` : undefined,
  );
});
createRoot(document.getElementById('root')!).render(<Scene />);
