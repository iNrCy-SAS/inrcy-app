import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  reconcileInrSendVideoAttachment,
  type InrSendVideoAttachmentIdentity,
} from "../../lib/inrsend/publicationVideoAttachmentPolicy.ts";

type TestVideoAttachment = InrSendVideoAttachmentIdentity & {
  mediaId?: string;
  videoSettings?: { format: string };
};

const persisted: TestVideoAttachment = {
  bucket: "inrcy-pro-media",
  storagePath: "users/account/video/source.mp4",
  publicUrl: "https://app.inrcy.com/api/media/source?token=old",
  url: "https://app.inrcy.com/api/media/source?token=old",
  mediaId: "media-1",
  videoSettings: { format: "original" },
};

test("une édition partielle récupère l'identité Storage canonique de la même vidéo", () => {
  const reconciled = reconcileInrSendVideoAttachment(
    {
      bucket: null,
      storagePath: persisted.storagePath,
      publicUrl: "https://app.inrcy.com/api/media/source?token=new",
      url: "https://app.inrcy.com/api/media/source?token=new",
      videoSettings: { format: "1_1" },
    },
    persisted,
  );

  assert.equal(reconciled?.bucket, "inrcy-pro-media");
  assert.equal(reconciled?.storagePath, persisted.storagePath);
  assert.equal(reconciled?.mediaId, "media-1");
  assert.deepEqual(reconciled?.videoSettings, { format: "1_1" });
});

test("une URL identique sans query permet de restaurer un chemin omis", () => {
  const reconciled = reconcileInrSendVideoAttachment(
    {
      publicUrl: "https://app.inrcy.com/api/media/source?token=fresh",
      url: "https://app.inrcy.com/api/media/source?token=fresh",
    },
    persisted,
  );

  assert.equal(reconciled?.bucket, "inrcy-pro-media");
  assert.equal(reconciled?.storagePath, persisted.storagePath);
});

test("une nouvelle vidéo ne peut pas hériter de l'identité d'une ancienne", () => {
  const incoming: TestVideoAttachment = {
    bucket: "other-bucket",
    storagePath: "users/account/video/new.mp4",
    publicUrl: "https://cdn.example.test/new.mp4",
  };
  assert.deepEqual(
    reconcileInrSendVideoAttachment(incoming, persisted),
    incoming,
  );
});

test("le client et le serveur conservent le bucket sur tout le trajet d'édition", () => {
  const mailbox = readFileSync(
    new URL(
      "../../app/dashboard/mails/_lib/mailboxPublicationVideo.foundations.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const shared = readFileSync(
    new URL(
      "../../app/dashboard/booster/publier/publishModal.shared.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const actions = readFileSync(
    new URL("../../lib/inrsend/publicationChannelActions.ts", import.meta.url),
    "utf8",
  );

  assert.match(mailbox, /bucket:\s*String\(/);
  assert.match(shared, /bucket:\s*result\.bucket/);
  assert.match(shared, /bucket:\s*"booster"/);
  assert.match(actions, /reconcileInrSendVideoAttachment\(incomingVideo, persistedVideo\)/);
});
