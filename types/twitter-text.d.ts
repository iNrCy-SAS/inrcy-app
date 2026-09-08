declare module "twitter-text" {
  export type ParsedTweet = {
    weightedLength: number;
    valid: boolean;
    permillage: number;
    validRangeStart: number;
    validRangeEnd: number;
    displayRangeStart: number;
    displayRangeEnd: number;
  };

  export function parseTweet(_text: string, _options?: Record<string, unknown>): ParsedTweet;
  export function extractUrlsWithIndices(
    _text: string,
    _options?: { extractUrlsWithoutProtocol?: boolean },
  ): Array<{ url: string; indices: [number, number] }>;

  const twitterText: {
    parseTweet: typeof parseTweet;
    extractUrlsWithIndices: typeof extractUrlsWithIndices;
  };
  export default twitterText;
}
