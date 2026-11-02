import { Page, expect } from '@playwright/test';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type BrowserFetchResult = {
  ok: boolean;
  status: number;
  contentType: string;
  json: JsonValue;
  text: string;
};

export async function apiGET(page: Page, url: string): Promise<BrowserFetchResult> {
  return page.evaluate(async (inputUrl) => {
    const res = await fetch(inputUrl, {
      method: 'GET',
      credentials: 'include',
      headers: {
        accept: 'application/json',
      },
    });

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    let json: JsonValue = null;
    try {
      json = contentType.includes('application/json') ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return {
      ok: res.ok,
      status: res.status,
      contentType,
      json,
      text,
    };
  }, url);
}

export type JsonObject = { [key: string]: JsonValue };

export function asObject(value: JsonValue): JsonObject {
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBeFalsy();
  expect(typeof value).toBe('object');
  return value as JsonObject;
}
