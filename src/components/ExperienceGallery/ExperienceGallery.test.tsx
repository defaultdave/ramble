import '@testing-library/jest-dom/vitest';
import { act, render, screen, within } from '@testing-library/react';
import type { ImageProps } from 'next/image';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { samplePhotos } from '@/components/Photo/Photo.fixtures';
import {
  restoreWidths,
  stubResizeObserver,
} from '../../../tests/support/resizeObserver';
import { galleryView } from '@/lib/pages/experience';
import type { PhotoView } from '@/lib/photoViews';
import { ExperienceGallery } from './ExperienceGallery';

// Behaviours under test, one per decision, branch or risk:
// - with no photo the gallery shows its placeholder and no image
// - the photos are in the order given, each named by its alt text, inside a group named for the experience that a keyboard can reach before any measuring
// - once measured, a strip that does not overflow is neither a group nor a tab stop, and one that does keeps both, and the change follows the layout
// - only the lead photo is the preload photo
// - with more than one photo each says where it is in the set; a single photo says nothing
// - up to three photos need no "See all"; more offer it, with the count
// - every photo is drawn once, whatever the count, so "See all" holds no copies

// next/image makes a data address eager and preloads nothing, so the props it is given are what is checked.
vi.mock('next/image', () => ({
  default: (props: ImageProps) => (
    // eslint-disable-next-line @next/next/no-img-element -- a stand-in that reports the props it received
    <img alt={props.alt} src="data:," data-preload={String(props.preload)} />
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  restoreWidths();
});

function gallery(count: number) {
  return render(
    <ExperienceGallery
      title="Sunset kayak on the Hudson"
      gallery={galleryView(samplePhotos(count))}
    />,
  );
}

describe('ExperienceGallery', () => {
  beforeEach(() => {
    stubResizeObserver();
  });

  it('shows a placeholder and no image when there is no photo', () => {
    gallery(0);
    expect(screen.getByText('Photos are on their way')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('lists the photos in order inside a focusable group named for the experience', () => {
    stubResizeObserver({ scrollWidth: 1200, clientWidth: 390 });
    gallery(3);
    const group = screen.getByRole('group', {
      name: 'Photos of Sunset kayak on the Hudson',
    });
    expect(group).toHaveAttribute('tabindex', '0');
    expect(
      within(group)
        .getAllByRole('img')
        .map((image) => image.getAttribute('alt')),
    ).toEqual(['Photo 1', 'Photo 2', 'Photo 3']);
  });

  it('is not a group or a tab stop while it fits, and becomes one when it overflows', () => {
    const layout = stubResizeObserver({ scrollWidth: 1200, clientWidth: 1200 });
    gallery(3);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(document.querySelector('[tabindex]')).toBeNull();

    act(() => {
      layout.resize({ scrollWidth: 1200, clientWidth: 390 });
    });
    expect(
      screen.getByRole('group', {
        name: 'Photos of Sunset kayak on the Hudson',
      }),
    ).toHaveAttribute('tabindex', '0');

    act(() => {
      layout.resize({ scrollWidth: 768, clientWidth: 768 });
    });
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('fetches only the lead photo ahead of the rest', () => {
    gallery(3);
    expect(
      screen
        .getAllByRole('img')
        .map((image) => image.getAttribute('data-preload')),
    ).toEqual(['true', 'false', 'false']);
  });

  it('says where each photo is in the set', () => {
    gallery(3);
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
  });

  it('says nothing about position for a single photo', () => {
    gallery(1);
    expect(screen.queryByText(/ of /)).not.toBeInTheDocument();
  });

  it('draws the labels and the lead the view gives, and works none out itself', () => {
    const [first, second, third] = samplePhotos(3);
    const lead = { photo: first as PhotoView, isLead: false, counter: 'A' };
    render(
      <ExperienceGallery
        title="Kayak"
        gallery={{
          layout: 'many',
          photos: [
            lead,
            { photo: second as PhotoView, isLead: true, counter: null },
            { photo: third as PhotoView, isLead: false, counter: null },
          ],
          seeAllLabel: 'Everything',
        }}
      />,
    );

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('Everything')).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('img', { hidden: true })
        .map((image) => image.getAttribute('data-preload')),
    ).toEqual(['false', 'true', 'false']);
  });

  it.each([1, 2, 3])('offers no "See all" for %i photos', (count) => {
    gallery(count);
    expect(screen.queryByText(/See all/)).not.toBeInTheDocument();
  });

  it('offers "See all" with the count for a fourth photo, closed to begin with', () => {
    gallery(5);
    const details = screen.getByText('See all 5 photos').closest('details');
    expect(details).not.toHaveAttribute('open');
  });

  it.each([1, 3, 4, 6, 15])('draws %i photos once each', (count) => {
    gallery(count);
    expect(screen.getAllByRole('img', { hidden: true })).toHaveLength(count);
  });
});
