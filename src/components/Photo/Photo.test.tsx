import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ImageProps } from 'next/image';
import type { Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Photo } from './Photo';
import { samplePhoto } from './Photo.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - a photo is an image named by its alt text, and a decorative photo (empty alt) is not announced
// - it fills its frame, shows its blur placeholder while it loads, and asks for the sizes it was given
// - without an underlay it is one image, and with one it is two: a decorative lower layer and the named photo above it
// - the lower layer asks for the sizes it was given, is fetched eagerly and carries the blur; the upper layer keeps its own sizes, has no blur of its own, and alone is the preload photo
// - the upper layer is hidden until it has loaded, whether the load event comes later or the image was already complete from cache
// - it is fetched ahead of the rest, at high priority, only when it is the preload photo

// next/image makes a data address eager and preloads nothing, so the props it is given are what is checked.
vi.mock('next/image', () => ({
  default: (props: ImageProps) => (
    // eslint-disable-next-line @next/next/no-img-element -- a stand-in that reports the props it received
    <img
      ref={(props as { ref?: Ref<HTMLImageElement> }).ref}
      alt={props.alt}
      src="data:,"
      className={props.className}
      onLoad={props.onLoad}
      data-loaded={String(props['data-loaded' as keyof ImageProps])}
      data-loading={props.loading}
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

describe('Photo with an underlay', () => {
  const underlaySizes = '(min-width: 768px) 384px, 100vw';
  const sizes = '(min-width: 1200px) 792px, 100vw';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function layers() {
    const [underlay, main] = Array.from(document.querySelectorAll('img'));
    if (!underlay || !main) {
      throw new Error('expected two layers');
    }
    return { underlay, main };
  }

  it('draws one named image above one decorative image', () => {
    render(
      <Photo
        photo={samplePhoto(0)}
        sizes={sizes}
        underlaySizes={underlaySizes}
      />,
    );
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Photo 1' })).toBe(layers().main);
    expect(layers().underlay).toHaveAttribute('alt', '');
  });

  it('gives the lower layer the underlay sizes, the blur and an eager fetch, and the upper layer its own sizes and no blur', () => {
    render(
      <Photo
        photo={samplePhoto(0)}
        sizes={sizes}
        underlaySizes={underlaySizes}
      />,
    );
    const { underlay, main } = layers();
    expect(underlay).toHaveAttribute('data-sizes', underlaySizes);
    expect(underlay).toHaveAttribute('data-placeholder', 'blur');
    expect(underlay).toHaveAttribute('data-blur', samplePhoto(0).blurDataUrl);
    expect(underlay).toHaveAttribute('data-loading', 'eager');
    expect(main).toHaveAttribute('data-sizes', sizes);
    expect(main).not.toHaveAttribute('data-placeholder');
  });

  it('makes only the upper layer the preload photo', () => {
    render(
      <Photo
        photo={samplePhoto(0)}
        sizes={sizes}
        underlaySizes={underlaySizes}
        preload
      />,
    );
    const { underlay, main } = layers();
    expect(main).toHaveAttribute('data-preload', 'true');
    expect(main).toHaveAttribute('data-fetch-priority', 'high');
    expect(underlay).toHaveAttribute('data-preload', 'undefined');
    expect(underlay).toHaveAttribute('data-fetch-priority', 'undefined');
  });

  it('shows the upper layer only after it has loaded', () => {
    render(
      <Photo
        photo={samplePhoto(0)}
        sizes={sizes}
        underlaySizes={underlaySizes}
      />,
    );
    const { main } = layers();
    expect(main).toHaveAttribute('data-loaded', 'false');

    vi.spyOn(main, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(main, 'naturalWidth', 'get').mockReturnValue(1080);
    fireEvent.load(main);
    expect(main).toHaveAttribute('data-loaded', 'true');
  });

  it('shows the upper layer at once when it was already complete before any load event', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(
      true,
    );
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(
      1080,
    );
    render(
      <Photo
        photo={samplePhoto(0)}
        sizes={sizes}
        underlaySizes={underlaySizes}
      />,
    );
    expect(layers().main).toHaveAttribute('data-loaded', 'true');
  });

  it('does not show a broken image: a load that left no pixels keeps the upper layer hidden', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(
      true,
    );
    render(
      <Photo
        photo={samplePhoto(0)}
        sizes={sizes}
        underlaySizes={underlaySizes}
      />,
    );
    expect(layers().main).toHaveAttribute('data-loaded', 'false');
  });
});
