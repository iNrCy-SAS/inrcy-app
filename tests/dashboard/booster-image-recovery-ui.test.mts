import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCompleteMediaLibraryDownload,
  remapRestoredChannelImageEditors,
  resolvePublishImagePreparation,
} from '../../app/dashboard/booster/publier/publishImageRecovery.ts';
import type { MediaWorkspaceMediaSummary } from '../../lib/mediaWorkspaceClient.ts';
import type { PersistentWorkspaceMediaState } from '../../app/dashboard/booster/publier/usePersistentMediaWorkspace.ts';
import type { ChannelImageEditorState } from '../../app/dashboard/booster/publier/publishModal.shared.tsx';

const localKey = 'workspace:photo.jpg:800:123';
const state: PersistentWorkspaceMediaState = {
  localKey,
  mediaId: 'media-current',
  mediaType: 'image',
  position: 0,
  status: 'ready',
  progress: 100,
  storagePath: 'photo.jpg',
  error: '',
};

function media(overrides: Partial<MediaWorkspaceMediaSummary> = {}): MediaWorkspaceMediaSummary {
  return {
    mediaId: 'media-current',
    mediaType: 'image',
    position: 0,
    uploadStatus: 'uploaded',
    uploadProgress: 100,
    processingStatus: 'ready',
    bucket: 'images',
    storagePath: 'photo.jpg',
    fileName: 'photo.jpg',
    clientMediaKey: localKey,
    mimeType: 'image/jpeg',
    sizeBytes: 800,
    ...overrides,
  };
}

function resolve(preparedMedia: MediaWorkspaceMediaSummary[], mediaStates: Record<string, PersistentWorkspaceMediaState> = { [localKey]: state }) {
  return resolvePublishImagePreparation({
    imageKeys: ['photo-key'],
    clientMediaKeys: [localKey],
    mediaStates,
    preparedMedia,
  })[0];
}

test('une image intacte attend son premier contrôle puis reste utilisable', () => {
  assert.equal(resolve([])?.status, 'pending');
  assert.equal(resolve([media({ processingStatus: 'processing' })])?.status, 'pending');
  assert.deepEqual(resolve([media()]), {
    imageKey: 'photo-key',
    position: 0,
    status: 'ready',
    recovered: false,
    previewUrl: '',
    canonicalUrl: '',
  });
});

test('un JPEG réparé exige sa variante canonique et utilise son aperçu serveur', () => {
  const recovery = { kind: 'truncated_jpeg', version: 1, requiresReview: true } as const;
  const preparing = media({ imageRecovery: recovery, requiresCanonical: true });
  assert.equal(resolve([preparing])?.status, 'pending');
  assert.equal(resolve([media({ ...preparing, canonicalUrl: null, previewUrl: null })])?.status, 'failed');
  const ready = resolve([media({ ...preparing, canonicalUrl: '/canonical', previewUrl: '/preview' })]);
  assert.equal(ready?.status, 'ready');
  assert.equal(ready?.recovered, true);
  assert.equal(ready?.previewUrl, '/preview');
  assert.equal(ready?.canonicalUrl, '/canonical');
});

test('un échec ou un ancien média au même emplacement ne libère pas Publier', () => {
  assert.equal(resolve([media({ processingStatus: 'failed_terminal' })])?.status, 'failed');
  assert.equal(resolve([media({ mediaId: 'media-before' })])?.status, 'pending');
  assert.equal(resolve([media({ clientMediaKey: 'previous-file' })], {})?.status, 'pending');
  assert.equal(resolve([media()], {})?.status, 'ready');
});

test('la Médiathèque refuse une réponse partielle ou une taille incohérente', () => {
  const download = { status: 200, contentRange: null, downloadedBytes: 800, expectedBytes: 800 };
  assert.equal(isCompleteMediaLibraryDownload(download), true);
  assert.equal(isCompleteMediaLibraryDownload({ ...download, status: 206 }), false);
  assert.equal(isCompleteMediaLibraryDownload({ ...download, contentRange: 'bytes 0-799/1000' }), false);
  assert.equal(isCompleteMediaLibraryDownload({ ...download, downloadedBytes: 799 }), false);
  assert.equal(isCompleteMediaLibraryDownload({ ...download, expectedBytes: null }), true);
  assert.equal(isCompleteMediaLibraryDownload({ ...download, downloadedBytes: 0 }), false);
});

test('un brouillon réparé garde son affectation et ses retouches après changement de taille', () => {
  const editor: ChannelImageEditorState = {
    imageKeys: ['original-key'],
    synchronizedImageKeys: ['original-key'],
    customizedImageKeys: ['original-key'],
    transforms: {
      'original-key': {
        fit: 'contain',
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        blurBackground: false,
      },
    },
  };
  const result = remapRestoredChannelImageEditors(
    { instagram: editor },
    { 'original-key': 'repaired-key' },
  );
  assert.deepEqual(result.instagram?.imageKeys, ['repaired-key']);
  assert.deepEqual(result.instagram?.synchronizedImageKeys, ['repaired-key']);
  assert.deepEqual(result.instagram?.customizedImageKeys, ['repaired-key']);
  assert.deepEqual(result.instagram?.transforms['repaired-key'], editor.transforms['original-key']);
});
