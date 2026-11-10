import assert from "node:assert/strict";
import test from "node:test";
import { getDirectInrAssistantNavigationRequest, getPureInrAssistantNavigationRequest, isInrAssistantNavigationRequest } from "../../lib/inrAssistantUiCommands.ts";

test("a current connect or reconnect order opens only its native channel panel", () => {
  for (const [request, destination] of [["Connecte mon canal Google Business.","google_business"],["Reconnecte mon compte Facebook maintenant.","facebook"],["Peux-tu connecter mon canal Instagram ?","instagram"],["Connect my channel LinkedIn.","linkedin"]]) {
    assert.equal(getPureInrAssistantNavigationRequest(request)?.destination,destination);
    assert.equal(isInrAssistantNavigationRequest(request),true);
  }
  assert.equal(getDirectInrAssistantNavigationRequest("Connecte mon canal Google Business et accompagne-moi jusqu’à mon autorisation.")?.destination,"google_business");
});

test("channel advice, denied, quoted, conditional and ambiguous connection requests never authorize navigation", () => {
  for (const request of ["Comment connecter mon canal Google Business ?","Explique : connecte Google Business.","Ne connecte pas mon compte Facebook.","Reconnecte Facebook demain.","Connecte Facebook après mon accord.","Si je te le demande, connecte Facebook.","Résume « Connecte Facebook ».","Connecte Facebook et Instagram.","Connecte mon compte inconnu."]) {
    assert.equal(getDirectInrAssistantNavigationRequest(request),null,request);
    assert.equal(getPureInrAssistantNavigationRequest(request),null,request);
  }
});
