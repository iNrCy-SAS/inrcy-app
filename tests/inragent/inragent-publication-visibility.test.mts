import assert from "node:assert/strict";
import test from "node:test";

import {
  hasPublicationSchedulePassed,
  nextPublicationVisibilityRefreshDelay,
  publicationScheduledTimestamp,
} from "../../app/dashboard/agent/_lib/agent.publication-visibility.ts";

const NOW = Date.parse("2026-09-19T16:30:00.000Z");

test("une publication disparaît dès que son horaire programmé est passé", () => {
  assert.equal(
    hasPublicationSchedulePassed(
      { scheduledFor: "2026-09-18T17:00:00.000Z" },
      NOW,
    ),
    true,
  );
  assert.equal(
    hasPublicationSchedulePassed(
      { scheduledFor: "2026-09-19T16:30:00.000Z" },
      NOW,
    ),
    true,
  );
  assert.equal(
    hasPublicationSchedulePassed(
      { scheduledFor: "2026-09-20T17:00:00.000Z" },
      NOW,
    ),
    false,
  );
});

test("une date absente ou invalide ne masque pas une action en préparation", () => {
  assert.equal(hasPublicationSchedulePassed({ scheduledFor: null }, NOW), false);
  assert.equal(
    hasPublicationSchedulePassed({ scheduledFor: "date-invalide" }, NOW),
    false,
  );
  assert.equal(publicationScheduledTimestamp({ scheduledFor: null }), null);
});

test("le rafraîchissement cible la prochaine date sans boucle fréquente", () => {
  assert.equal(
    nextPublicationVisibilityRefreshDelay(
      [
        { scheduledFor: "2026-09-18T17:00:00.000Z" },
        { scheduledFor: "2026-09-19T16:30:05.000Z" },
        { scheduledFor: "2026-09-20T17:00:00.000Z" },
      ],
      NOW,
    ),
    5_100,
  );
  assert.equal(
    nextPublicationVisibilityRefreshDelay(
      [{ scheduledFor: "2026-09-20T17:00:00.000Z" }],
      NOW,
    ),
    60_000,
  );
  assert.equal(
    nextPublicationVisibilityRefreshDelay(
      [{ scheduledFor: "2026-09-18T17:00:00.000Z" }],
      NOW,
    ),
    null,
  );
});
