import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetContentStore } from '../../../mock/contentMockStore';
import { installMockApi } from '../../../test/utils';
import { createContent, getContent } from './content';

describe('content service', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetContentStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('lists the seeded library', async () => {
    const items = await getContent();
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]).toMatchObject({ id: expect.any(String), title: expect.any(String) });
  });

  it('persists created content so a refetch includes it', async () => {
    const created = await createContent({
      title: 'Showcase',
      description: 'Social posts',
      kind: 'IMAGE',
      downloadUrl: 'https://cdn.test/showcase.jpg',
    });
    expect(created.title).toBe('Showcase');
    expect(created.downloadUrl).toBe('https://cdn.test/showcase.jpg');
    expect(created.share?.copyUrl).toBe('https://cdn.test/showcase.jpg');

    const refetched = await getContent();
    expect(refetched.some((item) => item.id === created.id)).toBe(true);
  });

  it('rejects empty titles', async () => {
    await expect(
      createContent({ title: '  ', kind: 'IMAGE', downloadUrl: 'https://cdn.test/x.jpg' }),
    ).rejects.toThrow();
  });
});
