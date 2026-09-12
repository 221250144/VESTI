import { afterEach, expect, it, vi } from 'vitest';
import { fetchDemoProxy } from './proxyRequest';
import { FALLBACK_PROXY_BASE_URL } from './llmConfig';

afterEach(() => { vi.useRealTimers(); });

function stalledBodyFetch() {
  let receivedHeaders!: () => void;
  const ready = new Promise<void>(resolve => { receivedHeaders = resolve; });
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const response = new Response(new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true });
      },
    }));
    receivedHeaders();
    return response;
  });
  return { fetcher, ready };
}

it('keeps the deadline active after headers until the response body completes', async () => {
  vi.useFakeTimers();
  const { fetcher, ready } = stalledBodyFetch();
  let settled = false;
  const request = fetchDemoProxy({ primaryBaseUrl: FALLBACK_PROXY_BASE_URL, route: 'chat', body: '{}', totalTimeoutMs: 100 }, fetcher)
    .then(response => response.text()).catch(error => error).finally(() => { settled = true; });
  await ready;
  await vi.advanceTimersByTimeAsync(101);
  expect(settled).toBe(true);
  expect(await request).toMatchObject({ name: 'TimeoutError' });
});

it('honors cancellation while reading a response body, not just while waiting for headers', async () => {
  const { fetcher, ready } = stalledBodyFetch();
  const controller = new AbortController();
  let settled = false;
  const request = fetchDemoProxy({ primaryBaseUrl: FALLBACK_PROXY_BASE_URL, route: 'chat', body: '{}', signal: controller.signal }, fetcher)
    .then(response => response.text()).catch(error => error).finally(() => { settled = true; });
  await ready;
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort(new DOMException('Cancelled by user', 'AbortError'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(settled).toBe(true);
  expect(await request).toMatchObject({ name: 'AbortError' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
