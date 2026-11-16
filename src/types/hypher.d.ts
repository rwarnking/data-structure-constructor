declare module 'hypher' {
  export default class Hypher {
    constructor(patterns: object)
    hyphenate(word: string): string[]
  }
}

declare module 'hyphenation.en-us' {
  const patterns: object
  export default patterns
}
