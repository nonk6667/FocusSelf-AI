// Lock both the document and the Android content scroller. Reference counts
// keep one overlay from unlocking the page while another overlay is still open.
const locks = new WeakMap<HTMLElement, { count: number; overflow: string }>();
export function lockPageScroll(): () => void {
  const targets = [
    document.body,
    document.querySelector<HTMLElement>("[data-main-scroll]"),
  ].filter((element): element is HTMLElement => element !== null);
  for (const element of targets) {
    const existing = locks.get(element);
    if (existing) existing.count += 1;
    else {
      locks.set(element, { count: 1, overflow: element.style.overflow });
      element.style.overflow = "hidden";
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const element of targets) {
      const lock = locks.get(element);
      if (!lock) continue;
      lock.count -= 1;
      if (lock.count === 0) {
        element.style.overflow = lock.overflow;
        locks.delete(element);
      }
    }
  };
}
