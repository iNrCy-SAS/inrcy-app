import "server-only";
import { inrAgentPublicationMediaAt } from "@/lib/inrAgentEditorialMediaPolicy";

export async function loadInstantMediaMixState(supabase: any, userId: string, mediaTypes: unknown) {
  const metadata = {preparedManually: true, editorialPlan: false};
  const query = () => supabase.from("inr_agent_actions")
    .select("id", {count: "exact", head: true}).eq("user_id", userId)
    .eq("automation_key", "publish").contains("metadata", metadata);
  const [total, video] = await Promise.all([query(),query().contains("payload",{mediaType:"video"})]);
  if (total.error || video.error) {
    console.warn("[inr-agent] instant media mix history unavailable", {userId});
    return {preparedPublications:0,videoPublications:0,mediaKind:"image" as const,imageCount:1 as const,historyAvailable:false};
  }
  const preparedPublications = Math.max(0,total.count || 0);
  return {
    preparedPublications,videoPublications:Math.max(0,video.count || 0),
    ...inrAgentPublicationMediaAt(preparedPublications+1,mediaTypes),historyAvailable:true,
  };
}
