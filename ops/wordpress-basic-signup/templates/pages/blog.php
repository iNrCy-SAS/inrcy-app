<?php if (!defined('ABSPATH')) { exit; } ?>
<?php if (inrcy_basic_blog_detail()) { return; } $native_blog = inrcy_basic_blog_landing(); ?>
<style>
.elementor-1523 .elementor-element.elementor-element-b0d289c{--display:flex;--min-height:0px;--flex-direction:column;--container-widget-width:100%;--container-widget-height:initial;--container-widget-flex-grow:0;--container-widget-align-self:initial;--flex-wrap-mobile:wrap;--margin-top:-11px;--margin-bottom:0px;--margin-left:0px;--margin-right:0px;--padding-top:0px;--padding-bottom:0px;--padding-left:0px;--padding-right:0px;}.elementor-1523 .elementor-element.elementor-element-3c2885e{margin:0px 0px calc(var(--kit-widget-spacing, 0px) + 0px) 0px;}.elementor-1523 .elementor-element.elementor-element-f1974d4{--display:flex;--flex-direction:column;--container-widget-width:100%;--container-widget-height:initial;--container-widget-flex-grow:0;--container-widget-align-self:initial;--flex-wrap-mobile:wrap;--margin-top:0px;--margin-bottom:0px;--margin-left:0px;--margin-right:0px;--padding-top:0px;--padding-bottom:0px;--padding-left:0px;--padding-right:0px;}.elementor-1523 .elementor-element.elementor-element-a0d6665{--display:flex;--flex-direction:column;--container-widget-width:100%;--container-widget-height:initial;--container-widget-flex-grow:0;--container-widget-align-self:initial;--flex-wrap-mobile:wrap;--margin-top:0px;--margin-bottom:0px;--margin-left:0px;--margin-right:0px;--padding-top:0px;--padding-bottom:0px;--padding-left:0px;--padding-right:0px;}body.elementor-page-1523:not(.elementor-motion-effects-element-type-background), body.elementor-page-1523 > .elementor-motion-effects-container > .elementor-motion-effects-layer{background-color:#FFFFFF;}:root{--page-title-display:none;}@media(max-width:1024px){.elementor-1523 .elementor-element.elementor-element-b0d289c{--margin-top:108px;--margin-bottom:0px;--margin-left:0px;--margin-right:0px;}}@media(max-width:767px){.elementor-1523 .elementor-element.elementor-element-b0d289c{--margin-top:-11px;--margin-bottom:0px;--margin-left:0px;--margin-right:0px;}.elementor-1523 .elementor-element.elementor-element-3c2885e{margin:0px 0px calc(var(--kit-widget-spacing, 0px) + 0px) 0px;}}
</style>
<div class="elementor elementor-1523">
<div class="elementor-element elementor-element-b0d289c packs-hero e-flex e-con-boxed e-con e-parent">
<div class="e-con-inner">
<div class="elementor-element elementor-element-3c2885e elementor-widget elementor-widget-html"><?php if (isset($native_blog[0])) { echo $native_blog[0]; } else { ?>
<section class="inrcy-blog-hero">
<a href="<?php echo esc_url(inrcy_basic_site_url('signup')); ?>" class="trial-bubble-absolute">
Créer mon compte
</a>
<div class="inrcy-blog-hero-inner">
<div class="inrcy-blog-kicker">
<span></span>
Conseils, idées &amp; stratégies
</div>
<h1 class="inrcy-blog-title">
Notre
<span>Blog</span>
</h1>
<p class="inrcy-blog-subtitle">
Ce qui fonctionne vraiment pour
<strong>capter l’attention</strong>,
gagner en visibilité et
<strong>convertir davantage de prospects.</strong>
</p>
<div class="inrcy-blog-tags" aria-label="Thématiques du blog">
<span>Communication</span>
<span>Visibilité</span>
<span>IA</span>
<span>Acquisition</span>
</div>
</div>
</section>
<style>
/* =========================================================
INR CY — HERO BLOG PREMIUM
========================================================= */
.inrcy-blog-hero{
--navy:#07142B;
--navy-deep:#051024;
--white:#FFFFFF;
--muted:#A4B1C7;
--orange:#FF7437;
--pink:#FF2F91;
--purple:#A62FFF;
--blue:#178CFF;
--gradient:linear-gradient(
110deg,
var(--orange) 0%,
var(--pink) 34%,
var(--purple) 67%,
var(--blue) 100%
);
position:relative;
isolation:isolate;
width:100%;
overflow:hidden;
padding:
clamp(72px,8vw,120px)
22px
clamp(66px,7vw,100px);
background:
radial-gradient(
circle at 18% 20%,
rgba(255,47,145,.10),
transparent 28%
),
radial-gradient(
circle at 84% 18%,
rgba(23,140,255,.12),
transparent 30%
),
radial-gradient(
circle at 50% 88%,
rgba(166,47,255,.09),
transparent 34%
),
linear-gradient(
180deg,
#07142B 0%,
#061228 52%,
#07142B 100%
);
color:#fff;
font-family:
Poppins,
Inter,
Arial,
sans-serif;
}
.inrcy-blog-hero *,
.inrcy-blog-hero *::before,
.inrcy-blog-hero *::after{
box-sizing:border-box;
}
/* =========================================================
LUEUR CENTRALE
========================================================= */
.inrcy-blog-hero::before{
content:"";
position:absolute;
z-index:-1;
left:50%;
top:42%;
width:900px;
height:320px;
transform:
translate(-50%,-50%);
border-radius:50%;
background:
radial-gradient(
ellipse at center,
rgba(166,47,255,.12),
rgba(23,140,255,.06) 42%,
transparent 72%
);
filter:blur(55px);
pointer-events:none;
}
/* =========================================================
INNER
========================================================= */
.inrcy-blog-hero-inner{
position:relative;
z-index:2;
width:min(1000px,100%);
margin:0 auto;
text-align:center;
}
/* =========================================================
KICKER
========================================================= */
.inrcy-blog-kicker{
width:max-content;
max-width:100%;
margin:
0 auto
22px;
padding:
8px
13px;
display:flex;
align-items:center;
justify-content:center;
gap:8px;
border:
1px solid
rgba(255,255,255,.08);
border-radius:999px;
background:
rgba(255,255,255,.04);
color:#D5DCEA;
font-size:11px;
font-weight:700;
line-height:1;
letter-spacing:.06em;
text-transform:uppercase;
box-shadow:
inset 0 1px 0
rgba(255,255,255,.035);
}
.inrcy-blog-kicker > span{
width:7px;
height:7px;
flex:
0 0 7px;
border-radius:50%;
background:
var(--gradient);
box-shadow:
0 0 14px
rgba(166,47,255,.45);
}
/* =========================================================
TITRE
========================================================= */
.inrcy-blog-title{
margin:0;
color:#fff;
font-size:
clamp(58px,7vw,104px);
line-height:.95;
letter-spacing:-.055em;
font-weight:850;
}
.inrcy-blog-title > span{
position:relative;
display:inline-block;
background:
var(--gradient);
-webkit-background-clip:text;
background-clip:text;
color:transparent;
filter:
drop-shadow(
0 0 20px
rgba(166,47,255,.12)
);
}
/* Reflet du mot Blog */
.inrcy-blog-title > span::after{
content:"";
position:absolute;
top:-15%;
left:-30%;
width:20%;
height:135%;
transform:
skewX(-22deg);
background:
linear-gradient(
90deg,
transparent,
rgba(255,255,255,.65),
transparent
);
opacity:0;
mix-blend-mode:screen;
pointer-events:none;
animation:
inrcyBlogTitleShine
5.8s
ease-in-out
infinite;
}
@keyframes inrcyBlogTitleShine{
0%,
70%{
left:-30%;
opacity:0;
}
74%{
opacity:1;
}
88%{
left:115%;
opacity:.9;
}
92%,
100%{
left:115%;
opacity:0;
}
}
/* =========================================================
SOUS-TITRE
========================================================= */
.inrcy-blog-subtitle{
max-width:790px;
margin:
26px auto
0;
color:var(--muted);
font-size:
clamp(15px,1.5vw,19px);
line-height:1.7;
font-weight:500;
}
.inrcy-blog-subtitle strong{
color:#fff;
font-weight:700;
}
/* =========================================================
TAGS
========================================================= */
.inrcy-blog-tags{
display:flex;
align-items:center;
justify-content:center;
flex-wrap:wrap;
gap:9px;
margin-top:30px;
}
.inrcy-blog-tags span{
padding:
8px
12px;
border:
1px solid
rgba(255,255,255,.075);
border-radius:999px;
background:
rgba(255,255,255,.035);
color:#AEB9CC;
font-size:10.5px;
line-height:1;
font-weight:650;
transition:
transform .25s ease,
color .25s ease,
background .25s ease,
border-color .25s ease;
}
.inrcy-blog-tags span:hover{
transform:
translateY(-2px);
color:#fff;
background:
rgba(255,255,255,.065);
border-color:
rgba(166,47,255,.18);
}
/* =========================================================
CTA INSCRIPTION
========================================================= */
.inrcy-blog-hero .trial-bubble-absolute,
.inrcy-blog-hero .trial-bubble-absolute:link,
.inrcy-blog-hero .trial-bubble-absolute:visited,
.inrcy-blog-hero .trial-bubble-absolute:hover,
.inrcy-blog-hero .trial-bubble-absolute:active,
.inrcy-blog-hero .trial-bubble-absolute:focus{
box-sizing:border-box !important;
text-decoration:none !important;
color:#fff !important;
font-family:
Poppins,
Inter,
Arial,
sans-serif !important;
}
/* =========================================================
DESKTOP — BULLE RONDE
========================================================= */
@media(min-width:769px){
.inrcy-blog-hero .trial-bubble-absolute{
position:absolute !important;
top:28px !important;
right:52px !important;
width:150px !important;
height:150px !important;
margin:0 !important;
padding:19px !important;
display:flex !important;
flex-direction:column !important;
align-items:center !important;
justify-content:center !important;
text-align:center !important;
border:
1px solid
rgba(255,255,255,.18) !important;
border-radius:50% !important;
background:
radial-gradient(
circle at 30% 20%,
rgba(255,255,255,.18),
transparent 28%
),
linear-gradient(
135deg,
#FF7437 0%,
#FF2F91 34%,
#A62FFF 67%,
#178CFF 100%
) !important;
color:#fff !important;
font-size:15px !important;
line-height:1.12 !important;
font-weight:800 !important;
letter-spacing:-.02em !important;
box-shadow:
0 0 0 6px rgba(255,255,255,.035),
0 18px 42px rgba(0,0,0,.25),
0 0 30px rgba(166,47,255,.20) !important;
overflow:hidden !important;
z-index:20 !important;
transform-origin:center !important;
animation:
inrcyBlogTrialFloat
4.8s
ease-in-out
infinite !important;
transition:
transform .3s ease,
box-shadow .3s ease !important;
}
/* Badge Basique */
.inrcy-blog-hero .trial-bubble-absolute::before{
content:"BASIQUE" !important;
display:block !important;
margin-bottom:6px !important;
padding:
4px
8px !important;
border:
1px solid
rgba(255,255,255,.18) !important;
border-radius:999px !important;
background:
rgba(255,255,255,.11) !important;
color:#fff !important;
font-size:8px !important;
line-height:1 !important;
font-weight:800 !important;
letter-spacing:.04em !important;
white-space:nowrap !important;
}
/* Reflet */
.inrcy-blog-hero .trial-bubble-absolute::after{
content:"" !important;
position:absolute !important;
top:-35% !important;
left:-38% !important;
width:24% !important;
height:170% !important;
transform:
skewX(-22deg) !important;
background:
linear-gradient(
90deg,
transparent,
rgba(255,255,255,.55),
transparent
) !important;
opacity:0 !important;
pointer-events:none !important;
animation:
inrcyBlogTrialShine
5.7s
ease-in-out
infinite !important;
}
.inrcy-blog-hero .trial-bubble-absolute:hover{
transform:
translateY(-4px)
scale(1.035) !important;
box-shadow:
0 0 0 7px rgba(255,255,255,.045),
0 24px 52px rgba(0,0,0,.28),
0 0 42px rgba(166,47,255,.26) !important;
}
}
/* =========================================================
ANIMATIONS CTA
========================================================= */
@keyframes inrcyBlogTrialFloat{
0%,
100%{
transform:
translateY(0)
scale(1);
}
50%{
transform:
translateY(-4px)
scale(1.015);
}
}
@keyframes inrcyBlogTrialShine{
0%,
70%{
left:-38%;
opacity:0;
}
74%{
opacity:1;
}
88%{
left:120%;
opacity:.9;
}
92%,
100%{
left:120%;
opacity:0;
}
}
/* =========================================================
TABLETTE
========================================================= */
@media(max-width:900px){
.inrcy-blog-hero{
padding:
76px
20px
72px;
}
.inrcy-blog-title{
font-size:
clamp(54px,10vw,80px);
}
.inrcy-blog-subtitle{
max-width:700px;
margin-top:23px;
font-size:15px;
}
}
/* =========================================================
MOBILE
========================================================= */
@media(max-width:768px){
.inrcy-blog-hero{
padding:
52px
18px
56px;
}
/* CTA mobile */
.inrcy-blog-hero .trial-bubble-absolute{
position:relative !important;
top:auto !important;
right:auto !important;
left:auto !important;
width:100% !important;
max-width:330px !important;
min-height:54px !important;
margin:
0 auto
28px !important;
padding:
12px
16px !important;
display:flex !important;
align-items:center !important;
justify-content:center !important;
gap:9px !important;
border:
1px solid
transparent !important;
border-radius:16px !important;
background:
linear-gradient(
#0B1933,
#0B1933
) padding-box,
linear-gradient(
110deg,
#FF7437,
#FF2F91,
#A62FFF,
#178CFF
) border-box !important;
color:#fff !important;
font-size:13px !important;
font-weight:800 !important;
text-align:center !important;
box-shadow:
0 14px 30px rgba(0,0,0,.20),
0 0 24px rgba(166,47,255,.10) !important;
animation:none !important;
z-index:20 !important;
}
.inrcy-blog-hero .trial-bubble-absolute::before{
content:"Basique" !important;
padding:
4px
7px !important;
border-radius:999px !important;
background:
rgba(255,255,255,.07) !important;
color:#fff !important;
font-size:8px !important;
font-weight:750 !important;
white-space:nowrap !important;
}
.inrcy-blog-hero .trial-bubble-absolute::after{
content:"→" !important;
width:24px !important;
height:24px !important;
display:grid !important;
place-items:center !important;
border-radius:50% !important;
background:
rgba(255,255,255,.08) !important;
color:#fff !important;
font-size:11px !important;
}
/* Hero mobile */
.inrcy-blog-hero::before{
width:520px;
height:230px;
top:44%;
filter:blur(45px);
}
.inrcy-blog-kicker{
margin-bottom:18px;
padding:
7px
11px;
font-size:8.5px;
letter-spacing:.05em;
}
.inrcy-blog-title{
font-size:
clamp(46px,15vw,65px);
line-height:.96;
letter-spacing:-.05em;
}
.inrcy-blog-subtitle{
max-width:95%;
margin-top:21px;
font-size:13px;
line-height:1.65;
}
.inrcy-blog-tags{
gap:7px;
margin-top:24px;
}
.inrcy-blog-tags span{
padding:
7px
10px;
font-size:9px;
}
}
/* =========================================================
PETITS MOBILES
========================================================= */
@media(max-width:390px){
.inrcy-blog-hero{
padding:
46px
15px
50px;
}
.inrcy-blog-title{
font-size:45px;
}
.inrcy-blog-subtitle{
font-size:12.5px;
}
.inrcy-blog-hero .trial-bubble-absolute{
max-width:300px !important;
}
}
/* =========================================================
ACCESSIBILITÉ
========================================================= */
@media(prefers-reduced-motion:reduce){
.inrcy-blog-title > span::after,
.inrcy-blog-tags span,
.inrcy-blog-hero .trial-bubble-absolute,
.inrcy-blog-hero .trial-bubble-absolute::after{
animation:none !important;
transition:none !important;
}
}
/* =========================================================
FIX LETTRE "g" DU TITRE BLOG
========================================================= */
.inrcy-blog-title{
line-height:1.05 !important;
overflow:visible !important;
}
.inrcy-blog-title > span{
overflow:visible !important;
padding-bottom:.12em !important;
}
/* =========================================================
iNrCy — FAQ HERO
VERSION PLUS COMPACTE
========================================================= */
/* DESKTOP */
.inrcy-blog-hero{
padding:
38px
22px
40px !important;
}
/* TABLETTE */
@media(max-width:900px){
.inrcy-blog-hero{
padding:
42px
20px
42px !important;
}
}
/* MOBILE */
@media(max-width:768px){
.inrcy-blog-hero{
padding:
28px
18px
32px !important;
}
}
/* PETITS MOBILES */
@media(max-width:390px){
.inrcy-blog-hero{
padding:
24px
15px
28px !important;
}
}
</style>
<?php } ?></div>
</div>
</div>
<div class="elementor-element elementor-element-f1974d4 e-flex e-con-boxed e-con e-parent">
<div class="e-con-inner">
<div class="elementor-element elementor-element-6b0a06a elementor-widget elementor-widget-html"><?php if (isset($native_blog[1])) { echo $native_blog[1]; } else { ?>
<section class="inrcy-blog-categories">
<div class="inrcy-blog-categories-inner">
<div class="inrcy-blog-categories-head">
<div class="inrcy-blog-mini-kicker">
<span></span>
Explorer par thématique
</div>
<h2>
Trouvez les contenus qui
<span>vous concernent vraiment.</span>
</h2>
<p>
Des conseils pratiques, des cas concrets et des ressources pour
mieux piloter votre communication, vos demandes clients et vos outils au quotidien.
</p>
</div>
<div class="inrcy-blog-category-grid">
<!-- 01 — CENTRALISATION -->
<a href="<?php echo esc_url(inrcy_basic_editorial_url(array('rubrique' => 'centralisation-des-outils'))); ?>" class="inrcy-blog-category-card" data-theme="centralisation">
<div class="inrcy-blog-category-visual">
<div class="inrcy-blog-category-art">
<div class="inrcy-central-core">
<span class="inrcy-central-ring"></span>
<span class="inrcy-central-dot inrcy-central-dot--1"></span>
<span class="inrcy-central-dot inrcy-central-dot--2"></span>
<span class="inrcy-central-dot inrcy-central-dot--3"></span>
<span class="inrcy-central-dot inrcy-central-dot--4"></span>
</div>
</div>
<div class="inrcy-blog-category-shine"></div>
</div>
<div class="inrcy-blog-category-content">
<div class="inrcy-blog-category-index">
01
</div>
<div class="inrcy-blog-category-label">
Communication
</div>
<h3>
Centralisation des outils de communication
</h3>
<p>
Regroupez vos outils et canaux de communication au même endroit
pour gagner du temps, simplifier votre organisation et piloter
votre visibilité depuis un seul espace.
</p>
<div class="inrcy-blog-category-link">
Voir les articles
<span>→</span>
</div>
</div>
</a>
<!-- 02 — CONVERSION -->
<a href="<?php echo esc_url(inrcy_basic_editorial_url(array('rubrique' => 'conversion-et-devis'))); ?>" class="inrcy-blog-category-card" data-theme="conversion">
<div class="inrcy-blog-category-visual">
<div class="inrcy-blog-category-art">
<div class="inrcy-money-core">€</div>
</div>
<div class="inrcy-blog-category-shine"></div>
</div>
<div class="inrcy-blog-category-content">
<div class="inrcy-blog-category-index">
02
</div>
<div class="inrcy-blog-category-label">
Business
</div>
<h3>
Conversion et devis
</h3>
<p>
Transformez davantage de demandes en clients avec un parcours
plus clair, des relances mieux structurées et des devis plus efficaces.
</p>
<div class="inrcy-blog-category-link">
Voir les articles
<span>→</span>
</div>
</div>
</a>
<!-- 03 — EVOLUTIONS -->
<a href="<?php echo esc_url(inrcy_basic_editorial_url(array('rubrique' => 'evolutions-inrcy'))); ?>" class="inrcy-blog-category-card" data-theme="evolution">
<div class="inrcy-blog-category-visual">
<div class="inrcy-blog-category-art">
<div class="inrcy-evolution-core">↗</div>
</div>
<div class="inrcy-blog-category-shine"></div>
</div>
<div class="inrcy-blog-category-content">
<div class="inrcy-blog-category-index">
03
</div>
<div class="inrcy-blog-category-label">
Produit
</div>
<h3>
Évolutions iNrCy
</h3>
<p>
Découvrez les nouvelles fonctionnalités, améliorations
et évolutions de la plateforme iNrCy.
</p>
<div class="inrcy-blog-category-link">
Voir les nouveautés
<span>→</span>
</div>
</div>
</a>
<!-- 04 — GENERATEUR -->
<a href="<?php echo esc_url(inrcy_basic_editorial_url(array('rubrique' => 'le-generateur-inrcy'))); ?>" class="inrcy-blog-category-card" data-theme="generator">
<div class="inrcy-blog-category-visual">
<div class="inrcy-blog-category-art">
<div class="inrcy-ai-core">
IA
</div>
<div class="inrcy-ai-stars">
<span>✦</span>
<span>✦</span>
<span>✦</span>
</div>
</div>
<div class="inrcy-blog-category-shine"></div>
</div>
<div class="inrcy-blog-category-content">
<div class="inrcy-blog-category-index">
04
</div>
<div class="inrcy-blog-category-label">
Intelligence artificielle
</div>
<h3>
Le générateur iNrCy
</h3>
<p>
Apprenez à exploiter le générateur de contenus pour créer
plus vite et adapter votre communication à chaque canal.
</p>
<div class="inrcy-blog-category-link">
Découvrir le générateur
<span>→</span>
</div>
</div>
</a>
<!-- 05 — METIERS -->
<a href="<?php echo esc_url(inrcy_basic_editorial_url(array('rubrique' => 'metiers-et-cas-concrets'))); ?>" class="inrcy-blog-category-card" data-theme="metiers">
<div class="inrcy-blog-category-visual">
<div class="inrcy-blog-category-art">
<div class="inrcy-tools-core">⚒</div>
</div>
<div class="inrcy-blog-category-shine"></div>
</div>
<div class="inrcy-blog-category-content">
<div class="inrcy-blog-category-index">
05
</div>
<div class="inrcy-blog-category-label">
Terrain
</div>
<h3>
Métiers et cas concrets
</h3>
<p>
Des exemples adaptés aux artisans et professionnels pour voir
comment appliquer iNrCy dans de vraies situations.
</p>
<div class="inrcy-blog-category-link">
Voir les cas concrets
<span>→</span>
</div>
</div>
</a>
<!-- 06 — PILOTAGE -->
<a href="<?php echo esc_url(inrcy_basic_editorial_url(array('rubrique' => 'pilotage-et-statistiques'))); ?>" class="inrcy-blog-category-card" data-theme="stats">
<div class="inrcy-blog-category-visual">
<div class="inrcy-blog-category-art">
<div class="inrcy-stats-core">
<div class="inrcy-stats-icon">
↗
</div>
<div class="inrcy-stats-bars">
<span></span>
<span></span>
<span></span>
<span></span>
</div>
</div>
</div>
<div class="inrcy-blog-category-shine"></div>
</div>
<div class="inrcy-blog-category-content">
<div class="inrcy-blog-category-index">
06
</div>
<div class="inrcy-blog-category-label">
Performance
</div>
<h3>
Pilotage et statistiques
</h3>
<p>
Suivez les bons indicateurs, analysez vos résultats et prenez
de meilleures décisions grâce à vos données.
</p>
<div class="inrcy-blog-category-link">
Voir les articles
<span>→</span>
</div>
</div>
</a>
<!-- 07 — NON CLASSE -->
<a href="<?php echo esc_url(inrcy_basic_editorial_url(array('rubrique' => 'non-classe'))); ?>" class="inrcy-blog-category-card inrcy-blog-category-card--wide" data-theme="misc">
<div class="inrcy-blog-category-visual">
<div class="inrcy-blog-category-art">
<div class="inrcy-misc-core">•••</div>
</div>
<div class="inrcy-blog-category-shine"></div>
</div>
<div class="inrcy-blog-category-content">
<div class="inrcy-blog-category-index">
07
</div>
<div class="inrcy-blog-category-label">
Autres contenus
</div>
<h3>
Non classé
</h3>
<p>
Retrouvez ici les contenus transversaux qui ne rentrent pas
encore dans une catégorie dédiée.
</p>
<div class="inrcy-blog-category-link">
Explorer
<span>→</span>
</div>
</div>
</a>
</div>
</div>
</section>
<style>
/* =========================================================
iNrCy — BLOG CATEGORIES PREMIUM FINAL
========================================================= */
.inrcy-blog-categories{
--ink:#07142B;
--muted:#76839A;
--orange:#FF7437;
--pink:#FF2F91;
--purple:#A62FFF;
--blue:#178CFF;
--gradient:linear-gradient(
110deg,
var(--orange) 0%,
var(--pink) 34%,
var(--purple) 67%,
var(--blue) 100%
);
width:100%;
padding:
clamp(76px,8vw,110px)
0
clamp(82px,8vw,115px);
overflow:hidden;
background:
radial-gradient(
circle at 12% 8%,
rgba(255,47,145,.045),
transparent 25%
),
radial-gradient(
circle at 90% 20%,
rgba(23,140,255,.05),
transparent 28%
),
#F7F9FC;
font-family:
Poppins,
Inter,
Arial,
sans-serif;
}
.inrcy-blog-categories *,
.inrcy-blog-categories *::before,
.inrcy-blog-categories *::after{
box-sizing:border-box;
}
.inrcy-blog-categories-inner{
width:min(1380px,92%);
margin:0 auto;
}
/* =========================================================
HEAD
========================================================= */
.inrcy-blog-categories-head{
max-width:900px;
margin:
0 auto
52px;
text-align:center;
}
.inrcy-blog-mini-kicker{
display:inline-flex;
align-items:center;
justify-content:center;
gap:8px;
margin-bottom:18px;
padding:
8px
12px;
border:
1px solid
rgba(7,20,43,.08);
border-radius:999px;
background:
rgba(255,255,255,.88);
color:#647188;
font-size:9px;
font-weight:750;
line-height:1;
letter-spacing:.07em;
text-transform:uppercase;
box-shadow:
0 8px 22px
rgba(7,20,43,.05);
}
.inrcy-blog-mini-kicker span{
width:7px;
height:7px;
border-radius:50%;
background:var(--gradient);
box-shadow:
0 0 12px
rgba(166,47,255,.30);
}
.inrcy-blog-categories-head h2{
margin:0;
color:var(--ink);
font-size:
clamp(44px,5vw,72px);
line-height:1.01;
letter-spacing:-.055em;
font-weight:850;
}
.inrcy-blog-categories-head h2 span{
display:block;
background:var(--gradient);
-webkit-background-clip:text;
background-clip:text;
color:transparent;
}
.inrcy-blog-categories-head p{
max-width:760px;
margin:
20px auto
0;
color:var(--muted);
font-size:
clamp(13px,1.3vw,16px);
line-height:1.75;
font-weight:500;
}
/* =========================================================
GRID
========================================================= */
.inrcy-blog-category-grid{
display:grid;
grid-template-columns:
repeat(3,minmax(0,1fr));
gap:18px;
}
/* =========================================================
CARD
========================================================= */
.inrcy-blog-category-card{
position:relative;
display:flex;
flex-direction:column;
min-height:465px;
overflow:hidden;
border:
1px solid
rgba(7,20,43,.075);
border-radius:24px;
background:#fff;
color:var(--ink);
text-decoration:none;
box-shadow:
0 14px 34px
rgba(7,20,43,.06);
transform:
translateY(24px)
scale(.985);
opacity:0;
transition:
transform .55s cubic-bezier(.2,.8,.2,1),
opacity .55s ease,
box-shadow .35s ease,
border-color .35s ease;
}
.inrcy-blog-category-card.is-visible{
transform:
translateY(0)
scale(1);
opacity:1;
}
.inrcy-blog-category-card:hover{
transform:
translateY(-6px)
scale(1.005);
border-color:
rgba(166,47,255,.16);
box-shadow:
0 26px 55px
rgba(7,20,43,.12),
0 0 30px
rgba(166,47,255,.055);
}
/* =========================================================
VISUEL COMMUN
========================================================= */
.inrcy-blog-category-visual{
position:relative;
height:210px;
overflow:hidden;
background:#091832;
}
.inrcy-blog-category-art{
position:absolute;
inset:0;
overflow:hidden;
background:
linear-gradient(
145deg,
#08172F 0%,
#0B1933 55%,
#101B3C 100%
);
transition:
transform .7s ease,
filter .7s ease;
}
.inrcy-blog-category-card:hover
.inrcy-blog-category-art{
transform:scale(1.045);
}
/* =========================================================
01 — CENTRALISATION
========================================================= */
[data-theme="centralisation"]
.inrcy-blog-category-art{
background:
radial-gradient(
circle at 18% 28%,
rgba(255,47,145,.26),
transparent 20%
),
radial-gradient(
circle at 82% 20%,
rgba(23,140,255,.26),
transparent 20%
),
radial-gradient(
circle at 50% 76%,
rgba(166,47,255,.22),
transparent 24%
),
linear-gradient(
145deg,
#08172F,
#0B1933 55%,
#101B3C
);
}
.inrcy-central-core{
position:absolute;
left:50%;
top:50%;
width:118px;
height:118px;
transform:
translate(-50%,-50%);
border-radius:50%;
background:var(--gradient);
box-shadow:
0 18px 42px
rgba(166,47,255,.24);
display:grid;
place-items:center;
}
.inrcy-central-ring{
width:52px;
height:52px;
border:
6px solid
rgba(255,255,255,.92);
border-radius:50%;
box-shadow:
inset 0 0 0 6px
rgba(255,255,255,.12);
}
.inrcy-central-dot{
position:absolute;
width:13px;
height:13px;
border-radius:50%;
background:#fff;
box-shadow:
0 0 12px
rgba(255,255,255,.22);
}
.inrcy-central-dot--1{
top:-14px;
left:50%;
transform:translateX(-50%);
}
.inrcy-central-dot--2{
right:-14px;
top:50%;
transform:translateY(-50%);
}
.inrcy-central-dot--3{
bottom:-14px;
left:50%;
transform:translateX(-50%);
}
.inrcy-central-dot--4{
left:-14px;
top:50%;
transform:translateY(-50%);
}
/* =========================================================
02 — CONVERSION
========================================================= */
[data-theme="conversion"]
.inrcy-blog-category-art{
background:
radial-gradient(
circle at 24% 25%,
rgba(255,116,55,.38),
transparent 20%
),
radial-gradient(
circle at 80% 75%,
rgba(166,47,255,.34),
transparent 24%
),
linear-gradient(
140deg,
#10172F,
#0B1933
);
}
.inrcy-money-core{
position:absolute;
left:50%;
top:50%;
width:118px;
height:118px;
transform:
translate(-50%,-50%);
display:grid;
place-items:center;
border-radius:50%;
background:var(--gradient);
color:#fff;
font-size:42px;
font-weight:850;
box-shadow:
0 20px 40px
rgba(166,47,255,.22);
}
/* =========================================================
03 — EVOLUTIONS
========================================================= */
[data-theme="evolution"]
.inrcy-blog-category-art{
background:
radial-gradient(
circle at 50% 50%,
rgba(23,140,255,.22),
transparent 25%
),
radial-gradient(
circle at 76% 24%,
rgba(166,47,255,.20),
transparent 20%
),
linear-gradient(
145deg,
#08172F,
#0B1933 55%,
#101B3C
);
}
.inrcy-evolution-core{
position:absolute;
left:50%;
top:50%;
width:118px;
height:118px;
transform:
translate(-50%,-50%);
display:grid;
place-items:center;
border-radius:50%;
background:var(--gradient);
color:#fff;
font-size:66px;
line-height:1;
font-weight:800;
box-shadow:
0 18px 42px
rgba(166,47,255,.23);
}
/* =========================================================
04 — GENERATEUR
========================================================= */
[data-theme="generator"]
.inrcy-blog-category-art{
background:
radial-gradient(
circle at 30% 30%,
rgba(255,47,145,.25),
transparent 22%
),
radial-gradient(
circle at 70% 65%,
rgba(23,140,255,.28),
transparent 26%
),
linear-gradient(
145deg,
#08172F,
#15183C
);
}
.inrcy-ai-core{
position:absolute;
left:50%;
top:44%;
transform:
translate(-50%,-50%);
background:var(--gradient);
-webkit-background-clip:text;
background-clip:text;
color:transparent;
font-size:90px;
line-height:1;
font-weight:900;
}
.inrcy-ai-stars{
position:absolute;
left:50%;
bottom:21%;
transform:translateX(-50%);
display:flex;
gap:28px;
color:
rgba(255,255,255,.72);
font-size:18px;
}
/* =========================================================
05 — METIERS
========================================================= */
[data-theme="metiers"]
.inrcy-blog-category-art{
background:
radial-gradient(
circle at 20% 78%,
rgba(255,116,55,.24),
transparent 22%
),
radial-gradient(
circle at 82% 18%,
rgba(166,47,255,.26),
transparent 22%
),
linear-gradient(
145deg,
#08172F,
#0B1933 55%,
#101B3C
);
}
.inrcy-tools-core{
position:absolute;
left:50%;
top:50%;
width:128px;
height:128px;
transform:
translate(-50%,-50%);
display:grid;
place-items:center;
border:
1px solid
rgba(255,255,255,.12);
border-radius:28px;
background:
linear-gradient(
145deg,
rgba(255,255,255,.08),
rgba(255,255,255,.03)
);
color:#fff;
font-size:45px;
box-shadow:
0 17px 36px
rgba(0,0,0,.20);
text-shadow:
0 0 20px
rgba(166,47,255,.20);
}
/* =========================================================
06 — PILOTAGE & STATISTIQUES
========================================================= */
[data-theme="stats"]
.inrcy-blog-category-art{
background:
radial-gradient(
circle at 20% 78%,
rgba(166,47,255,.27),
transparent 23%
),
radial-gradient(
circle at 82% 20%,
rgba(23,140,255,.28),
transparent 22%
),
radial-gradient(
circle at 52% 46%,
rgba(255,47,145,.08),
transparent 26%
),
linear-gradient(
145deg,
#08172F,
#0B1933 55%,
#101B3C
);
}
.inrcy-stats-core{
position:absolute;
left:50%;
top:50%;
transform:
translate(-50%,-50%);
display:flex;
flex-direction:column;
align-items:center;
gap:18px;
}
.inrcy-stats-icon{
width:118px;
height:118px;
display:grid;
place-items:center;
border-radius:50%;
background:var(--gradient);
color:#fff;
font-size:66px;
line-height:1;
font-weight:850;
box-shadow:
0 18px 42px
rgba(166,47,255,.24);
}
.inrcy-stats-bars{
width:125px;
height:25px;
display:flex;
align-items:flex-end;
justify-content:space-between;
gap:10px;
}
.inrcy-stats-bars span{
display:block;
width:21px;
border-radius:
5px 5px 2px 2px;
background:
linear-gradient(
180deg,
rgba(255,255,255,.92),
rgba(255,255,255,.42)
);
box-shadow:
0 0 10px
rgba(255,255,255,.08);
}
.inrcy-stats-bars span:nth-child(1){
height:9px;
}
.inrcy-stats-bars span:nth-child(2){
height:14px;
}
.inrcy-stats-bars span:nth-child(3){
height:19px;
}
.inrcy-stats-bars span:nth-child(4){
height:25px;
}
/* =========================================================
07 — NON CLASSE
========================================================= */
[data-theme="misc"]
.inrcy-blog-category-art{
background:
radial-gradient(
circle at 24% 28%,
rgba(255,47,145,.25),
transparent 20%
),
radial-gradient(
circle at 78% 72%,
rgba(23,140,255,.24),
transparent 20%
),
radial-gradient(
circle at 50% 50%,
rgba(166,47,255,.18),
transparent 26%
),
linear-gradient(
145deg,
#08172F,
#0B1933 55%,
#101B3C
);
}
.inrcy-misc-core{
position:absolute;
left:50%;
top:50%;
width:185px;
height:110px;
transform:
translate(-50%,-50%);
display:grid;
place-items:center;
border:
1px solid
rgba(255,255,255,.12);
border-radius:24px;
background:
linear-gradient(
145deg,
rgba(255,255,255,.09),
rgba(255,255,255,.03)
);
color:#fff;
font-size:54px;
line-height:1;
letter-spacing:8px;
font-weight:850;
box-shadow:
0 16px 35px
rgba(0,0,0,.18);
}
/* =========================================================
REFLET AUTOMATIQUE
========================================================= */
.inrcy-blog-category-shine{
position:absolute;
top:-30%;
left:-40%;
width:20%;
height:160%;
transform:
skewX(-22deg);
background:
linear-gradient(
90deg,
transparent,
rgba(255,255,255,.32),
transparent
);
opacity:0;
pointer-events:none;
}
.inrcy-blog-category-card.shine
.inrcy-blog-category-shine{
animation:
inrcyBlogCardShine
1s
ease;
}
@keyframes inrcyBlogCardShine{
0%{
left:-40%;
opacity:0;
}
15%{
opacity:.85;
}
100%{
left:120%;
opacity:0;
}
}
/* =========================================================
CONTENT
========================================================= */
.inrcy-blog-category-content{
position:relative;
flex:1;
padding:
22px
22px
24px;
}
.inrcy-blog-category-index{
position:absolute;
top:18px;
right:20px;
color:#E7EBF2;
font-size:30px;
font-weight:850;
line-height:1;
}
.inrcy-blog-category-label{
margin-bottom:10px;
color:#A62FFF;
font-size:8px;
font-weight:750;
line-height:1;
letter-spacing:.08em;
text-transform:uppercase;
}
.inrcy-blog-category-content h3{
max-width:85%;
margin:0;
color:var(--ink);
font-size:
clamp(18px,1.6vw,24px);
line-height:1.15;
letter-spacing:-.035em;
font-weight:850;
}
.inrcy-blog-category-content p{
margin:
13px 0
0;
color:#7D899E;
font-size:10.5px;
line-height:1.65;
}
.inrcy-blog-category-link{
display:flex;
align-items:center;
justify-content:space-between;
gap:15px;
margin-top:21px;
padding-top:17px;
border-top:
1px solid
rgba(7,20,43,.065);
color:#07142B;
font-size:9.5px;
font-weight:750;
}
.inrcy-blog-category-link span{
width:28px;
height:28px;
display:grid;
place-items:center;
border-radius:50%;
background:#F1F4F9;
transition:
transform .3s ease,
color .3s ease,
background .3s ease;
}
.inrcy-blog-category-card:hover
.inrcy-blog-category-link span{
transform:
translateX(3px);
color:#fff;
background:var(--gradient);
}
/* =========================================================
CARTE LARGE
========================================================= */
.inrcy-blog-category-card--wide{
grid-column:
span 3;
display:grid;
grid-template-columns:
minmax(320px,.85fr)
minmax(0,1.15fr);
min-height:270px;
}
.inrcy-blog-category-card--wide
.inrcy-blog-category-visual{
height:100%;
}
.inrcy-blog-category-card--wide
.inrcy-blog-category-content{
align-self:center;
padding:32px;
}
/* =========================================================
TABLETTE
========================================================= */
@media(max-width:1024px){
.inrcy-blog-category-grid{
grid-template-columns:
repeat(2,minmax(0,1fr));
}
.inrcy-blog-category-card--wide{
grid-column:
span 2;
}
}
/* =========================================================
MOBILE
========================================================= */
@media(max-width:650px){
.inrcy-blog-categories{
padding:
58px
0
70px;
}
.inrcy-blog-categories-inner{
width:
calc(100% - 28px);
}
.inrcy-blog-categories-head{
margin-bottom:34px;
}
.inrcy-blog-categories-head h2{
font-size:
clamp(36px,11vw,48px);
}
.inrcy-blog-categories-head p{
font-size:12px;
}
.inrcy-blog-category-grid{
grid-template-columns:1fr;
gap:14px;
}
.inrcy-blog-category-card,
.inrcy-blog-category-card--wide{
grid-column:auto;
display:flex;
min-height:0;
}
.inrcy-blog-category-visual,
.inrcy-blog-category-card--wide
.inrcy-blog-category-visual{
height:175px;
}
.inrcy-blog-category-content,
.inrcy-blog-category-card--wide
.inrcy-blog-category-content{
padding:19px;
}
.inrcy-blog-category-content h3{
max-width:82%;
font-size:20px;
}
.inrcy-blog-category-content p{
font-size:10px;
}
/* visuels plus petits */
.inrcy-central-core,
.inrcy-money-core,
.inrcy-evolution-core,
.inrcy-stats-icon{
width:92px;
height:92px;
}
.inrcy-money-core{
font-size:34px;
}
.inrcy-evolution-core,
.inrcy-stats-icon{
font-size:52px;
}
.inrcy-ai-core{
font-size:72px;
}
.inrcy-tools-core{
width:105px;
height:105px;
font-size:38px;
}
.inrcy-stats-bars{
width:100px;
}
.inrcy-misc-core{
width:150px;
height:88px;
font-size:43px;
}
}
/* =========================================================
ACCESSIBILITÉ
========================================================= */
@media(prefers-reduced-motion:reduce){
.inrcy-blog-category-card,
.inrcy-blog-category-art,
.inrcy-blog-category-shine{
animation:none !important;
transition:none !important;
}
}
/* =========================================================
iNrCy — BLOG CATEGORIES
FIX LISIBILITÉ
AUCUN TEXTE < 13px
À AJOUTER TOUT À LA FIN DU CSS
========================================================= */
/* =========================================================
PETIT KICKER DU HAUT
========================================================= */
.inrcy-blog-categories .inrcy-blog-mini-kicker{
font-size:13px !important;
line-height:1.2 !important;
padding:
9px
14px !important;
}
/* =========================================================
TEXTE D'INTRO
========================================================= */
.inrcy-blog-categories .inrcy-blog-categories-head p{
font-size:16px !important;
line-height:1.75 !important;
}
/* =========================================================
LABEL DES CARTES
Communication / Business / Produit / IA etc.
========================================================= */
.inrcy-blog-categories .inrcy-blog-category-label{
font-size:13px !important;
line-height:1.2 !important;
margin-bottom:11px !important;
letter-spacing:.065em !important;
}
/* =========================================================
TITRES DES CARTES
========================================================= */
.inrcy-blog-categories .inrcy-blog-category-content h3{
font-size:
clamp(
21px,
1.7vw,
26px
) !important;
line-height:1.18 !important;
}
/* =========================================================
DESCRIPTIONS DES CARTES
========================================================= */
.inrcy-blog-categories .inrcy-blog-category-content p{
margin-top:14px !important;
font-size:14px !important;
line-height:1.7 !important;
color:#748198 !important;
font-weight:450 !important;
}
/* =========================================================
LIEN DU BAS
Voir les articles / nouveautés / générateur...
========================================================= */
.inrcy-blog-categories .inrcy-blog-category-link{
font-size:13px !important;
line-height:1.3 !important;
font-weight:750 !important;
}
/* flèche */
.inrcy-blog-categories .inrcy-blog-category-link span{
width:32px !important;
height:32px !important;
font-size:16px !important;
}
/* =========================================================
NUMÉRO DE CARTE
01 / 02 / 03...
========================================================= */
.inrcy-blog-categories .inrcy-blog-category-index{
font-size:32px !important;
}
/* =========================================================
TABLETTE
========================================================= */
@media(max-width:1024px){
.inrcy-blog-categories .inrcy-blog-mini-kicker{
font-size:13px !important;
}
.inrcy-blog-categories .inrcy-blog-categories-head p{
font-size:15px !important;
}
.inrcy-blog-categories .inrcy-blog-category-label{
font-size:13px !important;
}
.inrcy-blog-categories .inrcy-blog-category-content h3{
font-size:22px !important;
}
.inrcy-blog-categories .inrcy-blog-category-content p{
font-size:13.5px !important;
}
.inrcy-blog-categories .inrcy-blog-category-link{
font-size:13px !important;
}
}
/* =========================================================
MOBILE
========================================================= */
@media(max-width:650px){
.inrcy-blog-categories .inrcy-blog-mini-kicker{
font-size:13px !important;
}
.inrcy-blog-categories .inrcy-blog-categories-head p{
font-size:14px !important;
line-height:1.7 !important;
}
.inrcy-blog-categories .inrcy-blog-category-label{
font-size:13px !important;
}
.inrcy-blog-categories .inrcy-blog-category-content h3{
font-size:21px !important;
line-height:1.2 !important;
}
.inrcy-blog-categories .inrcy-blog-category-content p{
font-size:13px !important;
line-height:1.65 !important;
}
.inrcy-blog-categories .inrcy-blog-category-link{
font-size:13px !important;
}
.inrcy-blog-categories .inrcy-blog-category-link span{
width:31px !important;
height:31px !important;
font-size:15px !important;
}
}
</style>
<?php } ?></div>
</div>
</div>
<div class="elementor-element elementor-element-a0d6665 e-flex e-con-boxed e-con e-parent">
<div class="e-con-inner">
<div class="elementor-element elementor-element-3f757b9 elementor-widget elementor-widget-html"><?php if (isset($native_blog[2])) { echo $native_blog[2]; } else { ?>
<section class="inrcy-dark-faq">
<div class="inrcy-dark-faq-inner">
<div class="inrcy-dark-faq-head">
<div class="inrcy-dark-faq-kicker">
<span></span>
Questions fréquentes
</div>
<h2>
Vous avez une question ?
<span>On vous répond.</span>
</h2>
<p>
Les réponses essentielles pour comprendre rapidement
le fonctionnement d’iNrCy et savoir si la plateforme
correspond à votre activité.
</p>
</div>
<div class="inrcy-dark-faq-list">
<details class="inrcy-dark-faq-item">
<summary>
<span>
À qui s’adresse iNrCy ?
</span>
<span class="inrcy-dark-faq-plus"></span>
</summary>
<div class="inrcy-dark-faq-answer">
iNrCy s’adresse aux professionnels, artisans et entreprises
qui souhaitent gagner du temps dans leur communication
et centraliser plusieurs outils depuis une seule plateforme.
</div>
</details>
<details class="inrcy-dark-faq-item">
<summary>
<span>
Que peut-on faire avec iNrCy ?
</span>
<span class="inrcy-dark-faq-plus"></span>
</summary>
<div class="inrcy-dark-faq-answer">
iNrCy permet notamment de préparer des contenus,
les adapter à différents canaux, centraliser ses demandes,
suivre son activité et simplifier plusieurs tâches du quotidien.
</div>
</details>
<details class="inrcy-dark-faq-item">
<summary>
<span>
Est-ce qu’iNrCy utilise l’intelligence artificielle ?
</span>
<span class="inrcy-dark-faq-plus"></span>
</summary>
<div class="inrcy-dark-faq-answer">
Oui. L’intelligence artificielle peut vous accompagner
dans la création et l’adaptation de vos contenus,
tout en vous laissant garder la main sur le résultat final.
</div>
</details>
<details class="inrcy-dark-faq-item">
<summary>
<span>
Puis-je choisir les canaux que j’utilise ?
</span>
<span class="inrcy-dark-faq-plus"></span>
</summary>
<div class="inrcy-dark-faq-answer">
Oui. Vous choisissez les canaux qui correspondent à votre activité
et vous restez libre de publier uniquement là où cela a du sens pour vous.
</div>
</details>
<details class="inrcy-dark-faq-item">
<summary>
<span>
Comment créer mon compte iNrCy ?
</span>
<span class="inrcy-dark-faq-plus"></span>
</summary>
<div class="inrcy-dark-faq-answer">
Créez votre compte, ouvrez l’application puis choisissez votre abonnement.
</div>
</details>
</div>
<div class="inrcy-dark-faq-bottom">
<span>
Une autre question ?
</span>
<a href="<?php echo esc_url(inrcy_basic_site_url('faq')); ?>">
Voir toute la FAQ
<span>→</span>
</a>
</div>
</div>
</section>
<style>
/* =========================================================
iNrCy — MINI FAQ DARK PREMIUM
========================================================= */
.inrcy-dark-faq{
--navy:#07142B;
--navy2:#0B1933;
--navy3:#0E1D3A;
--white:#FFFFFF;
--muted:#9EABC0;
--orange:#FF7437;
--pink:#FF2F91;
--purple:#A62FFF;
--blue:#178CFF;
--gradient:linear-gradient(
110deg,
var(--orange) 0%,
var(--pink) 34%,
var(--purple) 67%,
var(--blue) 100%
);
position:relative;
width:100%;
overflow:hidden;
padding:
clamp(74px,7vw,105px)
0;
background:
radial-gradient(
circle at 12% 12%,
rgba(255,47,145,.10),
transparent 26%
),
radial-gradient(
circle at 88% 20%,
rgba(23,140,255,.11),
transparent 28%
),
radial-gradient(
circle at 52% 100%,
rgba(166,47,255,.08),
transparent 35%
),
linear-gradient(
180deg,
#07142B 0%,
#061126 100%
);
color:#fff;
font-family:
Poppins,
Inter,
Arial,
sans-serif;
}
.inrcy-dark-faq *,
.inrcy-dark-faq *::before,
.inrcy-dark-faq *::after{
box-sizing:border-box;
}
/* =========================================================
HALO CENTRAL
========================================================= */
.inrcy-dark-faq::before{
content:"";
position:absolute;
left:50%;
top:42%;
width:850px;
height:300px;
transform:
translate(-50%,-50%);
border-radius:50%;
background:
radial-gradient(
ellipse,
rgba(166,47,255,.12),
rgba(23,140,255,.05) 42%,
transparent 72%
);
filter:blur(55px);
pointer-events:none;
}
/* =========================================================
INNER
========================================================= */
.inrcy-dark-faq-inner{
position:relative;
z-index:2;
width:min(980px,92%);
margin:0 auto;
}
/* =========================================================
HEAD
========================================================= */
.inrcy-dark-faq-head{
max-width:720px;
margin:
0 auto
38px;
text-align:center;
}
.inrcy-dark-faq-kicker{
display:inline-flex;
align-items:center;
justify-content:center;
gap:8px;
margin-bottom:17px;
padding:
8px
12px;
border:
1px solid
rgba(255,255,255,.08);
border-radius:999px;
background:
rgba(255,255,255,.04);
color:#D0D8E6;
font-size:9px;
font-weight:750;
letter-spacing:.07em;
text-transform:uppercase;
box-shadow:
inset 0 1px 0
rgba(255,255,255,.03);
}
.inrcy-dark-faq-kicker > span{
width:7px;
height:7px;
border-radius:50%;
background:var(--gradient);
box-shadow:
0 0 12px
rgba(166,47,255,.40);
}
.inrcy-dark-faq-head h2{
margin:0;
color:#fff;
font-size:
clamp(40px,4.6vw,62px);
line-height:1.02;
letter-spacing:-.05em;
font-weight:850;
}
.inrcy-dark-faq-head h2 > span{
display:block;
background:var(--gradient);
-webkit-background-clip:text;
background-clip:text;
color:transparent;
}
.inrcy-dark-faq-head p{
max-width:620px;
margin:
17px auto
0;
color:var(--muted);
font-size:
clamp(13px,1.2vw,15px);
line-height:1.7;
}
/* =========================================================
FAQ LIST
========================================================= */
.inrcy-dark-faq-list{
display:flex;
flex-direction:column;
gap:10px;
}
/* =========================================================
ITEM
========================================================= */
.inrcy-dark-faq-item{
overflow:hidden;
border:
1px solid
rgba(255,255,255,.075);
border-radius:17px;
background:
linear-gradient(
145deg,
rgba(255,255,255,.045),
rgba(255,255,255,.02)
);
box-shadow:
0 14px 32px
rgba(0,0,0,.12);
backdrop-filter:blur(12px);
-webkit-backdrop-filter:blur(12px);
transition:
transform .25s ease,
border-color .25s ease,
box-shadow .25s ease,
background .25s ease;
}
.inrcy-dark-faq-item:hover{
transform:
translateY(-2px);
border-color:
rgba(166,47,255,.18);
box-shadow:
0 18px 40px
rgba(0,0,0,.18),
0 0 24px
rgba(166,47,255,.05);
}
.inrcy-dark-faq-item[open]{
border-color:
rgba(166,47,255,.22);
background:
linear-gradient(
145deg,
rgba(255,255,255,.06),
rgba(255,255,255,.026)
);
}
/* =========================================================
SUMMARY
========================================================= */
.inrcy-dark-faq-item summary{
list-style:none;
display:flex;
align-items:center;
justify-content:space-between;
gap:22px;
min-height:70px;
padding:
18px
20px;
cursor:pointer;
color:#fff;
font-size:
clamp(13px,1.2vw,15px);
line-height:1.4;
font-weight:750;
user-select:none;
}
.inrcy-dark-faq-item summary::-webkit-details-marker{
display:none;
}
/* =========================================================
PLUS
========================================================= */
.inrcy-dark-faq-plus{
position:relative;
width:31px;
height:31px;
flex:
0 0 31px;
border:
1px solid
rgba(255,255,255,.07);
border-radius:50%;
background:
linear-gradient(
135deg,
rgba(255,116,55,.12),
rgba(255,47,145,.12),
rgba(166,47,255,.14),
rgba(23,140,255,.12)
);
transition:
transform .3s ease,
background .3s ease;
}
.inrcy-dark-faq-plus::before,
.inrcy-dark-faq-plus::after{
content:"";
position:absolute;
left:50%;
top:50%;
width:11px;
height:1.5px;
border-radius:999px;
background:#fff;
transform:
translate(-50%,-50%);
}
.inrcy-dark-faq-plus::after{
transform:
translate(-50%,-50%)
rotate(90deg);
transition:
transform .3s ease;
}
.inrcy-dark-faq-item[open]
.inrcy-dark-faq-plus{
transform:
rotate(180deg);
background:
var(--gradient);
}
.inrcy-dark-faq-item[open]
.inrcy-dark-faq-plus::after{
transform:
translate(-50%,-50%)
rotate(0deg);
}
/* =========================================================
ANSWER
========================================================= */
.inrcy-dark-faq-answer{
padding:
0
20px
20px;
color:#A7B3C6;
font-size:
12.5px;
line-height:1.72;
}
/* =========================================================
BOTTOM CTA
========================================================= */
.inrcy-dark-faq-bottom{
display:flex;
align-items:center;
justify-content:center;
gap:15px;
margin-top:28px;
color:#8E9CB3;
font-size:11px;
}
.inrcy-dark-faq-bottom a{
display:inline-flex;
align-items:center;
gap:8px;
padding:
10px
14px;
border:
1px solid
rgba(255,255,255,.08);
border-radius:12px;
background:
rgba(255,255,255,.035);
color:#fff;
text-decoration:none;
font-weight:750;
transition:
transform .25s ease,
border-color .25s ease,
background .25s ease;
}
.inrcy-dark-faq-bottom a:hover{
transform:
translateY(-2px);
border-color:
rgba(166,47,255,.18);
background:
rgba(255,255,255,.06);
}
.inrcy-dark-faq-bottom a > span{
transition:
transform .25s ease;
}
.inrcy-dark-faq-bottom a:hover > span{
transform:
translateX(3px);
}
/* =========================================================
MOBILE
========================================================= */
@media(max-width:650px){
.inrcy-dark-faq{
padding:
58px
0
62px;
}
.inrcy-dark-faq-inner{
width:
calc(100% - 28px);
}
.inrcy-dark-faq-head{
margin-bottom:28px;
}
.inrcy-dark-faq-head h2{
font-size:
clamp(34px,10vw,44px);
}
.inrcy-dark-faq-head p{
font-size:12px;
}
.inrcy-dark-faq-item summary{
min-height:64px;
padding:
16px
15px;
font-size:12px;
}
.inrcy-dark-faq-plus{
width:28px;
height:28px;
flex:
0 0 28px;
}
.inrcy-dark-faq-answer{
padding:
0
15px
17px;
font-size:11.5px;
}
.inrcy-dark-faq-bottom{
flex-direction:column;
gap:10px;
text-align:center;
}
}
/* =========================================================
ACCESSIBILITÉ
========================================================= */
@media(prefers-reduced-motion:reduce){
.inrcy-dark-faq *,
.inrcy-dark-faq *::before,
.inrcy-dark-faq *::after{
transition:none !important;
}
}
</style>
<?php } ?></div>
</div>
</div>
</div>
<script>
(function(){
'use strict';
const cards =
document.querySelectorAll(
'.inrcy-blog-category-card'
);
if(!cards.length){
return;
}
/* =======================================================
APPARITION AU SCROLL
======================================================= */
if('IntersectionObserver' in window){
const observer =
new IntersectionObserver(
function(entries){
entries.forEach(
function(entry){
if(entry.isIntersecting){
entry.target
.classList
.add('is-visible');
observer.unobserve(
entry.target
);
}
}
);
},
{
threshold:.12
}
);
cards.forEach(
function(card,index){
card.style.transitionDelay =
(index * 65) + 'ms';
observer.observe(card);
}
);
}
else{
cards.forEach(
function(card){
card.classList.add(
'is-visible'
);
}
);
}
/* =======================================================
REFLET AUTOMATIQUE
======================================================= */
let shineIndex = 0;
function shineNextCard(){
const card =
cards[shineIndex];
if(card){
card.classList.remove('shine');
void card.offsetWidth;
card.classList.add('shine');
setTimeout(
function(){
card.classList.remove(
'shine'
);
},
1100
);
}
shineIndex =
(shineIndex + 1)
% cards.length;
}
setInterval(
shineNextCard,
3200
);
/* =======================================================
PARALLAX DESKTOP
======================================================= */
cards.forEach(
function(card){
const visual =
card.querySelector(
'.inrcy-blog-category-art'
);
if(!visual){
return;
}
card.addEventListener(
'mousemove',
function(event){
if(
window.innerWidth <= 1024
){
return;
}
const rect =
card.getBoundingClientRect();
const x =
(
event.clientX
- rect.left
)
/ rect.width
- .5;
const y =
(
event.clientY
- rect.top
)
/ rect.height
- .5;
visual.style.transform =
'scale(1.045) translate('
+ (x * -7)
+ 'px,'
+ (y * -7)
+ 'px)';
}
);
card.addEventListener(
'mouseleave',
function(){
visual.style.transform =
'';
}
);
}
);
})();
</script>
