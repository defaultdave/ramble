import { describe, expect, it } from 'vitest';
import type { LegalDocument } from '../legal';
import { blocks } from '../seed/richText';
import { buildLegalView, demoLabel, legalHead } from './legal';

// Behaviours under test, one per decision, branch or risk:
// - the view carries the document's title and body and the demo label
// - the head is the document's title; no published version is the not-found title

const document: LegalDocument = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  doc: 'terms',
  version: 2,
  title: 'Terms of service',
  body: blocks('Demo text.'),
  status: 'published',
  publishedAt: new Date('2026-11-01T12:00:00Z'),
  createdAt: new Date('2026-10-31T12:00:00Z'),
};

describe('the legal page view', () => {
  it('carries the title and body, labeled as demo text', () => {
    expect(buildLegalView(document)).toEqual({
      title: 'Terms of service',
      body: document.body,
      demoLabel,
    });
  });
});

describe('the legal page head', () => {
  it('is the document title', () => {
    expect(legalHead(document)).toEqual({ title: 'Terms of service' });
  });

  it('is the not-found title when nothing is published', () => {
    expect(legalHead(null)).toEqual({ title: 'Document not found' });
  });
});
