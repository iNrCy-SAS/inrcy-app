export function shouldApplyVisioTeamAppointmentsResponse(input: {
  startedMutationRevision: number;
  currentMutationRevision: number;
  requestSequence: number;
  lastAppliedRequestSequence: number;
  mutationInFlight: boolean;
}) {
  return (
    !input.mutationInFlight &&
    input.startedMutationRevision === input.currentMutationRevision &&
    input.requestSequence > input.lastAppliedRequestSequence
  );
}
