/* SLATE OS mode for the SLATE FAR Calculator (same engine and report as slate-atelier.com/FAR).
   Inside SLATE OS there is no lead form or website log: each calculation goes to the SLATE OS FAR log instead,
   the report opens straight away, and SLATE OS can fill the inputs from a project. */
(function () {
  const inOS = window.parent && window.parent !== window;
  const post = msg => { try { window.parent.postMessage(Object.assign({ src: 'slate-far' }, msg), location.origin); } catch (e) {} };
  const pick = d => !d ? null : {
    city: d.city || 'dhaka', projName: d.projName, blockName: d.blockName, landKatha: d.landKatha, roadLabel: d.roadLabel,
    floors: d.proposedFloors, unitsPerFloor: d.unitsPerFloor, basements: d.basements, unitConfig: d.unitConfig || null,
    isJV: !!d.isJV, loShare: d.loShare, loUnits: d.loUnits, devUnits: d.devUnits,
    far: d.applicableFar, farType: d.city === 'ctg' ? 'CDA 2008' : (d.blockEligible ? 'Block FAR' : 'Non-block FAR'),
    farArea: d.totalFarArea, saleable: d.saleableArea, construction: d.constructionArea, maxUnits: d.maxUnits, totalUnits: d.totalUnits,
    totalCost: d.totalCost, costPerSqft: d.totalPerSqft, pricePerSqft: d.predictedPsf, profit: d.estProfit
  };

  // the website lead log is replaced by the SLATE OS FAR log
  window.sendLead = function (payload) {
    const kind = (payload && payload.request) || 'calculate';
    if (kind === 'calculate') post({ type: 'calc', result: pick(window.lastReport) });
  };
  window.logScenario = function () {};
  // the report opens straight away, prepared by the person signed in to SLATE OS
  window.generateReport = function () { if (!window.lastReport) return; window.reportBestWishes = false; buildAndPrintReport(); post({ type: 'report', result: pick(window.lastReport) }); };
  window.requestProposal = function () {};

  // printing from inside SLATE OS: hand the finished A4 pages to SLATE OS, which opens and prints them
  if (inOS) {
    const realPrint = window.print.bind(window);
    window.print = function () {
      const host = document.getElementById('printReport');
      if (!host || !host.innerHTML.trim()) return realPrint();
      const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
      post({ type: 'print', title: document.title, css, html: host.innerHTML });
    };
  }

  // tidy the page for SLATE OS: no install button, no call buttons, no proposal request
  /* inside SLATE OS: the SLATE OS look (white page, light grey groups, white bordered cards, uppercase section labels,
     full width of the SLATE OS column) and none of the website-only parts */
  if (inOS) { const st = document.createElement('style');
    st.textContent = [
      ':root{--bg-color:#fff;--input-bg:#F2F2F7;--output-bg:#fff;--border-color:#E5E5EA;--radius-md:10px;--radius-lg:12px;--shadow-sm:none;--shadow-md:none}',
      'html,body{background:#fff!important;min-height:0!important}',
      '.calc-note,.legend,#emptyState,.foot-links,.hero-tag,.cta-tag,.city-caption{display:none!important}',
      '.vertical-layout{max-width:none!important;padding:0 0 8px!important;gap:12px!important}',
      '.section-title{font-size:12px!important;letter-spacing:.05em!important;margin:18px 4px 8px!important;color:#8E8E93!important}',
      '.input-group{box-shadow:none!important;border-radius:10px!important}',
      '.field,.field-row{border-color:rgba(60,60,67,.12)!important}',
      '.field.out{background:#E8E8EC!important}',
      '.card{border:1px solid #E5E5EA;box-shadow:none!important}',
      '.card[style*="text-primary"]{border-color:#000}',
      '.city-switch{display:inline-flex!important;width:auto!important;background:#E8E8EC!important;border-radius:9px!important;padding:2px!important;box-shadow:none!important;gap:0!important;align-self:flex-start}',
      '.city-switch button{flex:none!important;font-size:13px!important;font-weight:500!important;padding:6px 14px!important;border-radius:7px!important;color:#000!important}',
      '.city-switch button.active{background:#fff!important;box-shadow:0 1px 3px rgba(0,0,0,.12)!important}',
      '.btn-calc{font-size:15px!important;padding:13px 20px!important;border-radius:10px!important}',
      '.btn-report{background:#E8E8EC!important;border:0!important;border-radius:10px!important;font-size:14px!important;padding:12px 18px!important}',
      '.results-header{border-color:#E5E5EA!important}',
      '.notice{border-radius:10px!important}',
      '.project-title{font-size:22px!important}'
    ].join('');
    (document.head || document.documentElement).appendChild(st); }
  const tidy = () => {
    if (!inOS) return;
    document.querySelectorAll('.call-fab,.btn-call-details,.btn-proposal,#btnInstall,#installOverlay,#leadOverlay').forEach(el => { el.style.display = 'none'; });
    const sh = document.querySelector('.sticky-header'); if (sh) sh.style.display = 'none';
    document.body.style.background = 'transparent';
  };
  tidy(); document.addEventListener('DOMContentLoaded', tidy);

  // SLATE OS can fill the inputs from a project
  const setVal = (id, v) => { const el = document.getElementById(id); if (!el || v == null || v === '') return; el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || e.data.src !== 'slate-os') return;
    const d = e.data;
    if (d.type === 'fill') {
      try { if (typeof setCity === 'function') setCity('dhaka'); } catch (x) {}
      setVal('projectName', d.projName);
      if (d.blockNo) { const sel = document.getElementById('densityBlock'); const o = sel && [...sel.options].find(o => o.textContent.trim() === String(d.blockNo)); if (o) { sel.value = o.value; try { onBlockNo(); } catch (x) {} } }
      setVal('landArea', d.katha); setVal('roadWidth', d.roadFt); setVal('unitsPerFloor', d.upf); setVal('proposedFloors', d.floors);
      setVal('basements', d.basements);
      if (d.jv != null) setVal('projectType', d.jv ? 'jv' : 'outright');
      setVal('loShareInput', d.loShare); setVal('loUnitsInput', d.loUnits);
      if (d.diffFloors && d.diffUnits != null) { setVal('hasDiffFloors', 'yes'); setVal('diffFloors', d.diffFloors); setVal('diffUnitsPerFloor', d.diffUnits); }
      try { inputChanged(); } catch (x) {}
    }
  });

  // tell SLATE OS how tall the page is, so it shows without an inner scrollbar
  if (inOS && window.ResizeObserver) {
    let last = 0; const send = () => { const v = document.querySelector('.vertical-layout'); const h = Math.ceil(v ? v.getBoundingClientRect().bottom + window.scrollY : document.documentElement.scrollHeight); if (Math.abs(h - last) > 4) { last = h; post({ type: 'height', h }); } };
    const ro = new ResizeObserver(send); ro.observe(document.body); const vl = document.querySelector('.vertical-layout'); if (vl) ro.observe(vl); window.addEventListener('load', send); setTimeout(send, 300);
  }
  post({ type: 'ready' });
})();
