/* =====================================================================
   SLATE FAR Calculator — logic (far.js)
   Loaded by index.html. Holds the regulation data, the Dhaka (DAP 2022–2035
   + Imarot Nirman Bidhimala 2025, RAJUK) and Chittagong (Imarat Nirman
   Bidhimala 2008, CDA) calculations, cost & pricing, scenarios, the A4
   report, lead capture (save.php) and the SLATE logo (LOGO_SRC).
   index.html holds only the interface (markup + styles).
   Build 2026-10-28
   ===================================================================== */
const LOGO_SRC = "data:image/png;base64,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";
document.getElementById('hdrLogo').src = LOGO_SRC;

const blocksData = [
  {"no":"1","title":"Biman Bandar (Restricted)","aka":["Biman Bondar", "Airport"],"name":"Block 1 - Biman Bandar (Restricted)","du":0.0,"areaFar":0.0},
  {"no":"2","title":"Jinjira-Kalindi-Aganagar","aka":["Zinzira"],"name":"Block 2 - Jinjira-Kalindi-Aganagar","du":2.3,"areaFar":3.0},
  {"no":"3","title":"Bashundhara Residential Area","aka":[],"name":"Block 3 - Bashundhara Residential Area","du":2.0,"areaFar":4.1},
  {"no":"4","title":"Dakshinkhan","aka":["Dakshinkhahn", "Dakkhinkhan"],"name":"Block 4 - Dakshinkhan","du":1.9,"areaFar":3.1},
  {"no":"5","title":"Faridabad","aka":[],"name":"Block 5 - Faridabad","du":2.2,"areaFar":3.1},
  {"no":"6","title":"Kawla","aka":["Kaula"],"name":"Block 6 - Kawla","du":2.0,"areaFar":3.2},
  {"no":"7","title":"Uttara Phase 1 & 2","aka":[],"name":"Block 7 - Uttara Phase 1 & 2","du":2.0,"areaFar":4.5},
  {"no":"8","title":"Kamarpara","aka":[],"name":"Block 8 - Kamarpara","du":2.3,"areaFar":3.1},
  {"no":"9","title":"Mirpur","aka":[],"name":"Block 9 - Mirpur","du":1.9,"areaFar":3.4},
  {"no":"10","title":"Keraniganj-Taranagar-Bhakurta","aka":["Vakurta"],"name":"Block 10 - Keraniganj-Taranagar-Bhakurta","du":2.1,"areaFar":2.5},
  {"no":"11","title":"Anandanagar-Beribadh","aka":["Beribandh"],"name":"Block 11 - Anandanagar-Beribadh","du":2.0,"areaFar":2.6},
  {"no":"12","title":"Shewrapara","aka":[],"name":"Block 12 - Shewrapara","du":1.9,"areaFar":3.0},
  {"no":"13","title":"Ibrahimpur-East Shewrapara","aka":[],"name":"Block 13 - Ibrahimpur-East Shewrapara","du":1.9,"areaFar":3.0},
  {"no":"14","title":"Baunia","aka":["Bawnia"],"name":"Block 14 - Baunia","du":2.1,"areaFar":3.5},
  {"no":"15","title":"Khilkhet-Bhatara","aka":["Vatara", "Bhatara"],"name":"Block 15 - Khilkhet-Bhatara","du":1.9,"areaFar":3.1},
  {"no":"16","title":"Baridhara","aka":[],"name":"Block 16 - Baridhara","du":1.8,"areaFar":4.7},
  {"no":"17","title":"Gulshan-Banani","aka":[],"name":"Block 17 - Gulshan-Banani","du":1.9,"areaFar":5.5},
  {"no":"18","title":"Ashulia-Dhamsona-Hazarpur","aka":[],"name":"Block 18 - Ashulia-Dhamsona-Hazarpur","du":2.1,"areaFar":2.7},
  {"no":"19","title":"Korail","aka":[],"name":"Block 19 - Korail","du":1.8,"areaFar":2.0},
  {"no":"20","title":"Mohakhali DOHS","aka":[],"name":"Block 20 - Mohakhali DOHS","du":2.0,"areaFar":4.4},
  {"no":"21","title":"Niketan","aka":["Niketon"],"name":"Block 21 - Niketan","du":1.8,"areaFar":3.8},
  {"no":"22","title":"Mohakhali","aka":[],"name":"Block 22 - Mohakhali","du":2.5,"areaFar":3.3},
  {"no":"23","title":"Rampura","aka":[],"name":"Block 23 - Rampura","du":2.2,"areaFar":3.6},
  {"no":"24","title":"Tejgaon Industrial Area","aka":["Tejgaon IA"],"name":"Block 24 - Tejgaon Industrial Area","du":2.3,"areaFar":3.3},
  {"no":"25","title":"Mohammadpur","aka":[],"name":"Block 25 - Mohammadpur","du":2.2,"areaFar":3.4},
  {"no":"26","title":"Banagram","aka":["Bonogram"],"name":"Block 26 - Banagram","du":1.6,"areaFar":2.1},
  {"no":"27","title":"Baitul Aman","aka":[],"name":"Block 27 - Baitul Aman","du":2.1,"areaFar":3.2},
  {"no":"28","title":"Moghbazar","aka":["Mogbazar", "Magbazar"],"name":"Block 28 - Moghbazar","du":2.2,"areaFar":3.2},
  {"no":"29a","title":"Puran Dhaka","aka":["Old Dhaka"],"name":"Block 29a - Puran Dhaka","du":2.8,"areaFar":3.3},
  {"no":"29b","title":"Dhania-Muradpur","aka":[],"name":"Block 29b - Dhania-Muradpur","du":2.4,"areaFar":3.3},
  {"no":"30","title":"Green Model Town","aka":[],"name":"Block 30 - Green Model Town","du":2.1,"areaFar":3.9},
  {"no":"31","title":"Satarkul-Nasirabad","aka":["Shatarkul"],"name":"Block 31 - Satarkul-Nasirabad","du":1.3,"areaFar":1.9},
  {"no":"32","title":"Basabo-Milgaw","aka":[],"name":"Block 32 - Basabo-Milgaw","du":2.1,"areaFar":3.4},
  {"no":"33","title":"Bandar-Mograpara-Kanchpur","aka":["Bondar", "Kachpur"],"name":"Block 33 - Bandar-Mograpara-Kanchpur","du":2.1,"areaFar":2.5},
  {"no":"34","title":"Ramna-Dhaka University","aka":["DU"],"name":"Block 34 - Ramna-Dhaka University","du":2.3,"areaFar":3.3},
  {"no":"35","title":"Panthapath","aka":[],"name":"Block 35 - Panthapath","du":2.2,"areaFar":3.4},
  {"no":"36","title":"Dhanmondi Residential Area","aka":[],"name":"Block 36 - Dhanmondi Residential Area","du":1.8,"areaFar":5.0},
  {"no":"37","title":"Narayanganj Centre","aka":["Narayanganj Center"],"name":"Block 37 - Narayanganj Centre","du":2.8,"areaFar":3.5},
  {"no":"38","title":"Tongi","aka":[],"name":"Block 38 - Tongi","du":2.3,"areaFar":3.2},
  {"no":"39","title":"Birulia","aka":[],"name":"Block 39 - Birulia","du":1.8,"areaFar":2.4},
  {"no":"40","title":"Gognagar-NCC 27","aka":["Gogonagar"],"name":"Block 40 - Gognagar-NCC 27","du":2.1,"areaFar":2.7},
  {"no":"41","title":"Dasherkandi-Kayetpara","aka":[],"name":"Block 41 - Dasherkandi-Kayetpara","du":1.8,"areaFar":2.4},
  {"no":"42a","title":"Matuail-Sarulia","aka":[],"name":"Block 42a - Matuail-Sarulia","du":1.9,"areaFar":3.4},
  {"no":"42b","title":"Kutubpur-Fatullah","aka":[],"name":"Block 42b - Kutubpur-Fatullah","du":1.9,"areaFar":3.4},
  {"no":"43","title":"Pathalia","aka":[],"name":"Block 43 - Pathalia","du":2.1,"areaFar":2.7},
  {"no":"44","title":"Rupganj-Isapur","aka":[],"name":"Block 44 - Rupganj-Isapur","du":2.1,"areaFar":2.7},
  {"no":"45","title":"Bhulta-Golakandail","aka":[],"name":"Block 45 - Bhulta-Golakandail","du":2.1,"areaFar":2.7},
  {"no":"46","title":"Savar Paurashava","aka":["Savar Municipality"],"name":"Block 46 - Savar Paurashava","du":2.3,"areaFar":3.4},
  {"no":"47","title":"Jhilmil Residential Area","aka":[],"name":"Block 47 - Jhilmil Residential Area","du":1.9,"areaFar":4.3},
  {"no":"48","title":"Hemayetpur-Tetuljhora","aka":["Tetulzhora"],"name":"Block 48 - Hemayetpur-Tetuljhora","du":2.3,"areaFar":2.8},
  {"no":"49","title":"Tarabo Paurashava","aka":[],"name":"Block 49 - Tarabo Paurashava","du":2.3,"areaFar":3.0},
  {"no":"50","title":"Jolshiri Abashon","aka":["Jolsiri", "Jalshiri"],"name":"Block 50 - Jolshiri Abashon","du":2.1,"areaFar":4.1},
  {"no":"51","title":"Badda","aka":[],"name":"Block 51 - Badda","du":2.1,"areaFar":3.4},
  {"no":"52","title":"Aftabnagar-Banasree","aka":["Banashree"],"name":"Block 52 - Aftabnagar-Banasree","du":1.9,"areaFar":3.7},
  {"no":"53","title":"United-Sun Valley","aka":["Sundiali", "United-Sundiali", "Sunvalley"],"name":"Block 53 - United-Sun Valley","du":1.9,"areaFar":3.7},
  {"no":"54","title":"Purbachal Residential Area","aka":[],"name":"Block 54 - Purbachal Residential Area","du":1.9,"areaFar":4.5},
  {"no":"55","title":"Uttara Phase 3","aka":[],"name":"Block 55 - Uttara Phase 3","du":1.9,"areaFar":4.7},
  {"no":"56","title":"POHS-Shornali Residential","aka":["Swarnali"],"name":"Block 56 - POHS-Shornali Residential","du":1.9,"areaFar":4.1},
  {"no":"57","title":"Naldobhag","aka":[],"name":"Block 57 - Naldobhag","du":2.0,"areaFar":2.6},
  {"no":"58","title":"Kallyanpur Retention (FAR 0)","aka":["Kalyanpur"],"name":"Block 58 - Kallyanpur Retention (FAR 0)","du":0.0,"areaFar":0.0},
  {"no":"59","title":"Bosila-Chandrima","aka":["Bisila", "Basila"],"name":"Block 59 - Bosila-Chandrima","du":2.3,"areaFar":3.1},
  {"no":"60","title":"Khilkhet Residential Area","aka":[],"name":"Block 60 - Khilkhet Residential Area","du":1.9,"areaFar":4.4},
  {"no":"61","title":"Mirpur DOHS","aka":[],"name":"Block 61 - Mirpur DOHS","du":1.9,"areaFar":4.8},
  {"no":"62","title":"Paikpara-Tailarbag","aka":[],"name":"Block 62 - Paikpara-Tailarbag","du":1.9,"areaFar":3.3},
  {"no":"63","title":"Kaundia-Aminbazar","aka":["Kawdia"],"name":"Block 63 - Kaundia-Aminbazar","du":1.3,"areaFar":2.0},
  {"no":"64","title":"Kachkura-Mainartek","aka":["Moinartek"],"name":"Block 64 - Kachkura-Mainartek","du":2.1,"areaFar":2.6},
  {"no":"65","title":"Pallabi Phase 2","aka":["Pallabi 2"],"name":"Block 65 - Pallabi Phase 2","du":1.9,"areaFar":3.3},
  {"no":"66","title":"Ghatarchar","aka":[],"name":"Block 66 - Ghatarchar","du":2.0,"areaFar":3.2},
  {"no":"67","title":"Demra-Konapara","aka":[],"name":"Block 67 - Demra-Konapara","du":1.8,"areaFar":3.2},
  {"no":"68","title":"Subacha-Arakul-Beyara","aka":[],"name":"Block 68 - Subacha-Arakul-Beyara","du":2.1,"areaFar":2.7}
];

const roadsData = [
  {"label":"20 ft","plotFar":3.258},
  {"label":"25 ft","plotFar":3.385},
  {"label":"30 ft","plotFar":3.524},
  {"label":"35 ft","plotFar":3.778},
  {"label":"40 ft","plotFar":4.008},
  {"label":"50 ft","plotFar":4.135},
  {"label":"60 ft","plotFar":4.274},
  {"label":"75 ft","plotFar":4.631},
  {"label":"80 ft","plotFar":4.75},
  {"label":"100 ft","plotFar":4.75}
];

const blockSel = document.getElementById('densityBlock');
blocksData.forEach(b => {
  const o = document.createElement('option');
  o.value = b.name; o.textContent = b.no;
  blockSel.appendChild(o);
});


function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
function fmtF(n) { return n.toFixed(3); }

function getPlotSizeBonus(katha) {
  if (katha >= 20) return 0.75;
  if (katha >= 15) return 0.65;
  if (katha >= 10) return 0.50;
  if (katha >= 6)  return 0.35;
  if (katha >= 3)  return 0.20;
  return 0;
}

function getLandBonus(katha) {
  if (katha >= 20) return 0.75;
  if (katha >= 15) return 0.65;
  if (katha >= 10) return 0.50;
  if (katha >= 6)  return 0.35;
  if (katha >= 3)  return 0.20;
  return 0;
}

function getMGCTier(katha) {
  const sqm = katha * 66.89;
  if (sqm <= 134)   return { minPct: 0.625, maxPct: 0.70 };
  if (sqm <= 201)   return { minPct: 0.60,  maxPct: 0.675 };
  if (sqm <= 268)   return { minPct: 0.485, maxPct: 0.65 };
  if (sqm <= 402)   return { minPct: 0.465, maxPct: 0.625 };
  if (sqm <= 670)   return { minPct: 0.45,  maxPct: 0.60 };
  if (sqm <= 937)   return { minPct: null,   maxPct: 0.55 };
  if (sqm <= 1339)  return { minPct: null,   maxPct: 0.50 };
  if (sqm <= 2699)  return { minPct: null,   maxPct: 0.45 };
  return                   { minPct: null,   maxPct: 0.40 };
}

function fmtN(n) { return (n === null || n === undefined || !isFinite(n)) ? '—' : fmt(n); }

// Developer share (0-1) = 100% minus LO share; null if LO share is blank/invalid
function getDevShare() {
  const raw = document.getElementById('loShareInput').value;
  const lo = parseFloat(raw);
  if (raw === '' || isNaN(lo) || lo < 0 || lo > 100) return null;
  return (100 - lo) / 100;
}


// ===== SCENARIO COMPARISON =====
const scenarios = [];

function scMsg(txt) {
  const el = document.getElementById('scMsg');
  if (!el) return;
  el.textContent = txt || '';
  el.style.display = txt ? 'block' : 'none';
}

function addScenario() {
  try {
    scMsg('');
    doCalculate(true);   // always refresh results from the current inputs first
    const d = window.lastReport;
    if (!d) { scMsg('Enter the project details above first (block, land area, road width), then tap Add current.'); return; }
    if (scenarios.length >= 3) { scMsg('Maximum of 3 scenarios. Remove one to add another.'); return; }
    scenarios.push(JSON.parse(JSON.stringify(d)));
    renderScenarios();
    logScenario();
  } catch (err) {
    scMsg('Could not save the scenario: ' + (err && err.message ? err.message : err));
  }
}
// Log that this calculation was added to Scenario Comparison: its row in the leads log is marked "scenario compare: yes"
function logScenario() {
  try { sendLead(leadPayload({ request: 'scenario', name: '', phone: '', email: '', consent: false, website: '' })); } catch (e) {}
}
function esc2(t) { return String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function removeScenario(i) { scenarios.splice(i, 1); renderScenarios(); }
function clearScenarios() { scenarios.length = 0; renderScenarios(); }

function renderScenarios() {
  try { renderScenariosInner(); } catch (err) { scMsg('Could not draw the comparison: ' + (err && err.message ? err.message : err)); }
}

function renderScenariosInner() {
  const box = document.getElementById('scenarioTable');
  const btn = document.getElementById('btnAddScenario');
  if (!box) return;
  btn.disabled = scenarios.length >= 3;
  btn.textContent = scenarios.length >= 3 ? 'Max 3 scenarios' : '+ Add current';
  if (!scenarios.length) { box.innerHTML = ''; return; }
  box.innerHTML = buildScenarioTable(false);
}

function buildScenarioTable(forReport) {
  const cr = n => (n === null || n === undefined || !isFinite(n)) ? '—' : (n / 1e7).toFixed(2) + ' Cr';
  const pctTxt = v => v !== null && v !== undefined ? v + '%' : '—';
  const plotTxt = d => d.blockName.split(' - ')[0].replace('Block ', 'B') + ' · ' + d.landKatha + 'kt · ' + d.roadLabel.replace(' ', '');
  const samePlot = scenarios.every(d => plotTxt(d) === plotTxt(scenarios[0]));
  const anyJV = scenarios.some(d => d.isJV);
  const rows = [
    { grp: 'Inputs' },
    ...(samePlot ? [] : [{ label: 'Plot', txt: plotTxt, input: true }]),
    { label: 'Floors × units', txt: d => d.unitConfig ? unitConfigText(d.unitConfig) : (d.proposedFloors > 0 ? d.proposedFloors : '—') + ' × ' + (d.unitsPerFloor > 0 ? d.unitsPerFloor : '—'), input: true },
    { label: 'Basements', txt: d => String(d.basements), input: true },
    { label: 'Quality', txt: d => d.qualityName || '—', input: true },
    { label: 'Type', txt: d => d.isJV ? 'JV' + (d.loShare !== null ? ' ' + Math.round(d.loShare * 100) + ':' + Math.round(d.devShare * 100) : '') : 'Outright', input: true },
    ...(anyJV ? [{ label: 'Units LO : Dev', txt: d => d.isJV ? (d.loUnits !== null && d.loUnits !== undefined ? fmt(d.loUnits) : '—') + ' : ' + (d.devUnits !== null && d.devUnits !== undefined ? fmt(d.devUnits) : '—') : 'N/A', input: true }] : []),
    { label: 'Land / signing per katha', txt: d => d.landOrSigning !== null ? fmt(d.landOrSigning / d.landKatha) : '—', input: true },
    { label: 'Margin', txt: d => pctTxt(d.marginPct), input: true },
    { label: 'Commission', txt: d => d.addons ? pctLbl(d.addons.cm) : '—', input: true },
    { grp: 'Area & Units' },
    { label: 'FAR', txt: d => fmtF(d.applicableFar) },
    { label: 'Total FAR area (sqft)', raw: d => d.totalFarArea, txt: d => fmt(d.totalFarArea), delta: true },
    { label: 'Saleable (sqft)', raw: d => d.saleableArea, txt: d => fmt(d.saleableArea), delta: true },
    { label: 'Const. area (sqft)', raw: d => d.constructionArea, txt: d => fmt(d.constructionArea), delta: true },
    { label: 'Dev. saleable (sqft)', raw: d => d.devSaleable, txt: d => fmtN(d.devSaleable), delta: true },
    { label: 'LO saleable (sqft)', raw: d => d.isJV ? d.loSaleable : null, txt: d => d.isJV ? fmtN(d.loSaleable) : 'N/A', delta: true },
    { label: 'Dev. avg unit (sqft)', raw: d => d.devAvgUnit > 0 ? d.devAvgUnit : null, txt: d => d.devAvgUnit > 0 ? fmt(d.devAvgUnit) : '—', delta: true },
    ...(anyJV ? [{ label: 'LO avg unit (sqft)', raw: d => d.isJV && d.loAvgUnit > 0 ? d.loAvgUnit : null, txt: d => d.isJV ? fmtN(d.loAvgUnit) : 'N/A', delta: true }] : []),
    { label: 'Total units', raw: d => d.totalUnits > 0 ? d.totalUnits : null, txt: d => d.totalUnits > 0 ? fmt(d.totalUnits) : '—', delta: true, strong: true },
    { label: 'Max units allowed', raw: d => d.maxUnits, txt: d => fmtN(d.maxUnits), delta: true },
    { label: 'Units check', txt: d => (d.totalUnits > 0 && d.maxUnits !== null && d.maxUnits !== undefined) ? (d.totalUnits <= d.maxUnits ? 'Within max' : 'Over by ' + fmt(d.totalUnits - d.maxUnits)) : '—' },
    { label: 'Avg. unit (sqft)', raw: d => d.avgUnitSize > 0 ? d.avgUnitSize : null, txt: d => d.avgUnitSize > 0 ? fmt(d.avgUnitSize) : '—', delta: true },
    { label: 'FAR floors est.', txt: d => {
        if (d.city === 'ctg') return 'up to ' + d.maxFloors;
        const mn = d.blockEligible ? d.blockMinFloors : d.nbMinFloors, mx = d.blockEligible ? d.blockMaxFloors : d.nbMaxFloors;
        return mn === null || mn === undefined ? '—' : mn + '–' + (mx === null || mx === undefined ? 'N/A' : mx);
      } },
    { label: 'Floors check', txt: d => {
        if (d.city === 'ctg') return d.proposedFloors > 0 ? (d.proposedFloors <= d.maxFloors ? 'Within max' : 'Above max') : '—';
        const mn = d.blockEligible ? d.blockMinFloors : d.nbMinFloors, mx = d.blockEligible ? d.blockMaxFloors : d.nbMaxFloors;
        if (!(d.proposedFloors > 0) || mn === null || mn === undefined) return '—';
        if (d.proposedFloors < mn) return 'Below min';
        if (mx !== null && mx !== undefined && d.proposedFloors > mx) return 'Above max';
        return 'Within range';
      } },
    { grp: 'Cost' },
    { label: 'Land / signing cost', raw: d => d.landOrSigning, txt: d => cr(d.landOrSigning), delta: true },
    { label: 'Construction cost', raw: d => d.constCost, txt: d => cr(d.constCost), delta: true },
    { label: 'Overhead, finance, soft', raw: d => d.addons ? d.addons.extra : null, txt: d => d.addons ? cr(d.addons.extra) : '—', delta: true },
    { label: 'Total cost', raw: d => d.totalCost, txt: d => cr(d.totalCost), delta: true, strong: true },
    { label: 'Cost / sqft', raw: d => d.totalPerSqft, txt: d => fmtN(d.totalPerSqft), delta: true, best: 'min' },
    { grp: 'Pricing & Return' },
    { label: 'Price / sqft', raw: d => d.predictedPsf, txt: d => fmtN(d.predictedPsf), delta: true },
    { label: 'Est. revenue', raw: d => d.estRevenue, txt: d => cr(d.estRevenue), delta: true },
    { label: 'Est. profit', raw: d => d.estProfit, txt: d => cr(d.estProfit), delta: true, strong: true, best: 'max' },
    { label: 'Unit price', raw: d => d.unitPrice, txt: d => cr(d.unitPrice), delta: true, strong: true }
  ];

  let h = (samePlot && !forReport) ? '<div class="subtext" style="margin: 0 0 8px; font-size: 11px;">' + esc2(scenarios[0].blockName) + ' · ' + scenarios[0].landKatha + ' katha · ' + esc2(scenarios[0].roadLabel) + ' road</div>' : '';
  h += '<table class="sc-table' + (forReport ? ' rp-sc' : '') + '"><thead><tr><th></th>';
  scenarios.forEach((d, i) => { h += '<th>S' + (i + 1) + (forReport ? '' : '<button type="button" class="sc-x" data-i="' + i + '" aria-label="Remove scenario ' + (i + 1) + '">×</button>') + '</th>'; });
  h += '</tr></thead><tbody>';
  rows.forEach(r => {
    if (r.grp) { h += '<tr class="grp"><td colspan="' + (scenarios.length + 1) + '">' + r.grp + '</td></tr>'; return; }
    h += '<tr><td>' + r.label + '</td>';
    scenarios.forEach((d, i) => {
      const t = r.txt(d);
      const differs = r.input && i > 0 && t !== r.txt(scenarios[0]);
      let delta = '';
      if (r.delta && i > 0) {
        const a = r.raw(scenarios[0]), b = r.raw(d);
        if (a !== null && b !== null && a !== 0 && isFinite(a) && isFinite(b)) {
          const p = (b - a) / a * 100;
          if (Math.abs(p) >= 0.05) delta = '<span class="sc-delta">' + (p > 0 ? '+' : '−') + Math.abs(p).toFixed(1) + '% vs S1</span>';
        }
      }
      let star = '';
      if (r.best && scenarios.length > 1) {
        const vals = scenarios.map(x => r.raw(x));
        if (vals.every(v => v !== null && isFinite(v))) {
          const bestV = r.best === 'max' ? Math.max(...vals) : Math.min(...vals);
          const allSame = vals.every(v => Math.abs(v - vals[0]) < 1e-9);
          if (!allSame && Math.abs(r.raw(d) - bestV) < 1e-9) star = ' ★';
        }
      }
      h += '<td class="val mono' + (differs ? ' diff' : '') + '"' + (r.strong ? ' style="font-weight:700"' : '') + '>' + t + star + delta + '</td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table>';
  return h;
}

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = val;
}

// ===== CALCULATE BUTTON: results appear only after "Calculate" is tapped; each tap saves the project inputs =====
let revealed = false;      // are the results currently shown?
let inputsStale = false;   // inputs changed after the last Calculate
let lastCalcSig = '';
const SESSION_ID = Math.random().toString(36).slice(2, 10);

function setEmptyText(valid, msg) {
  const el = document.getElementById('emptyText'); if (!el) return;
  el.innerHTML = msg ? msg : valid
    ? (inputsStale ? 'Inputs changed.<br>Tap Calculate to update your results.' : 'Tap Calculate to see your results.')
    : (CITY === 'ctg' ? 'Enter land area and front road width,<br>then tap Calculate.' : 'Select a density block, enter road width and land area,<br>then tap Calculate.');
}

function inputChanged() {
  if (revealed) { revealed = false; inputsStale = true; }
  const m = document.getElementById('calcMsg'); if (m) m.textContent = '';
  calc();
}

function doCalculate(quiet) {
  const msg = document.getElementById('calcMsg'); msg.textContent = '';
  const block = document.getElementById('densityBlock').value;
  const road = parseFloat(document.getElementById('roadWidth').value) || 0;
  const land = parseFloat(document.getElementById('landArea').value) || 0;
  const needBlock = CITY !== 'ctg';
  if ((needBlock && !block) || !road || land <= 0) {
    if (!quiet) msg.textContent = needBlock ? 'Please select a density block, then enter road width and land area.' : 'Please enter land area and road width first.';
    return false;
  }
  if (road < ROAD_MIN_FT) {
    if (!quiet) msg.textContent = 'Minimum front road width is 20 ft.';
    return false;
  }
  revealed = true; inputsStale = false;
  calc();
  // Save the project (anonymous) unless identical to the last one saved
  try {
    const p = leadPayload({ request: 'calculate', name: '', phone: '', email: '', consent: false, website: '' });
    const sig = JSON.stringify(Object.assign({}, p, { scenarios: 0, session: '' }));
    if (sig !== lastCalcSig) {
      lastCalcSig = sig;
      ['r_refCode', 'c_refCode'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
      sendLead(p);
    }
  } catch (e) {}
  const c = document.getElementById('resultsContent');
  if (!quiet && c && c.scrollIntoView) { try { c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { c.scrollIntoView(); } }
}

function calcDhaka() {
  document.getElementById('ctgResults').style.display = 'none';
  const _ds = getDevShare();
  set('devShareDisplay', _ds !== null ? (Math.round(_ds * 1000) / 10) + '%' : '—');
  const projName  = document.getElementById('projectName').value || 'Unnamed Project';
  const blockName = document.getElementById('densityBlock').value;
  const landKatha = parseFloat(document.getElementById('landArea').value) || 0;
  const roadFtIn  = parseFloat(document.getElementById('roadWidth').value);
  const roadLabel = !isNaN(roadFtIn) && roadFtIn > 0 ? roadFtIn + ' ft' : '';
  const unitsPerFloor    = parseFloat(document.getElementById('unitsPerFloor').value) || 0;
  const proposedFloors   = parseFloat(document.getElementById('proposedFloors').value) || 0;
  const basements        = parseInt(document.getElementById('basements').value) || 0;

  const empty = document.getElementById('emptyState');
  const content = document.getElementById('resultsContent');

  if (!blockName || !roadLabel || landKatha <= 0 || roadFtIn < ROAD_MIN_FT) {
    empty.style.display = 'block';
    content.style.display = 'none';
    showTail(false);
    setEmptyText(false, blockName && landKatha > 0 && roadFtIn > 0 && roadFtIn < ROAD_MIN_FT ? 'Minimum front road width is 20 ft.<br>Enter 20 ft or more, then tap Calculate.' : null);
    const hero0 = document.getElementById('heroTag'); if (hero0) hero0.style.display = '';
    return;
  }
  const hero1 = document.getElementById('heroTag'); if (hero1) hero1.style.display = '';   // tagline stays visible

  const b = blocksData.find(x => x.name === blockName);
  const r = getPlotFar(roadFtIn);
  if (!b || !r) return;

  const areaFar = b.areaFar;
  const plotFar = r.plotFar;
  const landSqft = landKatha * 720;
  const roadWidth = roadFtIn;
  const baseDu = b.du;
  
  // Evaluate block eligibility
  const blockEligible = landKatha >= 30;

  // --- Check for Regional Bonus ---
  const isPurbachalOrJhilmil = blockName.includes('Purbachal') || blockName.includes('Jhilmil');
  const regionalBonus = isPurbachalOrJhilmil ? 0.5 : 0;

  // --- Dynamic Road Bonus Calculation ---
  const roadBonusDynamic = roadWidth > 30 ? Math.min(1, (roadWidth - 30) * 0.02) : 0;

  // --- Non-Block FAR Calculation Core Updates ---
  const nonBlockBaseFar = (areaFar > 0 && plotFar > 0) ? Math.min(areaFar, plotFar) : 0;
  const nonBlockMaxFar  = (areaFar > 0 && plotFar > 0) ? Math.max(areaFar, plotFar) : 0;
  const plotSizeBonus   = getPlotSizeBonus(landKatha);
  const roadBonusNB     = roadBonusDynamic;
  
  // All incentives (size + road + regional) are added to the Minimum Base,
  // then the total is capped at the Maximum FAR (max of Area FAR and Plot FAR)
  const nonBlockFar = nonBlockBaseFar > 0 ? 
    Math.min(nonBlockBaseFar + plotSizeBonus + roadBonusNB + regionalBonus, nonBlockMaxFar) : 0;
  const nonBlockIncentiveApplied = nonBlockFar - nonBlockBaseFar;

  // --- Block FAR Calculation ---
  const isLargeBlock = landKatha >= 60;
  
  const areaFarIncentive      = isLargeBlock ? 0.20 : 0.15;
  const duIncentive           = isLargeBlock ? 0.20 : 0.15;
  const plotFarIncentiveBlock = isLargeBlock ? 0.75 : 0.50; 
  
  const avgUnitSizeFromChart = baseDu > 0 ? (areaFar * 720) / baseDu : 0;
  const netDuWithBlockIncentive = baseDu * (1 + duIncentive);
  
  const areaFarWithBlock  = (avgUnitSizeFromChart > 0 && areaFar > 0) ? 
    ((netDuWithBlockIncentive * avgUnitSizeFromChart) / 720) * (1 + areaFarIncentive) : 0;
    
  const plotFarWithBlock  = plotFar > 0 ? (plotFar + plotFarIncentiveBlock) : 0;
  
  const blockBaseFar      = (areaFar > 0 && plotFar > 0) ? Math.min(areaFarWithBlock, plotFarWithBlock) : 0;
  const blockMaxFar       = (areaFar > 0 && plotFar > 0) ? Math.max(areaFarWithBlock, plotFarWithBlock) : 0;
  const landBonus         = getLandBonus(landKatha);
  const roadBonusBlock    = roadBonusDynamic;
  
  // Incentives added and capped (+0.5 buffer), plus Regional Bonus
  const blockFar = blockBaseFar > 0 ? 
    Math.min(blockBaseFar + landBonus + roadBonusBlock, blockMaxFar + 0.5) + regionalBonus : 0;

  // --- MGC Calculation ---
  let mgcMaxPct, mgcMinPct;
  const mgcTier = getMGCTier(landKatha);
  
  if (blockEligible) {
    // Override MGC Max when block applies: 40% for under 60 katha, 45% for 60 and above
    mgcMaxPct = isLargeBlock ? 0.45 : 0.40;
    // Maintain standard min logic for floor division math downstream
    mgcMinPct = mgcTier.minPct;
  } else {
    mgcMaxPct = mgcTier.maxPct;
    mgcMinPct = mgcTier.minPct;
  }

  const mgcMaxArea  = landSqft * mgcMaxPct;
  const mgcMinArea  = mgcMinPct !== null ? landSqft * mgcMinPct : null;

  const totalFarAreaBlock = landSqft * blockFar;
  const totalFarAreaNB    = landSqft * nonBlockFar;
  const saleableArea = (blockEligible ? totalFarAreaBlock : totalFarAreaNB) * 1.22;
  const constMultiplier = basements === 2 ? 1.45 : basements === 1 ? 1.35 : 1.25;
  const constructionArea = saleableArea * constMultiplier;

  const blockMinFloors = blockEligible && mgcMaxArea > 0 ? Math.ceil(totalFarAreaBlock / mgcMaxArea) : null;
  const blockMaxFloors = blockEligible && mgcMinArea !== null && mgcMinArea > 0 ? Math.ceil(totalFarAreaBlock / mgcMinArea - 1e-9) : null;   // rounded UP: RAJUK allows the full floor for a fraction
  const nbMinFloors = mgcMaxArea > 0 ? Math.ceil(totalFarAreaNB / mgcMaxArea) : null;
  const nbMaxFloors = mgcMinArea !== null && mgcMinArea > 0 ? Math.ceil(totalFarAreaNB / mgcMinArea - 1e-9) : null;   // rounded UP: RAJUK allows the full floor for a fraction

  // --- Maximum Units Calculation ---
  const maxUnits = computeMaxUnits(landKatha, baseDu);

  const unitConfig   = getUnitConfig();
  const totalUnits   = unitConfig.total;
  const avgUnitSize  = totalUnits > 0 ? saleableArea / totalUnits : 0;

  // --- COST ANALYSIS ---
  const isJV          = document.getElementById('projectType').value === 'jv';
  const landPriceRaw  = document.getElementById('landPrice').value;
  const hasLandPrice  = landPriceRaw !== '' && !isNaN(parseFloat(landPriceRaw));
  const landPrice     = hasLandPrice ? parseFloat(landPriceRaw) : 0;
  const constRate     = parseFloat(document.getElementById('quality').value) || 0;

  // Developer / LO split (Outright = 100% developer)
  const devShare      = isJV ? getDevShare() : 1;
  const loShare       = devShare !== null ? 1 - devShare : null;
  const devSaleable   = devShare !== null ? saleableArea * devShare : null;
  const loSaleable    = loShare !== null ? saleableArea * loShare : null;

  // Land cost (Outright) or Signing money (JV) -- added into total cost either way
  const landOrSigning = hasLandPrice ? landPrice * landKatha : null;
  const landPerSqft   = (landOrSigning !== null && devSaleable > 0) ? landOrSigning / devSaleable : null;

  // Construction cost is borne by the developer and divided over the developer's saleable area
  const constCost     = constRate > 0 ? constructionArea * constRate : null;
  const constPerSqft  = (constCost !== null && devSaleable > 0) ? constCost / devSaleable : null;

  // Total cost with add-ons, predicted price (margin + commission gross-up) and tentative unit price
  const ad = computeAddons(landOrSigning, constCost, devSaleable, avgUnitSize);
  const totalCost = ad.total, totalPerSqft = ad.perSqft;
  const marginPct = ad.marginPct, predictedPsf = ad.price, unitPrice = ad.unitPrice;

  // --- UI RENDER ---
  empty.style.display = revealed ? 'none' : 'block';
  content.style.display = revealed ? 'block' : 'none';
  showTail(revealed);
  if (!revealed) setEmptyText(true);

  set('r_projName', projName);
  set('r_areaFar', fmtF(areaFar));
  set('r_plotFar', fmtF(plotFar));
  set('r_plotFarSub', roadFtIn + ' ft road · ' + r.band + ' band');

  const blockCard   = document.getElementById('r_blockFarCard');
  const blockNotice = document.getElementById('r_blockNotice');
  const farHero     = document.getElementById('r_farHero');
  
  if (blockEligible) {
    blockCard.style.display   = 'block';
    blockNotice.style.display = 'none';
    farHero.style.gridTemplateColumns = window.innerWidth > 600 ? '1fr 1fr' : '1fr';
    set('r_blockFar', fmtF(blockFar));
    set('r_blockBase', fmtF(blockBaseFar));
    set('r_landBonus', '+' + fmtF(landBonus));
    set('r_roadBonusBlock', '+' + fmtF(roadBonusDynamic));
    
    // Render Regional Bonus conditionally
    document.getElementById('row_regionalBonusBlock').style.display = regionalBonus > 0 ? 'flex' : 'none';
    set('r_regionalBonusBlock', '+' + fmtF(regionalBonus));
    
    set('r_blockIncentiveTotal', '+' + fmtF(landBonus + roadBonusDynamic + regionalBonus));
  } else {
    blockCard.style.display   = 'none';
    blockNotice.style.display = 'block';
    farHero.style.gridTemplateColumns = '1fr';
  }

  set('r_nonBlockFar', fmtF(nonBlockFar));
  set('r_nbBase', fmtF(nonBlockBaseFar));
  set('r_plotSizeBonus', '+' + fmtF(plotSizeBonus));
  set('r_roadBonusNB', '+' + fmtF(roadBonusNB));

  // Render Regional Bonus conditionally
  document.getElementById('row_regionalBonusNB').style.display = regionalBonus > 0 ? 'flex' : 'none';
  set('r_regionalBonusNB', '+' + fmtF(regionalBonus));

  set('r_nbIncentiveTotal', '+' + fmtF(nonBlockIncentiveApplied));

  set('r_mgcMin',     mgcMinPct !== null ? (mgcMinPct * 100).toFixed(1) + '%' : 'N/A');
  set('r_mgcMax',     (mgcMaxPct * 100).toFixed(1) + '%');
  set('r_mgcMinArea', mgcMinArea !== null ? fmt(mgcMinArea) : 'N/A');
  set('r_mgcMaxArea', fmt(mgcMaxArea));

  set('r_maxUnits',     fmt(maxUnits));
  set('r_totalFarArea', blockEligible ? fmt(totalFarAreaBlock) : fmt(totalFarAreaNB));
  set('r_saleable',          fmt(saleableArea));
  set('r_constructionArea',  fmt(constructionArea));
  set('r_totalUnits',   totalUnits > 0 ? fmt(totalUnits) : '—');
  set('r_avgSize',      avgUnitSize > 0 ? fmt(avgUnitSize) : '—');
  
  const maxUnitsLabel = document.getElementById('r_maxUnitsLabel');
  if (maxUnitsLabel) {
    if (blockEligible) {
      maxUnitsLabel.textContent = `(DAP + ${Math.round(duIncentive * 100)}%) + 10%`;
    } else {
      maxUnitsLabel.textContent = `(DAP + 10%)`;
    }
  }

  // Cost analysis render
  document.getElementById('ratioField').style.display = isJV ? 'flex' : 'none';
  document.getElementById('landPriceLabel').textContent = isJV ? 'Signing Money per Katha (BDT)' : 'Land Price per Katha (BDT)';

  const landLabel = isJV ? 'Signing Money' : 'Land Cost';
  set('r_landCostLabel', landLabel);
  set('r_landPerSqftLabel', landLabel + ' / Saleable Area');
  set('r_totalLandLabel', landLabel);
  const perSqftSub = isJV ? 'BDT / sqft (developer share)' : 'BDT / sqft';
  set('r_landPerSqftSub', perSqftSub);
  set('r_constPerSqftSub', perSqftSub);

  set('r_devShareLabel', devShare !== null && isJV ? '(' + Math.round(devShare * 1000) / 10 + '%)' : '');
  set('r_loShareLabel',  loShare !== null && isJV ? '(' + Math.round(loShare * 1000) / 10 + '%)' : '');
  set('r_devSaleable', fmtN(devSaleable));
  const us = unitSplitOutputs(totalUnits, isJV, devSaleable, loSaleable);
  renderUnitSplit('r', isJV, us);
  set('r_loSaleable',  isJV ? fmtN(loSaleable) : 'N/A');

  set('r_landCost', fmtN(landOrSigning));
  set('r_landPerSqft', fmtN(landPerSqft));
  set('r_constCost', fmtN(constCost));
  set('r_constCostSub', constRate > 0 ? 'BDT (' + fmt(constructionArea) + ' sqft × ' + fmt(constRate) + ')' : 'BDT');
  set('r_constPerSqft', fmtN(constPerSqft));

  set('r_totalLand', fmtN(landOrSigning));
  set('r_totalConst', fmtN(constCost));
  renderAddons('r', ad, avgUnitSize);

  const blockFloorsCard = document.getElementById('r_blockFloorsCard');
  if (blockEligible) {
    blockFloorsCard.style.opacity = '1';
    set('r_blockMinFloors', blockMinFloors !== null ? blockMinFloors : '—');
    set('r_blockMaxFloors', blockMaxFloors !== null ? blockMaxFloors : 'N/A');
  } else {
    blockFloorsCard.style.opacity = '0.3';
    set('r_blockMinFloors', 'N/A');
    set('r_blockMaxFloors', 'N/A');
  }
  set('r_nbMinFloors', nbMinFloors !== null ? nbMinFloors : '—');
  set('r_nbMaxFloors', nbMaxFloors !== null ? nbMaxFloors : 'N/A');

  // Snapshot for the A4 report
  const qSel = document.getElementById('quality');
  window.lastReport = {
    projName, blockName, landKatha, landSqft, roadLabel, isJV, basements,
    qualityName: qSel.value ? qSel.options[qSel.selectedIndex].text.split(' —')[0] : null,
    constRate, areaFar, plotFar, blockEligible, blockFar, nonBlockFar,
    blockBaseFar, nonBlockBaseFar, landBonus, plotSizeBonus, roadBonusDynamic, regionalBonus,
    mgcMinPct, mgcMaxPct, mgcMinArea, mgcMaxArea,
    blockMinFloors, blockMaxFloors, nbMinFloors, nbMaxFloors,
    maxUnits, totalUnits, avgUnitSize, unitsPerFloor, proposedFloors,
    applicableFar: blockEligible ? blockFar : nonBlockFar,
    totalFarArea: blockEligible ? totalFarAreaBlock : totalFarAreaNB,
    saleableArea, constructionArea, landLabel, landOrSigning, landPerSqft,
    constCost, constPerSqft, totalCost, totalPerSqft,
    marginPct, predictedPsf, unitPrice,
    estRevenue: ad.revenue, estProfit: ad.profit, addons: ad, city: 'dhaka',
    devShare, loShare, devSaleable, loSaleable,
    loUnits: us.loUnits, devUnits: us.devUnits, devAvgUnit: us.devAvg, loAvgUnit: us.loAvg, unitConfig
  };
}


// ===== DAP PLOT FAR FOR ANY ROAD WIDTH =====
// A road takes the band of the widest listed width it meets (80 ft and above = 4.75). Minimum 20 ft.
const ROAD_MIN_FT = 20;
function getPlotFar(ft) {
  if (!(ft >= ROAD_MIN_FT)) return null;
  let band = roadsData[0];
  roadsData.forEach(r => { if (ft >= parseFloat(r.label) - 1e-9) band = r; });
  return { plotFar: band.plotFar, band: band.label };
}

// ===== CITY SWITCH (Dhaka = DAP 2022–35 · Chittagong = Imarat Nirman Bidhimala 2008, CDA) =====
let CITY = 'dhaka';

function setCity(c) {
  CITY = c === 'ctg' ? 'ctg' : 'dhaka';
  document.body.classList.toggle('mode-ctg', CITY === 'ctg');
  ['cityDhaka', 'cityCtg'].forEach(id => {
    const on = (id === 'cityCtg') === (CITY === 'ctg');
    const b = document.getElementById(id);
    b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.getElementById('cityCaption').textContent = CITY === 'ctg'
    ? 'Imarat Nirman Bidhimala 2008 · CDA'
    : 'DAP 2022–2035 · Imarot Nirman Bidhimala 2025 · RAJUK';
  try { localStorage.setItem('slateFarCity', CITY); } catch (e) {}
  revealed = false; inputsStale = false;
  const m = document.getElementById('calcMsg'); if (m) m.textContent = '';
  calc();
}

function initCity() {
  let c = 'dhaka';
  try { c = localStorage.getItem('slateFarCity') || 'dhaka'; } catch (e) {}
  if (/^#(ctg|chittagong)$/i.test(location.hash)) c = 'ctg';
  if (/^#dhaka$/i.test(location.hash)) c = 'dhaka';
  setCity(c);
}

// ===== MAX UNITS (DAP density) =====
// base = ceil(katha × DU); non-block: ceil(base × 1.10); block (≥30 katha): ceil(ceil(base × (1 + DU incentive)) × 1.10), DU incentive 15% (20% at ≥60 katha)
function computeMaxUnits(katha, du) {
  const baseUnits = Math.ceil(katha * du);
  if (katha >= 30) {
    const duIncentive = katha >= 60 ? 0.20 : 0.15;
    return Math.ceil(Math.ceil(baseUnits * (1 + duIncentive)) * 1.10);
  }
  return Math.ceil(baseUnits * 1.10);
}

// ===== LO / DEVELOPER UNITS (JV) =====
// Outright: every unit is the developer's. JV: developer units = proposed units − LO units (entered as a number).
// Total units = (units / regular floor × regular floors) + (units / different floor × different floors)
// where regular floors = total floors − different floors. "Different floors" are optional (question set to Yes).
function getUnitConfig() {
  const F = parseFloat(document.getElementById('proposedFloors').value) || 0;
  const U = parseFloat(document.getElementById('unitsPerFloor').value) || 0;
  const yes = document.getElementById('hasDiffFloors').value === 'yes';
  const dFr = document.getElementById('diffFloors').value, dUr = document.getElementById('diffUnitsPerFloor').value;
  const dF = parseFloat(dFr), dU = parseFloat(dUr);
  const c = { F, U, asked: yes, used: false, ok: true, dF: null, dU: null, regular: F, total: 0, msg: '' };
  const base = F > 0 && U > 0 ? F * U : 0;
  if (!yes) { c.total = base; return c; }
  if (dFr === '' || dUr === '' || isNaN(dF) || isNaN(dU) || dF <= 0 || dU < 0) {
    c.total = base; c.msg = 'Enter the number of different floors and their units';
    return c;
  }
  if (F > 0 && dF >= F) { c.ok = false; c.total = 0; c.dF = dF; c.dU = dU; c.msg = 'Different floors must be fewer than the total floors (' + F + ')'; return c; }
  c.used = true; c.dF = dF; c.dU = dU; c.regular = F - dF;
  c.total = F > 0 && U > 0 ? U * c.regular + dU * dF : 0;
  return c;
}
function unitConfigText(c) {
  if (!c || !(c.F > 0)) return '—';
  if (c.used) return c.regular + ' × ' + (c.U > 0 ? c.U : '—') + ' + ' + c.dF + ' × ' + c.dU;
  return c.F + ' × ' + (c.U > 0 ? c.U : '—');
}
function proposedUnits() { return getUnitConfig().total; }
function getUnitSplit(totalUnits, isJV) {
  if (!isJV) return { lo: null, dev: totalUnits > 0 ? totalUnits : null, ok: true };
  const raw = document.getElementById('loUnitsInput').value;
  const lo = parseFloat(raw);
  if (raw === '' || isNaN(lo) || lo < 0) return { lo: null, dev: null, ok: true };
  if (totalUnits > 0 && lo > totalUnits) return { lo, dev: null, ok: false };
  return { lo, dev: totalUnits > 0 ? totalUnits - lo : null, ok: true };
}
function unitSplitOutputs(totalUnits, isJV, devSaleable, loSaleable) {
  const sp = getUnitSplit(totalUnits, isJV);
  const devAvg = (sp.dev > 0 && devSaleable > 0) ? devSaleable / sp.dev : null;
  const loAvg = (isJV && sp.lo > 0 && loSaleable > 0) ? loSaleable / sp.lo : null;
  return { loUnits: sp.lo, devUnits: sp.dev, unitsOk: sp.ok, devAvg, loAvg };
}
function renderUnitSplit(p, isJV, u) {
  set(p + '_devAvg', fmtN(u.devAvg));
  set(p + '_devAvgSub', u.devUnits > 0 ? 'sqft · ' + fmt(u.devUnits) + ' developer unit' + (u.devUnits === 1 ? '' : 's')
    : (!u.unitsOk ? 'LO units exceed proposed units' : isJV ? 'enter LO units and units / floors' : 'enter units / floor and floors'));
  set(p + '_loAvg', isJV ? fmtN(u.loAvg) : 'N/A');
  set(p + '_loAvgSub', !isJV ? 'outright purchase' : u.loUnits > 0 ? 'sqft · ' + fmt(u.loUnits) + ' LO unit' + (u.loUnits === 1 ? '' : 's') : 'enter LO units');
}

// Live cells in the input area: they update as the user types, before Calculate
function updateInputUI() {
  const isJV = document.getElementById('projectType').value === 'jv';
  document.getElementById('ratioField').style.display = isJV ? 'flex' : 'none';
  document.getElementById('unitsSplitField').style.display = isJV ? 'flex' : 'none';
  document.getElementById('landPriceLabel').textContent = isJV ? 'Signing Money per Katha (BDT)' : 'Land Price per Katha (BDT)';
  const ds = getDevShare();
  set('devShareDisplay', ds !== null ? (Math.round(ds * 1000) / 10) + '%' : '—');

  const uc = getUnitConfig();
  document.getElementById('diffFloorField').style.display = uc.asked ? 'flex' : 'none';
  document.getElementById('totalUnitsCell').style.display = uc.asked ? 'block' : 'none';
  set('upfLabel', uc.asked ? 'Units / Regular Floor' : 'Units / Floor');
  set('floorsLabel', uc.asked ? 'Floors (Total)' : 'Floors');
  const tc = document.getElementById('totalUnitsCell');
  tc.classList.toggle('over', !uc.ok);
  set('totalUnitsLive', !uc.ok ? '—' : uc.total > 0 ? fmt(uc.total) : '—');
  set('totalUnitsLiveSub', !uc.ok || uc.msg ? uc.msg
    : uc.total > 0 ? '(' + uc.U + ' units × ' + uc.regular + ' regular floor' + (uc.regular === 1 ? '' : 's') + ') + (' + uc.dU + ' unit' + (uc.dU === 1 ? '' : 's') + ' × ' + uc.dF + ' different floor' + (uc.dF === 1 ? '' : 's') + ')'
    : 'Enter units / regular floor and total floors');

  const total = uc.total;
  const sp = getUnitSplit(total, isJV);
  const devCell = document.getElementById('devUnitsCell');
  devCell.classList.toggle('over', !sp.ok);
  set('devUnitsDisplay', !sp.ok ? 'LO units exceed ' + fmt(total) + ' proposed'
    : sp.dev !== null ? fmt(sp.dev) + ' <span style="font-size:12px;font-weight:500;color:var(--text-secondary)">of ' + fmt(total) + '</span>'
    : (total > 0 ? '—' : 'Enter units / floor and floors'));

  // Max units (Dhaka only; the CDA 2008 engine has no DU cap)
  const cell = document.getElementById('maxUnitsCell');
  const b = blocksData.find(x => x.name === document.getElementById('densityBlock').value);
  const land = parseFloat(document.getElementById('landArea').value) || 0;
  if (!b || land <= 0) {
    cell.classList.remove('over');
    set('maxUnitsLive', '—'); set('maxUnitsLiveSub', 'Select a block and enter land area');
    return;
  }
  const max = computeMaxUnits(land, b.du);
  const over = total > 0 && total > max;
  cell.classList.toggle('over', over);
  set('maxUnitsLive', fmt(max));
  set('maxUnitsLiveSub', (land >= 30 ? 'DAP + ' + (land >= 60 ? 20 : 15) + '% block + 10%' : 'DAP + 10%')
    + (total > 0 ? ' · proposed ' + fmt(total) + (over ? ' · over by ' + fmt(total - max) : ' · within limit') : ' · enter units / floor and floors to check'));
}

function calc() {
  try { updateInputUI(); } catch (e) {}
  if (CITY === 'ctg') calcCtg(); else calcDhaka();
  if (window.lastReport && window.slateIds) { window.lastReport.projectCode = window.slateIds.project; window.lastReport.userId = window.slateIds.user; }
}

function showTail(on) { const t = document.getElementById('resultsTail'); if (t) t.style.display = on ? 'block' : 'none'; }

// ===== BLOCK NO. <-> BLOCK NAME SYNC + SUGGESTIONS =====
const normTxt = t => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
let sugIdx = -1, sugList = [];

function pickBlock(b) {
  document.getElementById('densityBlock').value = b ? b.name : '';
  document.getElementById('blockName').value = b ? b.title : '';
  closeSuggest();
  inputChanged();
}

function onBlockNo() {
  const v = document.getElementById('densityBlock').value;
  const b = blocksData.find(x => x.name === v);
  document.getElementById('blockName').value = b ? b.title : '';
  inputChanged();
}

function blockMatches(q) {
  const n = normTxt(q);
  if (!n) return blocksData.slice();
  const scored = [];
  blocksData.forEach(b => {
    const names = [b.title].concat(b.aka);
    const hay = names.map(normTxt);
    const num = normTxt(b.no);
    let score = -1;
    if (num === n || num === n.replace(/^block/, '')) score = 0;
    else if (hay.some(h => h.startsWith(n))) score = 1;
    else if (names.join(' ').toLowerCase().split(/[^a-z0-9]+/).some(w => w && w.startsWith(n))) score = 2;
    else if (hay.some(h => h.includes(n))) score = 3;
    if (score >= 0) scored.push([score, b]);
  });
  return scored.sort((a, c) => a[0] - c[0]).map(x => x[1]);
}

function renderSuggest(list) {
  const box = document.getElementById('blockSuggest');
  sugList = list.slice(0, 12); sugIdx = -1;
  box.innerHTML = list.length
    ? sugList.map((b, i) => `<button type="button" role="option" onmousedown="event.preventDefault()" onclick="pickBlock(sugList[${i}])"><span class="n">${esc(b.no)}</span><span>${esc(b.title)}</span><span class="f">FAR ${b.areaFar.toFixed(1)}</span></button>`).join('')
    : '<div class="none">No block matches. Check the spelling or pick a number.</div>';
  box.style.display = 'block';
  document.getElementById('blockName').setAttribute('aria-expanded', 'true');
}

function closeSuggest() {
  const box = document.getElementById('blockSuggest'); if (box) box.style.display = 'none';
  const inp = document.getElementById('blockName'); if (inp) inp.setAttribute('aria-expanded', 'false');
}

function onBlockNameInput(focusOnly) {
  const q = document.getElementById('blockName').value;
  renderSuggest(blockMatches(q));
  if (focusOnly) return;
  // an exact name or old spelling selects the block straight away
  const n = normTxt(q);
  const exact = blocksData.find(b => normTxt(b.title) === n || b.aka.some(a => normTxt(a) === n));
  const sel = document.getElementById('densityBlock');
  if (exact) { if (sel.value !== exact.name) { sel.value = exact.name; inputChanged(); } }
  else if (sel.value) { sel.value = ''; inputChanged(); }
}

function onBlockNameKey(e) {
  const box = document.getElementById('blockSuggest');
  if (box.style.display === 'none' || !sugList.length) return;
  const btns = box.querySelectorAll('button');
  if (e.key === 'ArrowDown') { e.preventDefault(); sugIdx = Math.min(sugIdx + 1, btns.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sugIdx = Math.max(sugIdx - 1, 0); }
  else if (e.key === 'Enter') { e.preventDefault(); pickBlock(sugList[sugIdx >= 0 ? sugIdx : 0]); return; }
  else if (e.key === 'Escape') { closeSuggest(); return; }
  else return;
  btns.forEach((b, i) => b.classList.toggle('on', i === sugIdx));
  if (btns[sugIdx]) btns[sugIdx].scrollIntoView({ block: 'nearest' });
}

// ===== COST ADD-ONS & PRICING (shared by Dhaka and Chittagong) =====
function pctVal(id) { const el = document.getElementById(id); const v = el ? parseFloat(el.value) : NaN; return (isNaN(v) || v < 0) ? 0 : v / 100; }
function pctLbl(x) { return (Math.round(x * 1000) / 10) + '%'; }

// Design + contingency on construction; overhead + finance on land + construction + soft costs;
// margin on total cost; commission comes out of the sale price, so the price is grossed up to cover it.
function computeAddons(land, cons, devS, avg) {
  const dg = pctVal('pctDesign'), ct = pctVal('pctCont'), oh = pctVal('pctOverhead'), fi = pctVal('pctFinance');
  const cm = Math.min(pctVal('pctComm'), 0.5);
  const mRaw = document.getElementById('marginPct').value;
  const hasMargin = mRaw !== '' && !isNaN(parseFloat(mRaw));
  const marginPct = hasMargin ? parseFloat(mRaw) : null;
  const mg = hasMargin ? Math.max(0, marginPct) / 100 : 0;

  const soft    = cons !== null ? cons * (dg + ct) : null;
  const base    = (land !== null && cons !== null) ? land + cons + soft : null;
  const ohA     = base !== null ? base * oh : null;
  const fiA     = base !== null ? base * fi : null;
  const total   = base !== null ? base + ohA + fiA : null;
  const perSqft = (total !== null && devS > 0) ? total / devS : null;
  const priced  = perSqft !== null && (hasMargin || cm > 0);
  const marginSqft = priced ? perSqft * mg : null;
  const price   = priced ? perSqft * (1 + mg) / (1 - cm) : null;
  const commSqft = price !== null ? price * cm : null;
  const revenue = price !== null ? price * devS : null;
  const commission = revenue !== null ? revenue * cm : null;
  const profit  = revenue !== null ? revenue - commission - total : null;
  const unitPrice = (price !== null && avg > 0) ? price * avg : null;
  return { dg, ct, oh, fi, cm, mg, marginPct, hasMargin, soft, ohA, fiA, total, perSqft,
           marginSqft, price, commSqft, revenue, commission, profit, unitPrice,
           extra: (soft || 0) + (ohA || 0) + (fiA || 0) };
}

function renderAddons(p, a, avg) {
  set(p + '_softLbl', 'Design &amp; Contingency (' + pctLbl(a.dg + a.ct) + ' of const.)');
  set(p + '_ohLbl', 'Overhead (' + pctLbl(a.oh) + ')');
  set(p + '_finLbl', 'Finance Cost (' + pctLbl(a.fi) + ')');
  set(p + '_totalSoft', fmtN(a.soft));
  set(p + '_totalOH', fmtN(a.ohA));
  set(p + '_totalFin', fmtN(a.fiA));
  set(p + '_totalCost', fmtN(a.total));
  set(p + '_totalPerSqft', fmtN(a.perSqft));

  set(p + '_predictedPsf', fmtN(a.price));
  set(p + '_predictedPsfSub', a.price !== null
    ? 'BDT / sqft (cost + ' + pctLbl(a.mg) + ' margin' + (a.cm > 0 ? ', grossed up for ' + pctLbl(a.cm) + ' commission' : '') + ')'
    : 'BDT / sqft (enter a margin or commission)');
  set(p + '_unitPrice', fmtN(a.unitPrice));
  set(p + '_unitPriceSub', avg > 0 ? 'BDT (' + fmt(avg) + ' sqft × predicted price)' : 'BDT (enter units / floors for avg. unit size)');

  set(p + '_pCost', fmtN(a.perSqft));
  set(p + '_pMarginLbl', 'Margin (' + pctLbl(a.mg) + ' of cost)');
  set(p + '_pMargin', a.marginSqft !== null ? '+' + fmtN(a.marginSqft) : '—');
  set(p + '_pCommLbl', 'Sales Commission (' + pctLbl(a.cm) + ' of price)');
  set(p + '_pComm', a.commSqft !== null ? '+' + fmtN(a.commSqft) : '—');
  set(p + '_revenue', fmtN(a.revenue));
  set(p + '_profit', fmtN(a.profit));
}

// ===== CHITTAGONG · IMARAT NIRMAN BIDHIMALA 2008 (CDA) — Residential Apartment (A3) =====
const CTG_FT = 0.3048, CTG_SQFT_M2 = 10.7639, CTG_KATHA_M2 = 66.89;
const CTG_UB = [2,3,4,5,6,7,8,9,10,12,14,16,18,20,Infinity];
const CTG_LBL = ['≤ 2','2–3','3–4','4–5','5–6','6–7','7–8','8–9','9–10','10–12','12–14','14–16','16–18','18–20','> 20'];
// Table 3(a), building type A1–A4: [normal road width m, FAR, MGC %]
const CTG_ROWS = [
  [6,3.15,67.5],[6,3.35,65],[6,3.5,62.5],[6,3.5,62.5],[6,3.75,60],[6,3.75,60],[6,4.0,60],[6,4.0,60],[6,4.25,57.5],
  [9,4.5,57.5],[9,4.75,55],[9,5.0,52.5],[9,5.25,52.5],[9,5.25,50],[12,5.5,50]
];
const CTG_R18 = [18,6.0,50], CTG_R24 = [24,6.5,50];

function ctgRows() {
  const all = CTG_ROWS.map((r, j) => ({ road: r[0], far: r[1], mgc: r[2], idx: j, label: CTG_LBL[j] + ' katha' }));
  all.push({ road: 18, far: CTG_R18[1], mgc: CTG_R18[2], idx: 15, label: 'Any size, 18 m road' });
  all.push({ road: 24, far: CTG_R24[1], mgc: CTG_R24[2], idx: 16, label: 'Any size, 24 m road' });
  return all;
}
function ctgSizeIdx(k) { return CTG_UB.findIndex(u => k <= u + 1e-9); }

// Rule 51 + 54(7): lesser of plot-size FAR and road-width FAR; 51(11): +0.05 per extra 0.30 m of road, capped at the next step
function ctgResolve(katha, R) {
  const all = ctgRows(), i = ctgSizeIdx(katha), pr = all[i];
  const cands = []; let limited = false;
  if (pr.road <= R + 1e-9) cands.push(pr);
  else { limited = true; for (let j = 0; j < i; j++) if (all[j].road <= R + 1e-9) cands.push(all[j]); }
  if (R >= 18 - 1e-9) cands.push(all[15]);
  if (R >= 24 - 1e-9) cands.push(all[16]);
  let best = cands[0];
  cands.forEach(c => { if (c.far > best.far || (c.far === best.far && c.mgc > best.mgc)) best = c; });
  const roadLimited = limited && best.idx < 15;
  let bonus = 0;
  if (!roadLimited) {
    const steps = Math.floor((Math.min(R, 24) - best.road) / 0.3 + 1e-6);
    bonus = Math.max(0, steps) * 0.05;
    const next = all.slice(best.idx + 1).find(r => r.far > best.far);
    bonus = Math.min(bonus, next ? next.far - best.far : 0);
  }
  return { best, pr, roadLimited, bonus };
}

// Table 4 — cars per flat by gross flat area (m²)
function ctgCarsPerUnit(m2) { if (m2 > 200) return 1; if (m2 > 140) return 2/3; if (m2 > 90) return 1/2; if (m2 > 60) return 1/4; return 1/8; }

function ctgNotice(box, cls, text) { const d = document.createElement('div'); d.className = 'notice' + (cls ? ' ' + cls : ''); d.textContent = text; box.appendChild(d); }

function calcCtg() {
  document.getElementById('resultsContent').style.display = 'none';
  const _ds = getDevShare();
  set('devShareDisplay', _ds !== null ? (Math.round(_ds * 1000) / 10) + '%' : '—');

  const projName  = document.getElementById('projectName').value || 'Unnamed Project';
  const landKatha = parseFloat(document.getElementById('landArea').value) || 0;
  const roadFt    = parseFloat(document.getElementById('roadWidth').value) || 0;
  const unitsPerFloor  = parseFloat(document.getElementById('unitsPerFloor').value) || 0;
  const proposedFloors = parseFloat(document.getElementById('proposedFloors').value) || 0;
  const basements = parseInt(document.getElementById('basements').value) || 0;
  const w = roadFt * CTG_FT;

  const isJV = document.getElementById('projectType').value === 'jv';
  document.getElementById('ratioField').style.display = isJV ? 'flex' : 'none';
  document.getElementById('landPriceLabel').textContent = isJV ? 'Signing Money per Katha (BDT)' : 'Land Price per Katha (BDT)';

  const empty = document.getElementById('emptyState');
  const content = document.getElementById('ctgResults');
  const hero = document.getElementById('heroTag'); if (hero) hero.style.display = '';

  if (landKatha <= 0 || roadFt <= 0 || roadFt < ROAD_MIN_FT) {
    empty.style.display = 'block'; content.style.display = 'none'; showTail(false);
    setEmptyText(false, roadFt > 0 && roadFt < ROAD_MIN_FT && landKatha > 0 ? 'Minimum front road width is 20 ft.<br>Enter 20 ft or more, then tap Calculate.' : null);
    return;
  }

  const res = ctgResolve(landKatha, w);
  const baseFar = res.best.far, mgcPct = res.best.mgc, rBonus = res.bonus, ctrlLabel = res.best.label;
  const far = baseFar + rBonus;

  const landSqft = landKatha * 720;
  const mgcArea = landSqft * mgcPct / 100;
  const farArea = landSqft * far;
  const maxFloors = mgcArea > 0 ? Math.floor(farArea / mgcArea + 1e-9) : 0;
  const storeys = proposedFloors + 1;

  const saleableArea = farArea * 1.15;
  const bsmPlate = landSqft * Math.min(1, mgcPct / 100 + 0.5 * (1 - mgcPct / 100));
  const constructionArea = farArea + mgcArea + basements * bsmPlate + 0.10 * mgcArea;
  const unitConfig = getUnitConfig();
  const totalUnits = unitConfig.total;
  const avgUnitSize = totalUnits > 0 ? saleableArea / totalUnits : 0;
  const propArea = proposedFloors * mgcArea;
  const propFar = landSqft > 0 ? propArea / landSqft : 0;

  const carsReq = totalUnits > 0 ? Math.max(1, Math.ceil(totalUnits * ctgCarsPerUnit(avgUnitSize / CTG_SQFT_M2))) : null;
  const carsCap = Math.floor((mgcArea / CTG_SQFT_M2) / 25) + basements * Math.floor((bsmPlate / CTG_SQFT_M2) / 30);

  // --- Render FAR ---
  set('c_projName', projName);
  set('c_plotFar', fmtF(res.pr.far) + ' · ' + res.pr.mgc + '%');
  set('c_plotSub', CTG_LBL[ctgSizeIdx(landKatha)] + ' katha · needs ' + Math.round(res.pr.road / CTG_FT) + ' ft road');
  if (res.roadLimited) { set('c_roadCheck', 'Road-Limited'); set('c_roadSub', 'Stepped down to ' + ctrlLabel + ' row'); }
  else if (res.best.idx >= 15) { set('c_roadCheck', 'Wide Road'); set('c_roadSub', 'Using ' + ctrlLabel + ' row · Rule 51(14)'); }
  else { set('c_roadCheck', 'Meets'); set('c_roadSub', roadFt + ' ft vs ' + Math.round(res.pr.road / CTG_FT) + ' ft required'); }

  set('c_far', fmtF(far));
  set('c_baseK', 'Table FAR · ' + ctrlLabel);
  set('c_base', fmtF(baseFar));
  set('c_rb', '+' + fmtF(rBonus));
  set('c_inc', '+' + fmtF(rBonus));

  set('c_mgc', mgcPct.toFixed(1) + '%');
  set('c_mgcA', fmt(mgcArea));
  set('c_net', fmt(landSqft));
  set('c_netSub', 'sqft · ' + landKatha + ' katha');
  set('c_roadM', w.toFixed(2));
  set('c_roadMSub', 'metres · ' + roadFt + ' ft');

  set('c_park', carsReq !== null ? carsReq + ' / ' + carsCap : '—');
  set('c_units', totalUnits > 0 ? fmt(totalUnits) : '—');
  set('c_avg', avgUnitSize > 0 ? fmt(avgUnitSize) : '—');
  set('c_farA', fmt(farArea));
  set('c_farASub', 'sqft · ' + fmt(farArea / CTG_SQFT_M2) + ' m²');
  set('c_sale', fmt(saleableArea));
  set('c_saleSub', 'sqft');
  set('c_const', fmt(constructionArea));

  set('c_maxFloors', maxFloors);
  set('c_propFloors', proposedFloors > 0 ? proposedFloors : '—');
  set('c_propFar', proposedFloors > 0 ? fmtF(propFar) : '—');

  const flags = document.getElementById('c_flags'); flags.innerHTML = '';
  if (proposedFloors > 0 && propArea > farArea + 1)
    ctgNotice(flags, '', 'Proposal exceeds permitted FAR by ' + fmt(propArea - farArea) + ' sqft. Reduce to ' + maxFloors + ' floors.');
  if (carsReq !== null && carsReq > carsCap)
    ctgNotice(flags, '', 'Parking short: Table 4 needs ' + carsReq + ' cars; ground' + (basements ? ' and basements' : '') + ' fit about ' + carsCap + '.');
  if (Math.max(farArea, propArea) / CTG_SQFT_M2 > 7000)
    ctgNotice(flags, 'info', 'Over 7,000 m² of FAR area: CDA Special Project Permit needed before the building permit.');
  if (storeys >= 10) ctgNotice(flags, 'info', 'Ten storeys or more: multi-storied building rules and full fire provisions apply.');
  else if (storeys * 3.05 > 18) ctgNotice(flags, 'info', 'Height over 18 m: a lift is required (Rule 24).');

  // --- Cost (same method as Dhaka) ---
  const landPriceRaw = document.getElementById('landPrice').value;
  const hasLandPrice = landPriceRaw !== '' && !isNaN(parseFloat(landPriceRaw));
  const landPrice = hasLandPrice ? parseFloat(landPriceRaw) : 0;
  const constRate = parseFloat(document.getElementById('quality').value) || 0;
  const devShare = isJV ? getDevShare() : 1;
  const loShare = devShare !== null ? 1 - devShare : null;
  const devSaleable = devShare !== null ? saleableArea * devShare : null;
  const loSaleable = loShare !== null ? saleableArea * loShare : null;
  const landOrSigning = hasLandPrice ? landPrice * landKatha : null;
  const landPerSqft = (landOrSigning !== null && devSaleable > 0) ? landOrSigning / devSaleable : null;
  const constCost = constRate > 0 ? constructionArea * constRate : null;
  const constPerSqft = (constCost !== null && devSaleable > 0) ? constCost / devSaleable : null;
  const ad = computeAddons(landOrSigning, constCost, devSaleable, avgUnitSize);

  const landLabel = isJV ? 'Signing Money' : 'Land Cost';
  set('c_landCostLabel', landLabel);
  set('c_landPerSqftLabel', landLabel + ' / Saleable Area');
  set('c_totalLandLabel', landLabel);
  const perSqftSub = isJV ? 'BDT / sqft (developer share)' : 'BDT / sqft';
  set('c_landPerSqftSub', perSqftSub);
  set('c_constPerSqftSub', perSqftSub);
  set('c_devShareLabel', devShare !== null && isJV ? '(' + Math.round(devShare * 1000) / 10 + '%)' : '');
  set('c_loShareLabel', loShare !== null && isJV ? '(' + Math.round(loShare * 1000) / 10 + '%)' : '');
  set('c_devSaleable', fmtN(devSaleable));
  const us = unitSplitOutputs(totalUnits, isJV, devSaleable, loSaleable);
  renderUnitSplit('c', isJV, us);
  set('c_loSaleable', isJV ? fmtN(loSaleable) : 'N/A');
  set('c_landCost', fmtN(landOrSigning));
  set('c_landPerSqft', fmtN(landPerSqft));
  set('c_constCost', fmtN(constCost));
  set('c_constCostSub', constRate > 0 ? 'BDT (' + fmt(constructionArea) + ' sqft × ' + fmt(constRate) + ')' : 'BDT');
  set('c_constPerSqft', fmtN(constPerSqft));
  set('c_totalLand', fmtN(landOrSigning));
  set('c_totalConst', fmtN(constCost));
  renderAddons('c', ad, avgUnitSize);

  // --- Show / hide (results appear after Calculate) ---
  empty.style.display = revealed ? 'none' : 'block';
  content.style.display = revealed ? 'block' : 'none';
  showTail(revealed);
  if (!revealed) setEmptyText(true);

  const qSel = document.getElementById('quality');
  window.lastReport = {
    city: 'ctg', projName, blockName: 'Chittagong (CDA 2008)', landKatha, landSqft, roadLabel: roadFt + ' ft', roadM: w,
    isJV, basements, unitsPerFloor, proposedFloors,
    qualityName: qSel.value ? qSel.options[qSel.selectedIndex].text.split(' —')[0] : null,
    constRate, applicableFar: far, baseFar, rBonus, ctrlLabel, plotRowFar: res.pr.far, mgcPct, mgcArea,
    blockEligible: false, nbMinFloors: null, nbMaxFloors: maxFloors, maxFloors, propFar, maxUnits: null,
    totalUnits, avgUnitSize, carsReq, carsCap,
    totalFarArea: farArea, saleableArea, constructionArea, landLabel, landOrSigning, landPerSqft,
    constCost, constPerSqft, totalCost: ad.total, totalPerSqft: ad.perSqft,
    marginPct: ad.marginPct, predictedPsf: ad.price, unitPrice: ad.unitPrice,
    estRevenue: ad.revenue, estProfit: ad.profit, addons: ad,
    devShare, loShare, devSaleable, loSaleable,
    loUnits: us.loUnits, devUnits: us.devUnits, devAvgUnit: us.devAvg, loAvgUnit: us.loAvg, unitConfig
  };
}

// ===== A4 REPORT =====
// Fill in any missing contact details below; empty fields are skipped on the report.
const CONTACT = {
  name: 'SLATE',
  address: 'House: SW (I) 3/A, Road 2, Gulshan 1, Dhaka',
  phone: '+880 1749 390 284',
  email: 'info@slate-atelier.com',
  website: 'www.slate-atelier.com/FAR'
};

function esc(t) {
  return String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ===== LEAD CAPTURE (saves to save.php -> data/leads.csv) =====
const SAVE_URL = 'save.php';   // same folder as this page; change if you put save.php elsewhere

function leadStore(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }

let leadMode = 'report';   // 'report' = get the PDF (contact optional) | 'proposal' = ask SLATE for a design proposal (contact required)
const CONSENT_REPORT = 'Your project inputs are saved anonymously to help SLATE understand what developers are exploring. SLATE stores your contact details only if you share them here, and may then contact you about this project.';
const CONSENT_PROPOSAL = 'I agree that SLATE may store my contact details and these project inputs, and contact me with a design proposal for this project.';

function openLeadForm(mode) {
  leadMode = mode === 'proposal' ? 'proposal' : 'report';
  const isP = leadMode === 'proposal';
  document.getElementById('leadTitle').textContent = isP ? 'Request a design proposal' : 'Get your report';
  document.getElementById('leadSub').textContent = isP
    ? 'Share your details and SLATE will get back to you with a design proposal for this project.'
    : 'Contact details are optional. Leave them blank and you still get your report.';
  document.getElementById('leadConsentText').textContent = isP ? CONSENT_PROPOSAL : CONSENT_REPORT;
  document.getElementById('leadSubmit').textContent = isP ? 'Send request' : 'Get report';
  document.getElementById('leadSkip').style.display = isP ? 'none' : '';
  document.getElementById('leadMsgWrap').style.display = isP ? '' : 'none';
  document.getElementById('leadMsg').value = '';
  const tt = document.getElementById('slateToast'); if (tt) tt.remove();
  document.getElementById('leadName').value  = leadStore('slateLeadName')  || '';
  document.getElementById('leadPhone').value = leadStore('slateLeadPhone') || '';
  document.getElementById('leadEmail').value = leadStore('slateLeadEmail') || '';
  document.getElementById('leadConsent').checked = false;
  document.getElementById('leadErr').textContent = '';
  document.getElementById('leadOverlay').classList.add('open');
  setTimeout(() => { const n = document.getElementById('leadName'); if (n && !n.value) n.focus(); }, 50);
}
function closeLeadForm() { document.getElementById('leadOverlay').classList.remove('open'); }

function leadPayload(extra) {
  const d = window.lastReport || {};
  return Object.assign({
    projName: d.projName, blockName: d.blockName, landKatha: d.landKatha, roadLabel: d.roadLabel,
    floors: d.proposedFloors, unitsPerFloor: d.unitsPerFloor, basements: d.basements,
    projectType: d.isJV ? 'JV' : 'Outright',
    loSharePct: d.isJV && d.loShare !== null ? Math.round(d.loShare * 1000) / 10 : '',
    quality: d.qualityName || '',
    landPricePerKatha: d.landOrSigning !== null && d.landKatha > 0 ? d.landOrSigning / d.landKatha : '',
    marginPct: d.marginPct, applicableFar: d.applicableFar, saleableArea: d.saleableArea,
    constructionArea: d.constructionArea, totalCost: d.totalCost, costPerSqft: d.totalPerSqft,
    predictedPsf: d.predictedPsf, unitPrice: d.unitPrice, scenarios: scenarios.length, session: SESSION_ID,
    city: d.city === 'ctg' ? 'Chittagong' : 'Dhaka',
    designPct: d.addons ? d.addons.dg * 100 : '', contingencyPct: d.addons ? d.addons.ct * 100 : '',
    overheadPct: d.addons ? d.addons.oh * 100 : '', financePct: d.addons ? d.addons.fi * 100 : '',
    commissionPct: d.addons ? d.addons.cm * 100 : '',
    loUnits: d.isJV && d.loUnits !== null && d.loUnits !== undefined ? d.loUnits : '',
    devUnits: d.devUnits !== null && d.devUnits !== undefined ? d.devUnits : '',
    diffFloors: d.unitConfig && d.unitConfig.used ? d.unitConfig.dF : '',
    diffUnitsPerFloor: d.unitConfig && d.unitConfig.used ? d.unitConfig.dU : '',
    totalUnits: d.totalUnits > 0 ? d.totalUnits : ''
  }, extra);
}

function sendLead(payload) {
  // Fire-and-forget: a failed save never blocks the user's report. The reply carries this visit's user ID and project code.
  try {
    fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload), keepalive: true, credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null).then(j => { if (j && j.user_id) applyIds(j); }).catch(() => {});
  } catch (e) {}
}

// User ID: one per person (kept by save.php in a first-party cookie). Project code: one per plot per user.
window.slateIds = { user: '', project: '' };
function applyIds(j) {
  window.slateIds = { user: j.user_id || '', project: j.project_code || '' };
  const t = window.slateIds.project ? 'Project ' + window.slateIds.project + ' · User ' + window.slateIds.user : '';
  ['r_refCode', 'c_refCode'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = t; });
  if (window.lastReport) { window.lastReport.projectCode = window.slateIds.project; window.lastReport.userId = window.slateIds.user; }
}

function generateReport() {
  if (!window.lastReport) return;
  openLeadForm('report');
}

function requestProposal() {
  openLeadForm('proposal');
}

function showToast(msg) {
  const old = document.getElementById('slateToast'); if (old) old.remove();
  const t = document.createElement('div'); t.id = 'slateToast'; t.className = 'slate-toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => { if (t.parentNode) t.remove(); }, 5000);
}

document.getElementById('leadCancel').addEventListener('click', closeLeadForm);
document.getElementById('leadOverlay').addEventListener('click', e => { if (e.target.id === 'leadOverlay') closeLeadForm(); });

// Skip: nothing new is saved (the Calculate row already holds the project); the visitor still gets the report plus a best-wishes note
function finishWithoutSharing() {
  closeLeadForm();
  sendLead(leadPayload({ name: '', phone: '', email: '', consent: false, website: document.getElementById('leadWebsite').value }));
  window.reportBestWishes = true;
  buildAndPrintReport();
  showToast('Best wishes with your project — from all of us at SLATE.');
}
document.getElementById('leadSkip').addEventListener('click', finishWithoutSharing);

document.getElementById('leadForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('leadName').value.trim();
  const phone = document.getElementById('leadPhone').value.trim();
  const email = document.getElementById('leadEmail').value.trim();
  const consent = document.getElementById('leadConsent').checked;
  const err = document.getElementById('leadErr');
  err.textContent = '';

  const isProposal = leadMode === 'proposal';

  // Nothing entered = they chose not to share (report only; a proposal request needs contact details)
  if (!isProposal && !name && !phone && !email) { finishWithoutSharing(); return; }

  if (!name) { err.textContent = isProposal ? 'Please add your name so SLATE knows who to contact.' : 'Please add your name, or clear the other fields to continue without sharing.'; return; }
  if (!phone && !email) { err.textContent = isProposal ? 'Please add a phone number or email so SLATE can reach you.' : 'Please add a phone number or email so SLATE can reach you, or tap “Skip”.'; return; }
  if (phone && !/^[0-9+\-\s()]{6,20}$/.test(phone)) { err.textContent = 'Please enter a valid phone number.'; return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Please enter a valid email.'; return; }
  if (!consent) { err.textContent = isProposal ? 'Please tick the box so SLATE can store your details and contact you.' : 'Please tick the box to let SLATE store your details, or tap “Skip”.'; return; }

  leadStore('slateLeadName', name); leadStore('slateLeadPhone', phone); leadStore('slateLeadEmail', email);

  if (isProposal) {
    sendLead(leadPayload({ name, phone, email, consent: true, request: 'proposal', message: document.getElementById('leadMsg').value.trim(), website: document.getElementById('leadWebsite').value }));
    closeLeadForm();
    showToast('Thank you — SLATE will get back to you with a design proposal soon.');
    return;
  }

  sendLead(leadPayload({ name, phone, email, consent: true, website: document.getElementById('leadWebsite').value }));
  closeLeadForm();
  window.reportBestWishes = false;
  buildAndPrintReport();
  showToast('Thank you — SLATE will be in touch soon.');
});

function buildAndPrintReport() {
  const d = window.lastReport;
  if (!d) return;

  const dash = '—';
  const row = (k, v, b) => `<tr class="${b ? 'b' : ''}"><td>${k}</td><td>${v}</td></tr>`;
  const sec = (title, rows) => `<div class="rp-sec"><div class="rp-h">${title}</div><table>${rows.join('')}</table></div>`;
  const pct = v => v !== null && v !== undefined ? (v * 100).toFixed(1) + '%' : 'N/A';
  const num = v => fmtN(v);
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const farRows = [
    row('Area FAR (DAP)', fmtF(d.areaFar)),
    row('Plot FAR (Road)', fmtF(d.plotFar)),
    row('Non-Block FAR', fmtF(d.nonBlockFar), !d.blockEligible),
    row('Block FAR', d.blockEligible ? fmtF(d.blockFar) : 'N/A', d.blockEligible),
    row('Size / Land Bonus', '+' + fmtF(d.blockEligible ? d.landBonus : d.plotSizeBonus)),
    row('Road Bonus', '+' + fmtF(d.roadBonusDynamic))
  ];
  if (d.regionalBonus > 0) farRows.push(row('Regional Bonus', '+' + fmtF(d.regionalBonus)));

  const dUsed = !!(d.unitConfig && d.unitConfig.used);
  const diffRows = dUsed ? [
    row('Regular Floors', d.unitConfig.regular),
    row('Different Floors × Units', d.unitConfig.dF + ' × ' + d.unitConfig.dU)
  ] : [];
  const siteRows = [
    row('Land Area', d.landKatha + ' katha'),
    row('Land Area', fmt(d.landSqft) + ' sqft'),
    row('Front Road', esc(d.roadLabel)),
    row('Basements', d.basements),
    row(dUsed ? 'Units / Regular Floor' : 'Units / Floor', d.unitsPerFloor > 0 ? d.unitsPerFloor : dash),
    row('Proposed Floors', d.proposedFloors > 0 ? d.proposedFloors : dash),
    ...diffRows
  ];

  const mgcRows = [
    row('Min MGC', pct(d.mgcMinPct)),
    row('Max MGC', pct(d.mgcMaxPct)),
    row('Min / Max MGC Area', (d.mgcMinArea !== null ? fmt(d.mgcMinArea) : 'N/A') + ' / ' + fmt(d.mgcMaxArea) + ' sqft'),
    row('Non-Block Floors (min–max)', (d.nbMinFloors ?? dash) + ' – ' + (d.nbMaxFloors ?? 'N/A')),
    row('Block Floors (min–max)', d.blockEligible ? ((d.blockMinFloors ?? dash) + ' – ' + (d.blockMaxFloors ?? 'N/A')) : 'N/A')
  ];

  const areaRows = [
    row('Max Units', fmt(d.maxUnits)),
    row('Proposed Units', d.totalUnits > 0 ? fmt(d.totalUnits) : dash),
    row('Avg. Unit Size', d.avgUnitSize > 0 ? fmt(d.avgUnitSize) + ' sqft' : dash),
    row('Total FAR Area', fmt(d.totalFarArea) + ' sqft'),
    row('Saleable Area', fmt(d.saleableArea) + ' sqft'),
    row('Construction Area', fmt(d.constructionArea) + ' sqft')
  ];

  if (d.city === 'ctg') {
    farRows.splice(0, farRows.length,
      row('Plot-size FAR (Table 3a)', fmtF(d.plotRowFar)),
      row('Controlling Row', esc(d.ctrlLabel)),
      row('Table FAR', fmtF(d.baseFar)),
      row('Road Width Bonus · 51(11)', '+' + fmtF(d.rBonus)),
      row('Permitted FAR', fmtF(d.applicableFar), true));
    siteRows.splice(0, siteRows.length,
      row('Land Area', d.landKatha + ' katha'),
      row('Land Area', fmt(d.landSqft) + ' sqft'),
      row('Front Road', esc(d.roadLabel) + ' (' + d.roadM.toFixed(2) + ' m)'),
      row('Basements', d.basements),
      row(dUsed ? 'Units / Regular Floor' : 'Units / Floor', d.unitsPerFloor > 0 ? d.unitsPerFloor : dash),
      row('Proposed Floors', d.proposedFloors > 0 ? d.proposedFloors : dash),
      ...diffRows);
    mgcRows.splice(0, mgcRows.length,
      row('Max MGC', d.mgcPct.toFixed(1) + '%'),
      row('MGC Area', fmt(d.mgcArea) + ' sqft'),
      row('Max Floors (above parking)', d.maxFloors),
      row('FAR Used (Proposal)', d.proposedFloors > 0 ? fmtF(d.propFar) : dash),
      row('Parking Req. / Est. Capacity', d.carsReq !== null ? d.carsReq + ' / ' + d.carsCap : dash));
    areaRows.splice(0, areaRows.length,
      row('Proposed Units', d.totalUnits > 0 ? fmt(d.totalUnits) : dash),
      row('Avg. Unit Size', d.avgUnitSize > 0 ? fmt(d.avgUnitSize) + ' sqft' : dash),
      row('Total FAR Area', fmt(d.totalFarArea) + ' sqft'),
      row('Saleable Area', fmt(d.saleableArea) + ' sqft'),
      row('Construction Area', fmt(d.constructionArea) + ' sqft'));
  }
  const allIn = d.addons && d.addons.extra > 0;

  const sub = d.isJV ? ' / dev. sqft' : ' / sqft';
  const costRows = [
    row(d.landLabel, d.landOrSigning !== null ? fmt(d.landOrSigning) + ' BDT' : dash),
    row(d.landLabel + sub, d.landPerSqft !== null ? fmt(d.landPerSqft) + ' BDT' : dash),
    row('Construction Cost', d.constCost !== null ? fmt(d.constCost) + ' BDT' : dash),
    row('Construction Cost' + sub, d.constPerSqft !== null ? fmt(d.constPerSqft) + ' BDT' : dash),
    ...(allIn ? [row('Design, Contingency, Overhead &amp; Finance', fmt(d.addons.extra) + ' BDT')] : []),
    row('Margin on Total Cost', d.marginPct !== null ? d.marginPct + '%' : dash),
    ...(d.addons && d.addons.cm > 0 ? [row('Sales Commission', pctLbl(d.addons.cm) + ' of price')] : []),
    row('Predicted Price / sqft', d.predictedPsf !== null ? fmt(d.predictedPsf) + ' BDT' : dash, true),
    row('Tentative Unit Price' + (d.avgUnitSize > 0 ? ' (' + fmt(d.avgUnitSize) + ' sqft)' : ''), d.unitPrice !== null ? fmt(d.unitPrice) + ' BDT' : dash, true)
  ];
  const structRows = [
    row('Project Type', d.isJV ? 'Joint Venture' : 'Outright Purchase'),
    row('Construction Quality', d.qualityName ? d.qualityName + ' (' + fmt(d.constRate) + ' BDT/sqft)' : dash),
    row('Developer Saleable Area', d.devSaleable !== null ? fmt(d.devSaleable) + ' sqft' : dash),
    row('LO Saleable Area', d.isJV ? (d.loSaleable !== null ? fmt(d.loSaleable) + ' sqft' : dash) : 'N/A')
  ];
  if (d.isJV && d.devShare !== null) {
    structRows.splice(2, 0, row('LO : Developer', Math.round(d.loShare * 1000) / 10 + ' : ' + Math.round(d.devShare * 1000) / 10));
  }
  const nU = v => v !== null && v !== undefined ? fmt(v) : dash;
  if (d.isJV) structRows.push(row('Units (LO : Developer)', nU(d.loUnits) + ' : ' + nU(d.devUnits)));
  structRows.push(row('Developer Avg. Unit Size', d.devAvgUnit > 0 ? fmt(d.devAvgUnit) + ' sqft' : dash));
  if (d.isJV) structRows.push(row('LO Avg. Unit Size', d.loAvgUnit > 0 ? fmt(d.loAvgUnit) + ' sqft' : dash));

  const contactTop = [
    CONTACT.address,
    CONTACT.phone ? 'T: ' + CONTACT.phone : '',
    CONTACT.email ? 'E: ' + CONTACT.email : '',
    CONTACT.website ? 'W: ' + CONTACT.website : ''
  ].filter(Boolean).map(esc).join('<br>');

  const hasSc = scenarios.length > 0;
  const pageCount = hasSc ? 3 : 2;
  const crf = n => (n === null || n === undefined || !isFinite(n)) ? dash : (n / 1e7).toFixed(2) + ' Cr';

  // Same header and footer on every page
  const header = `
    <div class="rp-top">
      <div class="rp-logo"><img src="${LOGO_SRC}" alt="SLATE"></div>
      <div class="rp-contact-top">${contactTop}</div>
    </div>`;
  const runFoot = n => `
    <div class="rp-runfoot">
      <span><b>${esc(CONTACT.name)}</b> &nbsp;·&nbsp; FAR &amp; Feasibility Report &nbsp;·&nbsp; ${esc(d.projName)}${d.projectCode ? ' &nbsp;·&nbsp; ' + esc(d.projectCode) : ''}</span>
      <span>${dateStr} &nbsp;·&nbsp; Page ${n} of ${pageCount}</span>
    </div>`;
  const shell = (n, body) => `<div class="rp-page">${header}<div class="rp-body"><div class="rp-fit">${body}</div></div>${runFoot(n)}</div>`;
  const titleBlock = (eyebrow, sub) => `
    <div class="rp-title">
      <div class="rp-eyebrow"><span>${eyebrow}${d.projectCode ? ' &nbsp;·&nbsp; ' + esc(d.projectCode) : ''}</span><span>FAR &amp; Feasibility Report &nbsp;·&nbsp; ${dateStr}</span></div>
      <div class="rp-name">${esc(d.projName)}</div>
      <div class="rp-sub">${sub}</div>
    </div>`;
  const projSub = 'Residential Apartment (A3) &nbsp;·&nbsp; ' + esc(d.blockName) + ' &nbsp;·&nbsp; ' + d.landKatha + ' katha &nbsp;·&nbsp; ' + esc(d.roadLabel) + ' road';

  // Page 1: site, FAR, coverage, areas
  const page1 = titleBlock('Project Reference', projSub) + `
    <div class="rp-metrics">
      <div><small>Applicable FAR</small><strong>${fmtF(d.applicableFar)}</strong><em>${d.city === 'ctg' ? 'Bidhimala 2008' : (d.blockEligible ? 'Block' : 'Non-Block')}</em></div>
      <div><small>Total FAR Area</small><strong>${fmt(d.totalFarArea)}</strong><em>sqft</em></div>
      <div><small>Saleable Area</small><strong>${fmt(d.saleableArea)}</strong><em>sqft</em></div>
      <div><small>Construction Area</small><strong>${fmt(d.constructionArea)}</strong><em>sqft</em></div>
    </div>
    <div class="rp-cols">
      ${sec('FAR Analysis', farRows)}
      ${sec('Site &amp; Building Configuration', siteRows)}
      ${sec('Ground Coverage &amp; Floors', mgcRows)}
      ${sec('Areas &amp; Units', areaRows)}
    </div>`;

  // Page 2: cost and pricing (total cost bar starts here)
  const page2 = titleBlock('Cost &amp; Pricing', projSub) + `
    <div class="rp-metrics">
      <div><small>Total Cost</small><strong>${crf(d.totalCost)}</strong><em>${allIn ? 'all-in' : (d.isJV ? 'signing money + construction' : 'land + construction')}</em></div>
      <div><small>Cost / Saleable sqft</small><strong>${fmtN(d.totalPerSqft)}</strong><em>BDT${d.isJV ? ' (developer share)' : ''}</em></div>
      <div><small>Predicted Price / sqft</small><strong>${fmtN(d.predictedPsf)}</strong><em>BDT</em></div>
      <div><small>Tentative Unit Price</small><strong>${crf(d.unitPrice)}</strong><em>${d.avgUnitSize > 0 ? fmt(d.avgUnitSize) + ' sqft unit' : 'enter units / floors'}</em></div>
    </div>
    <div class="rp-cols">
      ${sec('Cost Analysis', costRows)}
      ${sec('Project Structure', structRows)}
    </div>
    <div class="rp-total">
      <div><small>Total Cost (${allIn ? 'All-in' : (d.isJV ? 'Signing Money + Construction' : 'Land + Construction')})</small><strong>${d.totalCost !== null ? fmt(d.totalCost) + ' BDT' : dash}</strong></div>
      <div class="r"><small>Per Saleable sqft${d.isJV ? ' (Developer)' : ''}</small><strong>${d.totalPerSqft !== null ? fmt(d.totalPerSqft) + ' BDT' : dash}</strong></div>
    </div>
    <div class="rp-note">Prepared by ${esc(CONTACT.name)}. ${d.city === 'ctg' ? 'This report is an indicative feasibility estimate for a residential apartment building (A3) under Imarat Nirman Bidhimala 2008 as applied by the Chattogram Development Authority. Figures are subject to verification with CDA and final design development.' : 'This report is an indicative feasibility estimate generated from DAP 2022–2035 and Imarot Nirman Bidhimala 2025 parameters. Floor counts are rounded up to the next whole floor. Figures are subject to verification with RAJUK and final design development.'}</div>${window.reportBestWishes ? '<div class="rp-wish">Best wishes with your project — from all of us at SLATE.</div>' : ''}<div class="rp-sign">Design with purpose</div>`;

  let pagesHtml = shell(1, page1) + shell(2, page2);
  if (hasSc) {
    const plotOf = x => x.blockName + '|' + x.landKatha + '|' + x.roadLabel;
    const samePlotR = scenarios.every(x => plotOf(x) === plotOf(scenarios[0]));
    const scSub = samePlotR
      ? esc(scenarios[0].blockName) + ' &nbsp;·&nbsp; ' + scenarios[0].landKatha + ' katha &nbsp;·&nbsp; ' + esc(scenarios[0].roadLabel) + ' road'
      : 'Scenarios on different plots';
    const page3 = titleBlock('Scenario Comparison', scSub) + buildScenarioTable(true) + `
    <div class="rp-note">★ best value on that row &nbsp;·&nbsp; shaded cells differ from S1 &nbsp;·&nbsp; Cr = crore (10,000,000 BDT) &nbsp;·&nbsp; Est. revenue = predicted price per sqft × developer saleable area &nbsp;·&nbsp; Est. profit = est. revenue − total cost.</div>`;
    pagesHtml += shell(3, page3);
  }
  document.getElementById('printReport').innerHTML = pagesHtml;

  // Every page gets the same fixed content height (safe for A4 and Letter, with or without browser margins);
  // content is scaled down only if it would not fit.
  const host = document.getElementById('printReport');
  host.style.cssText = 'display:block;position:absolute;left:-10000px;top:0;visibility:hidden;';
  const mmPx = 96 / 25.4;
  const PAGE_H = 258 * mmPx, PAD = (11 + 9) * mmPx, FOOT_GAP = 3 * mmPx;
  host.querySelectorAll('.rp-page').forEach(pg => {
    const body = pg.querySelector('.rp-body'), fit = pg.querySelector('.rp-fit');
    const hdrH = pg.querySelector('.rp-top').offsetHeight, ftrH = pg.querySelector('.rp-runfoot').offsetHeight + FOOT_GAP;
    const avail = Math.floor(PAGE_H - PAD - hdrH - ftrH);
    body.style.height = avail + 'px';
    fit.style.transform = ''; fit.style.width = '100%';
    const natural = fit.offsetHeight;
    if (natural > avail) {
      const k = avail / natural;
      fit.style.width = (100 / k) + '%';
      fit.style.transform = 'scale(' + k + ')';
    }
  });
  host.style.cssText = '';

  const prevTitle = document.title;
  document.title = 'SLATE FAR Report - ' + d.projName;
  // Phones lay the page out at screen width when printing; force an A4-wide layout so the report stays centred
  const vp = document.querySelector('meta[name="viewport"]');
  const prevVp = vp ? vp.getAttribute('content') : null;
  if (vp) vp.setAttribute('content', 'width=794, initial-scale=1');
  window.addEventListener('afterprint', () => {
    document.title = prevTitle;
    if (vp && prevVp !== null) vp.setAttribute('content', prevVp);
  }, { once: true });
  window.print();
}

document.getElementById('btnAddScenario').addEventListener('click', addScenario);
document.getElementById('btnClearScenarios').addEventListener('click', clearScenarios);
document.getElementById('scenarioTable').addEventListener('click', e => {
  const b = e.target.closest ? e.target.closest('.sc-x') : null;
  if (b) removeScenario(parseInt(b.getAttribute('data-i'), 10));
});

document.getElementById('btnCalculate').addEventListener('click', () => doCalculate());
['projectName','landArea','roadWidth','unitsPerFloor','proposedFloors','loShareInput','loUnitsInput','diffFloors','diffUnitsPerFloor','landPrice','pctDesign','pctCont','pctOverhead','pctFinance','pctComm','marginPct'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); doCalculate(); } });
});

window.addEventListener('resize', () => {
    if(document.getElementById('resultsContent').style.display === 'block') calc();
});
initCity();


// ===== INSTALL AS AN APP (PWA) =====
// manifest.json + sw.js make the calculator installable. Android/Chrome/Edge: one tap opens the browser's install prompt.
// iPhone/iPad (Safari has no prompt): the button shows the Share > Add to Home Screen steps. Hidden once installed.
(function () {
  const btn = document.getElementById('btnInstall');
  if (!btn) return;
  const ua = navigator.userAgent || '';
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|LinkedInApp|Messenger/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  let deferred = null;

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  if (standalone()) return;            // already running as the installed app
  btn.hidden = false;

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; btn.hidden = false; });
  window.addEventListener('appinstalled', () => { btn.hidden = true; deferred = null; try { showToast('SLATE FAR Calculator is on your home screen.'); } catch (e) {} });

  const share = '<svg class="ico" width="16" height="18" viewBox="0 0 16 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V2M4 5.5 8 1.5l4 4"/><path d="M5 8H2v10h12V8h-3"/></svg>';
  const dots = '<b>⋮</b>';
  function steps() {
    if (inApp) return { sub: 'This page is open inside another app. Open it in your phone\'s browser first.',
      list: ['Tap the <b>⋯</b> or <b>⋮</b> menu in this app', 'Choose <b>Open in browser</b> (Safari or Chrome)', 'Then tap <b>Install SLATE FAR Calculator</b> again'] };
    if (isIOS) return { sub: 'On iPhone and iPad, install from Safari in two taps.',
      list: ['Tap the <b>Share</b> button ' + share + ' in Safari\'s toolbar', 'Scroll and tap <b>Add to Home Screen</b>', 'Tap <b>Add</b>. The SLATE icon appears on your home screen'] };
    if (isAndroid) return { sub: 'Install from your browser menu.',
      list: ['Tap the menu ' + dots + ' at the top right of Chrome', 'Tap <b>Install app</b> or <b>Add to Home screen</b>', 'Tap <b>Install</b>'] };
    return { sub: 'Install from your browser.',
      list: ['Click the <b>install</b> icon at the right end of the address bar', 'Or open the browser menu and choose <b>Install SLATE FAR Calculator</b>', 'On a phone, open this page and use <b>Add to Home Screen</b>'] };
  }
  const overlay = document.getElementById('installOverlay');
  function openSteps() {
    const s = steps();
    document.getElementById('installSub').textContent = s.sub;
    document.getElementById('installSteps').innerHTML = s.list.map(t => '<li><span>' + t + '</span></li>').join('');
    overlay.classList.add('open');
  }
  document.getElementById('installClose').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });

  btn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      try { const r = await deferred.userChoice; if (r && r.outcome === 'accepted') btn.hidden = true; } catch (e) {}
      deferred = null;
      return;
    }
    openSteps();
  });
})();
