import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { photoProblemTexts } from '@/lib/photoForm';
import { photoRefusalMessage, photoLimits } from '@/lib/photos';
import { savedPhotos, savedView } from './ExperienceEditor.fixtures';
import { ExperiencePhotos } from './ExperiencePhotos';

// Behaviours under test:
// - the gallery lists each photo in order with its alt text, or says it is decorative, and counts them against the limit
// - an experience with no photos says so
// - the upload form is a plain post that carries the experience id and offers a labelled file, alt text, decorative box, rights and credit fields
// - the rights basis starts on Ramble-owned and offers all three bases
// - a refused field shows its sentence and is marked invalid; the file field shows why a file was refused
// - a field that was not refused shows no problem

const noop = () => undefined;

function renderPhotos(
  props: Partial<Parameters<typeof ExperiencePhotos>[0]> = {},
) {
  return render(
    <ExperiencePhotos
      experienceId={savedView.id}
      photos={savedPhotos}
      add={noop}
      {...props}
    />,
  );
}

describe('ExperiencePhotos gallery', () => {
  it('lists the photos in order, each with its description', () => {
    renderPhotos();

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByRole('img')).toHaveAttribute(
      'alt',
      'Photo 1',
    );
    expect(
      within(items[0] as HTMLElement).getByText('Alt text: Photo 1'),
    ).toBeInTheDocument();
    expect(
      within(items[1] as HTMLElement).getByText('Decorative, no alt text.'),
    ).toBeInTheDocument();
  });

  it('counts the photos against the most an experience holds', () => {
    renderPhotos();

    expect(
      screen.getByText(`2 of ${String(photoLimits.maxPerExperience)}.`, {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  it('says when there are none', () => {
    renderPhotos({ photos: [] });

    expect(
      screen.getByText('This experience has no photos yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('ExperiencePhotos upload form', () => {
  it('carries the experience id and takes a labelled image file', () => {
    const { container } = renderPhotos();

    expect(container.querySelector('input[name="experienceId"]')).toHaveValue(
      savedView.id,
    );
    const file = screen.getByLabelText('Photo');
    expect(file).toHaveAttribute('type', 'file');
    expect(file).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    expect(file).toBeRequired();
  });

  it('labels the alt text, the decorative box and the credit fields', () => {
    renderPhotos();

    expect(screen.getByLabelText(/Alt text/)).toHaveAttribute(
      'maxlength',
      String(photoLimits.maxAltLength),
    );
    expect(
      screen.getByLabelText('This photo is decorative and needs no alt text.'),
    ).not.toBeChecked();
    expect(
      screen.getByLabelText(/Photographer or rights holder/),
    ).toBeVisible();
    expect(screen.getByLabelText(/Licence/)).toBeVisible();
    expect(screen.getByLabelText(/Source address/)).toBeVisible();
  });

  it('starts the rights on Ramble-owned and offers every basis', () => {
    renderPhotos();

    const rights = screen.getByLabelText('Rights');
    expect(rights).toHaveDisplayValue('Shot or owned by Ramble');
    expect(within(rights).getAllByRole('option')).toHaveLength(3);
  });

  it('has one button that adds the photo', () => {
    renderPhotos();

    expect(screen.getByRole('button', { name: 'Add photo' })).toHaveAttribute(
      'type',
      'submit',
    );
  });
});

describe('ExperiencePhotos problems', () => {
  it('shows the sentence of each refused field and marks it invalid', () => {
    renderPhotos({ problems: ['altText', 'rightsLicense'] });

    expect(screen.getByLabelText(/Alt text/)).toHaveAccessibleDescription(
      expect.stringContaining(photoProblemTexts(null).altText),
    );
    expect(screen.getByLabelText(/Alt text/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText(/Licence/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Photo')).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.queryByText(photoProblemTexts(null).photoFile)).toBeNull();
  });

  it('shows why the file was refused on the file field', () => {
    renderPhotos({ problems: ['photoFile'], refusal: 'too_small' });

    expect(screen.getByLabelText('Photo')).toHaveAccessibleDescription(
      expect.stringContaining(photoRefusalMessage('too_small')),
    );
    expect(screen.getByLabelText('Photo')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('asks for a file when none was chosen', () => {
    renderPhotos({ problems: ['photoFile'] });

    expect(screen.getByLabelText('Photo')).toHaveAccessibleDescription(
      expect.stringContaining(photoProblemTexts(null).photoFile),
    );
  });
});
