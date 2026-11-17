// The ticker runs only while the document is visible, the map container intersects the viewport and
// nothing else (a lost context) has suspended it.

export interface TickerControl {
  start(): void;
  stop(): void;
}

export interface TickerGate {
  setDocumentHidden(hidden: boolean): void;
  setIntersecting(intersecting: boolean): void;
  setSuspended(suspended: boolean): void;
  readonly running: boolean;
}

export function createTickerGate(control: TickerControl): TickerGate {
  let hidden = false;
  let intersecting = true;
  let suspended = false;
  let running = true;

  function sync(): void {
    const want = !hidden && intersecting && !suspended;
    if (want === running) return;
    running = want;
    if (want) control.start();
    else control.stop();
  }

  return {
    setDocumentHidden(value) {
      hidden = value;
      sync();
    },
    setIntersecting(value) {
      intersecting = value;
      sync();
    },
    setSuspended(value) {
      suspended = value;
      sync();
    },
    get running() {
      return running;
    },
  };
}