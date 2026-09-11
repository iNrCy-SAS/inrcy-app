export async function collectStripeListPages<T>(input: {
  fetchPage: (startingAfter: string | null, limit: number) => Promise<{
    data: T[];
    hasMore: boolean;
  }>;
  getId: (row: T) => string | null;
  pageSize?: number;
  maxPages?: number;
}): Promise<{ rows: T[]; pages: number }> {
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 100));
  const maxPages = Math.max(1, input.maxPages ?? 1_000);
  const rows: T[] = [];
  const seenCursors = new Set<string>();
  let startingAfter: string | null = null;
  let pages = 0;

  for (;;) {
    const page = await input.fetchPage(startingAfter, pageSize);
    pages += 1;
    rows.push(...page.data);
    if (!page.hasMore) break;
    if (pages >= maxPages) throw new Error("stripe_pagination_page_limit_exceeded");

    if (page.data.length === 0) throw new Error("stripe_pagination_missing_cursor");
    const cursor = input.getId(page.data[page.data.length - 1]);
    if (!cursor) throw new Error("stripe_pagination_missing_cursor");
    if (seenCursors.has(cursor)) throw new Error("stripe_pagination_repeated_cursor");
    seenCursors.add(cursor);
    startingAfter = cursor;
  }

  return { rows, pages };
}

export async function collectSupabaseRangePages<T>(input: {
  fetchRange: (from: number, to: number) => Promise<T[]>;
  pageSize?: number;
  maxPages?: number;
}): Promise<{ rows: T[]; pages: number }> {
  const pageSize = Math.max(1, input.pageSize ?? 500);
  const maxPages = Math.max(1, input.maxPages ?? 10_000);
  const rows: T[] = [];
  let pages = 0;

  for (let from = 0; ; from += pageSize) {
    const page = await input.fetchRange(from, from + pageSize - 1);
    pages += 1;
    rows.push(...page);
    if (page.length < pageSize) break;
    if (pages >= maxPages) throw new Error("supabase_pagination_page_limit_exceeded");
  }

  return { rows, pages };
}

export async function collectSupabaseKeysetPages<T>(input: {
  fetchPage: (after: string | null, limit: number) => Promise<T[]>;
  getCursor: (row: T) => string | null;
  pageSize?: number;
  maxPages?: number;
}): Promise<{ rows: T[]; pages: number }> {
  const pageSize = Math.max(1, input.pageSize ?? 500);
  const maxPages = Math.max(1, input.maxPages ?? 10_000);
  const rows: T[] = [];
  const seenCursors = new Set<string>();
  let after: string | null = null;
  let pages = 0;

  for (;;) {
    const page = await input.fetchPage(after, pageSize);
    pages += 1;
    rows.push(...page);
    if (page.length < pageSize) break;
    if (pages >= maxPages) throw new Error("supabase_pagination_page_limit_exceeded");

    const cursor = input.getCursor(page[page.length - 1]);
    if (!cursor) throw new Error("supabase_pagination_missing_cursor");
    if (seenCursors.has(cursor)) throw new Error("supabase_pagination_repeated_cursor");
    seenCursors.add(cursor);
    after = cursor;
  }

  return { rows, pages };
}
