/** Synthetic business results must respect the same pure native input guards.
 * This is not authentication, persistence, an approval signer or a provider. */
export function nativeFixtureRefusal(name, input, scope, nativeModule) {
  const message = scope.currentUserMessage ?? scope.currentApprovalMessage ?? '';
  if (name === 'manageCrmContact') return nativeModule.getInrAssistantCrmInstructionRefusal?.(message, input) ?? null;
  if (name === 'prepareCampaignEmail' || name === 'prepareCalendarAppointment') return nativeModule.getInrAssistantWorkspacePreparationRefusal?.(message, name, input) ?? null;
  if (name === 'searchCrmContacts') return nativeModule.getInrAssistantCrmSearchInputRefusal?.(message, input) ?? null;
  if (['readCommunicationRecords','updateCampaignDraft','dispatchCampaignDraft'].includes(name)) return nativeModule.getInrAssistantCommunicationInputRefusal?.(message, name, input) ?? null;
  if (['selectCampaignMailbox','previewCampaignAudience','dispatchCampaignAudience'].includes(name)) return nativeModule.getInrAssistantCampaignInputRefusal?.(message, name, input) ?? null;
  return null;
}

export function fixtureEffectIdentity(name, input, scope, nativeModule) {
  if (['prepareCampaignEmail','prepareCalendarAppointment'].includes(name) && nativeModule.getInrAssistantWorkspaceBatchSlot) {
    const kind = name === 'prepareCampaignEmail' ? 'campaign' : 'appointment';
    const slot = nativeModule.getInrAssistantWorkspaceBatchSlot(scope.currentUserMessage ?? '', kind, input.operationKey);
    return slot === null ? null : JSON.stringify([name, slot]);
  }
  return JSON.stringify([name, input]);
}
export function fixtureEffectFingerprint(name, input, nativeModule) {
  return ['prepareCampaignEmail','prepareCalendarAppointment'].includes(name) && nativeModule.getInrAssistantWorkspacePreparationFingerprint
    ? nativeModule.getInrAssistantWorkspacePreparationFingerprint(name,input) : JSON.stringify(input);
}

const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export function projectNativeFixtureRead(name, input, supplied) {
  const output = structuredClone(supplied);
  if (!output?.ok) return output;
  if (name === 'searchCrmContacts' && Array.isArray(output.contacts)) {
    const parts = String(input.query ?? '').replace(/[^\p{L}\p{N}\s-]/gu,' ').split(/\s+/).filter(part=>part.length>1).slice(0,4);
    output.contacts = output.contacts.filter(contact=>parts.length && parts.every(part=>normalize(`${contact.name ?? ''} ${contact.companyName ?? ''}`).includes(normalize(part))))
      .slice(0,5).map(contact=>Object.fromEntries(['id','name','companyName','category','contactType'].filter(key=>Object.hasOwn(contact,key)).map(key=>[key,contact[key]])));
  }
  if (name === 'readCrmContact' && output.contact && output.contact.id !== input.contactId) return {ok:false,status:'blocked',readOnly:true,message:'L’identifiant ne correspond pas à la fiche fictive ; aucune autre fiche retournée.'};
  if (name === 'readCommunicationRecords' && Array.isArray(output.items)) {
    const isCalendar = input.section === 'calendar';
    const query = normalize(input.query).replace(/[%_\\]/g,'');
    const min = input.timeMin ? Date.parse(input.timeMin) : Date.now();
    const max = input.timeMax ? Date.parse(input.timeMax) : min + 7*86400_000;
    const matching = output.items.filter(item=>{
      const calendarItem = Object.hasOwn(item,'start') || Object.hasOwn(item,'end');
      if (calendarItem !== isCalendar || input.recordId && item.id !== input.recordId || query && !normalize(item.title).includes(query)) return false;
      if (isCalendar) return input.recordId || Date.parse(item.start)<max && Date.parse(item.end)>min;
      return input.section === 'drafts' ? item.status === 'draft' : item.status !== 'draft';
    });
    output.items = matching.slice(0,8).map(item=>{
      const keys = isCalendar ? ['id','title','start','end','status'] : ['id','title','status','recipientCount'];
      if (input.recordId) keys.push('text',...(isCalendar?['location']:[]));
      return Object.fromEntries(keys.filter(key=>Object.hasOwn(item,key)).map(key=>[key,item[key]]));
    });
    output.hasMore = output.hasMore === true || output.truncated === true || matching.length > 8;
    output.truncated = output.hasMore;
    if (isCalendar) { output.period=input.recordId?null:{timeMin:new Date(min).toISOString(),timeMax:new Date(max).toISOString()}; output.availabilityGuaranteed=false; }
    else { delete output.period; delete output.availabilityGuaranteed; }
  }
  return output;
}

/** Counts only public part types. Never retain image bytes, URLs or text. */
export function providerVisualSummary(params) {
  const visualParts = {image:0,image_url:0};
  for (const message of params.prompt ?? []) for (const part of Array.isArray(message.content)?message.content:[]) {
    if (Object.hasOwn(visualParts,part.type)) visualParts[part.type]++;
  }
  return {visualCount:visualParts.image+visualParts.image_url,visualParts,serverFileTransmission:null};
}
