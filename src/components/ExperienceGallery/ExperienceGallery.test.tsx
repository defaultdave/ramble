import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import type { ImageProps } from 'next/image';
import { describe, expect, it, vi } from 'vitest';
import { samplePhotos } from '@/components/Photo/Photo.fixtures';
import { galleryView } from '@/lib/pages/experience';
import type { PhotoView } from '@/lib/photoViews';
import { ExperienceGallery } from './ExperienceGallery';

// Behaviours under test, one per decision, branch or risk:
// - with no photo the gallery shows its placeholder and no image
// - the photos are in the order given, each named by its alt text, inside a keyboard-focusable group named for the experience
// - only the lead photo is the preload photo
// - with more than one photo each says where it is in the set; a single photo says nothing
// - up to three photos need no "See all"; more offer it, with the count, and list the rest behind it

// next/image makes a data address eager and preloads nothing, so the props it is given are what is checked.
vi.mock('next/image', () => ({
  default: (props: ImageProps) => (
    // eslint-disable-next-line @next/next/no-img-element -- a stand-in that reports the props it received
    <img alt={props.alt} src="data:," data-preload={String(props.preload)} />
  ),
}));

function gallery(count: number) {
  return render(
    <ExperienceGallery
      title="Sunset kayak on the Hudson"
      gallery={galleryView(samplePhotos(count))}
    />,
  );
}

describe('ExperienceGallery', () => {
  it('shows a placeholder and no image when there is no photo', () => {
    gallery(0);
    expect(screen.getByText('Photos are on their way')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('lists the photos in order inside a focusable group named for the experience', () => {
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
          ],
          more: [third as PhotoView],
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

  it('offers "See all" with the count for a fourth photo, and lists the rest behind it', () => {
    gallery(5);
    const summary = screen.getByText('See all 5 photos');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(
      within(details as HTMLElement).getAllByRole('img', { hidden: true }),
    ).toHaveLength(2);
  });
});
