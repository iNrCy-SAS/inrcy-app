/** Default: offline plan. Only --apply --mode=test|live performs Stripe writes. */
import { VIDEO_CREDIT_PACKS } from "../lib/boutique/videoCreditPacks.ts";

type Row = Record<string, unknown>;
const args=new Set(process.argv.slice(2));
const apply=args.has("--apply");
const mode=args.has("--mode=live") ? "live" : args.has("--mode=test") ? "test" : null;
if ([...args].some(arg=>!["--apply","--mode=live","--mode=test"].includes(arg)) || (args.has("--mode=live") && args.has("--mode=test"))) throw new Error("Use only --apply and one --mode=test|live.");
const kind="inrcy_video_credits_v1";
const metadataFor=(pack: typeof VIDEO_CREDIT_PACKS[number])=>({kind,pack_key:pack.key,seconds:String(pack.seconds)});
const lookupFor=(pack: typeof VIDEO_CREDIT_PACKS[number])=>`inrcy_${pack.key}_eur_ht_v1`;
if (!apply) {
  console.log(JSON.stringify({mode:"offline-plan",taxBehavior:"exclusive",currency:"eur",oneTime:true,packs:VIDEO_CREDIT_PACKS.map(pack=>({
    name:`iNrCy – Recharge vidéo ${pack.seconds} secondes`,seconds:pack.seconds,amountHtCents:pack.priceEurHt*100,
    lookupKey:lookupFor(pack),environmentVariable:pack.priceEnv,metadata:metadataFor(pack),
  }))},null,2));
  process.exit(0);
}
if (!mode) throw new Error("An explicit Stripe --mode=test|live is required with --apply.");
const key=process.env.STRIPE_SECRET_KEY?.trim() ?? "";
if (!key.startsWith(`sk_${mode}_`) && !key.startsWith(`rk_${mode}_`)) throw new Error("The secret key does not match the explicitly requested Stripe mode.");

async function stripe(path: string,params?: URLSearchParams,idempotencyKey?: string): Promise<Row> {
  const response=await fetch(`https://api.stripe.com/v1${path}`,{method:params ? "POST" : "GET",headers:{
    Authorization:`Bearer ${key}`,...(params ? {"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":idempotencyKey!} : {}),
  },body:params?.toString(),signal:AbortSignal.timeout(20000)});
  const result=await response.json() as Row;
  if (!response.ok) throw new Error(`Stripe ${response.status}: ${(result.error as Row | undefined)?.message ?? "request failed"}`);
  return result;
}
function metadata(row: Row): Row { return (row.metadata ?? {}) as Row; }
function productScope(row: Row,pack: typeof VIDEO_CREDIT_PACKS[number]) {
  const hints=metadata(row);
  if (row.deleted || row.active!==true || row.livemode!==(mode==="live") || hints.kind!==kind || hints.pack_key!==pack.key || hints.seconds!==String(pack.seconds)) throw new Error(`Existing product differs from the approved ${pack.key} definition; manual review required.`);
}
const products: Row[]=[];
let after="";
do {
  const page=await stripe(`/products?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`);
  const data=page.data as Row[];
  if (!Array.isArray(data)) throw new Error("Invalid Stripe product inventory.");
  products.push(...data);
  if (!page.has_more) break;
  if (!data.length) throw new Error("Invalid Stripe product pagination.");
  after=String(data[data.length-1].id);
} while (true);
for (const pack of VIDEO_CREDIT_PACKS) {
  const prices=await stripe(`/prices?lookup_keys%5B%5D=${encodeURIComponent(lookupFor(pack))}&limit=10&expand%5B%5D=data.product`);
  const found=prices.data as Row[];
  if (!Array.isArray(found) || found.length>1 || prices.has_more) throw new Error(`Ambiguous existing price for ${pack.key}.`);
  let price=found[0];
  if (price) {
    if (price.active!==true || price.currency!=="eur" || price.unit_amount!==pack.priceEurHt*100 || price.tax_behavior!=="exclusive" || price.type!=="one_time" || price.livemode!==(mode==="live")) throw new Error(`Existing Stripe price differs from the approved ${pack.key} definition; manual review required.`);
    productScope(price.product as Row,pack);
  } else {
    const candidates=products.filter(row=>metadata(row).kind===kind && metadata(row).pack_key===pack.key);
    if (candidates.length>1) throw new Error(`Ambiguous existing product for ${pack.key}.`);
    let product=candidates[0];
    if (product) productScope(product,pack);
    else {
      const params=new URLSearchParams({name:`iNrCy – Recharge vidéo ${pack.seconds} secondes`,description:`${pack.seconds} secondes vidéo supplémentaires, hors quota mensuel. Achat ponctuel.`});
      for (const [name,value] of Object.entries(metadataFor(pack))) params.set(`metadata[${name}]`,value);
      product=await stripe("/products",params,`inrcy-video-credit-product-v1-${mode}-${pack.key}`);
      productScope(product,pack);
      products.push(product);
    }
    const params=new URLSearchParams({product:String(product.id),currency:"eur",unit_amount:String(pack.priceEurHt*100),tax_behavior:"exclusive",lookup_key:lookupFor(pack)});
    for (const [name,value] of Object.entries(metadataFor(pack))) params.set(`metadata[${name}]`,value);
    price=await stripe("/prices",params,`inrcy-video-credit-price-v1-${mode}-${pack.key}-${pack.priceEurHt*100}`);
    if (price.currency!=="eur" || price.unit_amount!==pack.priceEurHt*100 || price.tax_behavior!=="exclusive" || price.livemode!==(mode==="live")) throw new Error("Unexpected created Stripe price.");
  }
  console.log(`${pack.priceEnv}=${price.id}`);
}
