/** Instagram's complete caption is limited to 2,200 characters. Keep the
 * existing conservative UTF-16 counter consistently across iNrCy; the public
 * provider documentation does not specify a Unicode counting algorithm. */
export const INSTAGRAM_CAPTION_MAX_LENGTH = 2200;

export type InstagramCaptionIssue = {
  field: "caption";
  code: "instagram_caption_too_long";
  length: number;
  limit: number;
  excess: number;
  message: string;
};

export function getInstagramCaptionIssue(caption: string): InstagramCaptionIssue | null {
  const length = caption.length;
  if (length <= INSTAGRAM_CAPTION_MAX_LENGTH) return null;
  const excess = length - INSTAGRAM_CAPTION_MAX_LENGTH;
  return {
    field: "caption", code: "instagram_caption_too_long", length,
    limit: INSTAGRAM_CAPTION_MAX_LENGTH, excess,
    message: `Votre légende Instagram est trop longue de ${excess} caractère${excess === 1 ? "" : "s"}. Raccourcissez-la en tenant compte du titre, de l’appel à l’action et des hashtags.`,
  };
}

export class InstagramCaptionValidationError extends Error {
  readonly issue: InstagramCaptionIssue;
  constructor(issue: InstagramCaptionIssue) {
    super(issue.message);
    this.name = "InstagramCaptionValidationError";
    this.issue = issue;
  }
}
