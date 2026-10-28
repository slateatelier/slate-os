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
    let last = 0; const send = () => { const h = Math.ceil(document.documentElement.scrollHeight); if (Math.abs(h - last) > 4) { last = h; post({ type: 'height', h }); } };
    new ResizeObserver(send).observe(document.body); window.addEventListener('load', send); setTimeout(send, 300);
  }
  post({ type: 'ready' });
})();
