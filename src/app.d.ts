// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces

// Vite raw-text imports (e.g. system-prompt files imported verbatim).
declare module "*?raw" {
  const content: string;
  export default content;
}

declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      authenticated: boolean;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
