// The published types for @builderbot/provider-baileys@1.4.2 re-export
// `BaileysProvider` via an extension-less relative specifier
// (`export * from './bailey'`), which NodeNext module resolution can't
// follow even though the class exists at runtime. This augmentation patches
// the type surface so we can import it normally.
export {};

declare module "@builderbot/provider-baileys" {
  export class BaileysProvider {
    constructor(args?: Record<string, unknown>);
    on(event: string, listener: (...args: any[]) => void): this;
    saveFile(ctx: any, options?: { path: string }): Promise<string>;
  }
}
