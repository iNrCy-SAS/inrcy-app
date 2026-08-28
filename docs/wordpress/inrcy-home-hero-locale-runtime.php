function inrcy_home_hero_locale_runtime() {
    if ( is_admin() || ! is_front_page() ) {
        return;
    }

    echo <<<'INRCY_HERO_LOCALE'
<script id="inrcy-home-hero-locale-runtime" type="text/javascript" data-wpfc-render="false" data-cfasync="false" data-no-optimize="1">
(function () {
  'use strict';

  const root = document.getElementById('inrcyHeroSteps');
  if (!root || root.dataset.inrcyLocaleRuntime === '1') return;
  root.dataset.inrcyLocaleRuntime = '1';
  root.setAttribute('data-no-translation', '');
  root.setAttribute('data-no-dynamic-translation', '');

  const copy = {
    fr: {
      channels: ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'Google Business', 'Site web', 'Mail', 'Pinterest', 'Carte de visite', 'Site iNrCy', 'iNr’Search'],
      published: 'Publié', publishing: 'Publication en cours', sent: 'Envoyé', sending: 'Envoi en cours', updated: 'Mis à jour', updating: 'Mise à jour en cours',
      edit: 'Modifier', remove: 'Supprimer', views: 'VUES', interactions: 'INTERACTIONS', clicks: 'CLICS',
      progress: 'Diffusion multicanale', posts: 'Mes publications', postsSub: 'Modifiez ou supprimez vos contenus en quelques clics',
      performance: 'Performance globale', performanceSub: 'Tous vos canaux réunis dans un seul tableau de bord',
      titles: ['Guidez iNrCy', 'iNrCy adapte le contenu à chaque canal', 'Diffusez sur 12 canaux', 'Suivez les performances et modifiez vos contenus à tout moment'],
      descriptions: ['Une photo, une vidéo ou quelques mots suffisent pour démarrer.', '12 contenus uniques et intelligents, pensés pour chaque plateforme.', 'Publiez vos contenus sur tous les canaux sélectionnés.', 'Analysez vos résultats et gérez vos publications directement depuis iNrCy.']
    },
    en: {
      channels: ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'Google Business', 'Website', 'Email', 'Pinterest', 'Business card', 'iNrCy website', 'iNr’Search'],
      published: 'Published', publishing: 'Publishing', sent: 'Sent', sending: 'Sending', updated: 'Updated', updating: 'Updating',
      edit: 'Edit', remove: 'Delete', views: 'VIEWS', interactions: 'INTERACTIONS', clicks: 'CLICKS',
      progress: 'Multi-channel publishing', posts: 'My posts', postsSub: 'Edit or delete your content in just a few clicks',
      performance: 'Overall performance', performanceSub: 'All your channels brought together in one dashboard',
      titles: ['Share your idea with iNrCy', 'iNrCy tailors content to each channel', 'Publish across 12 channels', 'Track performance and edit your content anytime'],
      descriptions: ['A photo, a video or a few words are enough to get started.', '12 unique, intelligent pieces of content designed for every platform.', 'Publish your content across all selected channels.', 'Analyse your results and manage your posts directly from iNrCy.']
    },
    es: {
      channels: ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'Google Business', 'Sitio web', 'Email', 'Pinterest', 'Tarjeta de visita', 'Sitio web iNrCy', 'iNr’Search'],
      published: 'Publicado', publishing: 'Publicando', sent: 'Enviado', sending: 'Enviando', updated: 'Actualizado', updating: 'Actualizando',
      edit: 'Editar', remove: 'Eliminar', views: 'VISTAS', interactions: 'INTERACCIONES', clicks: 'CLICS',
      progress: 'Publicación multicanal', posts: 'Mis publicaciones', postsSub: 'Edita o elimina tus contenidos en unos pocos clics',
      performance: 'Rendimiento global', performanceSub: 'Todos tus canales reunidos en un único panel',
      titles: ['Comparte tu idea con iNrCy', 'iNrCy adapta el contenido a cada canal', 'Publica en 12 canales', 'Sigue el rendimiento y edita tus contenidos cuando quieras'],
      descriptions: ['Una foto, un vídeo o unas palabras bastan para empezar.', '12 contenidos únicos e inteligentes, diseñados para cada plataforma.', 'Publica tus contenidos en todos los canales seleccionados.', 'Analiza tus resultados y gestiona tus publicaciones directamente desde iNrCy.']
    },
    it: {
      channels: ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'Google Business', 'Sito web', 'Email', 'Pinterest', 'Biglietto da visita', 'Sito web iNrCy', 'iNr’Search'],
      published: 'Pubblicato', publishing: 'Pubblicazione in corso', sent: 'Inviato', sending: 'Invio in corso', updated: 'Aggiornato', updating: 'Aggiornamento in corso',
      edit: 'Modifica', remove: 'Elimina', views: 'VISUALIZZAZIONI', interactions: 'INTERAZIONI', clicks: 'CLIC',
      progress: 'Pubblicazione multicanale', posts: 'Le mie pubblicazioni', postsSub: 'Modifica o elimina i tuoi contenuti in pochi clic',
      performance: 'Prestazioni complessive', performanceSub: 'Tutti i tuoi canali riuniti in un’unica dashboard',
      titles: ['Condividi la tua idea con iNrCy', 'iNrCy adatta il contenuto a ogni canale', 'Pubblica su 12 canali', 'Monitora le prestazioni e modifica i contenuti in qualsiasi momento'],
      descriptions: ['Una foto, un video o poche parole sono sufficienti per iniziare.', '12 contenuti unici e intelligenti, pensati per ogni piattaforma.', 'Pubblica i tuoi contenuti su tutti i canali selezionati.', 'Analizza i risultati e gestisci le pubblicazioni direttamente da iNrCy.']
    },
    de: {
      channels: ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'Google Business', 'Website', 'E-Mail', 'Pinterest', 'Visitenkarte', 'iNrCy-Website', 'iNr’Search'],
      published: 'Veröffentlicht', publishing: 'Wird veröffentlicht', sent: 'Gesendet', sending: 'Wird gesendet', updated: 'Aktualisiert', updating: 'Wird aktualisiert',
      edit: 'Bearbeiten', remove: 'Löschen', views: 'AUFRUFE', interactions: 'INTERAKTIONEN', clicks: 'KLICKS',
      progress: 'Veröffentlichung auf mehreren Kanälen', posts: 'Meine Beiträge', postsSub: 'Bearbeiten oder löschen Sie Ihre Inhalte mit wenigen Klicks',
      performance: 'Gesamtleistung', performanceSub: 'Alle Ihre Kanäle in einem einzigen Dashboard',
      titles: ['Teilen Sie Ihre Idee mit iNrCy', 'iNrCy passt Inhalte an jeden Kanal an', 'Auf 12 Kanälen veröffentlichen', 'Leistung verfolgen und Inhalte jederzeit bearbeiten'],
      descriptions: ['Ein Foto, ein Video oder wenige Worte genügen für den Einstieg.', '12 einzigartige, intelligente Inhalte, passend für jede Plattform.', 'Veröffentlichen Sie Ihre Inhalte auf allen ausgewählten Kanälen.', 'Analysieren Sie Ihre Ergebnisse und verwalten Sie Ihre Beiträge direkt in iNrCy.']
    },
    nl: {
      channels: ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'Google Business', 'Website', 'E-mail', 'Pinterest', 'Visitekaartje', 'iNrCy-website', 'iNr’Search'],
      published: 'Gepubliceerd', publishing: 'Wordt gepubliceerd', sent: 'Verzonden', sending: 'Wordt verzonden', updated: 'Bijgewerkt', updating: 'Wordt bijgewerkt',
      edit: 'Bewerken', remove: 'Verwijderen', views: 'WEERGAVEN', interactions: 'INTERACTIES', clicks: 'KLIKS',
      progress: 'Publicatie via meerdere kanalen', posts: 'Mijn publicaties', postsSub: 'Bewerk of verwijder uw content in enkele klikken',
      performance: 'Totale prestaties', performanceSub: 'Al uw kanalen samengebracht in één dashboard',
      titles: ['Deel uw idee met iNrCy', 'iNrCy stemt content af op elk kanaal', 'Publiceer op 12 kanalen', 'Volg de prestaties en bewerk uw content wanneer u wilt'],
      descriptions: ['Een foto, video of enkele woorden zijn genoeg om te beginnen.', '12 unieke, intelligente contentstukken, afgestemd op elk platform.', 'Publiceer uw content op alle geselecteerde kanalen.', 'Analyseer uw resultaten en beheer uw publicaties rechtstreeks vanuit iNrCy.']
    },
    pt: {
      channels: ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'Google Business', 'Site', 'E-mail', 'Pinterest', 'Cartão de visita', 'Site iNrCy', 'iNr’Search'],
      published: 'Publicado', publishing: 'A publicar', sent: 'Enviado', sending: 'A enviar', updated: 'Atualizado', updating: 'A atualizar',
      edit: 'Editar', remove: 'Eliminar', views: 'VISUALIZAÇÕES', interactions: 'INTERAÇÕES', clicks: 'CLIQUES',
      progress: 'Publicação multicanal', posts: 'As minhas publicações', postsSub: 'Edite ou elimine os seus conteúdos em poucos cliques',
      performance: 'Desempenho global', performanceSub: 'Todos os seus canais reunidos num único painel',
      titles: ['Partilhe a sua ideia com a iNrCy', 'A iNrCy adapta o conteúdo a cada canal', 'Publique em 12 canais', 'Acompanhe o desempenho e edite os conteúdos a qualquer momento'],
      descriptions: ['Uma fotografia, um vídeo ou algumas palavras são suficientes para começar.', '12 conteúdos únicos e inteligentes, pensados para cada plataforma.', 'Publique os seus conteúdos em todos os canais selecionados.', 'Analise os seus resultados e gira as publicações diretamente na iNrCy.']
    },
    th: {
      channels: ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'Google Business', 'เว็บไซต์', 'อีเมล', 'Pinterest', 'นามบัตร', 'เว็บไซต์ iNrCy', 'iNr’Search'],
      published: 'เผยแพร่แล้ว', publishing: 'กำลังเผยแพร่', sent: 'ส่งแล้ว', sending: 'กำลังส่ง', updated: 'อัปเดตแล้ว', updating: 'กำลังอัปเดต',
      edit: 'แก้ไข', remove: 'ลบ', views: 'ยอดดู', interactions: 'การโต้ตอบ', clicks: 'คลิก',
      progress: 'เผยแพร่หลายช่องทาง', posts: 'โพสต์ของฉัน', postsSub: 'แก้ไขหรือลบเนื้อหาได้ในไม่กี่คลิก',
      performance: 'ประสิทธิภาพโดยรวม', performanceSub: 'รวมทุกช่องทางไว้ในแดชบอร์ดเดียว',
      titles: ['บอกไอเดียของคุณกับ iNrCy', 'iNrCy ปรับเนื้อหาให้เหมาะกับแต่ละช่องทาง', 'เผยแพร่ผ่าน 12 ช่องทาง', 'ติดตามผลและแก้ไขเนื้อหาได้ทุกเมื่อ'],
      descriptions: ['เพียงรูปภาพ วิดีโอ หรือข้อความไม่กี่คำก็เริ่มต้นได้', 'เนื้อหาอัจฉริยะที่ไม่ซ้ำกัน 12 ชิ้น ออกแบบสำหรับแต่ละแพลตฟอร์ม', 'เผยแพร่เนื้อหาไปยังทุกช่องทางที่เลือก', 'วิเคราะห์ผลลัพธ์และจัดการโพสต์ได้โดยตรงจาก iNrCy']
    },
    zh: {
      channels: ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'Google Business', '网站', '电子邮件', 'Pinterest', '电子名片', 'iNrCy 网站', 'iNr’Search'],
      published: '已发布', publishing: '正在发布', sent: '已发送', sending: '正在发送', updated: '已更新', updating: '正在更新',
      edit: '编辑', remove: '删除', views: '浏览量', interactions: '互动', clicks: '点击',
      progress: '多渠道发布', posts: '我的内容', postsSub: '只需几次点击即可编辑或删除内容',
      performance: '整体表现', performanceSub: '在一个仪表板中汇总所有渠道',
      titles: ['向 iNrCy 描述您的想法', 'iNrCy 为每个渠道调整内容', '发布到 12 个渠道', '随时跟踪表现并编辑内容'],
      descriptions: ['一张图片、一段视频或几句话即可开始。', '为每个平台量身打造 12 条独特的智能内容。', '将内容发布到所有选定渠道。', '直接在 iNrCy 中分析结果并管理发布内容。']
    }
  };

  function getLocale() {
    const htmlLocale = String(document.documentElement.lang || '').toLowerCase().split('-')[0];
    if (copy[htmlLocale]) return htmlLocale;
    const pathLocale = String(window.location.pathname || '').split('/').filter(Boolean)[0]?.toLowerCase();
    return copy[pathLocale] ? pathLocale : 'fr';
  }

  function setText(element, value) {
    if (element && value && element.textContent.trim() !== value) {
      element.textContent = value;
    }
  }

  let applying = false;
  function applyLocale() {
    if (applying) return;
    applying = true;
    try {
      const localeCopy = copy[getLocale()] || copy.fr;
      const channels = Array.from(root.querySelectorAll('.hs-channel'));
      channels.forEach(function (channel, index) {
        setText(channel.querySelector('.hs-channel-copy strong'), localeCopy.channels[index]);
        const complete = channel.classList.contains('active');
        const state = index === 7
          ? (complete ? localeCopy.sent : localeCopy.sending)
          : index === 9
            ? (complete ? localeCopy.updated : localeCopy.updating)
            : (complete ? localeCopy.published : localeCopy.publishing);
        setText(channel.querySelector('.hs-channel-copy span'), state);
      });

      root.querySelectorAll('.hs-post-btn--edit').forEach(function (button) { setText(button, localeCopy.edit); });
      root.querySelectorAll('.hs-post-btn--delete').forEach(function (button) { setText(button, localeCopy.remove); });

      const kpis = Array.from(root.querySelectorAll('.hs-kpi > :first-child'));
      [localeCopy.views, localeCopy.interactions, localeCopy.clicks].forEach(function (value, index) {
        setText(kpis[index], value);
      });

      setText(root.querySelector('.hs-progress-row > strong'), localeCopy.progress);
      setText(root.querySelector('.hs-panel-title > strong'), localeCopy.posts);
      setText(root.querySelector('.hs-panel-title > span'), localeCopy.postsSub);
      setText(root.querySelector('.hs-dash-title > strong'), localeCopy.performance);
      setText(root.querySelector('.hs-dash-title > span'), localeCopy.performanceSub);

      const titles = Array.from(root.querySelectorAll('.hs-step-title strong'));
      const descriptions = Array.from(root.querySelectorAll('.hs-step-sub'));
      localeCopy.titles.forEach(function (value, index) { setText(titles[index], value); });
      localeCopy.descriptions.forEach(function (value, index) { setText(descriptions[index], value); });
    } finally {
      applying = false;
    }
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(function () {
      queued = false;
      applyLocale();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });

  applyLocale();
  window.addEventListener('pageshow', applyLocale);
})();
</script>
INRCY_HERO_LOCALE;
}
add_action( 'wp_footer', 'inrcy_home_hero_locale_runtime', 120 );
