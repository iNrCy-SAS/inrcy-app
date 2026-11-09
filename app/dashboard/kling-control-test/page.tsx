import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { createKlingApiClient } from "@/lib/aiVideoKlingApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

// Temporary preview-only inspection of the single synthetic control attempt.
// No creation, retry, billing, database write, or production result publication.
const ACCOUNT = "636340f6-2017-4b1c-b698-49b3e1c7c482";
const REQUEST = "47acd858-2b66-4245-b3d3-de4b001bb331";

export default async function KlingControlTestPage() {
  if (process.env.VERCEL_ENV !== "preview") notFound();
  const current = await getCurrentInrcyAccountScope();
  if (!current || current.scope.activeUserId !== ACCOUNT) notFound();
  const apiKey = process.env.KLING_API_KEY?.trim();
  if (!apiKey) return <main>Clé de test indisponible sur cet aperçu.</main>;
  const externalId = "inrcy-k4-" + createHash("sha256").update(`${ACCOUNT}:${REQUEST}:kling-4.0`).digest("hex").slice(0, 32) + "-1";
  const task = await createKlingApiClient({ apiKey }).findVideo(externalId, AbortSignal.timeout(30000));
  if (!task) return <main>La demande de contrôle n’est pas disponible chez Kling.</main>;
  const supplierSeconds = task.createdAt && task.updatedAt && task.updatedAt >= task.createdAt
    ? Math.round((task.updatedAt - task.createdAt) / 1000) : null;
  return <main style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
    <h1>Inspection du clip de contrôle Kling</h1>
    <p>Résultat technique rejeté par le contrôle des paroles du Studio. Deux personnages et voix entièrement fictifs. Aucune nouvelle génération n’est lancée ici.</p>
    <p>État fournisseur : <strong>{task.status}</strong>. {supplierSeconds !== null && <>Temps entre création et mise à jour de la tâche : <strong>{supplierSeconds} secondes</strong>.</>}</p>
    {task.createdAt && <p>Création fournisseur : {new Date(task.createdAt).toISOString()}</p>}
    {task.updatedAt && <p>Dernière mise à jour fournisseur : {new Date(task.updatedAt).toISOString()}</p>}
    {task.outputs.map((output, index) => <section key={index}>
      <p>Clip natif : {output.duration} secondes. Les paroles et les voix restent à examiner.</p>
      <video controls playsInline preload="metadata" src={output.url} aria-label="Clip de contrôle Kling rejeté par le Studio" style={{ display: "block", width: "100%", maxHeight: "70vh", background: "#111" }} />
      <p><a href={output.url} download>Télécharger le clip technique</a></p>
    </section>)}
  </main>;
}
