// Debug utility — console.log solo en desarrollo
const IS_DEV: boolean = (globalThis as any).__DEV__ === true;

export const debug = {
  log: (...args: any[]) => { if (IS_DEV) console.log(...args); },
  error: (...args: any[]) => { console.error(...args); },
};
