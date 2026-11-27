// The page the avatar spec drives: two avatars that share a picture, served as main serves
// pictures, for Chromium to keep nothing of (`no-store`), drawn once the spec says. As it says,
// they're drawn again as new avatars at the address they had (`again`), or at an address that
// counts the picture's changes (`redraw`, `redrawPictures`).

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Avatar, redrawPictures } from '../../src/Avatar.tsx';

const PICTURE = 'http://pictures.test/cursor.svg';

/** Draws the avatars, as new ones each time: first as the spec asks once it serves their picture. */
let draw: () => void = () => {};

function Scene() {
  const [drawn, setDrawn] = useState(0);
  draw = () => setDrawn((times) => times + 1);
  return (
    <div id="avatars">
      {drawn > 0 && (
        <div key={drawn}>
          <Avatar login="cursor" image={PICTURE} />
          <Avatar login="cursor" image={PICTURE} />
        </div>
      )}
    </div>
  );
}

/** How many times the picture changed: its address says so. */
let changes = 0;

window.addEventListener('show', () => draw());
window.addEventListener('again', () => draw());
window.addEventListener('redraw', () => {
  changes += 1;
  redrawPictures((address) =>
    address.startsWith(PICTURE) ? `${PICTURE}?r=${changes}` : undefined,
  );
});
createRoot(document.getElementById('root')!).render(<Scene />);
