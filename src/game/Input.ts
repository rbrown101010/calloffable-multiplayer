export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  released = new Set<string>();
  buttons = new Set<number>();
  buttonsPressed = new Set<number>();
  buttonsReleased = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** Debug/automation: treat the pointer as always locked and derive deltas from client coordinates. */
  forceLocked = false;
  /** Trackpad scheme: ignore scroll-wheel weapon switching (two-finger drift). */
  trackpad = false;
  onLockChange?: (locked: boolean) => void;
  private el: HTMLElement;
  private lastX = -1; private lastY = -1; private wheelAcc = 0; private lastWheel = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.matches('input, textarea, select, [contenteditable]')) return;
      if (['Space', 'Tab', 'KeyR', 'KeyQ', 'KeyG', 'KeyC', 'KeyF', 'AltLeft', 'AltRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); this.released.add(e.code); });
    window.addEventListener('mousemove', (e) => {
      if (this.forceLocked) { if (this.lastX >= 0) { this.mouseDX += e.clientX - this.lastX; this.mouseDY += e.clientY - this.lastY; } this.lastX = e.clientX; this.lastY = e.clientY; return; }
      if (!this.locked) return; this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => { if (!this.locked && !this.forceLocked) return; this.buttons.add(e.button); this.buttonsPressed.add(e.button); });
    window.addEventListener('mouseup', (e) => { this.buttons.delete(e.button); this.buttonsReleased.add(e.button); });
    window.addEventListener('wheel', (e) => {
      if ((!this.locked && !this.forceLocked) || this.trackpad) return;
      // trackpads emit tiny deltas constantly: accumulate and require a deliberate notch
      this.wheelAcc += e.deltaY; const now = performance.now();
      if (Math.abs(this.wheelAcc) > 45 && now - this.lastWheel > 220) { this.wheel += Math.sign(this.wheelAcc); this.wheelAcc = 0; this.lastWheel = now; }
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => { if (this.locked || this.forceLocked) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.keys.clear(); this.buttons.clear(); }
      this.onLockChange?.(this.locked);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  lock() {
    try {
      const p: any = (this.el as any).requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') p.catch(() => this.el.requestPointerLock());
    } catch { this.el.requestPointerLock(); }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code: string) { return this.keys.has(code); }
  hit(code: string) { return this.pressed.has(code); }
  up(code: string) { return this.released.has(code); }
  btn(b: number) { return this.buttons.has(b); }
  btnHit(b: number) { return this.buttonsPressed.has(b); }
  btnUp(b: number) { return this.buttonsReleased.has(b); }

  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.buttonsPressed.clear(); this.buttonsReleased.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this.wheelAcc *= 0.6;
  }
}
