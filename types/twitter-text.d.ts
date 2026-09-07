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

  const twitterText: {
    parseTweet: typeof parseTweet;
  };
  export default twitterText;
}
