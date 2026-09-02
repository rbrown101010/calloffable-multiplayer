import './style.css';
import { Game } from './game/Game';

const game = new Game();
(window as any).__game = game;
game.boot().catch((e) => {
  console.error(e);
  const t = document.getElementById('ld-text');
  if (t) t.textContent = 'FAILED TO LOAD: ' + (e?.message || e);
});
