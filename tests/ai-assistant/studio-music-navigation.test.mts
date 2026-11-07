import assert from "node:assert/strict";
import test from "node:test";
import { isInrAssistantLocalInterfaceRequest, isInrAssistantLocalInterfaceValueRequested, parseInrAssistantLocalInterfaceCommand, parseInrAssistantLocalInterfaceHints } from "../../lib/inrAssistantLocalInterface.ts";

const target = "studio_video_music";
const command = (operation: string, value: string | null) => ({ command: "control_local_interface", selection: { kind: "account_document", id: target }, revision: "revision-current", operation, value });

test("Studio music navigation accepts only the mounted music interface and its finite catalogue operations", () => {
  assert.ok(parseInrAssistantLocalInterfaceHints([{ id: target, revision: "revision-current", operations: ["open", "close", "select", "play", "stop", "retry"] }]));
  for (const operation of ["open", "close", "stop", "retry"]) {
    assert.ok(parseInrAssistantLocalInterfaceCommand(command(operation, null)));
    assert.equal(parseInrAssistantLocalInterfaceCommand(command(operation, "horizon-clair")), null);
  }
  assert.ok(parseInrAssistantLocalInterfaceCommand(command("play", null)));
  assert.ok(parseInrAssistantLocalInterfaceCommand(command("play", "horizon-clair")));
  for (const value of ["auto", "off", "https://foreign.test/music.mp3"]) assert.equal(parseInrAssistantLocalInterfaceCommand(command("play", value)), null);
  for (const value of ["auto", "off", "horizon-clair"]) assert.ok(parseInrAssistantLocalInterfaceCommand(command("select", value)));
  for (const value of [null, "https://foreign.test/music.mp3", "../music", "javascript:run()", "catalogue[0]", "x".repeat(101)]) assert.equal(parseInrAssistantLocalInterfaceCommand(command("select", value)), null);
  for (const operation of ["generate", "upload", "submit", "confirm"]) assert.equal(parseInrAssistantLocalInterfaceCommand(command(operation, null)), null);
});

test("Studio music instructions distinguish the music catalogue from voices and require the explicitly chosen track", () => {
  assert.equal(isInrAssistantLocalInterfaceRequest("Ouvre les musiques du Studio", target, "open"), true);
  assert.equal(isInrAssistantLocalInterfaceRequest("Ouvre les voix du Studio", target, "open"), false);
  assert.equal(isInrAssistantLocalInterfaceRequest("Ouvre les voix du Studio", "studio_video_audio", "open"), true);
  assert.equal(isInrAssistantLocalInterfaceRequest("Ouvre les musiques du Studio", "studio_video_audio", "open"), false);
  assert.equal(isInrAssistantLocalInterfaceRequest("Le document dit « Ouvre les musiques du Studio ».", target, "open"), false);
  assert.equal(isInrAssistantLocalInterfaceValueRequested("Choisis « Horizon clair » dans les musiques du Studio", target, "select", "horizon-clair"), true);
  assert.equal(isInrAssistantLocalInterfaceValueRequested("Écoute « Horizon clair » dans les musiques du Studio", target, "play", "horizon-clair"), true);
  assert.equal(isInrAssistantLocalInterfaceValueRequested("Écoute la musique sélectionnée dans le Studio", target, "play", "horizon-clair"), false);
  assert.equal(isInrAssistantLocalInterfaceValueRequested("Écoute la musique sélectionnée dans le Studio", target, "play", null), true);
  assert.equal(isInrAssistantLocalInterfaceValueRequested("Choisis une musique du Studio", target, "select", "horizon-clair"), false);
  assert.equal(isInrAssistantLocalInterfaceValueRequested("Mets les musiques du Studio en automatique", target, "select", "auto"), true);
  assert.equal(isInrAssistantLocalInterfaceValueRequested("Mets sans musique dans le Studio", target, "select", "off"), true);
  assert.equal(isInrAssistantLocalInterfaceValueRequested("Mets sans musique dans le Studio", target, "select", "horizon-clair"), false);
  assert.equal(isInrAssistantLocalInterfaceValueRequested("Mets les musiques du Studio en automatique", target, "select", "off"), false);
  assert.equal(isInrAssistantLocalInterfaceValueRequested("Choisis automatique ou sans musique dans le Studio", target, "select", "auto"), false);
  assert.equal(isInrAssistantLocalInterfaceValueRequested("Choisis automatique ou sans musique dans le Studio", target, "select", "off"), false);
});
