import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ImageProps } from 'next/image';
import { describe, expect, it, vi } from 'vitest';
import { Photo } from './Photo';
import { samplePhoto } from './Photo.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - a photo is an image named by its alt text, and a decorative photo (empty alt) is not announced
// - it fills its frame, shows its blur placeholder while it loads, and asks for the sizes it was given
// - it is fetched ahead of the rest, at high priority, only when it is the preload photo

// next/image makes a data address eager and preloads nothing, so the props it is given are what is checked.
vi.mock('next/image', () => ({
  default: (props: ImageProps) => (
    // eslint-disable-next-line @next/next/no-img-element -- a stand-in that reports the props it received
    <img
      alt={props.alt}
      src="data:,"
      data-fill={String(props.fill)}
      data-sizes={props.sizes}
      data-preload={String(props.preload)}
      data-fetch-priority={String(props.fetchPriority)}
      data-placeholder={props.placeholder}
      data-blur={String(props.blurDataURL)}
    />
  ),
}));

describe('Photo', () => {
  it('is an image named by its alt text', () => {
    render(<Photo photo={samplePhoto(0)} sizes="100vw" />);
    expect(screen.getByRole('img', { name: 'Photo 1' })).toBeInTheDocument();
  });

  it('is not announced when it is decorative', () => {
    render(<Photo photo={samplePhoto(0, { alt: '' })} sizes="100vw" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('fills its frame with the blur placeholder and the sizes it was given', () => {
    render(
      <Photo photo={samplePhoto(0)} sizes="(min-width: 768px) 384px, 100vw" />,
    );
    const image = screen.getByRole('img');
    expect(image).toHaveAttribute('data-fill', 'true');
    expect(image).toHaveAttribute('data-placeholder', 'blur');
    expect(image).toHaveAttribute('data-blur', samplePhoto(0).blurDataUrl);
    expect(image).toHaveAttribute(
      'data-sizes',
      '(min-width: 768px) 384px, 100vw',
    );
  });

  it('is not the preload photo unless it is told to be', () => {
    const { rerender } = render(<Photo photo={samplePhoto(0)} sizes="100vw" />);
    expect(screen.getByRole('img')).toHaveAttribute('data-preload', 'false');
    expect(screen.getByRole('img')).toHaveAttribute(
      'data-fetch-priority',
      'undefined',
    );

    rerender(<Photo photo={samplePhoto(0)} sizes="100vw" preload />);
    expect(screen.getByRole('img')).toHaveAttribute('data-preload', 'true');
    expect(screen.getByRole('img')).toHaveAttribute(
      'data-fetch-priority',
      'high',
    );
  });
});
