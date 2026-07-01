/**
 * ═══════════════════════════════════════════════════════════
 *  TUMBLEWEED MINE — SCRIPT.JS
 *  Gestion complète : caisse, stock, achats, ventes,
 *  commandes, dépenses, employés, historique, paramètres.
 *  Stockage : LocalStorage uniquement, aucun serveur requis.
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

// ──────────────────────────────────────────────────────────────
//  ÉTAT GLOBAL DE L'APPLICATION
// ──────────────────────────────────────────────────────────────
let db = {
  caisseDepart: 0,
  produits:    [],
  achats:      [],
  ventes:      [],
  commandes:   [],
  depenses:    [],
  employes:    [],
  historique:  [],
  clotures:    [],
  sheets: {
    apiKey:  'AIzaSyCj_olDrCLVzbmHmzPkp7OF7p2pGF3yfJA',
    sheetId: '1IlosqEk4VyXUuLQsjRvCEM9rY-71l6tehb4p4AmxdiU',
    lastSync: null,
    lignes:  [],  // { nom, date, produit, quantite, prixUnit, total, importee }
  },
};

let chartCaisse = null;
let chartAV     = null;

// ──────────────────────────────────────────────────────────────
//  PERSISTENCE — LocalStorage
// ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'tumbleweed_mine_v1';

function saveDB() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    showToast('Erreur lors de la sauvegarde', 'error');
  }
}

function loadDB() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      // Fusion avec les valeurs par défaut pour assurer la compatibilité
      db = Object.assign({ caisseDepart: 0, produits: [], achats: [], ventes: [],
                           commandes: [], depenses: [], employes: [], historique: [], clotures: [],
                           sheets: { apiKey: 'AIzaSyCj_olDrCLVzbmHmzPkp7OF7p2pGF3yfJA', sheetId: '1IlosqEk4VyXUuLQsjRvCEM9rY-71l6tehb4p4AmxdiU', lastSync: null, lignes: [] } }, parsed);
    } catch (e) {
      showToast('Données corrompues, réinitialisation', 'error');
    }
  }
}

// ──────────────────────────────────────────────────────────────
//  UTILITAIRES
// ──────────────────────────────────────────────────────────────

/** Génère un identifiant unique */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Formate un montant en dollars */
function fmt(n) {
  const v = parseFloat(n) || 0;
  return '$' + v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(',', '.');
}

/** Retourne la date du jour au format YYYY-MM-DD */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Retourne l'heure actuelle HH:MM */
function nowTime() {
  return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Formate une date YYYY-MM-DD en DD/MM/YYYY */
function fmtDate(d) {
  if (!d) return '—';
  const p = d.split('-');
  if (p.length !== 3) return d;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

/** Retourne les 7 derniers jours (YYYY-MM-DD) du plus ancien au plus récent */
function last7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Retourne le lundi de la semaine courante */
function startOfWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Retourne le premier jour du mois courant */
function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

/** Classe CSS pour un montant (positif = vert, négatif = rouge) */
function amountClass(n) {
  if (n > 0) return 'amount-positive';
  if (n < 0) return 'amount-negative';
  return 'amount-neutral';
}

/** Classe CSS d'un badge de statut commande */
function statusClass(s) {
  const map = {
    'En attente':             'status-attente',
    'En préparation':         'status-preparation',
    'Prête':                  'status-prete',
    'Livrée':                 'status-livree',
    'En attente de paiement': 'status-att-paiement',
    'Payée':                  'status-payee',
    'Annulée':                'status-annulee',
  };
  return map[s] || '';
}

/** Classe de couleur de ligne pour le tableau commandes */
function statusRowClass(s) {
  const map = {
    'En attente':             'orange',
    'En préparation':         'gold',
    'Prête':                  'green',
    'Livrée':                 'teal',
    'En attente de paiement': 'amber',
    'Payée':                  'paid',
    'Annulée':                'cancelled',
  };
  return map[s] || '';
}

/** Échappe le HTML pour éviter les injections */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────────────────
//  CAISSE — calculs
// ──────────────────────────────────────────────────────────────

/** Calcule la caisse actuelle = départ + somme des opérations historique */
function calcCaisse() {
  return db.historique.reduce((acc, op) => acc + (op.montant || 0), db.caisseDepart);
}

/** Calcule le bénéfice/perte pour une période donnée */
function calcPeriode(dateFrom, dateTo) {
  return db.historique
    .filter(op => op.date >= dateFrom && op.date <= dateTo)
    .reduce((acc, op) => acc + (op.montant || 0), 0);
}

// ──────────────────────────────────────────────────────────────
//  HISTORIQUE — ajouter une opération
// ──────────────────────────────────────────────────────────────

/**
 * Enregistre une opération dans l'historique et sauvegarde.
 * @param {string} type       - 'Achat', 'Vente', 'Dépense', 'Salaire', 'Dépôt', 'Retrait'
 * @param {number} montant    - Positif = entrée, Négatif = sortie
 * @param {string} commentaire
 * @param {string} [ref]      - Référence optionnelle (ex: id d'achat)
 */
function addHistorique(type, montant, commentaire, ref) {
  const op = {
    id: uid(),
    type,
    montant: parseFloat(montant),
    commentaire: commentaire || '',
    date: today(),
    heure: nowTime(),
    ref: ref || null,
  };
  db.historique.unshift(op);
  return op;
}

// ──────────────────────────────────────────────────────────────
//  NAVIGATION
// ──────────────────────────────────────────────────────────────

let currentSection = null;

function navigate(section) {
  // Ne rien faire si on clique sur la section déjà active (évite le flash)
  if (section === currentSection) return;
  currentSection = section;

  // Masquer toutes les sections
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  // Afficher la section cible
  const target = document.getElementById('section-' + section);
  if (target) target.classList.remove('hidden');

  // Mettre à jour le menu
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.section === section);
  });

  // Fermer le sidebar sur mobile
  document.getElementById('sidebar').classList.remove('open');

  // Rafraîchir la vue courante
  refreshSection(section);
}

function refreshSection(section) {
  switch (section) {
    case 'dashboard':   renderDashboard(); break;
    case 'stock':       renderStock(); break;
    case 'achats':      renderAchats(); break;
    case 'ventes':      renderVentes(); break;
    case 'commandes':   renderCommandes(); break;
    case 'depenses':    renderDepenses(); break;
    case 'employes':    renderEmployes(); break;
    case 'historique':  renderHistorique(); break;
    case 'parametres':  renderParametres(); break;
  }
}

// ──────────────────────────────────────────────────────────────
//  DASHBOARD
// ──────────────────────────────────────────────────────────────

function renderDashboard() {
  const caisse = calcCaisse();

  // Caisse actuelle
  const el = document.getElementById('cash-amount');
  el.textContent = fmt(caisse);
  el.style.color = caisse >= 0 ? 'var(--gold)' : 'var(--red-bright)';

  // Stats semaine en cours
  const weekStart = startOfWeek();
  const todayStr  = today();

  // Uniquement les opérations non encore clôturées
  const opsWeek = db.historique.filter(op => op.date >= weekStart && op.date <= todayStr && !op.cloture);
  const entrees  = opsWeek.filter(op => op.montant > 0).reduce((s, op) => s + op.montant, 0);
  const sorties  = opsWeek.filter(op => op.montant < 0).reduce((s, op) => s + op.montant, 0);
  const benefice = entrees + sorties;

  document.getElementById('stat-entrees').textContent = '+' + fmt(entrees);
  document.getElementById('stat-sorties').textContent = fmt(sorties);

  const benEl = document.getElementById('stat-benefice');
  benEl.textContent = (benefice >= 0 ? '+' : '') + fmt(benefice);
  benEl.className = 'week-stat-value ' + (benefice > 0 ? 'text-green' : benefice < 0 ? 'text-red' : '');

  // Label de la semaine (lundi → dimanche)
  const lundi = new Date(weekStart);
  const dimanche = new Date(lundi);
  dimanche.setDate(lundi.getDate() + 6);
  const fmtD = d => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  document.getElementById('week-label').textContent = `${fmtD(lundi)} – ${fmtD(dimanche)}`;

  // Badge sidebar commandes urgentes
  const urgentCount = db.commandes.filter(c => ['En attente', 'En préparation'].includes(c.statut)).length;
  const badge = document.getElementById('badge-commandes');
  badge.textContent = urgentCount;
  badge.classList.toggle('visible', urgentCount > 0);

  // Clôtures passées
  renderClotures();

  // Dernières opérations — uniquement celles après la dernière clôture
  const tbody = document.getElementById('dash-history-body');
  const recent = db.historique.filter(op => !op.cloture).slice(0, 8);
  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Aucune opération depuis la dernière clôture</td></tr>';
  } else {
    tbody.innerHTML = recent.map(op => `
      <tr>
        <td>${fmtDate(op.date)}</td>
        <td>${esc(op.heure)}</td>
        <td><span class="type-pill type-${op.type.toLowerCase().replace(/ /g,'')}">${esc(op.type)}</span></td>
        <td class="${amountClass(op.montant)}">${op.montant > 0 ? '+' : ''}${fmt(op.montant)}</td>
        <td class="text-muted">${esc(op.commentaire) || '—'}</td>
      </tr>`).join('');
  }

  renderCharts();
}

// setStatValue remplacé par renderDashboard inline


// ──────────────────────────────────────────────────────────────
//  CLÔTURE HEBDOMADAIRE
// ──────────────────────────────────────────────────────────────

function renderClotures() {
  const tbody = document.getElementById('clotures-body');
  if (!tbody) return;
  if (!db.clotures || db.clotures.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Aucune clôture enregistrée</td></tr>';
    return;
  }
  tbody.innerHTML = [...db.clotures].reverse().map(c => `
    <tr>
      <td class="text-muted" style="font-size:12px">${esc(c.semaine)}</td>
      <td>${fmt(c.caisseDeb)}</td>
      <td class="text-green">+${fmt(c.entrees)}</td>
      <td class="text-red">${fmt(c.sorties)}</td>
      <td class="${c.benefice >= 0 ? 'text-green' : 'text-red'} " style="font-weight:600">${c.benefice >= 0 ? '+' : ''}${fmt(c.benefice)}</td>
      <td class="text-gold">${fmt(c.caisseFin)}</td>
      <td><button class="btn-icon danger" onclick="deleteCloture('${c.id}')" title="Supprimer">✕</button></td>
    </tr>`).join('');
}

function deleteCloture(id) {
  confirmAction('Supprimer cette clôture ?', 'La clôture sera retirée de l\'historique. Les données ne sont pas affectées.', () => {
    db.clotures = db.clotures.filter(c => c.id !== id);
    saveDB();
    renderClotures();
    showToast('Clôture supprimée', 'info');
  });
}

function openCloture() {
  const weekStart = startOfWeek();
  const todayStr  = today();
  const opsWeek   = db.historique.filter(op => op.date >= weekStart && op.date <= todayStr && !op.cloture);
  const entrees   = opsWeek.filter(op => op.montant > 0).reduce((s, op) => s + op.montant, 0);
  const sorties   = opsWeek.filter(op => op.montant < 0).reduce((s, op) => s + op.montant, 0);
  const benefice  = entrees + sorties;
  const caisseFin = calcCaisse();

  // Caisse de début = caisse actuelle - entrées de la semaine + sorties de la semaine
  const caisseDeb = caisseFin - benefice;

  const lundi = new Date(weekStart);
  const dimanche = new Date(lundi);
  dimanche.setDate(lundi.getDate() + 6);
  const fmtD = d => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const labelSemaine = `${fmtD(lundi)} → ${fmtD(dimanche)}`;

  // Stocker pour saveCloture
  window._clotureData = { semaine: labelSemaine, caisseDeb, entrees, sorties, benefice, caisseFin };

  document.getElementById('cloture-body').innerHTML = `
    <div class="cloture-recap">
      <div class="cloture-ligne">
        <span>Période</span>
        <strong>${esc(labelSemaine)}</strong>
      </div>
      <div class="cloture-ligne">
        <span>Caisse en début de semaine</span>
        <strong>${fmt(caisseDeb)}</strong>
      </div>
      <div class="cloture-sep"></div>
      <div class="cloture-ligne">
        <span>Total entrées</span>
        <strong class="text-green">+${fmt(entrees)}</strong>
      </div>
      <div class="cloture-ligne">
        <span>Total sorties</span>
        <strong class="text-red">${fmt(sorties)}</strong>
      </div>
      <div class="cloture-sep"></div>
      <div class="cloture-ligne big">
        <span>Bénéfice net</span>
        <strong class="${benefice >= 0 ? 'text-green' : 'text-red'}">${benefice >= 0 ? '+' : ''}${fmt(benefice)}</strong>
      </div>
      <div class="cloture-ligne big">
        <span>Caisse en fin de semaine</span>
        <strong class="text-gold">${fmt(caisseFin)}</strong>
      </div>
    </div>`;

  openModal('modal-cloture');
}

function saveCloture() {
  if (!window._clotureData) return;
  const c = { id: uid(), date: today(), ...window._clotureData };
  if (!db.clotures) db.clotures = [];
  db.clotures.push(c);

  // Marquer toutes les opérations comme clôturées (stats + dernières opérations)
  const weekStart = startOfWeek();
  const todayStr  = today();
  db.historique.forEach(op => {
    if (op.date >= weekStart && op.date <= todayStr) {
      op.cloture = c.id;
    }
  });

  // Stocker la date de dernière clôture pour masquer les anciennes opérations du dashboard
  db.derniereCloture = todayStr;

  saveDB();
  closeAllModals();
  renderDashboard();
  showToast('Semaine clôturée — tout remis à zéro', 'success');
  window._clotureData = null;
}

// ──────────────────────────────────────────────────────────────
//  GRAPHIQUES (Chart.js)
// ──────────────────────────────────────────────────────────────

function renderCharts() {
  const days = last7Days();
  const labels = days.map(d => { const p = d.split('-'); return `${p[2]}/${p[1]}`; });

  // Données caisse cumulée par jour (reconstruction)
  const caisseParJour = [];
  let running = db.caisseDepart;
  for (const day of days) {
    const dayOps = db.historique.filter(op => op.date === day);
    running += dayOps.reduce((s, op) => s + op.montant, 0);
    caisseParJour.push(parseFloat(running.toFixed(2)));
  }

  // Achats vs Ventes par jour
  const achatsParJour = days.map(d =>
    Math.abs(db.historique.filter(op => op.type === 'Achat' && op.date === d).reduce((s, op) => s + op.montant, 0))
  );
  const ventesParJour = days.map(d =>
    db.historique.filter(op => op.type === 'Vente' && op.date === d).reduce((s, op) => s + op.montant, 0)
  );

  const chartDefaults = {
    responsive: false,
    animation: false,
    plugins: { legend: { labels: { color: '#8a7d6b', font: { family: 'Inter', size: 11 } } } },
    scales: {
      x: { ticks: { color: '#8a7d6b', font: { size: 10 } }, grid: { color: 'rgba(46,40,32,0.5)' } },
      y: { ticks: { color: '#8a7d6b', font: { size: 10 } }, grid: { color: 'rgba(46,40,32,0.5)' } },
    },
  };

  // ── Graphique caisse : mise à jour sans destroy pour éviter le flash ──
  if (chartCaisse) {
    chartCaisse.data.labels = labels;
    chartCaisse.data.datasets[0].data = caisseParJour;
    chartCaisse.update('none');
  } else {
    const ctxC = document.getElementById('chart-caisse').getContext('2d');
    chartCaisse = new Chart(ctxC, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Caisse ($)',
          data: caisseParJour,
          borderColor: '#c9a84c',
          backgroundColor: 'rgba(201,168,76,0.08)',
          borderWidth: 2,
          tension: 0.3,
          fill: true,
          pointBackgroundColor: '#c9a84c',
          pointRadius: 4,
        }],
      },
      options: chartDefaults,
    });
  }

  // ── Graphique achats vs ventes : même logique ──
  if (chartAV) {
    chartAV.data.labels = labels;
    chartAV.data.datasets[0].data = achatsParJour;
    chartAV.data.datasets[1].data = ventesParJour;
    chartAV.update('none');
  } else {
    const ctxAV = document.getElementById('chart-av').getContext('2d');
    chartAV = new Chart(ctxAV, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Achats ($)', data: achatsParJour, backgroundColor: 'rgba(139,58,26,0.6)', borderColor: '#8b3a1a', borderWidth: 1 },
          { label: 'Ventes ($)', data: ventesParJour, backgroundColor: 'rgba(74,124,89,0.5)',  borderColor: '#4a7c59',  borderWidth: 1 },
        ],
      },
      options: chartDefaults,
    });
  }
}

// ──────────────────────────────────────────────────────────────
//  STOCK
// ──────────────────────────────────────────────────────────────

function renderStock() {
  updateCatSuggestions();
  const search = (document.getElementById('stock-search').value || '').toLowerCase();
  const cat    = document.getElementById('stock-cat-filter').value;

  // Mettre à jour le filtre catégories
  const cats = [...new Set(db.produits.map(p => p.categorie).filter(Boolean))].sort();
  const catFilter = document.getElementById('stock-cat-filter');
  const currentCat = catFilter.value;
  catFilter.innerHTML = '<option value="">Toutes les catégories</option>' +
    cats.map(c => `<option value="${esc(c)}" ${c === currentCat ? 'selected' : ''}>${esc(c)}</option>`).join('');

  const produits = db.produits.filter(p => {
    const matchSearch = !search || p.nom.toLowerCase().includes(search) || (p.categorie || '').toLowerCase().includes(search);
    const matchCat    = !cat || p.categorie === cat;
    return matchSearch && matchCat;
  });

  const tbody = document.getElementById('stock-body');
  if (produits.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Aucun produit trouvé</td></tr>';
    return;
  }

  tbody.innerHTML = produits.map(p => {
    const valeur = (p.qte || 0) * (p.prixAchat || 0);
    const qteClass = p.qte <= 0 ? 'text-red' : p.qte < 5 ? 'text-gold' : '';
    return `<tr>
      <td><strong>${esc(p.nom)}</strong></td>
      <td class="text-muted">${esc(p.categorie) || '—'}</td>
      <td class="${qteClass}">${p.qte ?? 0}</td>
      <td class="text-muted">${esc(p.unite) || '—'}</td>
      <td>${fmt(p.prixAchat)}</td>
      <td class="text-gold">${fmt(p.prixVente)}</td>
      <td class="text-muted">${fmt(valeur)}</td>
      <td>
        <button class="btn-icon" onclick="editProduit('${p.id}')" title="Modifier">✎</button>
        <button class="btn-icon danger" onclick="deleteProduit('${p.id}')" title="Supprimer">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function filterStock() { renderStock(); }

function updateCatSuggestions() {
  const cats = [...new Set(db.produits.map(p => p.categorie).filter(Boolean))];
  const lists = document.querySelectorAll('#cat-suggestions');
  lists.forEach(dl => {
    dl.innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  });
}

function openModal(id) {
  document.getElementById('modal-overlay').classList.add('active');
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}

function closeAllModals() {
  document.getElementById('modal-overlay').classList.remove('active');
  document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
}

// Nouveau produit
function openNewProduitModal() {
  document.getElementById('modal-produit-title').textContent = 'Nouveau produit';
  document.getElementById('produit-id').value       = '';
  document.getElementById('produit-nom').value      = '';
  document.getElementById('produit-categorie').value = '';
  document.getElementById('produit-qte').value      = '0';
  document.getElementById('produit-unite').value    = '';
  document.getElementById('produit-prix-achat').value = '';
  document.getElementById('produit-prix-vente').value  = '';
  openModal('modal-produit');
}

// Édition produit
function editProduit(id) {
  const p = db.produits.find(x => x.id === id);
  if (!p) return;
  document.getElementById('modal-produit-title').textContent = 'Modifier le produit';
  document.getElementById('produit-id').value          = p.id;
  document.getElementById('produit-nom').value         = p.nom;
  document.getElementById('produit-categorie').value   = p.categorie || '';
  document.getElementById('produit-qte').value         = p.qte ?? 0;
  document.getElementById('produit-unite').value       = p.unite || '';
  document.getElementById('produit-prix-achat').value  = p.prixAchat || '';
  document.getElementById('produit-prix-vente').value  = p.prixVente || '';
  openModal('modal-produit');
}

function saveProduit() {
  const nom = document.getElementById('produit-nom').value.trim();
  if (!nom) return showToast('Le nom du produit est requis', 'error');

  const id = document.getElementById('produit-id').value;
  const data = {
    nom,
    categorie:  document.getElementById('produit-categorie').value.trim(),
    qte:        parseFloat(document.getElementById('produit-qte').value) || 0,
    unite:      document.getElementById('produit-unite').value.trim(),
    prixAchat:  parseFloat(document.getElementById('produit-prix-achat').value) || 0,
    prixVente:  parseFloat(document.getElementById('produit-prix-vente').value) || 0,
  };

  if (id) {
    const idx = db.produits.findIndex(p => p.id === id);
    if (idx !== -1) db.produits[idx] = { ...db.produits[idx], ...data };
    showToast('Produit mis à jour', 'success');
  } else {
    db.produits.push({ id: uid(), ...data });
    showToast('Produit ajouté au stock', 'success');
  }

  saveDB();
  closeAllModals();
  renderStock();
}

function deleteProduit(id) {
  const p = db.produits.find(x => x.id === id);
  if (!p) return;
  confirmAction(
    'Supprimer le produit ?',
    `Voulez-vous supprimer "${p.nom}" ? Cette action est irréversible.`,
    () => {
      db.produits = db.produits.filter(x => x.id !== id);
      saveDB();
      renderStock();
      showToast('Produit supprimé', 'info');
    }
  );
}

// ──────────────────────────────────────────────────────────────
//  ACHATS
// ──────────────────────────────────────────────────────────────

function renderAchats() {
  const tbody = document.getElementById('achats-body');
  if (db.achats.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Aucun achat enregistré</td></tr>';
    return;
  }
  tbody.innerHTML = [...db.achats].reverse().map(a => `
    <tr>
      <td>${fmtDate(a.date)}</td>
      <td><strong>${esc(a.nomProduit)}</strong></td>
      <td>${a.qte} ${esc(a.unite || '')}</td>
      <td class="amount-negative">${fmt(a.total)}</td>
      <td class="text-muted">${esc(a.commentaire) || '—'}</td>
      <td>
        <button class="btn-icon danger" onclick="deleteAchat('${a.id}')" title="Supprimer">✕</button>
      </td>
    </tr>`).join('');
}

function onAchatProduitChange() {
  const val = document.getElementById('achat-produit').value;
  document.getElementById('achat-new-produit-fields').classList.toggle('hidden', val !== '__new__');
}

function populateAchatSelect() {
  const sel = document.getElementById('achat-produit');
  sel.innerHTML = '<option value="">-- Sélectionner un produit --</option>' +
    '<option value="__new__">+ Créer un nouveau produit</option>' +
    db.produits.map(p => `<option value="${p.id}">${esc(p.nom)} (${p.qte} ${esc(p.unite || '')})</option>`).join('');
  document.getElementById('achat-new-produit-fields').classList.add('hidden');
}

function openAchatModal() {
  populateAchatSelect();
  document.getElementById('achat-id').value     = '';
  document.getElementById('achat-qte').value    = '';
  document.getElementById('achat-total').value  = '';
  document.getElementById('achat-commentaire').value = '';
  document.getElementById('achat-new-nom').value = '';
  document.getElementById('achat-new-cat').value = '';
  document.getElementById('achat-new-unite').value = '';
  document.getElementById('achat-new-prix-vente').value = '';
  openModal('modal-achat');
}

function saveAchat() {
  const produitSel = document.getElementById('achat-produit').value;
  const qte        = parseFloat(document.getElementById('achat-qte').value);
  const total      = parseFloat(document.getElementById('achat-total').value);
  const commentaire = document.getElementById('achat-commentaire').value.trim();

  if (!produitSel) return showToast('Sélectionnez un produit', 'error');
  if (!qte || qte <= 0) return showToast('Quantité invalide', 'error');
  if (isNaN(total) || total < 0) return showToast('Prix total invalide', 'error');

  let produit;

  if (produitSel === '__new__') {
    // Créer un nouveau produit
    const nom = document.getElementById('achat-new-nom').value.trim();
    if (!nom) return showToast('Le nom du nouveau produit est requis', 'error');
    const prixVente = parseFloat(document.getElementById('achat-new-prix-vente').value) || 0;
    const prixAchat = qte > 0 ? total / qte : 0;
    produit = {
      id:        uid(),
      nom,
      categorie: document.getElementById('achat-new-cat').value.trim(),
      qte:       qte,
      unite:     document.getElementById('achat-new-unite').value.trim(),
      prixAchat: parseFloat(prixAchat.toFixed(2)),
      prixVente,
    };
    db.produits.push(produit);
  } else {
    produit = db.produits.find(p => p.id === produitSel);
    if (!produit) return showToast('Produit introuvable', 'error');
    // Mise à jour du prix d'achat moyen pondéré
    const totalQte = produit.qte + qte;
    const prixMoyen = totalQte > 0 ? ((produit.prixAchat * produit.qte) + total) / totalQte : 0;
    produit.qte += qte;
    produit.prixAchat = parseFloat(prixMoyen.toFixed(2));
  }

  // Enregistrement de l'achat
  const achat = {
    id:          uid(),
    produitId:   produit.id,
    nomProduit:  produit.nom,
    unite:       produit.unite,
    qte,
    total,
    commentaire,
    date:        today(),
    heure:       nowTime(),
  };
  db.achats.push(achat);

  // Impact caisse (sortie d'argent)
  addHistorique('Achat', -total, `Achat : ${produit.nom} x${qte} — ${commentaire}`, achat.id);

  saveDB();
  closeAllModals();
  renderAchats();
  showToast(`Achat enregistré — ${fmt(total)} débité de la caisse`, 'success');
}

function deleteAchat(id) {
  confirmAction('Supprimer cet achat ?', 'Cette opération sera retirée de l\'historique. La caisse sera recalculée.', () => {
    const achat = db.achats.find(a => a.id === id);
    if (!achat) return;
    // Retirer l'opération d'historique liée
    db.historique = db.historique.filter(op => op.ref !== id);
    // Remettre le stock
    const produit = db.produits.find(p => p.id === achat.produitId);
    if (produit) produit.qte -= achat.qte;
    db.achats = db.achats.filter(a => a.id !== id);
    saveDB();
    renderAchats();
    showToast('Achat supprimé', 'info');
  });
}

// ──────────────────────────────────────────────────────────────
//  VENTES
// ──────────────────────────────────────────────────────────────

function renderVentes() {
  const tbody = document.getElementById('ventes-body');
  if (db.ventes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Aucune vente enregistrée</td></tr>';
    return;
  }
  tbody.innerHTML = [...db.ventes].reverse().map(v => `
    <tr>
      <td>${fmtDate(v.date)}</td>
      <td><strong>${esc(v.nomProduit)}</strong></td>
      <td>${v.qte}</td>
      <td>${fmt(v.prixUnit)}</td>
      <td class="amount-positive">${fmt(v.total)}</td>
      <td class="text-muted">${esc(v.commentaire) || '—'}</td>
      <td>
        <button class="btn-icon danger" onclick="deleteVente('${v.id}')" title="Supprimer">✕</button>
      </td>
    </tr>`).join('');
}

function populateVenteSelect() {
  const sel = document.getElementById('vente-produit');
  sel.innerHTML = '<option value="">-- Sélectionner un produit --</option>' +
    db.produits.filter(p => p.qte > 0).map(p =>
      `<option value="${p.id}">${esc(p.nom)} (Stock : ${p.qte} ${esc(p.unite || '')})</option>`
    ).join('');
  document.getElementById('vente-stock-info').textContent = '';
  document.getElementById('vente-prix-unit').value = '';
  document.getElementById('vente-qte').value = '';
  document.getElementById('vente-total-display').textContent = 'Total : $0.00';
}

function openVenteModal() {
  populateVenteSelect();
  document.getElementById('vente-id').value = '';
  document.getElementById('vente-commentaire').value = '';
  openModal('modal-vente');
}

function onVenteProduitChange() {
  const produitId = document.getElementById('vente-produit').value;
  const produit   = db.produits.find(p => p.id === produitId);
  const infoEl    = document.getElementById('vente-stock-info');
  if (produit) {
    document.getElementById('vente-prix-unit').value = produit.prixVente || '';
    infoEl.textContent = `Stock disponible : ${produit.qte} ${produit.unite || ''}`;
    calcVenteTotal();
  } else {
    infoEl.textContent = '';
    document.getElementById('vente-prix-unit').value = '';
  }
}

function calcVenteTotal() {
  const qte  = parseFloat(document.getElementById('vente-qte').value) || 0;
  const prix = parseFloat(document.getElementById('vente-prix-unit').value) || 0;
  document.getElementById('vente-total-display').textContent = `Total : ${fmt(qte * prix)}`;
}

function saveVente() {
  const produitId   = document.getElementById('vente-produit').value;
  const qte         = parseFloat(document.getElementById('vente-qte').value);
  const prixUnit    = parseFloat(document.getElementById('vente-prix-unit').value);
  const commentaire = document.getElementById('vente-commentaire').value.trim();

  if (!produitId) return showToast('Sélectionnez un produit', 'error');
  if (!qte || qte <= 0) return showToast('Quantité invalide', 'error');
  if (isNaN(prixUnit) || prixUnit < 0) return showToast('Prix unitaire invalide', 'error');

  const produit = db.produits.find(p => p.id === produitId);
  if (!produit) return showToast('Produit introuvable', 'error');
  if (produit.qte < qte) return showToast(`Stock insuffisant (disponible : ${produit.qte} ${produit.unite || ''})`, 'error');

  const total = parseFloat((qte * prixUnit).toFixed(2));

  // Décrémenter le stock
  produit.qte -= qte;

  // Enregistrement de la vente
  const vente = {
    id: uid(),
    produitId:   produit.id,
    nomProduit:  produit.nom,
    qte,
    prixUnit,
    total,
    commentaire,
    date:  today(),
    heure: nowTime(),
  };
  db.ventes.push(vente);

  // Impact caisse (entrée d'argent)
  addHistorique('Vente', total, `Vente : ${produit.nom} x${qte} — ${commentaire}`, vente.id);

  saveDB();
  closeAllModals();
  renderVentes();
  showToast(`Vente enregistrée — ${fmt(total)} ajouté à la caisse`, 'success');
}

function deleteVente(id) {
  confirmAction('Supprimer cette vente ?', 'La caisse sera recalculée et le stock restauré.', () => {
    const vente = db.ventes.find(v => v.id === id);
    if (!vente) return;
    // Restaurer le stock
    const produit = db.produits.find(p => p.id === vente.produitId);
    if (produit) produit.qte += vente.qte;
    // Retirer l'historique
    db.historique = db.historique.filter(op => op.ref !== id);
    db.ventes = db.ventes.filter(v => v.id !== id);
    saveDB();
    renderVentes();
    showToast('Vente supprimée', 'info');
  });
}

// ──────────────────────────────────────────────────────────────
//  COMMANDES
// ──────────────────────────────────────────────────────────────

let commandeNextNum = 1;

function getNextNumCommande() {
  if (db.commandes.length === 0) return 1;
  return Math.max(...db.commandes.map(c => c.numero || 0)) + 1;
}

function renderCommandes() {
  // Mettre à jour le filtre clients
  const clients = [...new Set(db.commandes.map(c => c.client).filter(Boolean))].sort();
  const clientFilter = document.getElementById('cmd-client-filter');
  const currentClient = clientFilter.value;
  clientFilter.innerHTML = '<option value="">Tous les clients</option>' +
    clients.map(c => `<option value="${esc(c)}" ${c === currentClient ? 'selected' : ''}>${esc(c)}</option>`).join('');

  filterCommandes();
}

function filterCommandes() {
  const search  = (document.getElementById('cmd-search').value || '').toLowerCase();
  const client  = document.getElementById('cmd-client-filter').value;
  const statut  = document.getElementById('cmd-status-filter').value;

  const commandes = db.commandes.filter(c => {
    const matchSearch = !search || c.client.toLowerCase().includes(search) || String(c.numero).includes(search);
    const matchClient = !client || c.client === client;
    const matchStatut = !statut || c.statut === statut;
    return matchSearch && matchClient && matchStatut;
  }).sort((a, b) => b.numero - a.numero);

  const tbody = document.getElementById('commandes-body');
  if (commandes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Aucune commande trouvée</td></tr>';
    return;
  }

  tbody.innerHTML = commandes.map(c => `
    <tr class="cmd-row-${statusRowClass(c.statut)}">
      <td class="text-muted">#${c.numero}</td>
      <td><strong>${esc(c.client)}</strong></td>
      <td>${fmtDate(c.date)}</td>
      <td class="text-gold">${fmt(c.total)}</td>
      <td>
        <span class="status-badge ${statusClass(c.statut)}">${esc(c.statut)}</span>
      </td>
      <td>
        <select class="statut-select ${statusClass(c.statut)}"
          onchange="changeStatutCommande('${c.id}', this.value)">
          ${['En attente','En préparation','Prête','Livrée','En attente de paiement','Payée','Annulée']
            .map(s => `<option value="${s}" ${c.statut === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td>
        <button class="btn-icon" onclick="voirCommande('${c.id}')" title="Voir">◉</button>
        <button class="btn-icon" onclick="editCommande('${c.id}')" title="Modifier">✎</button>
        ${c.statut === 'Annulée' ? `<button class="btn-icon danger" onclick="deleteCommande('${c.id}')" title="Supprimer">✕</button>` : ''}
      </td>
    </tr>`).join('');
}

function addLigneCommande(produitId, qte, prixUnit) {
  const container = document.getElementById('commande-lignes');
  const ligneId   = uid();
  const div = document.createElement('div');
  div.className = 'commande-ligne';
  div.dataset.ligneId = ligneId;

  const options = db.produits.map(p =>
    `<option value="${p.id}" data-prix="${p.prixVente}" ${p.id === produitId ? 'selected' : ''}>${esc(p.nom)}</option>`
  ).join('');

  div.innerHTML = `
    <div>
      <div class="form-label" style="margin-top:0">Produit</div>
      <select class="input-field ligne-produit" onchange="updateLigne('${ligneId}')">
        <option value="">-- Produit --</option>
        ${options}
      </select>
    </div>
    <div>
      <div class="form-label" style="margin-top:0">Quantité</div>
      <input type="number" class="input-field ligne-qte" value="${qte || ''}" min="0.01" step="0.01" oninput="updateLigne('${ligneId}')" />
    </div>
    <div>
      <div class="form-label" style="margin-top:0">Prix unit.</div>
      <input type="number" class="input-field ligne-prix" value="${prixUnit || ''}" min="0" step="0.01" oninput="updateLigne('${ligneId}')" />
    </div>
    <div>
      <div class="form-label" style="margin-top:0">Sous-total</div>
      <div class="ligne-total">$0.00</div>
      <button class="btn-icon danger" onclick="this.closest('.commande-ligne').remove();calcTotalCommande()" title="Retirer">✕</button>
    </div>`;

  container.appendChild(div);
  if (produitId) updateLigne(ligneId);
}

function updateLigne(ligneId) {
  const div    = document.querySelector(`.commande-ligne[data-ligne-id="${ligneId}"]`);
  if (!div) return;
  const selProd = div.querySelector('.ligne-produit');
  const qteIn   = div.querySelector('.ligne-qte');
  const prixIn  = div.querySelector('.ligne-prix');
  const totalEl = div.querySelector('.ligne-total');

  // Auto-remplir le prix si changement de produit
  if (selProd && prixIn) {
    const opt = selProd.selectedOptions[0];
    if (opt && opt.dataset.prix && !prixIn.dataset.manual) {
      prixIn.value = opt.dataset.prix;
    }
  }
  prixIn.addEventListener('input', () => { prixIn.dataset.manual = '1'; });

  const qte  = parseFloat(qteIn.value) || 0;
  const prix = parseFloat(prixIn.value) || 0;
  totalEl.textContent = fmt(qte * prix);
  calcTotalCommande();
}

function calcTotalCommande() {
  let total = 0;
  document.querySelectorAll('.commande-ligne').forEach(div => {
    const qte  = parseFloat(div.querySelector('.ligne-qte')?.value) || 0;
    const prix = parseFloat(div.querySelector('.ligne-prix')?.value) || 0;
    total += qte * prix;
  });
  document.getElementById('commande-total-display').textContent = `Total : ${fmt(total)}`;
  return total;
}

function getLignesCommande() {
  const lignes = [];
  document.querySelectorAll('.commande-ligne').forEach(div => {
    const produitId = div.querySelector('.ligne-produit')?.value;
    const qte       = parseFloat(div.querySelector('.ligne-qte')?.value) || 0;
    const prixUnit  = parseFloat(div.querySelector('.ligne-prix')?.value) || 0;
    if (produitId && qte > 0) {
      const produit = db.produits.find(p => p.id === produitId);
      lignes.push({
        produitId,
        nomProduit: produit ? produit.nom : '?',
        unite:      produit ? produit.unite : '',
        qte,
        prixUnit,
        total: parseFloat((qte * prixUnit).toFixed(2)),
      });
    }
  });
  return lignes;
}

function openCommandeModal() {
  document.getElementById('commande-id').value            = '';
  document.getElementById('commande-client').value        = '';
  document.getElementById('commande-date').value          = today();
  document.getElementById('commande-commentaire').value   = '';
  document.getElementById('commande-statut').value        = 'En attente';
  document.getElementById('commande-lignes').innerHTML    = '';
  document.getElementById('commande-total-display').textContent = 'Total : $0.00';
  document.getElementById('modal-commande-title').textContent   = 'Nouvelle commande';
  addLigneCommande();
  openModal('modal-commande');
}

function editCommande(id) {
  const c = db.commandes.find(x => x.id === id);
  if (!c) return;
  document.getElementById('commande-id').value          = c.id;
  document.getElementById('commande-client').value      = c.client;
  document.getElementById('commande-date').value        = c.date;
  document.getElementById('commande-commentaire').value = c.commentaire || '';
  document.getElementById('commande-statut').value      = c.statut;
  document.getElementById('commande-lignes').innerHTML  = '';
  document.getElementById('modal-commande-title').textContent = `Modifier commande #${c.numero}`;
  c.lignes.forEach(l => addLigneCommande(l.produitId, l.qte, l.prixUnit));
  calcTotalCommande();
  openModal('modal-commande');
}

function saveCommande() {
  const client    = document.getElementById('commande-client').value.trim();
  const date      = document.getElementById('commande-date').value;
  const commentaire = document.getElementById('commande-commentaire').value.trim();
  const statut    = document.getElementById('commande-statut').value;
  const lignes    = getLignesCommande();
  const id        = document.getElementById('commande-id').value;

  if (!client) return showToast('Le nom du client est requis', 'error');
  if (lignes.length === 0) return showToast('Ajoutez au moins un produit', 'error');

  const total = parseFloat(lignes.reduce((s, l) => s + l.total, 0).toFixed(2));

  const estDejaPayee = id && db.commandes.find(c => c.id === id)?.statut === 'Payée';

  if (id) {
    const idx = db.commandes.findIndex(c => c.id === id);
    if (idx === -1) return;
    const ancien = db.commandes[idx];
    db.commandes[idx] = { ...ancien, client, date, commentaire, statut, lignes, total };

    // Si le statut passe à "Payée" et ne l'était pas encore
    if (statut === 'Payée' && !estDejaPayee) {
      paiementCommande(db.commandes[idx]);
    }
    showToast('Commande mise à jour', 'success');
  } else {
    const numero = getNextNumCommande();
    const cmd = { id: uid(), numero, client, date, commentaire, statut, lignes, total, payeeLe: null };
    db.commandes.push(cmd);
    if (statut === 'Payée') paiementCommande(cmd);
    showToast(`Commande #${numero} créée`, 'success');
  }

  saveDB();
  closeAllModals();
  renderCommandes();
}

function changeStatutCommande(id, newStatut) {
  const c = db.commandes.find(x => x.id === id);
  if (!c) return;
  const ancienStatut = c.statut;
  c.statut = newStatut;

  // Déclencher le paiement si on passe à "Payée"
  if (newStatut === 'Payée' && ancienStatut !== 'Payée') {
    paiementCommande(c);
    showToast(`Commande #${c.numero} payée — ${fmt(c.total)} encaissé`, 'success');
  }

  saveDB();
  renderCommandes();
  // Rafraîchir le dashboard si visible
  if (!document.getElementById('section-dashboard').classList.contains('hidden')) renderDashboard();
}

/** Encaissement d'une commande : caisse + stock + historique */
function paiementCommande(cmd) {
  cmd.payeeLe = today();

  // Retirer les produits du stock
  cmd.lignes.forEach(l => {
    const produit = db.produits.find(p => p.id === l.produitId);
    if (produit) {
      produit.qte = Math.max(0, produit.qte - l.qte);
    }
  });

  // Créer une vente dans l'historique
  addHistorique(
    'Vente',
    cmd.total,
    `Commande #${cmd.numero} — ${cmd.client}`,
    cmd.id
  );
}

function voirCommande(id) {
  const c = db.commandes.find(x => x.id === id);
  if (!c) return;
  document.getElementById('voir-commande-title').textContent = `Commande #${c.numero} — ${c.client}`;

  const lignesHtml = c.lignes.map(l => `
    <tr>
      <td>${esc(l.nomProduit)}</td>
      <td>${l.qte} ${esc(l.unite || '')}</td>
      <td>${fmt(l.prixUnit)}</td>
      <td class="text-gold">${fmt(l.total)}</td>
    </tr>`).join('');

  document.getElementById('voir-commande-body').innerHTML = `
    <div class="voir-detail-block">
      <table>
        <tr><td>Client</td><td><strong>${esc(c.client)}</strong></td></tr>
        <tr><td>Date</td><td>${fmtDate(c.date)}</td></tr>
        <tr><td>Statut</td><td><span class="status-badge ${statusClass(c.statut)}">${esc(c.statut)}</span></td></tr>
        ${c.commentaire ? `<tr><td>Commentaire</td><td>${esc(c.commentaire)}</td></tr>` : ''}
        ${c.payeeLe ? `<tr><td>Payée le</td><td>${fmtDate(c.payeeLe)}</td></tr>` : ''}
      </table>
    </div>
    <div class="table-card" style="margin-bottom:0">
      <table class="data-table">
        <thead><tr><th>Produit</th><th>Quantité</th><th>Prix unit.</th><th>Sous-total</th></tr></thead>
        <tbody>${lignesHtml}</tbody>
      </table>
    </div>
    <div class="total-display" style="margin-top:12px">Total : ${fmt(c.total)}</div>`;

  openModal('modal-voir-commande');
}

function deleteCommande(id) {
  const c = db.commandes.find(x => x.id === id);
  if (!c || c.statut !== 'Annulée') return showToast('Seules les commandes annulées peuvent être supprimées', 'error');
  confirmAction('Supprimer la commande ?', `Supprimer définitivement la commande #${c.numero} de ${c.client} ?`, () => {
    db.commandes = db.commandes.filter(x => x.id !== id);
    saveDB();
    renderCommandes();
    showToast('Commande supprimée', 'info');
  });
}

// ──────────────────────────────────────────────────────────────
//  DÉPENSES
// ──────────────────────────────────────────────────────────────

function renderDepenses() {
  const tbody = document.getElementById('depenses-body');
  if (db.depenses.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Aucune dépense enregistrée</td></tr>';
    return;
  }
  tbody.innerHTML = [...db.depenses].reverse().map(d => `
    <tr>
      <td>${fmtDate(d.date)}</td>
      <td><span class="text-muted">${esc(d.categorie)}</span></td>
      <td class="amount-negative">${fmt(d.montant)}</td>
      <td class="text-muted">${esc(d.commentaire) || '—'}</td>
      <td>
        <button class="btn-icon" onclick="editDepense('${d.id}')" title="Modifier">✎</button>
        <button class="btn-icon danger" onclick="deleteDepense('${d.id}')" title="Supprimer">✕</button>
      </td>
    </tr>`).join('');
}

function openDepenseModal() {
  document.getElementById('depense-id').value = '';
  document.getElementById('depense-montant').value = '';
  document.getElementById('depense-commentaire').value = '';
  document.getElementById('modal-depense-title').textContent = 'Nouvelle dépense';
  openModal('modal-depense');
}

function editDepense(id) {
  const d = db.depenses.find(x => x.id === id);
  if (!d) return;
  document.getElementById('depense-id').value         = d.id;
  document.getElementById('depense-categorie').value  = d.categorie;
  document.getElementById('depense-montant').value    = d.montant;
  document.getElementById('depense-commentaire').value = d.commentaire || '';
  document.getElementById('modal-depense-title').textContent = 'Modifier la dépense';
  openModal('modal-depense');
}

function saveDepense() {
  const categorie   = document.getElementById('depense-categorie').value;
  const montant     = parseFloat(document.getElementById('depense-montant').value);
  const commentaire = document.getElementById('depense-commentaire').value.trim();
  const id          = document.getElementById('depense-id').value;

  if (!montant || montant <= 0) return showToast('Montant invalide', 'error');

  if (id) {
    const idx = db.depenses.findIndex(d => d.id === id);
    const ancienMontant = db.depenses[idx].montant;
    db.depenses[idx] = { ...db.depenses[idx], categorie, montant, commentaire };
    // Mettre à jour l'opération d'historique
    const histOp = db.historique.find(op => op.ref === id);
    if (histOp) {
      histOp.montant = -montant;
      histOp.commentaire = `${categorie} — ${commentaire}`;
    }
    showToast('Dépense mise à jour', 'success');
  } else {
    const dep = { id: uid(), categorie, montant, commentaire, date: today(), heure: nowTime() };
    db.depenses.push(dep);
    addHistorique('Dépense', -montant, `${categorie} — ${commentaire}`, dep.id);
    showToast(`Dépense enregistrée — ${fmt(montant)} débité`, 'success');
  }

  saveDB();
  closeAllModals();
  renderDepenses();
}

function deleteDepense(id) {
  confirmAction('Supprimer cette dépense ?', 'La caisse sera recalculée.', () => {
    db.historique = db.historique.filter(op => op.ref !== id);
    db.depenses   = db.depenses.filter(d => d.id !== id);
    saveDB();
    renderDepenses();
    showToast('Dépense supprimée', 'info');
  });
}


// ══════════════════════════════════════════════════════════════
//  GOOGLE SHEETS — SYNCHRONISATION
// ══════════════════════════════════════════════════════════════

/**
 * Lit TOUTES les feuilles du Google Sheet automatiquement.
 * Chaque feuille = 1 employé (nom de la feuille = prénom de l'employé)
 * Colonnes : A=Date, B=Produit, C=Quantité, D=Prix unitaire
 */
async function syncGoogleSheets() {
  const btn = document.getElementById('btn-sync-sheets');
  if (btn) { btn.textContent = '⟳ Synchronisation...'; btn.disabled = true; }

  try {
    const { apiKey, sheetId } = db.sheets;

    // 1. Récupérer la liste de toutes les feuilles
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey}&fields=sheets.properties.title`;
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) throw new Error(`Erreur API (méta) : ${metaRes.status}`);
    const metaData = await metaRes.json();
    const feuilles = (metaData.sheets || []).map(s => s.properties.title);

    if (feuilles.length === 0) throw new Error('Aucune feuille trouvée');

    let nouvelles = 0;
    let ignorees  = 0;

    // 2. Lire chaque feuille (= chaque employé)
    for (const nomEmploye of feuilles) {
      const range   = encodeURIComponent(`${nomEmploye}!A2:D1000`);
      const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;
      const dataRes = await fetch(dataUrl);
      if (!dataRes.ok) continue;
      const data = await dataRes.json();
      const rows = data.values || [];

      rows.forEach(row => {
        const date     = parseSheetDate(row[0] || '');
        const produit  = (row[1] || '').trim();
        const quantite = parseFloat(row[2]) || 0;
        const prixUnit = parseFloat(row[3]) || 0;

        if (!date || !produit || quantite <= 0) return;

        // Clé unique pour éviter les doublons
        const cle = `${nomEmploye}|${date}|${produit}|${quantite}`;
        if (db.sheets.lignes.some(l => l.cle === cle)) { ignorees++; return; }

        const total = parseFloat((quantite * prixUnit).toFixed(2));

        // Enregistrer la ligne
        db.sheets.lignes.push({
          id: uid(), cle,
          nom: nomEmploye, date, produit, quantite, prixUnit, total,
          importeeLe: today(), payee: false
        });

        // Mettre à jour le stock
        let p = db.produits.find(x => x.nom.toLowerCase() === produit.toLowerCase());
        if (!p) {
          p = { id: uid(), nom: produit, categorie: 'Production', qte: 0, unite: 'unités', prixAchat: prixUnit, prixVente: prixUnit };
          db.produits.push(p);
        }
        p.qte += quantite;

        // Créer l'employé automatiquement s'il n'existe pas encore
        if (!db.employes.find(e => e.nom.toLowerCase() === nomEmploye.toLowerCase())) {
          db.employes.push({ id: uid(), nom: nomEmploye, metier: 'Mineur', salaire: 0, dernierPaiement: null });
        }

        nouvelles++;
      });
    }

    db.sheets.lastSync = new Date().toISOString();
    saveDB();
    renderEmployes();
    renderStock();

    showToast(`Sync terminée — ${feuilles.length} feuille(s), ${nouvelles} nouvelles lignes, ${ignorees} déjà importées`, 'success');

  } catch (err) {
    console.error(err);
    showToast('Erreur : ' + err.message, 'error');
  } finally {
    if (btn) { btn.textContent = '⟳ Synchroniser Google Sheets'; btn.disabled = false; }
  }
}

/** Convertit JJ/MM/AAAA ou AAAA-MM-JJ en AAAA-MM-JJ */
function parseSheetDate(str) {
  if (!str) return '';
  str = str.trim();
  // Format JJ/MM/AAAA
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
  // Format AAAA-MM-JJ déjà bon
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  return '';
}

// ──────────────────────────────────────────────────────────────
//  EMPLOYÉS
// ──────────────────────────────────────────────────────────────

function renderEmployes() {
  // Bouton sync + dernière sync
  const lastSync = db.sheets.lastSync
    ? 'Dernière sync : ' + new Date(db.sheets.lastSync).toLocaleString('fr-FR')
    : 'Jamais synchronisé';
  const syncBar = document.getElementById('sheets-sync-bar');
  if (syncBar) {
    syncBar.innerHTML = `
      <div class="sheets-sync-info">
        <span class="text-muted" style="font-size:12px">⟳ Google Sheets — ${lastSync}</span>
        <button class="btn btn-gold btn-sm" id="btn-sync-sheets" onclick="syncGoogleSheets()">⟳ Synchroniser</button>
      </div>
      ${db.sheets.lignes.length > 0 ? renderSheetLignes() : ''}
    `;
  }

  const tbody = document.getElementById('employes-body');
  if (db.employes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Aucun employé enregistré</td></tr>';
    return;
  }
  tbody.innerHTML = db.employes.map(e => {
    // Calculer ce qu'on doit à cet employé depuis les lignes Sheets non payées
    const lignesNonPayees = db.sheets.lignes.filter(l =>
      l.nom.toLowerCase() === e.nom.toLowerCase() && !l.payee
    );
    const totalDu = lignesNonPayees.reduce((s, l) => s + l.total, 0);

    return `<tr>
      <td><strong>${esc(e.nom)}</strong></td>
      <td class="text-muted">${esc(e.metier) || '—'}</td>
      <td class="text-gold">${fmt(e.salaire)}</td>
      <td class="${totalDu > 0 ? 'text-red' : 'text-muted'}" style="font-weight:${totalDu > 0 ? '600' : '400'}">
        ${totalDu > 0 ? fmt(totalDu) : '—'}
      </td>
      <td class="text-muted">${e.dernierPaiement ? fmtDate(e.dernierPaiement) : 'Jamais'}</td>
      <td>
        <button class="btn btn-rust btn-sm" onclick="openPayerEmploye('${e.id}')">Payer</button>
        <button class="btn-icon" onclick="editEmploye('${e.id}')" title="Modifier">✎</button>
        <button class="btn-icon danger" onclick="deleteEmploye('${e.id}')" title="Supprimer">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function renderSheetLignes() {
  // Grouper les lignes par employé
  const byEmployee = {};
  db.sheets.lignes.forEach(l => {
    if (!byEmployee[l.nom]) byEmployee[l.nom] = [];
    byEmployee[l.nom].push(l);
  });

  const rows = db.sheets.lignes
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20)
    .map(l => `
      <tr class="${l.payee ? 'opacity-50' : ''}">
        <td><strong>${esc(l.nom)}</strong></td>
        <td class="text-muted">${fmtDate(l.date)}</td>
        <td>${esc(l.produit)}</td>
        <td>${l.quantite}</td>
        <td>${fmt(l.prixUnit)}</td>
        <td class="${l.payee ? 'text-muted' : 'text-gold'}">${fmt(l.total)}</td>
        <td>${l.payee ? '<span class="text-green">✓ Payé</span>' : `<button class="btn-icon" onclick="marquerLignePayee('${l.id}')" title="Marquer payé">✓</button>`}</td>
      </tr>`).join('');

  return `
    <div class="table-card" style="margin-top:16px">
      <div class="table-card-header">
        <h3>Productions importées depuis Google Sheets</h3>
        <span class="text-muted" style="font-size:12px">${db.sheets.lignes.length} lignes au total</span>
      </div>
      <table class="data-table">
        <thead><tr><th>Employé</th><th>Date</th><th>Produit</th><th>Qté</th><th>Prix/unité</th><th>Total dû</th><th>Statut</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function marquerLignePayee(id) {
  const ligne = db.sheets.lignes.find(l => l.id === id);
  if (!ligne) return;
  ligne.payee = true;
  saveDB();
  renderEmployes();
  showToast('Ligne marquée comme payée', 'success');
}

function openEmployeModal() {
  document.getElementById('employe-id').value = '';
  document.getElementById('employe-nom').value = '';
  document.getElementById('employe-metier').value = '';
  document.getElementById('employe-salaire').value = '';
  document.getElementById('modal-employe-title').textContent = 'Nouvel employé';
  openModal('modal-employe');
}

function editEmploye(id) {
  const e = db.employes.find(x => x.id === id);
  if (!e) return;
  document.getElementById('employe-id').value     = e.id;
  document.getElementById('employe-nom').value    = e.nom;
  document.getElementById('employe-metier').value = e.metier || '';
  document.getElementById('employe-salaire').value = e.salaire || '';
  document.getElementById('modal-employe-title').textContent = 'Modifier l\'employé';
  openModal('modal-employe');
}

function saveEmploye() {
  const nom    = document.getElementById('employe-nom').value.trim();
  const metier = document.getElementById('employe-metier').value.trim();
  const salaire = parseFloat(document.getElementById('employe-salaire').value) || 0;
  const id     = document.getElementById('employe-id').value;

  if (!nom) return showToast('Le nom est requis', 'error');

  if (id) {
    const idx = db.employes.findIndex(e => e.id === id);
    db.employes[idx] = { ...db.employes[idx], nom, metier, salaire };
    showToast('Employé mis à jour', 'success');
  } else {
    db.employes.push({ id: uid(), nom, metier, salaire, dernierPaiement: null });
    showToast('Employé ajouté', 'success');
  }

  saveDB();
  closeAllModals();
  renderEmployes();
}

function deleteEmploye(id) {
  const e = db.employes.find(x => x.id === id);
  if (!e) return;
  confirmAction('Supprimer cet employé ?', `Supprimer "${e.nom}" de la liste des employés ?`, () => {
    db.employes = db.employes.filter(x => x.id !== id);
    saveDB();
    renderEmployes();
    showToast('Employé supprimé', 'info');
  });
}

function openPayerEmploye(id) {
  const e = db.employes.find(x => x.id === id);
  if (!e) return;
  document.getElementById('payer-employe-id').value  = e.id;
  document.getElementById('payer-montant').value     = e.salaire || '';
  document.getElementById('payer-commentaire').value = '';
  document.getElementById('modal-payer-title').textContent = `Payer ${e.nom}`;
  openModal('modal-payer-employe');
}

function savePaiementEmploye() {
  const id         = document.getElementById('payer-employe-id').value;
  const montant    = parseFloat(document.getElementById('payer-montant').value);
  const commentaire = document.getElementById('payer-commentaire').value.trim();

  if (!montant || montant <= 0) return showToast('Montant invalide', 'error');

  const e = db.employes.find(x => x.id === id);
  if (!e) return;

  e.dernierPaiement = today();
  addHistorique('Salaire', -montant, `Salaire ${e.nom} — ${commentaire || e.metier || ''}`, id);

  saveDB();
  closeAllModals();
  renderEmployes();
  showToast(`${e.nom} payé — ${fmt(montant)} débité de la caisse`, 'success');
}

// ──────────────────────────────────────────────────────────────
//  HISTORIQUE
// ──────────────────────────────────────────────────────────────

function renderHistorique() {
  filterHistorique();
}

function filterHistorique() {
  const search   = (document.getElementById('hist-search').value || '').toLowerCase();
  const type     = document.getElementById('hist-type-filter').value;
  const dateFrom = document.getElementById('hist-date-from').value;
  const dateTo   = document.getElementById('hist-date-to').value;

  const ops = db.historique.filter(op => {
    const matchSearch = !search ||
      op.type.toLowerCase().includes(search) ||
      (op.commentaire || '').toLowerCase().includes(search);
    const matchType   = !type || op.type === type;
    const matchFrom   = !dateFrom || op.date >= dateFrom;
    const matchTo     = !dateTo || op.date <= dateTo;
    return matchSearch && matchType && matchFrom && matchTo;
  });

  const tbody = document.getElementById('historique-body');
  if (ops.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Aucune opération trouvée</td></tr>';
    return;
  }

  tbody.innerHTML = ops.map(op => `
    <tr>
      <td>${fmtDate(op.date)}</td>
      <td class="text-muted">${esc(op.heure)}</td>
      <td><span class="text-muted">${esc(op.type)}</span></td>
      <td class="${amountClass(op.montant)}">${op.montant > 0 ? '+' : ''}${fmt(op.montant)}</td>
      <td class="text-muted">${esc(op.commentaire) || '—'}</td>
      <td>
        <button class="btn-icon" onclick="editHistorique('${op.id}')" title="Modifier">✎</button>
        <button class="btn-icon danger" onclick="deleteHistorique('${op.id}')" title="Supprimer">✕</button>
      </td>
    </tr>`).join('');
}

function editHistorique(id) {
  const op = db.historique.find(x => x.id === id);
  if (!op) return;
  document.getElementById('edit-hist-id').value          = op.id;
  document.getElementById('edit-hist-commentaire').value = op.commentaire || '';
  openModal('modal-edit-historique');
}

function saveEditHistorique() {
  const id          = document.getElementById('edit-hist-id').value;
  const commentaire = document.getElementById('edit-hist-commentaire').value.trim();
  const op          = db.historique.find(x => x.id === id);
  if (!op) return;
  op.commentaire = commentaire;
  saveDB();
  closeAllModals();
  renderHistorique();
  showToast('Opération modifiée', 'success');
}

function deleteHistorique(id) {
  confirmAction(
    'Supprimer cette opération ?',
    'La caisse sera recalculée. Le stock ne sera pas restauré.',
    () => {
      db.historique = db.historique.filter(x => x.id !== id);
      saveDB();
      renderHistorique();
      showToast('Opération supprimée', 'info');
    }
  );
}

// ──────────────────────────────────────────────────────────────
//  DÉPÔT / RETRAIT MANUEL
// ──────────────────────────────────────────────────────────────

function saveDepot() {
  const montant     = parseFloat(document.getElementById('depot-montant').value);
  const commentaire = document.getElementById('depot-commentaire').value.trim();
  if (!montant || montant <= 0) return showToast('Montant invalide', 'error');
  addHistorique('Dépôt', montant, commentaire || 'Dépôt manuel');
  saveDB();
  closeAllModals();
  if (currentSection === 'dashboard') renderDashboard();
  showToast(`${fmt(montant)} déposé dans la caisse`, 'success');
  document.getElementById('depot-montant').value = '';
  document.getElementById('depot-commentaire').value = '';
}

function saveRetrait() {
  const montant     = parseFloat(document.getElementById('retrait-montant').value);
  const commentaire = document.getElementById('retrait-commentaire').value.trim();
  if (!montant || montant <= 0) return showToast('Montant invalide', 'error');
  addHistorique('Retrait', -montant, commentaire || 'Retrait manuel');
  saveDB();
  closeAllModals();
  if (currentSection === 'dashboard') renderDashboard();
  showToast(`${fmt(montant)} retiré de la caisse`, 'info');
  document.getElementById('retrait-montant').value = '';
  document.getElementById('retrait-commentaire').value = '';
}

// ──────────────────────────────────────────────────────────────
//  PARAMÈTRES
// ──────────────────────────────────────────────────────────────

function renderParametres() {
  document.getElementById('param-caisse-depart').value = db.caisseDepart;
}

function saveCaisseDepart() {
  const val = parseFloat(document.getElementById('param-caisse-depart').value);
  if (isNaN(val)) return showToast('Valeur invalide', 'error');
  db.caisseDepart = val;
  saveDB();
  showToast('Caisse de départ mise à jour', 'success');
}

function exportData() {
  const json = JSON.stringify(db, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `tumbleweed_mine_backup_${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Export téléchargé', 'success');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      confirmAction(
        'Importer les données ?',
        'Les données actuelles seront remplacées. Cette action est irréversible.',
        () => {
          db = Object.assign({ caisseDepart: 0, produits: [], achats: [], ventes: [],
                               commandes: [], depenses: [], employes: [], historique: [] }, parsed);
          saveDB();
          navigate('dashboard');
          showToast('Données importées avec succès', 'success');
        }
      );
    } catch (err) {
      showToast('Fichier JSON invalide', 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function confirmReset() {
  confirmAction(
    '⚠ Réinitialisation complète',
    'Toutes les données (stock, achats, ventes, commandes, dépenses, employés, historique) seront supprimées. Cette action est IRRÉVERSIBLE.',
    () => {
      db = { caisseDepart: 0, produits: [], achats: [], ventes: [], commandes: [], depenses: [], employes: [], historique: [], clotures: [], sheets: { apiKey: 'AIzaSyCj_olDrCLVzbmHmzPkp7OF7p2pGF3yfJA', sheetId: '1IlosqEk4VyXUuLQsjRvCEM9rY-71l6tehb4p4AmxdiU', lastSync: null, lignes: [] } };
      saveDB();
      navigate('dashboard');
      showToast('Application réinitialisée', 'warning');
    }
  );
}

// ──────────────────────────────────────────────────────────────
//  MODAL DE CONFIRMATION
// ──────────────────────────────────────────────────────────────

function confirmAction(title, message, onConfirm) {
  document.getElementById('confirm-title').textContent   = title;
  document.getElementById('confirm-message').textContent = message;
  const btn = document.getElementById('confirm-btn');
  btn.onclick = () => { closeAllModals(); onConfirm(); };
  openModal('modal-confirm');
}

// ──────────────────────────────────────────────────────────────
//  TOASTS
// ──────────────────────────────────────────────────────────────

/**
 * Affiche une notification temporaire.
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} type
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ──────────────────────────────────────────────────────────────
//  HORLOGE & DATE
// ──────────────────────────────────────────────────────────────

function updateClock() {
  const now = new Date();
  const clockEl = document.getElementById('sidebar-clock');
  const dateEl  = document.getElementById('header-date');
  const newTime = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const newDate = now.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  // Ne mettre à jour que si la valeur change (évite les reflows inutiles)
  if (clockEl.textContent !== newTime) clockEl.textContent = newTime;
  if (dateEl && dateEl.textContent !== newDate) dateEl.textContent = newDate;
}

// ──────────────────────────────────────────────────────────────
//  INITIALISATION
// ──────────────────────────────────────────────────────────────

function init() {
  // Charger les données depuis localStorage
  loadDB();

  // Navigation par le menu latéral
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(item.dataset.section);
    });
  });

  // Bouton mobile pour ouvrir/fermer le sidebar
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Boutons des modals qui ont besoin d'une préparation
  document.querySelector('[onclick="openModal(\'modal-produit\')"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    // Réinitialiser le formulaire
    document.getElementById('produit-id').value = '';
    document.getElementById('produit-nom').value = '';
    document.getElementById('produit-categorie').value = '';
    document.getElementById('produit-qte').value = '0';
    document.getElementById('produit-unite').value = '';
    document.getElementById('produit-prix-achat').value = '';
    document.getElementById('produit-prix-vente').value = '';
    document.getElementById('modal-produit-title').textContent = 'Nouveau produit';
  });

  // Relier les boutons "Nouvel achat", "Nouvelle vente", etc.
  // (ils appellent openModal directement depuis le HTML, mais on override ici)
  const achatBtn = document.querySelector('[onclick="openModal(\'modal-achat\')"]');
  if (achatBtn) achatBtn.onclick = openAchatModal;

  const venteBtn = document.querySelector('[onclick="openModal(\'modal-vente\')"]');
  if (venteBtn) venteBtn.onclick = openVenteModal;

  const cmdBtn = document.querySelector('[onclick="openModal(\'modal-commande\')"]');
  if (cmdBtn) cmdBtn.onclick = openCommandeModal;

  const depBtn = document.querySelector('[onclick="openModal(\'modal-depense\')"]');
  if (depBtn) depBtn.onclick = openDepenseModal;

  const empBtn = document.querySelector('[onclick="openModal(\'modal-employe\')"]');
  if (empBtn) empBtn.onclick = openEmployeModal;

  const prodBtn = document.querySelector('#section-stock .btn-gold');
  if (prodBtn) prodBtn.onclick = () => {
    document.getElementById('produit-id').value = '';
    document.getElementById('produit-nom').value = '';
    document.getElementById('produit-categorie').value = '';
    document.getElementById('produit-qte').value = '0';
    document.getElementById('produit-unite').value = '';
    document.getElementById('produit-prix-achat').value = '';
    document.getElementById('produit-prix-vente').value = '';
    document.getElementById('modal-produit-title').textContent = 'Nouveau produit';
    openModal('modal-produit');
  };

  // Fermer modal avec Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  // Horloge
  updateClock();
  setInterval(updateClock, 1000);

  // Afficher le dashboard par défaut
  navigate('dashboard');
}

// Lancer l'application au chargement du DOM
document.addEventListener('DOMContentLoaded', init);
